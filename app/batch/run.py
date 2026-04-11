#!/usr/bin/env python3
"""
バッチデータ更新 CLI

Usage:
  python app/batch/run.py                     # 全実行（3年分 + Layer再計算）
  python app/batch/run.py --daily             # 日次: Yahoo(14日) + FRED/SRF(3年分) + 週次失業保険
  python app/batch/run.py --weekly            # 週次: FRBバランスシート, SRF, MMF, 雇用統計 + Layer再計算
  python app/batch/run.py --fred              # FRED のみ（流動性）
  python app/batch/run.py --yahoo             # Yahoo のみ
  python app/batch/run.py --srf              # SRF のみ
  python app/batch/run.py --employment       # 雇用データのみ（weekly_claims + economic_indicators）
  python app/batch/run.py --calc             # Layer計算のみ
  python app/batch/run.py --full             # 15年分フル取得 + Layer計算
  python app/batch/run.py --since 2025-01-01 # 指定日以降

スケジューリング例 (crontab -e):
  # 日次: 毎日 7:00 JST（米市場終了後）
  0 7 * * * cd /path/to/open-regime && python app/batch/run.py --daily >> logs/batch_daily.log 2>&1

  # 週次: 毎週土曜 8:00 JST（週次FRED更新後）
  0 8 * * 6 cd /path/to/open-regime && python app/batch/run.py --weekly >> logs/batch_weekly.log 2>&1

  # 月次: 毎月1日 9:00 JST（全データ3年分 + 修正検知 + Layer再計算）
  0 9 1 * * cd /path/to/open-regime && python app/batch/run.py >> logs/batch_monthly.log 2>&1
"""

import argparse
import logging
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

# プロジェクトルートをパスに追加（python app/batch/run.py で実行可能にする）
_project_root = str(Path(__file__).resolve().parent.parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from app.batch.config import (
    DEFAULT_LOOKBACK_YEARS,
    INCREMENTAL_LOOKBACK_DAYS,
    DAILY_LOOKBACK_DAYS,
    DAILY_FRED_LOOKBACK_DAYS,
    get_conn,
)

# ===== Batch Log Helper =====

def _log_start(job_type: str) -> int | None:
    """バッチログ開始を記録し、log_id を返す"""
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO batch_logs (job_type, status, started_at) "
                "VALUES (%s, 'running', %s) RETURNING id",
                (job_type, datetime.now().isoformat()),
            )
            row = cur.fetchone()
            return row[0] if row else None
    except Exception as e:
        logger.debug(f"batch_logs insert skipped: {e}")
        return None


def _log_finish(log_id: int | None, status: str = "success",
                records: int = 0, error_msg: str = None, details: dict = None):
    """バッチログ完了を記録"""
    if log_id is None:
        return
    try:
        import json
        conn = get_conn()
        now = datetime.now()
        with conn.cursor() as cur:
            cur.execute("SELECT started_at FROM batch_logs WHERE id = %s", (log_id,))
            old = cur.fetchone()
            duration = None
            if old and old[0]:
                started = old[0] if isinstance(old[0], datetime) else datetime.fromisoformat(str(old[0]).replace("Z", "").replace("+00:00", ""))
                duration = round((now - started).total_seconds(), 1)
            cur.execute(
                "UPDATE batch_logs SET status = %s, finished_at = %s, "
                "duration_seconds = %s, records_processed = %s, "
                "error_message = %s, details = %s WHERE id = %s",
                (status, now.isoformat(), duration, records,
                 error_msg, json.dumps(details) if details else None, log_id),
            )
    except Exception as e:
        logger.debug(f"batch_logs update skipped: {e}")
from app.batch.db import (
    upsert_credit_spreads,
    upsert_fed_balance_sheet,
    upsert_interest_rates,
    upsert_market_indicators,
    upsert_bank_sector,
    upsert_mmf_assets,
    upsert_srf_usage,
    upsert_weekly_claims,
    upsert_economic_indicators,
)
from app.batch.fetchers.fred import (
    fetch_credit_spreads,
    fetch_fed_balance_sheet,
    fetch_interest_rates,
    fetch_mmf_data,
    fetch_weekly_claims,
    fetch_employment_indicators,
    fetch_consumer_indicators,
)
from app.batch.fetchers.nyfed import fetch_srf_data
from app.batch.fetchers.yahoo import fetch_bank_sector, fetch_market_indicators
from app.batch.calculators.layer_stress import calculate_monthly_states

from app.batch.snapshot import take_daily_snapshot
import urllib.request

logger = logging.getLogger("batch")

# warmup は Docker 内部ネットワーク経由で直接叩く (nginx を経由しない)
# → 外部から ?purge=1 を叩けなくなる (nginx でブロック)
_API_GO_URL = "http://api-go:8080"
_API_PYTHON_URL = "http://api-python:8081"

# 2026-04-09: warmup 対象を「実際にキャッシュ実装済みエンドポイント」だけに絞る。
# api-go ハンドラのうち Redis cache を持つのは fx と employment (本日追加) のみ。
# liquidity / market-state / stocks は cache 未実装なので warmup を打っても重い計算が
# 走って結果が捨てられるだけの無駄な DB 負荷になるので除外。
# /api/regime は api-python が serve しているので Python の cache_get/cache_set が効く。
WARMUP_ENDPOINTS = [
    (_API_PYTHON_URL, "/api/regime"),                                       # api-python (24h cache)
    (_API_GO_URL, "/api/employment/risk-score?purge=1"),                    # api-go (24h cache)
    (_API_GO_URL, "/api/employment/risk-history?months=350&purge=1"),       # api-go (24h cache)
]

# api-go の ?purge=1 認証用ヘッダ。
# api-go config.go の WarmupToken と一致しなければ 403 になる。
WARMUP_TOKEN = os.getenv("WARMUP_TOKEN", "")


def _warmup_cache():
    """API キャッシュをウォームアップ (cron 後に対象エンドポイントを ?purge=1 で叩いて再計算 + cache 更新)"""
    logger.info("--- Cache warmup ---")
    headers = {}
    if WARMUP_TOKEN:
        headers["X-Warmup-Token"] = WARMUP_TOKEN
    else:
        logger.warning("WARMUP_TOKEN env var not set — purge endpoints will return 403")

    for base_url, ep in WARMUP_ENDPOINTS:
        try:
            req = urllib.request.Request(f"{base_url}{ep}", headers=headers)
            urllib.request.urlopen(req, timeout=60)
            logger.info(f"  ✓ {ep}")
        except Exception as e:
            logger.warning(f"  ✗ {ep}: {e}")


# ===== データ取得関数 =====

def _run_fred(start: str, end: str):
    """FRED 4テーブル取得 + upsert"""
    rows = fetch_fed_balance_sheet(start, end)
    upsert_fed_balance_sheet(rows)

    rows = fetch_interest_rates(start, end)
    upsert_interest_rates(rows)

    rows = fetch_credit_spreads(start, end)
    upsert_credit_spreads(rows)

    rows = fetch_mmf_data(start, end)
    upsert_mmf_assets(rows)


def _run_yahoo(start: str, end: str):
    """Yahoo 2テーブル取得 + upsert"""
    rows = fetch_market_indicators(start, end)
    upsert_market_indicators(rows)

    rows = fetch_bank_sector(start, end)
    upsert_bank_sector(rows)


def _run_srf(start: str, end: str):
    """NY Fed SRF 取得 + upsert"""
    rows = fetch_srf_data(start, end)
    upsert_srf_usage(rows)


def _run_employment(start: str, end: str):
    """雇用データ取得 + upsert（weekly_claims + economic_indicators + 消費者系列）"""
    rows = fetch_weekly_claims(start, end)
    upsert_weekly_claims(rows)

    rows = fetch_employment_indicators(start, end)
    upsert_economic_indicators(rows)

    rows = fetch_consumer_indicators(start, end)
    upsert_economic_indicators(rows)


def _run_calc():
    """Layer Stress + Market State 計算"""
    calculate_monthly_states(start_date="2010-01-01")


# ===== スケジュール別グループ =====

def _run_daily(end: str):
    """日次バッチ: Yahoo は直近14日、FRED/NY Fed は3年分（修正検知用）"""
    logger.info("--- Daily batch ---")

    # FRED 3年分（修正検知あり）
    fred_start = (datetime.now() - timedelta(days=DAILY_FRED_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    logger.info(f"FRED/NY Fed: {fred_start} → {end} (修正検知あり)")

    rows = fetch_interest_rates(fred_start, end)
    upsert_interest_rates(rows)

    rows = fetch_credit_spreads(fred_start, end)
    upsert_credit_spreads(rows)

    # NY Fed SRF も3年分
    rows = fetch_srf_data(fred_start, end)
    upsert_srf_usage(rows)

    # 週次失業保険（毎木曜更新、3年分で修正検知）
    rows = fetch_weekly_claims(fred_start, end)
    upsert_weekly_claims(rows)

    # Yahoo は直近14日（株価は修正されない）
    yahoo_start = (datetime.now() - timedelta(days=DAILY_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    logger.info(f"Yahoo: {yahoo_start} → {end}")

    rows = fetch_market_indicators(yahoo_start, end)
    upsert_market_indicators(rows)

    rows = fetch_bank_sector(yahoo_start, end)
    upsert_bank_sector(rows)

    # 期限切れ stock_cache を掃除
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM stock_cache WHERE expires_at < %s", (datetime.now().isoformat(),))
        logger.info("Cleaned expired stock_cache rows")
    except Exception as e:
        logger.debug(f"stock_cache cleanup skipped: {e}")

    # ポートフォリオスナップショット（市場データ取得後に実行）
    logger.info("--- Portfolio snapshot ---")
    try:
        take_daily_snapshot(snapshot_date=end)
    except Exception as e:
        logger.warning(f"Portfolio snapshot failed (non-fatal): {e}")


def _run_weekly(start: str, end: str):
    """週次更新データ: FRBバランスシート(WALCL, WTREGEN), RRP, SRF"""
    logger.info("--- Weekly batch ---")

    rows = fetch_fed_balance_sheet(start, end)
    upsert_fed_balance_sheet(rows)

    rows = fetch_srf_data(start, end)
    upsert_srf_usage(rows)

    # MMF は四半期だが、週次で確認しても害はない
    rows = fetch_mmf_data(start, end)
    upsert_mmf_assets(rows)

    # 雇用統計（月次だが週次チェックで修正検知）
    rows = fetch_employment_indicators(start, end)
    upsert_economic_indicators(rows)

    # 消費者・構造指標（実質個人所得, 消費者信頼感, クレカ延滞率, コアCPI, 失業者数）
    rows = fetch_consumer_indicators(start, end)
    upsert_economic_indicators(rows)

    # 週次データ更新後は Layer 再計算
    _run_calc()


# ===== CLI =====

def main():
    parser = argparse.ArgumentParser(description="バッチデータ更新")
    parser.add_argument("--daily", action="store_true",
                        help="日次: Yahoo(14日) + FRED/NY Fed(3年分, 修正検知)")
    parser.add_argument("--weekly", action="store_true",
                        help="週次: FRBバランスシート, SRF, MMF + Layer再計算")
    parser.add_argument("--fred", action="store_true", help="FRED のみ")
    parser.add_argument("--yahoo", action="store_true", help="Yahoo のみ")
    parser.add_argument("--srf", action="store_true", help="SRF のみ")
    parser.add_argument("--employment", action="store_true",
                        help="雇用データのみ（weekly_claims + economic_indicators）")
    parser.add_argument("--calc", action="store_true", help="Layer計算のみ")
    parser.add_argument("--full", action="store_true", help="15年分フル取得 + Layer計算")
    parser.add_argument("--snapshot", action="store_true",
                        help="ポートフォリオスナップショットのみ")
    parser.add_argument("--backfill-snapshots", action="store_true",
                        help="過去の取引履歴からスナップショットをバックフィル")
    parser.add_argument("--notify", action="store_true",
                        help="発掘銘柄のentry判定 → Slack/Discord通知")
    parser.add_argument("--since", type=str, help="指定日以降を取得 (YYYY-MM-DD)")
    parser.add_argument("--verbose", "-v", action="store_true", help="DEBUG ログ")
    args = parser.parse_args()

    # ログ設定
    import os as _os
    level = logging.DEBUG if args.verbose else logging.INFO
    if _os.getenv("ENVIRONMENT") == "production":
        # 本番: JSON ファイル出力 (Wazuh SIEM 連携用)
        import logging.handlers as _lh
        from pythonjsonlogger import jsonlogger as _jl
        log_dir = "/var/log/open-regime/batch"
        try:
            _os.makedirs(log_dir, exist_ok=True)
        except Exception:
            pass
        formatter = _jl.JsonFormatter(
            "%(asctime)s %(name)s %(levelname)s %(message)s",
            rename_fields={"asctime": "time", "levelname": "level"},
        )
        file_h = _lh.RotatingFileHandler(
            filename=f"{log_dir}/app.log",
            maxBytes=50 * 1024 * 1024,
            backupCount=3,
        )
        file_h.setFormatter(formatter)
        stdout_h = logging.StreamHandler()
        stdout_h.setFormatter(formatter)
        root = logging.getLogger()
        root.setLevel(level)
        root.handlers.clear()
        root.addHandler(file_h)
        root.addHandler(stdout_h)
    else:
        logging.basicConfig(
            level=level,
            format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
            datefmt="%H:%M:%S",
        )

    # 日付範囲
    end = datetime.now().strftime("%Y-%m-%d")
    if args.full:
        start = (datetime.now() - timedelta(days=365 * DEFAULT_LOOKBACK_YEARS)).strftime("%Y-%m-%d")
    elif args.since:
        start = args.since
    else:
        # デフォルト: 3年分
        start = (datetime.now() - timedelta(days=INCREMENTAL_LOOKBACK_DAYS)).strftime("%Y-%m-%d")

    any_specific = args.fred or args.yahoo or args.srf or args.employment or args.calc or args.daily or args.weekly or args.snapshot or args.notify or getattr(args, 'backfill_snapshots', False)
    t0 = time.time()

    # ジョブ種別を決定
    if args.daily:
        job_type = "daily"
    elif args.weekly:
        job_type = "weekly"
    elif args.fred:
        job_type = "fred"
    elif args.yahoo:
        job_type = "yahoo"
    elif args.srf:
        job_type = "srf"
    elif args.employment:
        job_type = "employment"
    elif args.calc:
        job_type = "calc"
    elif args.notify:
        job_type = "notify"
    elif args.snapshot:
        job_type = "snapshot"
    elif getattr(args, 'backfill_snapshots', False):
        job_type = "backfill_snapshots"
    elif args.full:
        job_type = "full"
    else:
        job_type = "full"

    log_id = _log_start(job_type)
    logger.info(f"=== Batch run: {start} → {end} ({job_type}) ===")

    try:
        if args.notify:
            from app.batch.notify import check_and_notify, check_exit_signals
            check_and_notify()
            check_exit_signals()

        elif args.snapshot:
            take_daily_snapshot(snapshot_date=end)

        elif getattr(args, 'backfill_snapshots', False):
            from app.batch.backfill_snapshots import backfill_snapshots
            since = args.since or (datetime.now() - timedelta(days=365 * 2)).strftime("%Y-%m-%d")
            backfill_snapshots(since=since)

        elif args.daily:
            _run_daily(end)
            _warmup_cache()

        elif args.weekly:
            _run_weekly(start, end)
            _warmup_cache()

        else:
            if args.fred or not any_specific:
                _run_fred(start, end)

            if args.yahoo or not any_specific:
                _run_yahoo(start, end)

            if args.srf or not any_specific:
                _run_srf(start, end)

            if args.employment or not any_specific:
                _run_employment(start, end)

            if args.calc or args.full or not any_specific:
                _run_calc()

            if not any_specific or args.full:
                _warmup_cache()

        elapsed = time.time() - t0
        logger.info(f"=== Done in {elapsed:.1f}s ===")
        _log_finish(log_id, status="success")

    except Exception:
        logger.exception("Batch run failed")
        elapsed = time.time() - t0
        import traceback
        _log_finish(log_id, status="error", error_msg=traceback.format_exc()[:1000])
        sys.exit(1)


if __name__ == "__main__":
    main()
