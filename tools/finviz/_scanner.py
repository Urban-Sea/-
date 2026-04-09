"""
finvizfinance スクリーナーの薄いラッパー。

各プリセットを実行して DataFrame を返す。プリセット定義は presets.yml から
読み込み、`module` フィールドで technical / financial / overview / valuation /
performance / ownership のどれを使うか決まる。

finviz は stderr に進捗バーを print してくる (tqdm ではないので環境変数で
抑制不可)。`quiet` モードでは contextlib.redirect_stderr で吸い取る。

Phase B の finviz-publish.py からも import される想定。
"""
from __future__ import annotations

import contextlib
import io
import logging
import sys
import time
from dataclasses import dataclass
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

# 動的 import: finvizfinance v1.3.0 が install されてないと ImportError
# CLI 側で「pip install -r requirements.txt して」と案内する
try:
    from finvizfinance.screener.financial import Financial
    from finvizfinance.screener.overview import Overview
    from finvizfinance.screener.ownership import Ownership
    from finvizfinance.screener.performance import Performance
    from finvizfinance.screener.technical import Technical
    from finvizfinance.screener.valuation import Valuation
except ImportError as e:
    raise ImportError(
        "finvizfinance is not installed. "
        "Run: pip install -r tools/finviz/requirements.txt"
    ) from e


# プリセット定義の `module` フィールド → finviz クラス
_MODULE_MAP: dict[str, type] = {
    "technical": Technical,
    "financial": Financial,
    "overview": Overview,
    "valuation": Valuation,
    "performance": Performance,
    "ownership": Ownership,
}


@dataclass
class PresetResult:
    """1 プリセットの実行結果"""
    name: str                  # "momentum"
    module: str                # "technical"
    filters: dict[str, str]    # 渡したフィルター辞書
    df: pd.DataFrame           # finviz の screener_view() 結果 (空 DF もあり)
    elapsed_sec: float         # 実行時間 (秒)
    error: str | None = None   # エラー時のメッセージ (df は空 DF)

    @property
    def count(self) -> int:
        return len(self.df)

    @property
    def ok(self) -> bool:
        return self.error is None


def run_preset(name: str, definition: dict[str, Any], *, quiet: bool = True) -> PresetResult:
    """1 つのプリセットを実行して PresetResult を返す。

    Args:
        name: プリセット名 ("momentum" 等)
        definition: presets.yml から読み込んだ dict
                    {"module": "technical", "filters": {...}}
        quiet: True なら finviz の stderr 進捗バーを吸い取る

    Returns:
        PresetResult (例外を投げず、エラーは error フィールドに)
    """
    module_name = definition.get("module")
    filters = definition.get("filters", {})

    if module_name not in _MODULE_MAP:
        return PresetResult(
            name=name,
            module=str(module_name),
            filters=filters,
            df=pd.DataFrame(),
            elapsed_sec=0.0,
            error=f"Unknown module: {module_name!r} (allowed: {list(_MODULE_MAP)})",
        )

    cls = _MODULE_MAP[module_name]
    started = time.monotonic()

    try:
        if quiet:
            # finviz/util.py:186 の progress_bar は sys.stdout.write を使うので
            # stdout を吸い取る (stderr は念のため両方)
            with contextlib.redirect_stdout(io.StringIO()), \
                 contextlib.redirect_stderr(io.StringIO()):
                screener = cls()
                screener.set_filter(filters_dict=filters)
                df = screener.screener_view()
        else:
            screener = cls()
            screener.set_filter(filters_dict=filters)
            df = screener.screener_view()
    except Exception as e:
        elapsed = time.monotonic() - started
        logger.exception("preset %s failed", name)
        return PresetResult(
            name=name,
            module=module_name,
            filters=filters,
            df=pd.DataFrame(),
            elapsed_sec=elapsed,
            error=f"{type(e).__name__}: {e}",
        )

    elapsed = time.monotonic() - started

    # 空 DataFrame なら空 DF として返す (None ではない)
    if df is None:
        df = pd.DataFrame()

    return PresetResult(
        name=name,
        module=module_name,
        filters=filters,
        df=df,
        elapsed_sec=elapsed,
        error=None,
    )


def run_presets(
    presets: dict[str, dict[str, Any]],
    *,
    only: str | None = None,
    quiet: bool = True,
) -> list[PresetResult]:
    """複数プリセットを順に実行。

    Args:
        presets: presets.yml から読み込んだ dict 全体
                 (キー = プリセット名、値 = {module, filters})
        only: 1つだけ実行したい場合のプリセット名 (None なら全部)
        quiet: True なら stderr 吸い取り

    Returns:
        PresetResult のリスト (順序は presets dict の順)
    """
    results: list[PresetResult] = []

    targets: dict[str, dict[str, Any]]
    if only:
        if only not in presets:
            raise ValueError(
                f"Preset {only!r} not found. Available: {list(presets)}"
            )
        targets = {only: presets[only]}
    else:
        # `scoring` は予約名として除外
        targets = {k: v for k, v in presets.items() if k != "scoring"}

    for name, definition in targets.items():
        logger.info("Running preset: %s", name)
        result = run_preset(name, definition, quiet=quiet)
        if result.ok:
            logger.info(
                "preset=%s count=%d elapsed=%.1fs",
                name, result.count, result.elapsed_sec,
            )
        else:
            logger.error(
                "preset=%s FAILED elapsed=%.1fs error=%s",
                name, result.elapsed_sec, result.error,
            )
        results.append(result)

    return results


def get_finvizfinance_version() -> str:
    """インストールされている finvizfinance のバージョン文字列を返す"""
    try:
        from importlib.metadata import version
        return version("finvizfinance")
    except Exception:
        return "unknown"
