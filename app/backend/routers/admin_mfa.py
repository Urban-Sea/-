"""
/api/admin/mfa — 管理者 TOTP MFA エンドポイント

- GET  /status         MFA 設定状態を返す
- POST /setup          TOTP シークレット生成 + QR コード (base64)
- POST /setup/verify   セットアップ確認 → セッショントークン発行
- POST /verify         ログイン時 TOTP 検証 → セッショントークン発行
- GET  /session        セッショントークン検証
"""

import hashlib
import io
import os
import base64
import secrets
import logging
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta

import pyotp
import qrcode
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, HTTPException, Header, Request

import main
from routers.admin import require_admin

logger = logging.getLogger(__name__)

router = APIRouter()

_SESSION_DURATION_HOURS = 1
_ISSUER_NAME = "OpenRegimeAdmin"

# ── C2: TOTP シークレット暗号化 (AES-256-GCM) ──
_MFA_ENCRYPTION_KEY = os.getenv("MFA_ENCRYPTION_KEY", "")


def _get_aesgcm() -> AESGCM:
    if not _MFA_ENCRYPTION_KEY or len(_MFA_ENCRYPTION_KEY) != 64:
        raise HTTPException(status_code=503, detail="MFA encryption not configured")
    return AESGCM(bytes.fromhex(_MFA_ENCRYPTION_KEY))


def _encrypt_secret(plaintext: str) -> str:
    """TOTP シークレットを AES-256-GCM で暗号化。nonce:ciphertext (hex) 形式。"""
    aesgcm = _get_aesgcm()
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return nonce.hex() + ":" + ct.hex()


def _decrypt_secret(encrypted: str) -> str:
    """暗号化された TOTP シークレットを復号。レガシー平文も後方互換で処理。"""
    if ":" not in encrypted:
        logger.warning("Legacy plaintext TOTP secret detected — re-encrypt on next setup")
        return encrypted
    aesgcm = _get_aesgcm()
    nonce_hex, ct_hex = encrypted.split(":", 1)
    return aesgcm.decrypt(bytes.fromhex(nonce_hex), bytes.fromhex(ct_hex), None).decode()


# ── C4: TOTP ブルートフォース対策 ──
_MAX_ATTEMPTS = 5
_LOCKOUT_SECONDS = 900  # 15分
_attempt_tracker: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(user_id: str) -> None:
    """ユーザー別の TOTP 試行回数をチェック。超過時は 429。"""
    now = time.time()
    cutoff = now - _LOCKOUT_SECONDS
    _attempt_tracker[user_id] = [t for t in _attempt_tracker[user_id] if t > cutoff]
    if len(_attempt_tracker[user_id]) >= _MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail=f"Too many attempts. Try again in {_LOCKOUT_SECONDS // 60} minutes.",
        )


def _record_attempt(user_id: str) -> None:
    _attempt_tracker[user_id].append(time.time())


def _clear_attempts(user_id: str) -> None:
    _attempt_tracker.pop(user_id, None)


# ── H3: TOTP リプレイ防止 ──
_used_codes: dict[str, dict[str, float]] = defaultdict(dict)


def _check_replay(user_id: str, code: str) -> None:
    """同一コードの再利用を検知。90秒以内に使われたコードは拒否。"""
    now = time.time()
    user_codes = _used_codes[user_id]
    expired = [c for c, exp in user_codes.items() if exp < now]
    for c in expired:
        del user_codes[c]
    if code in user_codes:
        raise HTTPException(status_code=401, detail="Code already used")


def _mark_code_used(user_id: str, code: str) -> None:
    _used_codes[user_id][code] = time.time() + 90


def _hash_token(token: str) -> str:
    """トークンを SHA-256 ハッシュ化"""
    return hashlib.sha256(token.encode()).hexdigest()


def _get_user_email(supabase, user_id: str) -> str:
    """user_id からメールアドレスを取得"""
    result = (
        supabase.table("users")
        .select("email")
        .eq("id", user_id)
        .limit(1)
        .execute()
    )
    return result.data[0]["email"] if result.data else "admin"


def _create_session_token(supabase, user_id: str) -> dict:
    """MFA セッショントークンを生成・DB 保存"""
    token = secrets.token_hex(32)
    token_hash = _hash_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=_SESSION_DURATION_HOURS)

    supabase.table("admin_mfa_sessions").insert({
        "user_id": user_id,
        "token_hash": token_hash,
        "expires_at": expires_at.isoformat(),
    }).execute()

    return {
        "token": token,
        "expires_at": expires_at.isoformat(),
    }


# ============================================================
# MFA Status
# ============================================================

@router.get("/status")
async def mfa_status(admin_id: str = Depends(require_admin)):
    """MFA の設定状態を返す"""
    supabase = main.get_supabase()
    result = (
        supabase.table("admin_mfa")
        .select("enabled")
        .eq("user_id", admin_id)
        .limit(1)
        .execute()
    )

    if not result.data:
        return {"mfa_enabled": False, "mfa_setup": False}

    return {
        "mfa_enabled": result.data[0]["enabled"],
        "mfa_setup": True,
    }


# ============================================================
# MFA Setup
# ============================================================

@router.post("/setup")
async def mfa_setup(admin_id: str = Depends(require_admin)):
    """TOTP シークレット生成 + QR コード返却"""
    supabase = main.get_supabase()

    # 既に有効な MFA がある場合は拒否
    existing = (
        supabase.table("admin_mfa")
        .select("enabled")
        .eq("user_id", admin_id)
        .limit(1)
        .execute()
    )
    if existing.data and existing.data[0]["enabled"]:
        raise HTTPException(status_code=409, detail="MFA already enabled")

    # H5: pending セットアップが既にある場合は拒否
    if existing.data and not existing.data[0]["enabled"]:
        raise HTTPException(
            status_code=409,
            detail="MFA setup already in progress. Complete verification or contact support.",
        )

    # TOTP シークレット生成
    secret = pyotp.random_base32()
    email = _get_user_email(supabase, admin_id)
    totp = pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(name=email, issuer_name=_ISSUER_NAME)

    # QR コード生成 (base64 PNG)
    img = qrcode.make(provisioning_uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_base64 = base64.b64encode(buf.getvalue()).decode()

    # C2: DB に暗号化して保存（未確認状態: enabled=False）
    encrypted_secret = _encrypt_secret(secret)
    supabase.table("admin_mfa").insert({
        "user_id": admin_id,
        "secret_enc": encrypted_secret,
        "enabled": False,
    }).execute()

    return {
        "secret": secret,
        "qr_code": f"data:image/png;base64,{qr_base64}",
        "provisioning_uri": provisioning_uri,
    }


# ============================================================
# MFA Setup Verify
# ============================================================

@router.post("/setup/verify")
async def mfa_setup_verify(
    request: Request,
    admin_id: str = Depends(require_admin),
):
    """セットアップ確認: 6桁コードで検証 → MFA 有効化 + トークン発行"""
    supabase = main.get_supabase()
    body = await request.json()
    code = str(body.get("code", "")).strip()

    if not code or len(code) != 6:
        raise HTTPException(status_code=400, detail="6-digit code required")

    # C4: ブルートフォースチェック
    _check_rate_limit(admin_id)

    # シークレット取得
    result = (
        supabase.table("admin_mfa")
        .select("secret_enc, enabled")
        .eq("user_id", admin_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="MFA setup not found. Call /setup first.")

    if result.data[0]["enabled"]:
        raise HTTPException(status_code=409, detail="MFA already enabled")

    # C2: 暗号化シークレットを復号
    secret = _decrypt_secret(result.data[0]["secret_enc"])
    totp = pyotp.TOTP(secret)

    if not totp.verify(code, valid_window=1):
        _record_attempt(admin_id)
        raise HTTPException(status_code=401, detail="Invalid code")

    # H3: リプレイチェック
    _check_replay(admin_id, code)
    _mark_code_used(admin_id, code)
    _clear_attempts(admin_id)

    # MFA を有効化
    supabase.table("admin_mfa").update({
        "enabled": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("user_id", admin_id).execute()

    # セッショントークン発行
    session = _create_session_token(supabase, admin_id)

    logger.info(f"MFA enabled for user {admin_id}")

    return {
        "status": "mfa_enabled",
        **session,
    }


# ============================================================
# MFA Verify (login)
# ============================================================

@router.post("/verify")
async def mfa_verify(
    request: Request,
    admin_id: str = Depends(require_admin),
):
    """ログイン時の TOTP 検証 → セッショントークン発行"""
    supabase = main.get_supabase()
    body = await request.json()
    code = str(body.get("code", "")).strip()

    if not code or len(code) != 6:
        raise HTTPException(status_code=400, detail="6-digit code required")

    # C4: ブルートフォースチェック
    _check_rate_limit(admin_id)

    # シークレット取得
    result = (
        supabase.table("admin_mfa")
        .select("secret_enc, enabled")
        .eq("user_id", admin_id)
        .limit(1)
        .execute()
    )
    if not result.data or not result.data[0]["enabled"]:
        raise HTTPException(status_code=404, detail="MFA not enabled")

    # C2: 暗号化シークレットを復号
    secret = _decrypt_secret(result.data[0]["secret_enc"])
    totp = pyotp.TOTP(secret)

    if not totp.verify(code, valid_window=1):
        _record_attempt(admin_id)
        raise HTTPException(status_code=401, detail="Invalid code")

    # H3: リプレイチェック
    _check_replay(admin_id, code)
    _mark_code_used(admin_id, code)
    _clear_attempts(admin_id)

    # セッショントークン発行
    session = _create_session_token(supabase, admin_id)

    return {
        "status": "verified",
        **session,
    }


# ============================================================
# MFA Session Check
# ============================================================

@router.get("/session")
async def mfa_session_check(
    admin_id: str = Depends(require_admin),
    x_mfa_token: str | None = Header(None),
):
    """MFA セッショントークンの有効性を検証"""
    if not x_mfa_token:
        return {"valid": False, "reason": "no_token"}

    supabase = main.get_supabase()
    token_hash = _hash_token(x_mfa_token)
    now = datetime.now(timezone.utc).isoformat()

    result = (
        supabase.table("admin_mfa_sessions")
        .select("id, expires_at")
        .eq("user_id", admin_id)
        .eq("token_hash", token_hash)
        .gte("expires_at", now)
        .limit(1)
        .execute()
    )

    if not result.data:
        return {"valid": False, "reason": "expired_or_invalid"}

    return {
        "valid": True,
        "expires_at": result.data[0]["expires_at"],
    }


# ============================================================
# H4: MFA Session Logout (server-side invalidation)
# ============================================================

@router.delete("/session")
async def mfa_logout(
    admin_id: str = Depends(require_admin),
    x_mfa_token: str | None = Header(None),
):
    """MFA セッショントークンをサーバー側で無効化"""
    if not x_mfa_token:
        return {"status": "no_token"}

    supabase = main.get_supabase()
    token_hash = _hash_token(x_mfa_token)

    supabase.table("admin_mfa_sessions").delete().eq(
        "user_id", admin_id
    ).eq("token_hash", token_hash).execute()

    logger.info("MFA session invalidated for user %s", admin_id)
    return {"status": "logged_out"}
