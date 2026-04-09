"""
finvizfinance が返す文字列カラムを Python の数値に変換するヘルパー群。

finviz の DataFrame は全部 dtype=object で、以下のような文字列が混在する:
  - "319.01"      → float
  - "12.34%"      → 0.1234 (10進)
  - "-5.10%"      → -0.051
  - "1.23M"       → 1_230_000
  - "500K"        → 500_000
  - "2.5B"        → 2_500_000_000
  - "302.10B"     → market cap (B = billion)
  - "N/A" / "-"   → None
  - "" / NaN      → None

NaN / None / 不正値はすべて None に正規化する (KeyError を下流で防ぐ)。
"""
from __future__ import annotations

import math
from typing import Any


def _is_missing(value: Any) -> bool:
    """None / NaN / 空文字 / "-" / "N/A" を欠損として判定"""
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    if isinstance(value, str):
        s = value.strip()
        if s == "" or s == "-" or s.upper() == "N/A":
            return True
    return False


def parse_float(value: Any) -> float | None:
    """純粋な数値文字列 → float。欠損は None。

    例:
        "319.01"  → 319.01
        "1.94"    → 1.94
        "N/A"     → None
        "-"       → None
        ""        → None
        319.01    → 319.01 (既に float ならそのまま)
    """
    if _is_missing(value):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip().replace(",", ""))
    except (ValueError, TypeError):
        return None


def parse_pct(value: Any) -> float | None:
    """パーセント文字列 → 10進 float。欠損は None。

    例:
        "12.34%"  → 0.1234
        "-5.10%"  → -0.051
        "0.00%"   → 0.0
        "-"       → None
        ""        → None
    """
    if _is_missing(value):
        return None
    if isinstance(value, (int, float)):
        # 既に数値の場合: finviz は 10進形式 (-0.0221) で返すケースもある
        return float(value)
    s = str(value).strip().replace(",", "")
    if s.endswith("%"):
        s = s[:-1].strip()
    try:
        return float(s) / 100.0
    except (ValueError, TypeError):
        return None


def parse_volume(value: Any) -> float | None:
    """出来高 / 時価総額の文字列 → float。欠損は None。

    finviz は K (千) / M (百万) / B (十億) / T (兆) のサフィックスで返す。

    例:
        "1.23M"    → 1_230_000
        "500K"     → 500_000
        "2.5B"     → 2_500_000_000
        "302.10B"  → 302_100_000_000
        "1.5T"     → 1_500_000_000_000
        "1234567"  → 1234567.0 (サフィックスなしも許容)
        "-"        → None
    """
    if _is_missing(value):
        return None
    if isinstance(value, (int, float)):
        return float(value)

    s = str(value).strip().replace(",", "")
    if not s:
        return None

    multiplier = 1.0
    suffix = s[-1].upper()
    if suffix == "K":
        multiplier = 1_000.0
        s = s[:-1]
    elif suffix == "M":
        multiplier = 1_000_000.0
        s = s[:-1]
    elif suffix == "B":
        multiplier = 1_000_000_000.0
        s = s[:-1]
    elif suffix == "T":
        multiplier = 1_000_000_000_000.0
        s = s[:-1]

    try:
        return float(s) * multiplier
    except (ValueError, TypeError):
        return None
