"""
Exit Manager - 5層Exit System

Justin Banks式トレードシステムの出口戦略を管理
構造変化を早期に検出し、利益を最大化しながらリスクを最小化

Exit層の優先順位:
L1: 利確ターゲット到達 → 部分/全決済（最速）
L2: CHoCH検出（Lower High）→ 50%決済（早期警戒）
L3: Structure Stop（スイングロー割れ）→ 全決済（中間）
L4: EMA Cascade（8→13→21崩壊）→ 段階的決済（遅め）
L5: Time Stop（7日新高値なし）→ 全決済（最終）
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple
from enum import Enum
from datetime import datetime


class ExitType(Enum):
    """Exit種別"""
    NONE = "NONE"
    PROFIT_T1 = "PROFIT_T1"
    PROFIT_T2 = "PROFIT_T2"
    PROFIT_T3 = "PROFIT_T3"
    TRAIL_STOP = "TRAIL_STOP"
    CHOCH_WARNING = "CHOCH_WARNING"
    STRUCTURE_STOP = "STRUCTURE_STOP"
    EMA_CASCADE_PARTIAL = "EMA_CASCADE_PARTIAL"
    EMA_CASCADE_FULL = "EMA_CASCADE_FULL"
    TIME_STOP = "TIME_STOP"


class ExitUrgency(Enum):
    """Exit緊急度"""
    LOW = "LOW"           # 警告のみ
    MEDIUM = "MEDIUM"     # 部分決済推奨
    HIGH = "HIGH"         # 即時部分決済
    CRITICAL = "CRITICAL" # 即時全決済


@dataclass
class ProfitTarget:
    """利確ターゲット"""
    price: float
    pct: float
    target_type: str  # 'T1', 'T2', 'T3', 'RESISTANCE', 'ATR'
    exit_pct: int     # このターゲットで決済する割合


@dataclass
class ExitSignal:
    """Exit シグナル"""
    exit_type: ExitType
    exit_pct: int           # 決済割合 0-100
    trigger_price: float
    reason: str
    urgency: ExitUrgency
    layer: int              # どの層から発生したか (1-5)


@dataclass
class ExitDecision:
    """最終Exit判断"""
    should_exit: bool
    exit_type: ExitType
    exit_pct: int
    exit_price: Optional[float]
    reason: str
    urgency: ExitUrgency
    all_signals: List[ExitSignal]  # 全層からのシグナル


@dataclass
class Position:
    """ポジション情報（部分決済対応）"""
    ticker: str
    entry_price: float
    entry_date: str
    initial_shares: int
    remaining_shares: int
    bos_grade: str
    targets: List[ProfitTarget]
    structure_stop: float
    highest_price: float        # 保有中の最高値
    last_swing_high: float
    days_since_new_high: int

    # Exit層状態
    choch_warning_triggered: bool = False
    ema_8_broken: bool = False
    ema_8_broken_days: int = 0         # 8EMA割れ連続日数（Justin Banks式）
    ema_13_broken: bool = False
    ema_21_broken: bool = False
    ema_cascade_days: int = 0          # EMA Cascade連続日数
    trail_stop_active: bool = False
    trail_stop_price: float = 0.0

    # 部分決済履歴
    partial_exits: List[Dict] = field(default_factory=list)

    def get_unrealized_pnl_pct(self, current_price: float) -> float:
        """含み損益%を計算"""
        return (current_price / self.entry_price - 1) * 100

    def get_remaining_pct(self) -> float:
        """残りポジション%"""
        return (self.remaining_shares / self.initial_shares) * 100


class ExitManager:
    """5層Exit Systemマネージャー"""

    # 最終版: シンプル＆長めホールド
    # Entry: BOS + 8EMA backtest
    # Exit: 利確 or Structure Stop（8%） or Time（30日）
    # 8 EMA割れは警告のみ（自動決済しない）
    DEFAULT_PARAMS = {
        "max_hold_days": 30,           # 最大保有日数（長め - トレンドフォロー）
        "trail_start_pct": 15,         # トレイリング開始%（T1到達後）
        "trail_distance_pct": 8,       # トレイル距離%（余裕を持つ）
        "ema_8_exit": False,           # 8EMA割れはExit無効（警告のみ）
        "ema_8_consecutive_days": 999, # 実質無効
        "structure_exit": True,        # Structure割れでExit（8%固定）
        # 以下は全て無効化
        "choch_exit_pct": 0,
        "choch_min_diff_pct": 999,
        "ema_cascade_partial_pct": 0,
        "ema_cascade_min_days": 999,
        "profit_cushion_pct": 0,
    }

    # Justin Banks式ターゲット設定（+25-50%を狙う）
    # "MARA 12→16 (+33%), RIOT 18→25 (+39%), IREN 55→70 (+27%)"
    TARGETS_BY_GRADE = {
        "EXTENSION": [
            {"pct": 20, "type": "T1", "exit_pct": 25},   # 部分利確
            {"pct": 35, "type": "T2", "exit_pct": 25},   # 部分利確
            {"pct": 50, "type": "T3", "exit_pct": 50},   # 残り全部
        ],
        "REVERSAL": [
            {"pct": 15, "type": "T1", "exit_pct": 25},
            {"pct": 25, "type": "T2", "exit_pct": 25},
            {"pct": 40, "type": "T3", "exit_pct": 50},
        ],
        "CONTINUATION": [
            {"pct": 15, "type": "T1", "exit_pct": 33},
            {"pct": 25, "type": "T2", "exit_pct": 33},
            {"pct": 35, "type": "T3", "exit_pct": 34},
        ],
        "NONE": [
            {"pct": 15, "type": "T1", "exit_pct": 50},
            {"pct": 25, "type": "T2", "exit_pct": 50},
        ],
    }

    def __init__(self, params: Optional[Dict] = None):
        self.params = {**self.DEFAULT_PARAMS, **(params or {})}

    def calculate_targets(
        self,
        entry_price: float,
        bos_grade: str,
        resistances: Optional[List[float]] = None,
        atr: Optional[float] = None
    ) -> List[ProfitTarget]:
        """
        BOS Grade + レジスタンス + ATRから利確ターゲットを計算
        """
        targets = []

        # 1. BOS Gradeベースのターゲット
        grade_targets = self.TARGETS_BY_GRADE.get(bos_grade, self.TARGETS_BY_GRADE["NONE"])
        for t in grade_targets:
            target_price = entry_price * (1 + t["pct"] / 100)
            targets.append(ProfitTarget(
                price=target_price,
                pct=t["pct"],
                target_type=t["type"],
                exit_pct=t["exit_pct"]
            ))

        # 2. レジスタンスターゲット（3%以上離れている最寄り）
        if resistances:
            for r in sorted(resistances):
                if r > entry_price * 1.03:
                    r_pct = (r / entry_price - 1) * 100
                    targets.append(ProfitTarget(
                        price=r,
                        pct=r_pct,
                        target_type="RESISTANCE",
                        exit_pct=25  # レジスタンスでは25%決済
                    ))
                    break

        # 3. ATRターゲット（ATR×2.5上）
        if atr and atr > 0:
            atr_target = entry_price + (atr * 2.5)
            if atr_target > entry_price * 1.05:
                atr_pct = (atr_target / entry_price - 1) * 100
                targets.append(ProfitTarget(
                    price=atr_target,
                    pct=atr_pct,
                    target_type="ATR",
                    exit_pct=25
                ))

        # 価格でソート
        targets.sort(key=lambda x: x.price)
        return targets

    def evaluate_all_layers(
        self,
        position: Position,
        current_candle: Dict,  # {open, high, low, close}
        ema_8: float,
        ema_13: float,
        ema_21: float,
        swing_highs: List[float],
        swing_lows: List[float]
    ) -> ExitDecision:
        """
        全5層のExit条件を評価し、最終判断を返す
        """
        signals: List[ExitSignal] = []
        close = current_candle["close"]
        high = current_candle["high"]
        low = current_candle["low"]

        # Layer 1: 利確ターゲット
        l1_signal = self._check_profit_targets(position, high, close)
        if l1_signal:
            signals.append(l1_signal)

        # Layer 2: CHoCH早期警戒
        l2_signal = self._check_choch_warning(position, swing_highs, close)
        if l2_signal:
            signals.append(l2_signal)

        # Layer 3: Structure Stop
        l3_signal = self._check_structure_stop(position, low, swing_lows)
        if l3_signal:
            signals.append(l3_signal)

        # Layer 4: EMA Cascade
        l4_signal = self._check_ema_cascade(position, close, ema_8, ema_13, ema_21)
        if l4_signal:
            signals.append(l4_signal)

        # Layer 5: Time Stop
        l5_signal = self._check_time_stop(position)
        if l5_signal:
            signals.append(l5_signal)

        # Trail Stop（有効化されている場合）
        trail_signal = self._check_trail_stop(position, low)
        if trail_signal:
            signals.append(trail_signal)

        # 最も緊急度が高いシグナルを選択
        return self._select_final_decision(signals, close)

    def _check_profit_targets(
        self,
        position: Position,
        high: float,
        close: float
    ) -> Optional[ExitSignal]:
        """
        Layer 1: 利確ターゲット到達チェック
        """
        for target in position.targets:
            if high >= target.price:
                # ターゲット到達
                return ExitSignal(
                    exit_type=ExitType[f"PROFIT_{target.target_type}"] if target.target_type in ["T1", "T2", "T3"] else ExitType.PROFIT_T1,
                    exit_pct=target.exit_pct,
                    trigger_price=target.price,
                    reason=f"利確{target.target_type}: ${target.price:.2f} (+{target.pct:.1f}%)",
                    urgency=ExitUrgency.HIGH,
                    layer=1
                )

        # Trail Stop有効化チェック
        pnl_pct = position.get_unrealized_pnl_pct(close)
        if pnl_pct >= self.params["trail_start_pct"] and not position.trail_stop_active:
            position.trail_stop_active = True
            position.trail_stop_price = close * (1 - self.params["trail_distance_pct"] / 100)

        # Trail Stop更新
        if position.trail_stop_active:
            new_trail = close * (1 - self.params["trail_distance_pct"] / 100)
            if new_trail > position.trail_stop_price:
                position.trail_stop_price = new_trail

        return None

    def _check_choch_warning(
        self,
        position: Position,
        swing_highs: List[float],
        current_price: float
    ) -> Optional[ExitSignal]:
        """
        Layer 2: CHoCH早期警戒（Lower High検出）

        Bearish CHoCH = 前回のスイングハイより低いスイングハイが形成
        → 構造崩壊の早期警告 → 50%決済

        改善:
        - 最小差（1.5%）以上のLower Highでのみ発動
        - 利益クッション（+5%以上）がある場合はスキップ（Trail Stopに任せる）
        """
        if position.choch_warning_triggered:
            return None  # 既にトリガー済み

        # 利益クッションチェック: 十分な利益がある場合はTrail Stopに任せる
        pnl_pct = position.get_unrealized_pnl_pct(current_price)
        if pnl_pct >= self.params["profit_cushion_pct"]:
            return None

        if len(swing_highs) >= 2:
            current_swing_high = swing_highs[-1]
            previous_swing_high = swing_highs[-2]

            # 最小差チェック: 意味のあるLower Highのみ
            diff_pct = (previous_swing_high - current_swing_high) / previous_swing_high * 100
            min_diff = self.params["choch_min_diff_pct"]

            # Lower High = Bearish CHoCH（差が十分大きい場合のみ）
            if current_swing_high < previous_swing_high and diff_pct >= min_diff:
                position.choch_warning_triggered = True
                return ExitSignal(
                    exit_type=ExitType.CHOCH_WARNING,
                    exit_pct=self.params["choch_exit_pct"],
                    trigger_price=current_swing_high,
                    reason=f"CHoCH警戒: Lower High ${current_swing_high:.2f} < ${previous_swing_high:.2f} (-{diff_pct:.1f}%)",
                    urgency=ExitUrgency.HIGH,
                    layer=2
                )

        return None

    def _check_structure_stop(
        self,
        position: Position,
        low: float,
        swing_lows: List[float]
    ) -> Optional[ExitSignal]:
        """
        Layer 3: Structure Stop（スイングロー割れ）
        """
        if low <= position.structure_stop:
            return ExitSignal(
                exit_type=ExitType.STRUCTURE_STOP,
                exit_pct=100,
                trigger_price=position.structure_stop,
                reason=f"Structure Stop: ${low:.2f} <= ${position.structure_stop:.2f}",
                urgency=ExitUrgency.CRITICAL,
                layer=3
            )

        # 動的Structure Stop更新（Higher Lowが形成された場合）
        if swing_lows and len(swing_lows) >= 1:
            latest_swing_low = swing_lows[-1]
            if latest_swing_low > position.structure_stop:
                position.structure_stop = latest_swing_low

        return None

    def _check_ema_cascade(
        self,
        position: Position,
        close: float,
        ema_8: float,
        ema_13: float,
        ema_21: float
    ) -> Optional[ExitSignal]:
        """
        Justin Banks式: 8EMA割れでExit

        "As long as price holds 8 EMA and Structure"
        "Exit when 8 EMA breaks"

        シンプルに:
        - close < 8EMA が N日連続 → Exit
        """
        broken_8 = close < ema_8
        broken_13 = close < ema_13
        broken_21 = close < ema_21

        # 状態更新
        position.ema_8_broken = broken_8
        position.ema_13_broken = broken_13
        position.ema_21_broken = broken_21

        # 8EMA割れ連続日数チェック（Justin Banks式メインExit）
        if self.params.get("ema_8_exit", True):
            consecutive_days_needed = self.params.get("ema_8_consecutive_days", 2)

            if broken_8:
                position.ema_8_broken_days += 1

                if position.ema_8_broken_days >= consecutive_days_needed:
                    return ExitSignal(
                        exit_type=ExitType.EMA_CASCADE_FULL,  # 既存タイプを再利用
                        exit_pct=100,
                        trigger_price=close,
                        reason=f"8EMA Exit: {position.ema_8_broken_days}日連続8EMA割れ",
                        urgency=ExitUrgency.HIGH,
                        layer=4
                    )
                else:
                    # 警告のみ（まだ連続日数に達していない）
                    return ExitSignal(
                        exit_type=ExitType.NONE,
                        exit_pct=0,
                        trigger_price=close,
                        reason=f"8EMA警戒: {position.ema_8_broken_days}日目 (2日でExit)",
                        urgency=ExitUrgency.LOW,
                        layer=4
                    )
            else:
                # 8EMAを回復 → リセット
                position.ema_8_broken_days = 0

        return None

    def _check_time_stop(
        self,
        position: Position
    ) -> Optional[ExitSignal]:
        """
        Layer 5: Time Stop（新高値なしでExit）
        """
        if position.days_since_new_high >= self.params["max_hold_days"]:
            return ExitSignal(
                exit_type=ExitType.TIME_STOP,
                exit_pct=100,
                trigger_price=0,
                reason=f"Time Stop: {position.days_since_new_high}日間新高値なし",
                urgency=ExitUrgency.HIGH,
                layer=5
            )

        return None

    def _check_trail_stop(
        self,
        position: Position,
        low: float
    ) -> Optional[ExitSignal]:
        """
        Trail Stop チェック
        """
        if position.trail_stop_active and low <= position.trail_stop_price:
            return ExitSignal(
                exit_type=ExitType.TRAIL_STOP,
                exit_pct=100,
                trigger_price=position.trail_stop_price,
                reason=f"Trail Stop: ${low:.2f} <= ${position.trail_stop_price:.2f}",
                urgency=ExitUrgency.CRITICAL,
                layer=1
            )

        return None

    def _select_final_decision(
        self,
        signals: List[ExitSignal],
        current_price: float
    ) -> ExitDecision:
        """
        全シグナルから最終判断を決定

        優先順位:
        1. CRITICAL緊急度のシグナル
        2. 最も高い決済割合
        3. 最も低い層番号
        """
        if not signals:
            return ExitDecision(
                should_exit=False,
                exit_type=ExitType.NONE,
                exit_pct=0,
                exit_price=None,
                reason="Exit条件なし",
                urgency=ExitUrgency.LOW,
                all_signals=[]
            )

        # 緊急度でソート（CRITICAL > HIGH > MEDIUM > LOW）
        urgency_order = {
            ExitUrgency.CRITICAL: 0,
            ExitUrgency.HIGH: 1,
            ExitUrgency.MEDIUM: 2,
            ExitUrgency.LOW: 3
        }

        signals.sort(key=lambda s: (
            urgency_order[s.urgency],
            -s.exit_pct,
            s.layer
        ))

        best_signal = signals[0]

        # exit_pct > 0 のシグナルのみExitとして扱う
        should_exit = best_signal.exit_pct > 0

        return ExitDecision(
            should_exit=should_exit,
            exit_type=best_signal.exit_type,
            exit_pct=best_signal.exit_pct,
            exit_price=best_signal.trigger_price if best_signal.trigger_price > 0 else current_price,
            reason=best_signal.reason,
            urgency=best_signal.urgency,
            all_signals=signals
        )

    def update_position_after_partial_exit(
        self,
        position: Position,
        exit_pct: int,
        exit_price: float,
        exit_reason: str
    ) -> Position:
        """
        部分決済後のポジション更新
        """
        shares_to_exit = int(position.remaining_shares * exit_pct / 100)

        position.partial_exits.append({
            "date": datetime.now().isoformat(),
            "shares": shares_to_exit,
            "price": exit_price,
            "reason": exit_reason,
            "remaining_pct": position.get_remaining_pct() - exit_pct
        })

        position.remaining_shares -= shares_to_exit

        return position

    def get_exit_summary(self, position: Position, current_price: float) -> Dict:
        """
        現在のExit状況サマリーを取得
        """
        pnl_pct = position.get_unrealized_pnl_pct(current_price)

        # 次のターゲット
        next_target = None
        for t in position.targets:
            if t.price > current_price:
                next_target = t
                break

        return {
            "ticker": position.ticker,
            "entry_price": position.entry_price,
            "current_price": current_price,
            "pnl_pct": pnl_pct,
            "remaining_pct": position.get_remaining_pct(),
            "bos_grade": position.bos_grade,
            "layers": {
                "L1_profit": {
                    "next_target": next_target.price if next_target else None,
                    "next_target_pct": next_target.pct if next_target else None,
                    "trail_active": position.trail_stop_active,
                    "trail_price": position.trail_stop_price if position.trail_stop_active else None
                },
                "L2_choch": {
                    "warning_triggered": position.choch_warning_triggered,
                    "last_swing_high": position.last_swing_high
                },
                "L3_structure": {
                    "stop_price": position.structure_stop,
                    "distance_pct": (current_price - position.structure_stop) / current_price * 100
                },
                "L4_ema_cascade": {
                    "ema_8_broken": position.ema_8_broken,
                    "ema_13_broken": position.ema_13_broken,
                    "ema_21_broken": position.ema_21_broken
                },
                "L5_time": {
                    "days_since_high": position.days_since_new_high,
                    "max_days": self.params["max_hold_days"],
                    "remaining": max(0, self.params["max_hold_days"] - position.days_since_new_high)
                }
            },
            "partial_exits": position.partial_exits
        }


# ============================================================
# テスト用関数
# ============================================================

def test_exit_manager():
    """Exit Managerの動作テスト"""
    manager = ExitManager()

    # テスト用ポジション作成
    targets = manager.calculate_targets(
        entry_price=100.0,
        bos_grade="EXTENSION",
        resistances=[108.0, 115.0],
        atr=3.0
    )

    position = Position(
        ticker="TEST",
        entry_price=100.0,
        entry_date="2025-01-01",
        initial_shares=100,
        remaining_shares=100,
        bos_grade="EXTENSION",
        targets=targets,
        structure_stop=95.0,
        highest_price=100.0,
        last_swing_high=102.0,
        days_since_new_high=0
    )

    print("=== Exit Manager テスト ===")
    print(f"\nターゲット設定（EXTENSION）:")
    for t in targets:
        print(f"  {t.target_type}: ${t.price:.2f} (+{t.pct:.1f}%) → {t.exit_pct}%決済")

    # ケース1: 通常状態
    decision = manager.evaluate_all_layers(
        position=position,
        current_candle={"open": 101, "high": 102, "low": 100, "close": 101},
        ema_8=99.5,
        ema_13=98.0,
        ema_21=96.0,
        swing_highs=[100.0, 102.0],
        swing_lows=[95.0, 97.0]
    )
    print(f"\nケース1（通常）: should_exit={decision.should_exit}, reason={decision.reason}")

    # ケース2: CHoCH発生
    position.choch_warning_triggered = False
    decision = manager.evaluate_all_layers(
        position=position,
        current_candle={"open": 101, "high": 101.5, "low": 100, "close": 100.5},
        ema_8=99.5,
        ema_13=98.0,
        ema_21=96.0,
        swing_highs=[102.0, 101.0],  # Lower High
        swing_lows=[95.0, 97.0]
    )
    print(f"ケース2（CHoCH）: should_exit={decision.should_exit}, exit_pct={decision.exit_pct}%, reason={decision.reason}")

    # ケース3: Structure Stop
    decision = manager.evaluate_all_layers(
        position=position,
        current_candle={"open": 96, "high": 96.5, "low": 94.5, "close": 95},
        ema_8=97.0,
        ema_13=96.0,
        ema_21=95.0,
        swing_highs=[102.0, 101.0],
        swing_lows=[95.0, 97.0]
    )
    print(f"ケース3（Structure Stop）: should_exit={decision.should_exit}, exit_pct={decision.exit_pct}%, reason={decision.reason}")

    # サマリー表示
    summary = manager.get_exit_summary(position, 101.0)
    print(f"\n現在のExit状況サマリー:")
    print(f"  PnL: {summary['pnl_pct']:.2f}%")
    print(f"  残りポジション: {summary['remaining_pct']:.0f}%")
    print(f"  L3 Structure Stop: ${summary['layers']['L3_structure']['stop_price']:.2f}")


if __name__ == "__main__":
    test_exit_manager()
