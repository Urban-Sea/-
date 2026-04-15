"""
finviz スクリーニング結果に対するスコアリング。

spec (tasks/finviz-discovery-plan.md §4.3):
    finviz_score = 1.0 * in_uptrend          (SMA200 上)
                 + 0.8 * near_52w_high       (52W High からの距離 0-10%)
                 + 0.6 * (rel_volume > 1.5)
                 + 0.5 * rsi_pullback        (30 < RSI < 50)
                 + 0.4 * quality_fundament   (P/E, ROE 揃ってる)
    # 0.00 - 3.30 の連続値

重要: プリセットによって取れるカラムが違う (technical では SMA/RSI、financial では
ROE/ROA)。欠損カラムは **0 加点として扱う** (None ペナルティではない)。
これにより複数プリセットにヒットした銘柄ほどスコアが上がる、という直感に合う。

重みは presets.yml の `scoring:` セクションで上書き可能。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from _parsers import parse_float, parse_pct, parse_volume


# デフォルト重み (presets.yml で上書き可)
DEFAULT_WEIGHTS = {
    "in_uptrend": 1.0,
    "near_52w_high": 0.8,
    "rel_volume_high": 0.6,
    "rsi_pullback": 0.5,
    "quality_fundament": 0.4,
    "sustained_uptrend": 0.7,
}


@dataclass
class ScoreBreakdown:
    """スコアの内訳 (デバッグ用 / 後追い検証用)"""
    in_uptrend: float = 0.0
    near_52w_high: float = 0.0
    rel_volume_high: float = 0.0
    rsi_pullback: float = 0.0
    quality_fundament: float = 0.0
    sustained_uptrend: float = 0.0

    @property
    def total(self) -> float:
        return round(
            self.in_uptrend
            + self.near_52w_high
            + self.rel_volume_high
            + self.rsi_pullback
            + self.quality_fundament
            + self.sustained_uptrend,
            2,
        )

    def to_dict(self) -> dict[str, float]:
        return {
            "in_uptrend": self.in_uptrend,
            "near_52w_high": self.near_52w_high,
            "rel_volume_high": self.rel_volume_high,
            "rsi_pullback": self.rsi_pullback,
            "quality_fundament": self.quality_fundament,
            "sustained_uptrend": self.sustained_uptrend,
            "total": self.total,
        }


def _in_uptrend(row: Mapping[str, Any]) -> bool:
    """SMA200 上にあるか。

    finviz の technical screener は SMA200 を「価格からのオフセット (-0.0468)」
    として返す。負なら SMA200 を下回っている。
    SMA200 カラムがない (financial プリセット) 場合は False (0 加点)。
    """
    sma200 = parse_pct(row.get("SMA200"))
    return sma200 is not None and sma200 > 0


def _near_52w_high(row: Mapping[str, Any]) -> float:
    """52W High からの距離。

    finviz は「52W High」カラムを「現在値が 52週高値からどれだけ離れているか」を
    マイナス値で返す。例: -0.0123 → 1.23% 下、0.0 → 高値タイ。
    -0.10 (10% 以内) なら満点 1.0、それ以上離れているほど線形減衰、超過は 0。
    """
    distance = parse_pct(row.get("52W High"))
    if distance is None or distance > 0.001:  # 高値超え (> 高値) は 1.0
        if distance is not None and distance > -0.001:
            return 1.0
        return 0.0
    if distance < -0.10:
        return 0.0
    # -0.10 → 0.0、 0.0 → 1.0 に線形マッピング
    return round((distance + 0.10) / 0.10, 4)


def _rel_volume_high(row: Mapping[str, Any]) -> bool:
    """Rel Volume が 1.5 倍超か"""
    rv = parse_float(row.get("Rel Volume"))
    return rv is not None and rv > 1.5


def _rsi_pullback(row: Mapping[str, Any]) -> bool:
    """RSI が 30-50 の押し目ゾーンか"""
    rsi = parse_float(row.get("RSI"))
    return rsi is not None and 30.0 < rsi < 50.0


def _sustained_uptrend(row: Mapping[str, Any]) -> float:
    """継続上昇スコア (0.0-1.0)。

    SMA20 / SMA50 / SMA200 が全て価格より下 (= 価格がすべてのSMA上) で満点 0.6、
    加えて半年パフォーマンス >=30% なら +0.4 で最大 1.0。

    technical プリセットでは SMA20 カラムは返らないことがあるので、
    SMA20 が None なら SMA50 > 0 と SMA200 > 0 のみで 0.6 を付ける。
    Perf Half が None なら上昇整列分のみ。
    """
    sma20 = parse_pct(row.get("SMA20"))
    sma50 = parse_pct(row.get("SMA50"))
    sma200 = parse_pct(row.get("SMA200"))
    perf_half = parse_pct(row.get("Perf Half"))

    score = 0.0
    aligned = (sma50 is not None and sma50 > 0) and (sma200 is not None and sma200 > 0)
    # SMA20 が取れていれば追加で要件化、なければ 50/200 のみで判定
    if sma20 is not None:
        aligned = aligned and sma20 > 0
    if aligned:
        score += 0.6

    if perf_half is not None and perf_half >= 0.30:
        score += 0.4

    return round(score, 4)


def _quality_fundament(row: Mapping[str, Any]) -> float:
    """ファンダ品質スコア (0.0-1.0)。

    ROE > 15% かつ Debt/Eq < 1.0 で満点、片方だけなら 0.5、両方欠損 or NG は 0。
    technical プリセット由来の銘柄は ROE/Debt/Eq カラムを持たないので
    自動的に 0 加点になる。
    """
    score = 0.0
    roe = parse_pct(row.get("ROE"))
    if roe is not None and roe > 0.15:
        score += 0.5
    debt_eq = parse_float(row.get("Debt/Eq"))
    if debt_eq is not None and debt_eq < 1.0:
        score += 0.5
    return score


def calc_score(
    row: Mapping[str, Any],
    weights: Mapping[str, float] | None = None,
) -> ScoreBreakdown:
    """1 銘柄の row dict から finviz_score を計算。

    Args:
        row: finviz の DataFrame 1 行 (dict 化したもの)
        weights: スコア成分の重み (None ならデフォルト)

    Returns:
        ScoreBreakdown — 各成分と total
    """
    w = dict(DEFAULT_WEIGHTS)
    if weights:
        w.update(weights)

    bd = ScoreBreakdown()
    bd.in_uptrend = w["in_uptrend"] * (1.0 if _in_uptrend(row) else 0.0)
    bd.near_52w_high = w["near_52w_high"] * _near_52w_high(row)
    bd.rel_volume_high = w["rel_volume_high"] * (1.0 if _rel_volume_high(row) else 0.0)
    bd.rsi_pullback = w["rsi_pullback"] * (1.0 if _rsi_pullback(row) else 0.0)
    bd.quality_fundament = w["quality_fundament"] * _quality_fundament(row)
    bd.sustained_uptrend = w["sustained_uptrend"] * _sustained_uptrend(row)
    return bd


def select_top(
    candidates: list[dict[str, Any]],
    *,
    top_n: int = 50,
    threshold: float = 1.5,
    floor_preset: str = "pullback",
    floor_count: int = 5,
) -> tuple[list[dict[str, Any]], bool]:
    """グローバル top N で件数キャップ、ただし指定プリセットには最低保証 (floor)。

    Args:
        candidates: 各 dict は {"ticker", "presets" (list), "finviz_score", ...}
        top_n: グローバル上限件数
        threshold: finviz_score >= の閾値
        floor_preset: 最低保証するプリセット名 (デフォルト pullback = Discount)
        floor_count: floor_preset から最大何件まで保証するか (実際に取れる分まで)

    Returns:
        (選ばれた候補リスト, floor_applied)
        - 選ばれた候補は finviz_score 降順
        - floor_applied: floor で銘柄を強制追加したかどうか

    Logic:
        1. threshold 未満を捨てる
        2. スコア降順でソート
        3. top N を取る
        4. top N 内の floor_preset 由来の数 < floor_count なら、
           top N 外の floor_preset の上位を入れて、top N の最下位 (非floor) を追い出す
        5. floor_count に届かなければベストエフォート (無理はしない)

    Note: top_n < floor_count の場合は floor を無効化 (warning は呼び出し側で)
    """
    # 1. 閾値フィルタ
    filtered = [c for c in candidates if c.get("finviz_score", 0.0) >= threshold]
    # 2. スコア降順
    sorted_all = sorted(filtered, key=lambda c: -c["finviz_score"])

    # top_n が小さすぎる場合は floor を無効化
    if top_n < floor_count:
        return sorted_all[:top_n], False

    top = sorted_all[:top_n]
    floor_in_top = sum(1 for c in top if floor_preset in c.get("presets", []))

    if floor_in_top >= floor_count:
        return top, False  # floor 不要

    # 不足分を補う候補 = top 外で floor_preset を持つもの
    rest_floor = [
        c for c in sorted_all[top_n:]
        if floor_preset in c.get("presets", [])
    ]
    needed = floor_count - floor_in_top
    promote = rest_floor[:needed]  # 実際に取れる分だけ

    if not promote:
        return top, False  # 入れ替え対象が存在しない

    # top 内で floor_preset を含まない最下位から needed 件を追い出す
    # (floor_preset を含むものは保護する)
    non_floor_indices = [
        i for i, c in enumerate(top)
        if floor_preset not in c.get("presets", [])
    ]
    # 末尾から needed 件 (= スコア低い順)
    to_evict = sorted(non_floor_indices[-len(promote):])

    # 入れ替え
    new_top = list(top)
    for idx, replacement in zip(to_evict, promote):
        new_top[idx] = replacement
    new_top.sort(key=lambda c: -c["finviz_score"])

    return new_top, True
