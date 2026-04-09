"""
スキャン結果の JSON 書き出しとターミナル表示。

JSON フォーマットは Phase B の HTTP POST body と同形にする
(plan の "Output JSON の形" 参照)。
"""
from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any


def _safe(value: Any) -> Any:
    """JSON 化できない値 (NaN, numpy 型等) を安全な形に変換"""
    if value is None:
        return None
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    # numpy/pandas のスカラー型を Python 型に
    try:
        if hasattr(value, "item"):
            return _safe(value.item())
    except Exception:
        pass
    return value


def _safe_dict(d: dict[str, Any]) -> dict[str, Any]:
    return {k: _safe(v) for k, v in d.items()}


def build_payload(
    *,
    scan_date: str,
    scan_started_at: datetime,
    scan_finished_at: datetime,
    scanner_version: str,
    finvizfinance_version: str,
    preset_counts: dict[str, int],
    total_unique: int,
    threshold: float,
    discount_floor_applied: bool,
    selected: list[dict[str, Any]],
) -> dict[str, Any]:
    """JSON payload を組み立てる。

    Args:
        selected: select_top の出力
                  各 dict: {ticker, presets, finviz_score, fundament}
    """
    return {
        "scan_date": scan_date,
        "scan_started_at": scan_started_at.isoformat(),
        "scan_finished_at": scan_finished_at.isoformat(),
        "scanner_version": scanner_version,
        "finvizfinance_version": finvizfinance_version,
        "preset_counts": preset_counts,
        "total_unique": total_unique,
        "after_threshold": len(selected),
        "threshold": threshold,
        "discount_floor_applied": discount_floor_applied,
        "tickers": [
            {
                "ticker": item["ticker"],
                "presets": item["presets"],
                "finviz_score": item["finviz_score"],
                "fundament": _safe_dict(item.get("fundament", {})),
            }
            for item in selected
        ],
    }


def write_json(payload: dict[str, Any], output_path: Path) -> None:
    """payload を JSON ファイルに書き出す (atomic write)"""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = output_path.with_suffix(output_path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
    tmp.replace(output_path)


def print_summary(payload: dict[str, Any], *, top_display: int = 15) -> None:
    """ターミナルに結果サマリを表示"""
    print()
    print("=" * 70)
    print(f"  Finviz Discovery Scan — {payload['scan_date']}")
    print("=" * 70)
    print(f"  scanner v{payload['scanner_version']} / "
          f"finvizfinance v{payload['finvizfinance_version']}")
    print()

    # プリセット別件数
    print("  Preset hits:")
    for name, count in payload["preset_counts"].items():
        print(f"    {name:12s} {count:5d}")
    print(f"    {'TOTAL UNIQ':12s} {payload['total_unique']:5d}")
    print()

    floor_note = " (Discount floor applied)" if payload["discount_floor_applied"] else ""
    print(
        f"  Selected: {payload['after_threshold']} tickers "
        f"(threshold >= {payload['threshold']}){floor_note}"
    )
    print()

    if not payload["tickers"]:
        print("  (No tickers passed the threshold)")
        return

    # 上位 N を表形式で
    print(f"  Top {min(top_display, len(payload['tickers']))} by finviz_score:")
    print("  " + "-" * 66)
    print(f"  {'Ticker':<8} {'Score':<6} {'Presets':<28} {'Price':<10} {'RSI':<6}")
    print("  " + "-" * 66)
    for item in payload["tickers"][:top_display]:
        ticker = item["ticker"]
        score = item["finviz_score"]
        presets = ",".join(item["presets"])
        fundament = item.get("fundament", {})
        price = fundament.get("Price", "-")
        rsi = fundament.get("RSI", "-")
        if isinstance(price, (int, float)):
            price = f"{price:.2f}"
        if isinstance(rsi, (int, float)):
            rsi = f"{rsi:.1f}"
        print(f"  {ticker:<8} {score:<6.2f} {presets[:28]:<28} {str(price):<10} {str(rsi):<6}")

    print("  " + "-" * 66)
    print()
