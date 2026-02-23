"""
バッチ処理 共通設定

環境変数:
  SUPABASE_URL  — Supabase プロジェクトURL
  SUPABASE_KEY  — service_role キー（書き込みに必要）
  FRED_API_KEY  — FRED API キー（取得: https://fred.stlouisfed.org/docs/api/api_key.html）
"""

import os
import logging
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

logger = logging.getLogger("batch")

# ===== .env 読み込み =====
# プロジェクトルート（株式AI/）の .env を自動で読む
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(_env_path)

# ===== 環境変数 =====
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
FRED_API_KEY = os.environ["FRED_API_KEY"]

# ===== FRED 系列ID =====
# FRED API ドキュメント: https://fred.stlouisfed.org/docs/api/fred/series_observations.html
FRED_SERIES = {
    # FRBバランスシート（週次）
    "reserves": "TOTRESNS",       # 準備預金         確認: https://fred.stlouisfed.org/series/TOTRESNS
    "rrp": "RRPONTSYD",           # リバースレポ     確認: https://fred.stlouisfed.org/series/RRPONTSYD
    "tga": "WTREGEN",             # TGA              確認: https://fred.stlouisfed.org/series/WTREGEN
    "soma": "WALCL",              # SOMA総資産       確認: https://fred.stlouisfed.org/series/WALCL

    # 金利（日次/月次）
    "fed_funds": "FEDFUNDS",      # FFレート         確認: https://fred.stlouisfed.org/series/FEDFUNDS
    "treasury_2y": "DGS2",        # 2年国債          確認: https://fred.stlouisfed.org/series/DGS2
    "treasury_10y": "DGS10",      # 10年国債         確認: https://fred.stlouisfed.org/series/DGS10

    # クレジットスプレッド（日次）
    "hy_spread": "BAMLH0A0HYM2",  # HYスプレッド     確認: https://fred.stlouisfed.org/series/BAMLH0A0HYM2
    "ig_spread": "BAMLC0A0CM",    # IGスプレッド     確認: https://fred.stlouisfed.org/series/BAMLC0A0CM

    # MMF（四半期）
    "mmf": "MMMFFAQ027S",         # MMF総資産        確認: https://fred.stlouisfed.org/series/MMMFFAQ027S
}

# 信用取引残高（手動更新 — 公開APIなし）
# 確認: https://www.finra.org/investors/learn-to-invest/advanced-investing/margin-statistics

# ===== FRED 雇用系列ID =====
FRED_EMPLOYMENT_SERIES = {
    # 週次（毎木曜更新）
    "initial_claims": "ICSA",           # 新規失業保険申請   確認: https://fred.stlouisfed.org/series/ICSA
    "continued_claims": "CCSA",         # 継続失業保険申請   確認: https://fred.stlouisfed.org/series/CCSA
    "initial_claims_4w_avg": "IC4WSA",  # 新規申請4週平均    確認: https://fred.stlouisfed.org/series/IC4WSA

    # 月次（毎月第1金曜 = 雇用統計発表）
    "nfp": "PAYEMS",                    # 非農業部門雇用者数 確認: https://fred.stlouisfed.org/series/PAYEMS
    "u3_rate": "UNRATE",                # 失業率(U3)        確認: https://fred.stlouisfed.org/series/UNRATE
    "u6_rate": "U6RATE",                # 実質失業率(U6)    確認: https://fred.stlouisfed.org/series/U6RATE
    "avg_hourly_earnings": "CES0500000003",  # 平均時給      確認: https://fred.stlouisfed.org/series/CES0500000003
    "labor_force_participation": "CIVPART",  # 労働参加率    確認: https://fred.stlouisfed.org/series/CIVPART
    "jolts_openings": "JTSJOL",         # JOLTS求人件数      確認: https://fred.stlouisfed.org/series/JTSJOL
}

# ===== FRED 消費者・構造系列ID =====
FRED_CONSUMER_SERIES = {
    # 消費者カテゴリ（月次/四半期）
    "real_personal_income": "W875RX1",      # 実質個人所得（移転除く） 月次  確認: https://fred.stlouisfed.org/series/W875RX1
    "consumer_sentiment": "UMCSENT",         # ミシガン消費者信頼感    月次  確認: https://fred.stlouisfed.org/series/UMCSENT
    "credit_card_delinquency": "DRCCLACBS",  # クレカ延滞率           四半期 確認: https://fred.stlouisfed.org/series/DRCCLACBS
    # インフレ乖離計算用
    "core_cpi": "CPILFESL",                  # コアCPI(食料・エネルギー除く) 月次 確認: https://fred.stlouisfed.org/series/CPILFESL
    # 構造カテゴリ（JOLTS比率計算用）
    "unemployed_persons": "UNEMPLOY",        # 失業者数（千人）       月次  確認: https://fred.stlouisfed.org/series/UNEMPLOY
}

# 手動のままのデータ:
#   - ADP雇用統計: FRED(ADPWNUSNERSA)は更新遅延あり → manual_inputs テーブルで管理
#   - Challenger解雇: FRED系列なし → manual_inputs テーブルで管理
#   - Truflation: API有料 → manual_inputs テーブルで管理
#   - NFP改定メモ: 人間の判断が必要 → 手動

# ===== Yahoo Finance ティッカー =====
YAHOO_TICKERS = {
    "vix": "^VIX",                # VIX指数          確認: https://finance.yahoo.com/quote/%5EVIX/
    "dxy": "DX-Y.NYB",            # ドルインデックス 確認: https://finance.yahoo.com/quote/DX-Y.NYB/
    "sp500": "^GSPC",             # S&P500           確認: https://finance.yahoo.com/quote/%5EGSPC/
    "nasdaq": "^IXIC",            # NASDAQ           確認: https://finance.yahoo.com/quote/%5EIXIC/
    "russell2000": "^RUT",        # Russell 2000     確認: https://finance.yahoo.com/quote/%5ERUT/
    "kre": "KRE",                 # 地方銀行ETF      確認: https://finance.yahoo.com/quote/KRE/
}

# ===== NY Fed SRF =====
# 確認: https://markets.newyorkfed.org/markets/domestic-market-operations/results
NYFED_SRF_URL = "https://markets.newyorkfed.org/api/rp/results/search.json"

# ===== フェッチ期間 =====
DEFAULT_LOOKBACK_YEARS = 25         # フル実行時（2001年〜、ITバブル崩壊+GFC含む）
INCREMENTAL_LOOKBACK_DAYS = 1095    # 通常実行時（3年分 = 修正検知用）
DAILY_LOOKBACK_DAYS = 14            # daily の Yahoo 用（株価は修正されない）
DAILY_FRED_LOOKBACK_DAYS = 1095     # daily の FRED/NY Fed 用（3年分 = 修正検知）

# ===== Supabase クライアント =====
_supabase_client: Client | None = None


def get_supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info(f"Supabase connected: {SUPABASE_URL[:40]}...")
    return _supabase_client
