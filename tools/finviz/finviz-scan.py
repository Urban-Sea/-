#!/usr/bin/env python3
"""
finviz-scan.py — open-regime Discovery Phase A スキャンスクリプト

ローカル実行専用。VPS では動かさない (architecture-current.md の隔離方針)。

使い方:
    python tools/finviz/finviz-scan.py             # 全プリセット、JSON 保存
    python tools/finviz/finviz-scan.py --dry-run   # 表示のみ、保存しない
    python tools/finviz/finviz-scan.py --preset pullback --dry-run

詳細は --help または tools/finviz/README.md
"""
from __future__ import annotations

import argparse
import logging
import logging.handlers
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# モジュールを同ディレクトリから import (パッケージ化していないため)
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from _output import build_payload, print_summary, write_json
from _scanner import get_finvizfinance_version, run_presets
from _scorer import calc_score, select_top

SCANNER_VERSION = "0.1.0"
DEFAULT_OUTPUT_DIR = SCRIPT_DIR / "output"
DEFAULT_PRESETS_PATH = SCRIPT_DIR / "presets.yml"
LOG_PATH = DEFAULT_OUTPUT_DIR / "scan.log"


def setup_logging(verbose: bool, quiet: bool) -> None:
    """ファイル + stderr ロガーをセットアップ"""
    level = logging.DEBUG if verbose else (logging.WARNING if quiet else logging.INFO)
    fmt = "%(asctime)s %(levelname)s %(name)s %(message)s"
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()

    # ファイル (rotating)
    DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fh = logging.handlers.RotatingFileHandler(
        LOG_PATH, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    fh.setFormatter(logging.Formatter(fmt))
    root.addHandler(fh)

    # stderr (quiet 時は WARNING 以上のみ)
    if not quiet:
        sh = logging.StreamHandler(sys.stderr)
        sh.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
        sh.setLevel(level)
        root.addHandler(sh)


def load_presets(path: Path) -> dict:
    """presets.yml を読み込む"""
    try:
        import yaml
    except ImportError as e:
        raise ImportError(
            "PyYAML is not installed. Run: pip install -r tools/finviz/requirements.txt"
        ) from e

    if not path.exists():
        raise FileNotFoundError(f"presets file not found: {path}")
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ValueError(f"presets file must be a YAML mapping, got {type(data).__name__}")
    return data


def aggregate_candidates(results: list, weights: dict) -> tuple[list[dict], dict[str, int]]:
    """プリセット結果をマージしてスコア計算済の候補リストを返す。

    Returns:
        (candidates, preset_counts)
        - candidates: [{ticker, presets, finviz_score, fundament}, ...]
        - preset_counts: プリセット別ヒット件数
    """
    by_ticker: dict[str, dict] = {}
    preset_counts: dict[str, int] = {}

    for result in results:
        preset_counts[result.name] = result.count
        if not result.ok or result.df.empty:
            continue
        df = result.df
        if "Ticker" not in df.columns:
            logging.warning("preset %s has no 'Ticker' column", result.name)
            continue
        for _, row in df.iterrows():
            ticker = str(row["Ticker"]).strip().upper()
            if not ticker:
                continue
            row_dict = {k: row[k] for k in df.columns}
            entry = by_ticker.get(ticker)
            if entry is None:
                # 初出: fundament を取得
                by_ticker[ticker] = {
                    "ticker": ticker,
                    "presets": [result.name],
                    "fundament": row_dict,
                }
            else:
                if result.name not in entry["presets"]:
                    entry["presets"].append(result.name)
                # fundament カラムをマージ (技術系 + ファンダ系を統合)
                for k, v in row_dict.items():
                    if k not in entry["fundament"]:
                        entry["fundament"][k] = v

    # スコア計算
    candidates: list[dict] = []
    for entry in by_ticker.values():
        breakdown = calc_score(entry["fundament"], weights=weights)
        entry["finviz_score"] = breakdown.total
        candidates.append(entry)

    return candidates, preset_counts


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Finviz Discovery scanner for open-regime Phase A"
    )
    parser.add_argument(
        "--preset",
        default=os.environ.get("FINVIZ_PRESET", "all"),
        help="Preset name (momentum/pullback/quality/breakout) or 'all' (default: all)",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=int(os.environ.get("FINVIZ_TOP", "50")),
        help="Global top N cap after threshold filter (default: 50)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=float(os.environ.get("FINVIZ_THRESHOLD", "1.5")),
        help="Minimum finviz_score (default: 1.5)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output JSON path (default: tools/finviz/output/YYYY-MM-DD.json)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print results only, do not write JSON",
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Show finviz progress bars and DEBUG logs",
    )
    parser.add_argument(
        "--quiet", action="store_true",
        help="Suppress all output except WARNING/ERROR",
    )
    parser.add_argument(
        "--presets-file",
        type=Path,
        default=DEFAULT_PRESETS_PATH,
        help=f"Path to presets.yml (default: {DEFAULT_PRESETS_PATH})",
    )
    args = parser.parse_args()

    if args.verbose and args.quiet:
        print("ERROR: --verbose and --quiet are mutually exclusive", file=sys.stderr)
        return 1

    setup_logging(args.verbose, args.quiet)
    log = logging.getLogger("finviz-scan")

    log.info(
        "scanner=%s finvizfinance=%s preset=%s top=%d threshold=%.2f dry_run=%s",
        SCANNER_VERSION,
        get_finvizfinance_version(),
        args.preset,
        args.top,
        args.threshold,
        args.dry_run,
    )

    # プリセット読み込み
    try:
        presets = load_presets(args.presets_file)
    except (FileNotFoundError, ValueError, ImportError) as e:
        log.error("Failed to load presets: %s", e)
        return 1

    weights = presets.get("scoring", {}).get("weights", {})

    # 実行
    only = None if args.preset == "all" else args.preset
    started = datetime.now(timezone.utc)

    try:
        results = run_presets(presets, only=only, quiet=not args.verbose)
    except ValueError as e:
        log.error("%s", e)
        return 1
    except Exception:
        log.exception("Unexpected error during scan")
        return 1

    finished = datetime.now(timezone.utc)

    # データ品質チェック: 全プリセット失敗 or 全件 0 ならエラー扱い
    total_count = sum(r.count for r in results if r.ok)
    all_failed = all(not r.ok for r in results)
    if all_failed or total_count == 0:
        log.error(
            "Data quality check failed: %d results, all_failed=%s, total_count=%d. "
            "Possible FinViz HTML change or rate limit. Try: pip install -U finvizfinance",
            len(results), all_failed, total_count,
        )
        for r in results:
            if not r.ok:
                log.error("  preset=%s error=%s", r.name, r.error)
        return 2

    # 集約 + スコア計算
    candidates, preset_counts = aggregate_candidates(results, weights)
    log.info("aggregated: %d unique tickers", len(candidates))

    # top_n < floor_count の警告
    floor_count = 5
    if args.top < floor_count:
        log.warning(
            "--top %d is less than floor_count %d, Discount floor disabled",
            args.top, floor_count,
        )

    # 件数キャップ + floor 適用
    selected, floor_applied = select_top(
        candidates,
        top_n=args.top,
        threshold=args.threshold,
        floor_preset="pullback",
        floor_count=floor_count,
    )
    log.info(
        "selected: %d tickers (threshold=%.2f, floor_applied=%s)",
        len(selected), args.threshold, floor_applied,
    )

    # Payload 構築
    scan_date = started.astimezone().date().isoformat()
    payload = build_payload(
        scan_date=scan_date,
        scan_started_at=started,
        scan_finished_at=finished,
        scanner_version=SCANNER_VERSION,
        finvizfinance_version=get_finvizfinance_version(),
        preset_counts=preset_counts,
        total_unique=len(candidates),
        threshold=args.threshold,
        discount_floor_applied=floor_applied,
        selected=selected,
    )

    # 表示
    if not args.quiet:
        print_summary(payload)

    # 保存
    if args.dry_run:
        log.info("dry-run: skipping JSON write")
    else:
        output_path = args.output or (DEFAULT_OUTPUT_DIR / f"{scan_date}.json")
        write_json(payload, output_path)
        log.info("wrote %s", output_path)
        if not args.quiet:
            print(f"  → wrote {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
