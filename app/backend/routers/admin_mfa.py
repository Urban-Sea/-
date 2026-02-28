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
import base64
import secrets
import logging
from datetime import datetime, timezone, timedelta

import pyotp
import qrcode
from fastapi import APIRouter, Depends, HTTPException, Header, Request

import main
from routers.admin import require_admin

logger = logging.getLogger(__name__)

router = APIRouter()

_SESSION_DURATION_HOURS = 24
_ISSUER_NAME = "OpenRegimeAdmin"


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

    # DB に保存（未確認状態: enabled=False）
    if existing.data:
        supabase.table("admin_mfa").update({
            "secret_enc": secret,
            "enabled": False,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("user_id", admin_id).execute()
    else:
        supabase.table("admin_mfa").insert({
            "user_id": admin_id,
            "secret_enc": secret,
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

    secret = result.data[0]["secret_enc"]
    totp = pyotp.TOTP(secret)

    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid code")

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

    secret = result.data[0]["secret_enc"]
    totp = pyotp.TOTP(secret)

    if not totp.verify(code, valid_window=1):
        raise HTTPException(status_code=401, detail="Invalid code")

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
