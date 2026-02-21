"""
流動性スコア計算モジュール（demoから移植）

各Layerの Stress Score を計算する

設計思想:
- スコアは「良い／悪い」ではなく "詰まり度・危険度" を表す
- 0 = 非常に健全（流れがスムーズ）
- 100 = 臨界状態（詰まり・破断寸前）
- 高いほど危険
"""

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
