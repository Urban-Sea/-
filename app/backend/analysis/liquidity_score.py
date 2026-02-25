"""
流動性スコア計算モジュール（demoから移植）

各Layerの Stress Score を計算する

設計思想:
- スコアは「良い／悪い」ではなく "詰まり度・危険度" を表す
- 0 = 非常に健全（流れがスムーズ）
- 100 = 臨界状態（詰まり・破断寸前）
- 高いほど危険
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple, List
import statistics


# ============================================================
# ITバブル崩壊時の2年変化率ピーク
# ============================================================
IT_BUBBLE_PEAK_2Y_CHANGE = 104.68

# 2年変化率の位相テーブル
PHASE_THRESHOLDS = [
    (40, "健全", 20),
    (60, "警戒", 40),
    (80, "高警戒", 70),
    (100, "危険", 90),
    (float('inf'), "臨界", 100),
]


# ============================================================
# Layer 1: 政策流動性（元栓）
# Net Liquidity = SOMA - RRP - TGA の Z-score で評価
# ============================================================

def calculate_layer1_stress(
    net_liquidity: float,
    historical_values: List[float],
    window_size: int = 520,  # 約10年分（週次データ）
) -> Dict[str, Any]:
    """
    Layer 1 Stress Score計算（上流流動性）

    Z-score（ローリング期間）を 0-100 に正規化

    Args:
        net_liquidity: 現在のNet Liquidity
        historical_values: 過去のNet Liquidity値のリスト（古い順）
        window_size: Z-score計算のウィンドウサイズ

    Returns:
        dict: stress_score, z_score, net_liquidity, interpretation
    """
    if not historical_values or len(historical_values) < 2:
        return {
            'stress_score': 50,
            'z_score': 0.0,
            'net_liquidity': net_liquidity,
            'interpretation': 'データ不足'
        }

    # ウィンドウ内のデータを使用
    window = historical_values[-window_size:] if len(historical_values) > window_size else historical_values

    mean = statistics.mean(window)
    stdev = statistics.stdev(window) if len(window) > 1 else 1.0

    if stdev == 0:
        z_score = 0.0
    else:
        z_score = (net_liquidity - mean) / stdev

    # Z-score → Stress Score変換
    # Z > +1.5 → Stress 10（非常に健全）
    # Z = 0    → Stress 50（中立）
    # Z < -1.5 → Stress 90（危険）
    stress = 50 - (z_score * 26.67)
    stress = max(0, min(100, stress))

    # 解釈
    if stress < 30:
        interpretation = "流動性は十分に潤沢"
    elif stress < 50:
        interpretation = "流動性は平均的"
    elif stress < 70:
        interpretation = "流動性は減少傾向"
    else:
        interpretation = "流動性は逼迫状態"

    return {
        'stress_score': int(stress),
        'z_score': round(z_score, 2),
        'net_liquidity': net_liquidity,
        'interpretation': interpretation
    }


# ============================================================
# Layer 2A: 銀行システム（配管）
# 準備預金、KRE、SRF、IGスプレッドから評価
# ============================================================

def calculate_layer2a_stress(
    reserves_change_mom: Optional[float] = None,
    kre_52w_change: Optional[float] = None,
    srf_usage: Optional[float] = None,
    ig_spread: Optional[float] = None,
    srf_consecutive_days: Optional[int] = None,
    srf_days_90d: Optional[int] = None
) -> Dict[str, Any]:
    """
    Layer 2A Stress Score計算（銀行システム）

    重み: reserves=20%, KRE=20%, SRF=40%, IG=20%
    """
    alerts = []

    # 部分スコア（各0-25）
    reserves_score = 0
    kre_score = 0
    srf_score = 0
    ig_score = 0

    # 準備預金変化率
    if reserves_change_mom is not None:
        if reserves_change_mom < -10:
            reserves_score = 25
            alerts.append("準備預金急減（-10%超）")
        elif reserves_change_mom < -5:
            reserves_score = 15
            alerts.append("準備預金減少（-5%超）")
        elif reserves_change_mom < 0:
            reserves_score = 8
        elif reserves_change_mom > 10:
            reserves_score = -5

    # KRE 52週変化率
    if kre_52w_change is not None:
        if kre_52w_change < -30:
            kre_score = 25
            alerts.append("銀行株急落（-30%超）")
        elif kre_52w_change < -20:
            kre_score = 20
            alerts.append("銀行株大幅下落（-20%超）")
        elif kre_52w_change < -10:
            kre_score = 12
            alerts.append("銀行株下落（-10%超）")
        elif kre_52w_change > 20:
            kre_score = -5

    # SRF利用
    srf_amount_score = 0
    srf_days_score = 0

    if srf_usage is not None and srf_usage > 0:
        if srf_usage >= 200:
            srf_amount_score = 15
            alerts.append(f"SRF月間大量利用（30日累計{srf_usage:.0f}B）")
        elif srf_usage >= 100:
            srf_amount_score = 12
        elif srf_usage >= 50:
            srf_amount_score = 8
        elif srf_usage >= 20:
            srf_amount_score = 5
        else:
            srf_amount_score = 2

    if srf_consecutive_days is not None and srf_consecutive_days > 0:
        if srf_consecutive_days >= 15:
            srf_days_score = 15
            alerts.append(f"SRF恒常的利用（月{srf_consecutive_days}日）")
        elif srf_consecutive_days >= 10:
            srf_days_score = 12
        elif srf_consecutive_days >= 5:
            srf_days_score = 8
        elif srf_consecutive_days >= 2:
            srf_days_score = 4
        else:
            srf_days_score = 2

    srf_score = max(srf_amount_score, srf_days_score)
    if srf_amount_score >= 10 and srf_days_score >= 8:
        srf_score = min(25, srf_score + 5)

    # 90日依存度
    srf_dependency_bonus = 0
    if srf_days_90d is not None and srf_days_90d > 0:
        dependency_rate = srf_days_90d / 90 * 100
        if dependency_rate > 50:
            srf_dependency_bonus = 8
        elif dependency_rate > 30:
            srf_dependency_bonus = 5
        elif dependency_rate > 10:
            srf_dependency_bonus = 3
        srf_score = min(25, srf_score + srf_dependency_bonus)

    # IGスプレッド
    if ig_spread is not None:
        if ig_spread > 2.0:
            ig_score = 25
            alerts.append(f"IGスプレッド拡大（{ig_spread:.2f}%）")
        elif ig_spread > 1.5:
            ig_score = 15
            alerts.append(f"IGスプレッド警戒（{ig_spread:.2f}%）")
        elif ig_spread > 1.0:
            ig_score = 8
        elif ig_spread < 0.8:
            ig_score = -3

    # クリップ
    reserves_score = max(0, min(25, reserves_score))
    kre_score = max(0, min(25, kre_score))
    srf_score = max(0, min(25, srf_score))
    ig_score = max(0, min(25, ig_score))

    # 重み付け平均
    weighted_sum = (
        reserves_score * 0.20 +
        kre_score * 0.20 +
        srf_score * 0.40 +
        ig_score * 0.20
    )
    stress = 15 + weighted_sum * 3.4
    stress = max(0, min(100, stress))

    # 解釈タイプ
    has_credit_stress = (
        (kre_52w_change is not None and kre_52w_change < -10) or
        (ig_spread is not None and ig_spread > 1.5)
    )
    has_srf_dependency = (
        (srf_days_90d is not None and srf_days_90d > 9) or
        (srf_consecutive_days is not None and srf_consecutive_days >= 5)
    )

    interpretation_type = "NORMAL"
    if stress < 30:
        interpretation = "銀行システムは健全"
        interpretation_type = "HEALTHY"
    elif stress < 50:
        interpretation = "銀行システムは安定"
        interpretation_type = "STABLE"
    elif stress >= 50:
        if has_credit_stress and has_srf_dependency:
            interpretation = "銀行システム危機の兆候"
            interpretation_type = "CRISIS"
        elif has_credit_stress:
            interpretation = "銀行システムにストレス発生"
            interpretation_type = "CREDIT_STRESS"
        elif has_srf_dependency:
            interpretation = "Fed施設への流動性依存"
            interpretation_type = "FED_DEPENDENCY"
        else:
            interpretation = "銀行システムに警戒シグナル"
            interpretation_type = "WARNING"

    return {
        'stress_score': int(stress),
        'interpretation': interpretation,
        'interpretation_type': interpretation_type,
        'alerts': alerts,
        'components': {
            'reserves_change_mom': reserves_change_mom,
            'kre_52w_change': kre_52w_change,
            'srf_usage': srf_usage,
            'ig_spread': ig_spread,
            'reserves': reserves_score,
            'kre': kre_score,
            'srf': srf_score,
            'ig': ig_score,
        }
    }


# ============================================================
# Layer 2B: リスク許容度（蛇口）
# 信用取引残高 2年変化率（80%） + MMF変化率（20%）
# ============================================================

def _get_phase_stress(change_2y: float) -> int:
    for threshold, _, stress in PHASE_THRESHOLDS:
        if change_2y < threshold:
            return stress
    return 100

def _get_phase_label(change_2y: float) -> str:
    for threshold, label, _ in PHASE_THRESHOLDS:
        if change_2y < threshold:
            return label
    return "臨界"

def calculate_layer2b_stress(
    margin_debt_2y: float,
    margin_debt_1y: Optional[float] = None,
    mmf_change: Optional[float] = None,
    vix: Optional[float] = None
) -> Dict[str, Any]:
    """
    Layer 2B Stress Score計算（Market Risk Appetite）

    信用取引残高: 80%, MMF: 20%
    """
    margin_score = _get_phase_stress(margin_debt_2y)
    phase_label = _get_phase_label(margin_debt_2y)

    mmf_score = 50
    if mmf_change is not None:
        inverted_mmf = -mmf_change
        mmf_score = max(0, min(100, 50 + inverted_mmf * 2.5))

    if mmf_change is not None:
        final_stress = int(margin_score * 0.8 + mmf_score * 0.2)
    else:
        final_stress = margin_score

    final_stress = max(0, min(100, final_stress))

    it_bubble_comparison = round((margin_debt_2y / IT_BUBBLE_PEAK_2Y_CHANGE) * 100, 1)

    return {
        'stress_score': final_stress,
        'phase': phase_label,
        'margin_debt_2y': margin_debt_2y,
        'margin_debt_1y': margin_debt_1y,
        'it_bubble_comparison': it_bubble_comparison,
        'it_bubble_peak': IT_BUBBLE_PEAK_2Y_CHANGE,
        'components': {
            'margin_debt_2y': margin_debt_2y,
            'margin_debt_1y': margin_debt_1y,
            'mmf_change': mmf_change,
            'margin_score': margin_score,
            'mmf_score': mmf_score if mmf_change is not None else None,
        }
    }


# ============================================================
# Credit Pressure（Layer 3 - スコア化しない）
# ============================================================

def calculate_credit_pressure(
    hy_spread: Optional[float] = None,
    ig_spread: Optional[float] = None,
    yield_curve: Optional[float] = None,
    dxy: Optional[float] = None
) -> Dict[str, Any]:
    """信用圧力レベルを判定"""
    pressure_count = 0
    alerts = []
    components = {
        'hy_spread': {'value': hy_spread, 'status': 'normal'},
        'ig_spread': {'value': ig_spread, 'status': 'normal'},
        'yield_curve': {'value': yield_curve, 'status': 'normal'},
        'dxy': {'value': dxy, 'status': 'normal'},
    }

    if hy_spread is not None:
        if hy_spread > 5.0:
            pressure_count += 2
            alerts.append(f'HYスプレッド高水準（{hy_spread:.2f}%）')
            components['hy_spread']['status'] = 'danger'
        elif hy_spread > 3.5:
            pressure_count += 1
            alerts.append(f'HYスプレッド警戒（{hy_spread:.2f}%）')
            components['hy_spread']['status'] = 'warning'

    if ig_spread is not None:
        if ig_spread > 1.5:
            pressure_count += 2
            alerts.append(f'IGスプレッド拡大（{ig_spread:.2f}%）')
            components['ig_spread']['status'] = 'danger'
        elif ig_spread > 1.0:
            pressure_count += 1
            alerts.append(f'IGスプレッド警戒（{ig_spread:.2f}%）')
            components['ig_spread']['status'] = 'warning'

    if yield_curve is not None:
        if yield_curve < 0:
            pressure_count += 2
            alerts.append(f'逆イールド（{yield_curve:.2f}%）')
            components['yield_curve']['status'] = 'danger'
        elif yield_curve < 0.5:
            pressure_count += 1
            alerts.append(f'フラット化（{yield_curve:.2f}%）')
            components['yield_curve']['status'] = 'warning'

    if dxy is not None:
        if dxy > 105:
            pressure_count += 1
            alerts.append(f'ドル高（DXY: {dxy:.1f}）')
            components['dxy']['status'] = 'warning'

    if pressure_count >= 5:
        level = 'High'
    elif pressure_count >= 2:
        level = 'Medium'
    else:
        level = 'Low'

    return {
        'level': level,
        'pressure_count': pressure_count,
        'components': components,
        'alerts': alerts
    }


# ============================================================
# Market State（市場状態判定）
# ============================================================

MARKET_STATE_DEFINITIONS = {
    'LIQUIDITY_SHOCK': {
        'label': '流動性ショック',
        'description': '銀行システムで高ストレスまたは急激なストレス上昇を検出。緊急事態の可能性。',
        'action': '防御態勢、現金比率UP',
        'color': 'red',
    },
    'CREDIT_CONTRACTION': {
        'label': '信用収縮',
        'description': '銀行システムにストレス発生。信用供給が制限される可能性。',
        'action': '信用取引厳禁、様子見',
        'color': 'orange',
    },
    'POLICY_TIGHTENING': {
        'label': '政策引き締め',
        'description': 'FRBの流動性供給が縮小中。市場への逆風に注意。',
        'action': 'リスク資産への逆風に注意',
        'color': 'yellow',
    },
    'SPLIT_BUBBLE': {
        'label': '分断型バブル',
        'description': '銀行システムにストレスがある一方、市場は過熱中。脆弱な上昇相場。',
        'action': '段階的にリスク縮小',
        'color': 'orange',
    },
    'MARKET_OVERSHOOT': {
        'label': '市場先行型',
        'description': '銀行・政策は安定だが、市場参加者の信用取引が先行して過熱中。',
        'action': '利確検討、新規抑制',
        'color': 'yellow',
    },
    'FINANCIAL_RALLY': {
        'label': '金融相場',
        'description': '政策流動性が潤沢で、市場に資金が流入中。上昇しやすい環境。',
        'action': '積極的にリスクオン',
        'color': 'cyan',
    },
    'HEALTHY': {
        'label': '健全相場',
        'description': '全Layerで流動性が安定。通常の相場環境。',
        'action': '通常投資を継続',
        'color': 'green',
    },
    'NEUTRAL': {
        'label': '中立',
        'description': '特定の状態パターンに該当しない。個別指標を確認してください。',
        'action': '現状維持',
        'color': 'gray',
    },
}


def _adjust_description_by_l2a_type(
    state_code: str, description: str, l2a_type: Optional[str]
) -> str:
    if l2a_type is None:
        return description
    if state_code == 'CREDIT_CONTRACTION':
        if l2a_type == 'FED_DEPENDENCY':
            return 'Fed緊急流動性施設(SRF)への依存が高まっている。潜在的な流動性リスクに注意。'
        elif l2a_type == 'CRISIS':
            return '銀行システム危機の兆候。銀行信用ストレスとFed施設への依存が同時発生。'
    elif state_code == 'SPLIT_BUBBLE':
        if l2a_type == 'FED_DEPENDENCY':
            return 'Fed施設依存下で市場が過熱中。流動性は脆弱だが、銀行信用自体は安定。'
        elif l2a_type == 'CRISIS':
            return '銀行危機の兆候がある中で市場が過熱。極めて脆弱な上昇相場。'
    elif state_code == 'LIQUIDITY_SHOCK':
        if l2a_type == 'FED_DEPENDENCY':
            return 'Fed施設への構造的依存が深刻化。緊急流動性供給に頼った不安定な状態。'
        elif l2a_type == 'CRISIS':
            return '銀行システム危機。信用ストレスとFed依存が同時に高水準。'
    return description


def determine_market_state(
    layer1_stress: int,
    layer2a_stress: int,
    layer2b_stress: int,
    l2a_interpretation_type: Optional[str] = None
) -> Dict[str, Any]:
    """
    市場状態を判定し、該当する全てのSTATEを返す
    """
    conditions = [
        (layer2a_stress >= 65, 'LIQUIDITY_SHOCK', 1),
        (layer2a_stress >= 50, 'CREDIT_CONTRACTION', 2),
        (layer1_stress >= 45, 'POLICY_TIGHTENING', 3),
        (layer2a_stress >= 40 and layer2b_stress >= 70, 'SPLIT_BUBBLE', 4),
        (layer2b_stress >= 80 and layer2a_stress < 35, 'MARKET_OVERSHOOT', 5),
        (layer1_stress < 30 and layer2b_stress > 60, 'FINANCIAL_RALLY', 6),
        (layer1_stress < 35 and layer2a_stress < 35 and layer2b_stress < 40, 'HEALTHY', 7),
    ]

    # 最優先の状態
    primary_code = 'NEUTRAL'
    for condition, code, _ in conditions:
        if condition:
            primary_code = code
            break

    primary_def = MARKET_STATE_DEFINITIONS[primary_code]
    primary_desc = _adjust_description_by_l2a_type(
        primary_code, primary_def['description'], l2a_interpretation_type
    )

    # 全該当状態
    all_states = []
    for condition, code, priority in conditions:
        if condition:
            state_def = MARKET_STATE_DEFINITIONS[code]
            desc = _adjust_description_by_l2a_type(code, state_def['description'], l2a_interpretation_type)
            all_states.append({
                'code': code,
                'label': state_def['label'],
                'description': desc,
                'action': state_def['action'],
                'color': state_def['color'],
                'priority': priority,
            })

    if not all_states:
        state_def = MARKET_STATE_DEFINITIONS['NEUTRAL']
        all_states.append({
            'code': 'NEUTRAL',
            'label': state_def['label'],
            'description': state_def['description'],
            'action': state_def['action'],
            'color': state_def['color'],
            'priority': 10,
        })

    all_states.sort(key=lambda x: x['priority'])

    # コメント生成
    comment = generate_market_comment(
        primary_code, layer1_stress, layer2a_stress, layer2b_stress
    )

    return {
        'code': primary_code,
        'label': primary_def['label'],
        'description': primary_desc,
        'action': primary_def['action'],
        'color': primary_def['color'],
        'comment': comment,
        'all_states': all_states,
        'state_count': len(all_states),
    }


def generate_market_comment(
    state_code: str,
    layer1_stress: int,
    layer2a_stress: int,
    layer2b_stress: int,
) -> str:
    """市場状態に応じた自動コメントを生成"""
    comments = []

    state_comments = {
        'HEALTHY': '流動性環境は健全。リスク資産への追い風が期待できる状況。',
        'FINANCIAL_RALLY': '政策流動性が潤沢で、金融相場の様相。実体経済との乖離に注意。',
        'MARKET_OVERSHOOT': '信用取引主導で市場が先行して過熱中。投機的動きが目立つ。',
        'SPLIT_BUBBLE': '銀行ストレスの中での上昇。脆弱な相場構造に警戒。',
        'LIQUIDITY_SHOCK': '緊急事態。銀行システムで急激なストレス上昇。リスク資産は回避推奨。',
        'CREDIT_CONTRACTION': '銀行ストレス発生。信用供給が制限される可能性。守りの姿勢を推奨。',
        'POLICY_TIGHTENING': 'FRBの流動性供給が縮小中。株式市場への逆風に注意。',
        'NEUTRAL': '明確な状態パターンなし。各Layerの個別動向を注視。'
    }
    comments.append(state_comments.get(state_code, ''))

    if layer1_stress >= 70:
        comments.append('政策流動性が逼迫。FRBの動向に注目。')
    elif layer1_stress <= 30:
        comments.append('政策流動性は潤沢。')

    if layer2a_stress >= 70:
        comments.append('銀行システムにストレス。金融機関の健全性に注意。')
    elif layer2a_stress <= 30:
        comments.append('銀行システムは健全。')

    return ' '.join(comments)


# ============================================================
# イベント検出システム
# 短期的な市場イベントを6種類検出
# demo/analysis/liquidity_score.py から移植
# ============================================================

@dataclass
class MarketEvent:
    """検出されたイベント"""
    event_type: str        # イベントタイプコード
    event_label: str       # 日本語ラベル
    severity: str          # 'WARNING' | 'ALERT' | 'CRITICAL'
    description: str       # 説明
    trigger_value: float   # トリガーとなった値
    threshold: float       # 閾値


EVENT_DEFINITIONS = {
    'FUNDING_STRESS': {
        'label': '資金調達ストレス',
        'description': '準備預金が急減。銀行間市場で流動性逼迫の兆候。'
    },
    'LIQUIDITY_DRAIN': {
        'label': '流動性急減',
        'description': 'Net Liquidityが急激に減少。市場全体への資金供給が縮小。'
    },
    'BANK_STRESS': {
        'label': '銀行ストレス',
        'description': '銀行株が急落。金融システムへの懸念が浮上。'
    },
    'VOLATILITY_SHOCK': {
        'label': 'ボラティリティショック',
        'description': 'VIXが急騰。市場参加者のリスク回避が急速に進行。'
    },
    'CREDIT_SPIKE': {
        'label': 'クレジットスパイク',
        'description': '社債スプレッドが急拡大。信用リスクへの警戒が高まっている。'
    },
    'REPO_STRESS': {
        'label': 'レポ市場ストレス',
        'description': 'レポ金利が急騰または異常値。短期資金市場に問題発生。'
    }
}


def _detect_funding_stress(
    reserves_change_1m: Optional[float] = None,
    reserves_change_1w: Optional[float] = None
) -> Optional[MarketEvent]:
    d = EVENT_DEFINITIONS['FUNDING_STRESS']
    if reserves_change_1m is not None:
        if reserves_change_1m <= -15:
            return MarketEvent('FUNDING_STRESS', d['label'], 'CRITICAL', d['description'], reserves_change_1m, -15)
        elif reserves_change_1m <= -10:
            return MarketEvent('FUNDING_STRESS', d['label'], 'ALERT', d['description'], reserves_change_1m, -10)
        elif reserves_change_1m <= -5:
            return MarketEvent('FUNDING_STRESS', d['label'], 'WARNING', d['description'], reserves_change_1m, -5)
    if reserves_change_1w is not None and reserves_change_1w <= -5:
        return MarketEvent('FUNDING_STRESS', d['label'], 'ALERT',
                           '準備預金が1週間で急減。短期的な流動性逼迫。', reserves_change_1w, -5)
    return None


def _detect_liquidity_drain(
    net_liquidity_change_3m: Optional[float] = None,
    net_liquidity_change_1m: Optional[float] = None
) -> Optional[MarketEvent]:
    d = EVENT_DEFINITIONS['LIQUIDITY_DRAIN']
    if net_liquidity_change_3m is not None:
        if net_liquidity_change_3m <= -20:
            return MarketEvent('LIQUIDITY_DRAIN', d['label'], 'CRITICAL', d['description'], net_liquidity_change_3m, -20)
        elif net_liquidity_change_3m <= -15:
            return MarketEvent('LIQUIDITY_DRAIN', d['label'], 'ALERT', d['description'], net_liquidity_change_3m, -15)
        elif net_liquidity_change_3m <= -10:
            return MarketEvent('LIQUIDITY_DRAIN', d['label'], 'WARNING', d['description'], net_liquidity_change_3m, -10)
    if net_liquidity_change_1m is not None and net_liquidity_change_1m <= -10:
        return MarketEvent('LIQUIDITY_DRAIN', d['label'], 'ALERT',
                           'Net Liquidityが1ヶ月で急減。短期的な資金供給縮小。', net_liquidity_change_1m, -10)
    return None


def _detect_bank_stress(
    kre_change_2m: Optional[float] = None,
    kre_change_1m: Optional[float] = None
) -> Optional[MarketEvent]:
    d = EVENT_DEFINITIONS['BANK_STRESS']
    if kre_change_2m is not None:
        if kre_change_2m <= -25:
            return MarketEvent('BANK_STRESS', d['label'], 'CRITICAL', d['description'], kre_change_2m, -25)
        elif kre_change_2m <= -15:
            return MarketEvent('BANK_STRESS', d['label'], 'ALERT', d['description'], kre_change_2m, -15)
    if kre_change_1m is not None and kre_change_1m <= -15:
        return MarketEvent('BANK_STRESS', d['label'], 'ALERT',
                           '銀行株が1ヶ月で急落。金融セクターへの懸念。', kre_change_1m, -15)
    return None


def _detect_volatility_shock(
    vix_current: Optional[float] = None,
    vix_1m_ago: Optional[float] = None,
    vix_1w_ago: Optional[float] = None
) -> Optional[MarketEvent]:
    d = EVENT_DEFINITIONS['VOLATILITY_SHOCK']
    if vix_current is not None:
        if vix_current >= 40:
            return MarketEvent('VOLATILITY_SHOCK', d['label'], 'CRITICAL',
                               'VIXが40を超え、パニック水準に到達。', vix_current, 40)
        elif vix_current >= 30:
            return MarketEvent('VOLATILITY_SHOCK', d['label'], 'ALERT',
                               'VIXが30を超え、高警戒水準。', vix_current, 30)
        if vix_1w_ago is not None and vix_current - vix_1w_ago >= 15:
            delta = vix_current - vix_1w_ago
            return MarketEvent('VOLATILITY_SHOCK', d['label'], 'ALERT',
                               f'VIXが1週間で{delta:.1f}ポイント急騰。', delta, 15)
        if vix_1m_ago is not None and vix_current - vix_1m_ago >= 20:
            delta = vix_current - vix_1m_ago
            return MarketEvent('VOLATILITY_SHOCK', d['label'], 'WARNING',
                               f'VIXが1ヶ月で{delta:.1f}ポイント上昇。', delta, 20)
    return None


def _detect_credit_spike(
    hy_spread_current: Optional[float] = None,
    hy_spread_1m_ago: Optional[float] = None,
    ig_spread_current: Optional[float] = None,
    ig_spread_1m_ago: Optional[float] = None
) -> Optional[MarketEvent]:
    d = EVENT_DEFINITIONS['CREDIT_SPIKE']
    if hy_spread_current is not None:
        if hy_spread_current >= 6.0:
            return MarketEvent('CREDIT_SPIKE', d['label'], 'CRITICAL',
                               f'HYスプレッドが{hy_spread_current:.2f}%に拡大。信用危機水準。', hy_spread_current, 6.0)
        elif hy_spread_current >= 5.0:
            return MarketEvent('CREDIT_SPIKE', d['label'], 'ALERT',
                               f'HYスプレッドが{hy_spread_current:.2f}%に拡大。信用リスク警戒。', hy_spread_current, 5.0)
        if hy_spread_1m_ago is not None:
            change = hy_spread_current - hy_spread_1m_ago
            if change >= 1.5:
                return MarketEvent('CREDIT_SPIKE', d['label'], 'ALERT',
                                   f'HYスプレッドが1ヶ月で{change:.2f}%拡大。', change, 1.5)
    if ig_spread_current is not None and ig_spread_1m_ago is not None:
        change = ig_spread_current - ig_spread_1m_ago
        if change >= 0.5:
            return MarketEvent('CREDIT_SPIKE', d['label'], 'WARNING',
                               f'IGスプレッドが1ヶ月で{change:.2f}%拡大。', change, 0.5)
    return None


def _detect_repo_stress(
    sofr_ff_spread: Optional[float] = None,
    rrp_change_1w: Optional[float] = None
) -> Optional[MarketEvent]:
    d = EVENT_DEFINITIONS['REPO_STRESS']
    if sofr_ff_spread is not None:
        if sofr_ff_spread >= 30:
            return MarketEvent('REPO_STRESS', d['label'], 'CRITICAL',
                               f'SOFR-FFスプレッドが{sofr_ff_spread:.0f}bpに拡大。レポ市場危機。', sofr_ff_spread, 30)
        elif sofr_ff_spread >= 15:
            return MarketEvent('REPO_STRESS', d['label'], 'ALERT',
                               f'SOFR-FFスプレッドが{sofr_ff_spread:.0f}bpに拡大。', sofr_ff_spread, 15)
    if rrp_change_1w is not None and rrp_change_1w <= -30:
        return MarketEvent('REPO_STRESS', d['label'], 'WARNING',
                           f'RRP残高が1週間で{rrp_change_1w:.1f}%減少。QTの緩衝材が枯渇に向かっており、これ以上のQT継続は市場から直接資金を吸収し始めるリスク。', rrp_change_1w, -30)
    return None


def detect_market_events(
    reserves_change_1m: Optional[float] = None,
    reserves_change_1w: Optional[float] = None,
    net_liquidity_change_3m: Optional[float] = None,
    net_liquidity_change_1m: Optional[float] = None,
    kre_change_2m: Optional[float] = None,
    kre_change_1m: Optional[float] = None,
    vix_current: Optional[float] = None,
    vix_1m_ago: Optional[float] = None,
    vix_1w_ago: Optional[float] = None,
    hy_spread_current: Optional[float] = None,
    hy_spread_1m_ago: Optional[float] = None,
    ig_spread_current: Optional[float] = None,
    ig_spread_1m_ago: Optional[float] = None,
    sofr_ff_spread: Optional[float] = None,
    rrp_change_1w: Optional[float] = None
) -> List[MarketEvent]:
    """市場イベントを検出（severity順ソート）"""
    events = []
    detectors = [
        lambda: _detect_funding_stress(reserves_change_1m, reserves_change_1w),
        lambda: _detect_liquidity_drain(net_liquidity_change_3m, net_liquidity_change_1m),
        lambda: _detect_bank_stress(kre_change_2m, kre_change_1m),
        lambda: _detect_volatility_shock(vix_current, vix_1m_ago, vix_1w_ago),
        lambda: _detect_credit_spike(hy_spread_current, hy_spread_1m_ago, ig_spread_current, ig_spread_1m_ago),
        lambda: _detect_repo_stress(sofr_ff_spread, rrp_change_1w),
    ]
    for detect in detectors:
        evt = detect()
        if evt:
            events.append(evt)
    severity_order = {'CRITICAL': 0, 'ALERT': 1, 'WARNING': 2}
    events.sort(key=lambda e: severity_order.get(e.severity, 3))
    return events


def events_to_dict(events: List[MarketEvent]) -> List[Dict[str, Any]]:
    """MarketEventリストを辞書リストに変換"""
    return [
        {
            'event_type': e.event_type,
            'event_label': e.event_label,
            'severity': e.severity,
            'description': e.description,
            'trigger_value': e.trigger_value,
            'threshold': e.threshold
        }
        for e in events
    ]


# ============================================================
# Policy Regime（政策レジーム）検出システム
# demo/analysis/liquidity_score.py から移植
#
# 6状態（優先順位順）:
#   1. PIVOT_CONFIRMED  2. PIVOT_EARLY  3. QE_MODE
#   4. QT_ACTIVE  5. QT_EXHAUSTED  6. NEUTRAL_POLICY
# ============================================================

@dataclass
class PolicyRegime:
    """政策レジーム情報"""
    regime: str
    regime_label: str
    description: str
    fed_action_room: Dict[str, Any]
    signals: List[str]


POLICY_REGIME_DEFINITIONS = {
    'PIVOT_CONFIRMED': {
        'label': '政策転換確定',
        'description': '利下げ継続またはバランスシート増勢が確認された状態。緩和サイクル入り。'
    },
    'PIVOT_EARLY': {
        'label': '政策転換初期',
        'description': '利下げの見込みあり。保険的利下げの可能性あり。RRP枯渇があれば警戒強。'
    },
    'QE_MODE': {
        'label': '量的緩和モード',
        'description': 'FRBがバランスシートを拡大中。市場に流動性を供給している状態。'
    },
    'QT_ACTIVE': {
        'label': '量的引き締め（実効）',
        'description': 'FRBがバランスシートを縮小中。RRP潤沢で流動性吸収が効いている状態。'
    },
    'QT_EXHAUSTED': {
        'label': '量的引き締め（疲弊）',
        'description': '形式上はQT継続だが、RRP枯渇でQTが効かなくなっている状態。'
    },
    'NEUTRAL_POLICY': {
        'label': '中立',
        'description': '明確な政策方向性なし。バランスシートは横ばい。'
    }
}

POLICY_REGIME_THRESHOLDS = {
    'rrp_depleted': 50,
    'rrp_ample': 200,
    'soma_expanding': 2.0,
    'soma_shrinking': -0.5,
    'soma_flat': 0.5,
    'cuts_confirmed': 100,
}


def _calculate_fed_action_room(
    ff_rate: Optional[float] = None,
    rrp_level: Optional[float] = None,
    tga_level: Optional[float] = None,
    inflation_rate: Optional[float] = None,
    yield_curve: Optional[float] = None
) -> Dict[str, Any]:
    """Fedの行動余地メーター（利下げ余地/吸収余地/財政余地）"""
    result = {
        'rate_cut_room': {'level': 'Unknown', 'room_pct': None, 'constraint': None},
        'absorption_room': {'level': 'Unknown', 'rrp_buffer': None, 'comment': None},
        'fiscal_assist_potential': {'level': 'Unknown', 'tga_level': None, 'comment': None},
        'overall_room': 'Unknown'
    }
    fed_scores = []

    # 利下げ余地
    if ff_rate is not None:
        room_pct = ff_rate
        constraint = None
        if inflation_rate is not None and inflation_rate > 3.0:
            constraint = f'高インフレ（{inflation_rate:.1f}%）が利下げを制約'
            level = 'Low'
            fed_scores.append(1)
        elif ff_rate >= 4.0:
            level = 'High'
            fed_scores.append(3)
        elif ff_rate >= 2.0:
            level = 'Medium'
            fed_scores.append(2)
        else:
            level = 'Low'
            constraint = 'ゼロ金利に近い'
            fed_scores.append(1)
        result['rate_cut_room'] = {'level': level, 'room_pct': round(room_pct, 2), 'constraint': constraint}

    # 吸収余地（RRP）
    if rrp_level is not None:
        if rrp_level > 500:
            level, comment = 'High', f'RRP残高潤沢（{rrp_level:.0f}B$）- QT継続余地あり'
            fed_scores.append(3)
        elif rrp_level > 200:
            level, comment = 'Medium', f'RRP残高中程度（{rrp_level:.0f}B$）- QT慎重に継続'
            fed_scores.append(2)
        else:
            level, comment = 'Low', f'RRP残高低下（{rrp_level:.0f}B$）- QT限界に接近'
            fed_scores.append(1)
        result['absorption_room'] = {'level': level, 'rrp_buffer': rrp_level, 'comment': comment}

    # 財政補助余地（TGA - 政治裁量枠）
    if tga_level is not None:
        if tga_level > 500:
            level, comment = 'Available', f'TGA残高あり（{tga_level:.0f}B$）- 財政余力あり（政治裁量）'
        else:
            level, comment = 'Limited', f'TGA残高限定的（{tga_level:.0f}B$）'
        result['fiscal_assist_potential'] = {'level': level, 'tga_level': tga_level, 'comment': comment}

    # 総合判定（Fed単独 = rate_cut + absorption、TGA含めない）
    if fed_scores:
        avg = sum(fed_scores) / len(fed_scores)
        result['overall_room'] = 'Ample' if avg >= 2.5 else 'Moderate' if avg >= 1.5 else 'Limited'

    return result


def detect_policy_regime(
    soma_change_3m: Optional[float] = None,
    soma_change_6m: Optional[float] = None,
    rrp_level: Optional[float] = None,
    rrp_change_3m: Optional[float] = None,
    tga_level: Optional[float] = None,
    ff_rate: Optional[float] = None,
    ff_rate_change_6m: Optional[float] = None,
    yield_curve: Optional[float] = None,
    inflation_rate: Optional[float] = None
) -> PolicyRegime:
    """政策レジームを検出（優先順位: PIVOT > QE > QT > NEUTRAL）"""
    T = POLICY_REGIME_THRESHOLDS
    signals = []
    regime = 'NEUTRAL_POLICY'

    cuts_cum_bp_6m = -ff_rate_change_6m * 100 if ff_rate_change_6m is not None else 0
    soma_flat = abs(soma_change_3m) < T['soma_flat'] if soma_change_3m is not None else False
    rrp_depleted = rrp_level is not None and rrp_level < T['rrp_depleted']
    rrp_ample = rrp_level is not None and rrp_level > T['rrp_ample']
    soma_expanding = soma_change_3m is not None and soma_change_3m > T['soma_expanding']
    soma_shrinking = soma_change_3m is not None and soma_change_3m < T['soma_shrinking']

    if cuts_cum_bp_6m >= T['cuts_confirmed']:
        regime = 'PIVOT_CONFIRMED'
        signals.append(f'利下げ累計 {cuts_cum_bp_6m:.0f}bp（6M）- 緩和サイクル確定')
    elif cuts_cum_bp_6m > 0:
        regime = 'PIVOT_EARLY'
        signals.append(f'利下げ開始（累計 {cuts_cum_bp_6m:.0f}bp / 6M）')
        if rrp_depleted:
            signals.append(f'RRP枯渇（{rrp_level:.1f}B$）- 警戒強')
    elif soma_expanding:
        regime = 'QE_MODE'
        signals.append(f'SOMA拡大中（3M: +{soma_change_3m:.1f}%）')
    elif soma_shrinking and rrp_ample:
        regime = 'QT_ACTIVE'
        signals.append(f'SOMA縮小中（3M: {soma_change_3m:.1f}%）')
        signals.append(f'RRP潤沢（{rrp_level:.0f}B$）- QT実効中')
    elif rrp_depleted and cuts_cum_bp_6m <= 0 and (soma_shrinking or soma_flat):
        regime = 'QT_EXHAUSTED'
        signals.append(f'SOMA {"縮小" if soma_shrinking else "横ばい"}中（3M: {soma_change_3m:.1f}%）')
        signals.append(f'RRP枯渇（{rrp_level:.1f}B$）- QT限界到達')
    else:
        if soma_change_3m is not None:
            signals.append(f'SOMA変化（3M: {soma_change_3m:+.1f}%）')
        if rrp_level is not None:
            signals.append(f'RRP残高: {rrp_level:.0f}B$')

    regime_def = POLICY_REGIME_DEFINITIONS.get(regime, POLICY_REGIME_DEFINITIONS['NEUTRAL_POLICY'])
    fed_action_room = _calculate_fed_action_room(
        ff_rate=ff_rate, rrp_level=rrp_level, tga_level=tga_level,
        inflation_rate=inflation_rate, yield_curve=yield_curve
    )
    return PolicyRegime(
        regime=regime, regime_label=regime_def['label'],
        description=regime_def['description'],
        fed_action_room=fed_action_room, signals=signals
    )


def policy_regime_to_dict(regime: PolicyRegime) -> Dict[str, Any]:
    """PolicyRegimeを辞書に変換"""
    return {
        'regime': regime.regime,
        'regime_label': regime.regime_label,
        'description': regime.description,
        'fed_action_room': regime.fed_action_room,
        'signals': regime.signals
    }


def generate_fed_action_comment(regime: PolicyRegime) -> str:
    """Fedの行動余地に関するコメント生成（条件の組み合わせで具体的に）"""
    action_room = regime.fed_action_room
    rate = action_room.get('rate_cut_room', {})
    absorb = action_room.get('absorption_room', {})
    fiscal = action_room.get('fiscal_assist_potential', {})

    rate_level = rate.get('level', 'Unknown')
    rate_pct = rate.get('room_pct')
    absorb_level = absorb.get('level', 'Unknown')
    rrp_buffer = absorb.get('rrp_buffer')
    fiscal_level = fiscal.get('level', 'Unknown')
    has_constraint = rate.get('constraint') is not None

    lines = []

    # 利下げ状況（メイン判断）
    if rate_level == 'High' and not has_constraint:
        lines.append(f'利下げ余地は約{rate_pct:.1f}%pt。大幅利下げが可能な水準。')
        if absorb_level == 'Low':
            lines.append('ただしRRP緩衝材が枯渇。QTを続ければ市場から直接資金吸収が始まるため、利下げ・QT停止圧力が高まっている。')
        elif absorb_level == 'Medium':
            lines.append('保険的利下げの可能性あり。景気減速シグナルに注視。')
    elif rate_level == 'Medium':
        lines.append(f'FF金利{rate_pct:.1f}%。利下げカードは温存されている。')
        if has_constraint:
            lines.append(rate['constraint'] + '。実行にはハードルあり。')
        elif absorb_level == 'Low':
            lines.append('景気悪化時は保険的利下げの可能性。RRP緩衝材の枯渇でQTが市場を直接圧迫するリスクあり。')
        else:
            lines.append('景気・インフレ次第で利下げ着手のタイミングを探る局面。')
    elif rate_level == 'Low':
        if has_constraint:
            lines.append(rate['constraint'] + '。利下げカード乏しい。')
        else:
            lines.append('ゼロ金利に近く、利下げ余地は極めて限定的。')
        if absorb_level == 'Low':
            lines.append('RRP緩衝材も枯渇。QTは市場から直接吸収する段階。Fedの弾切れリスク。')

    # RRP/QT状況
    if absorb_level == 'Low' and rrp_buffer is not None:
        lines.append(f'RRP残高{rrp_buffer:.0f}B$ — QTの緩衝材がほぼ消失。これ以上のQTは銀行準備預金を直接削る。')
    elif absorb_level == 'High':
        lines.append('RRP残高潤沢。QTの影響はRRPが吸収しており、市場への直接的圧迫なし。')

    # 財政余地
    if fiscal_level == 'Available':
        tga = fiscal.get('tga_level')
        lines.append(f'TGA {tga:.0f}B$で財政補助の余地あり（政治裁量）。' if tga else '財政補助の余地あり。')
    elif fiscal_level == 'Limited':
        lines.append('TGA残高限定的。財政面からの支援は期待薄。')

    # フォールバック
    if not lines:
        lines.append('明確な政策方向性なし。データ不足の可能性。')

    return ' '.join(lines)


# ============================================================
# ローリングZ-score（乖離分析用）
# ============================================================

def rolling_zscore(values: List[float], window: int = 24) -> List[Optional[float]]:
    """ローリングウィンドウでz-scoreを計算"""
    result = []
    for i in range(len(values)):
        w = values[max(0, i - window + 1):i + 1]
        if len(w) < 3:
            result.append(None)
            continue
        mean = statistics.mean(w)
        std = statistics.stdev(w)
        result.append(round((values[i] - mean) / std, 3) if std > 0 else 0.0)
    return result
