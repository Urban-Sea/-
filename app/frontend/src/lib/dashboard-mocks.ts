/**
 * Dashboard preview 用モックデータ.
 *
 * シナリオ: POLICY_TIGHTENING × CAUTION (警戒モード, 黄〜橙)
 *  - 流動性: FRB が QT で L1 ストレス高め, L2A 銀行は健全, L2B 市場は中程度
 *  - 景気: 雇用・消費・構造の合算で 52/100 (CAUTION)
 *  - 4 つのインサイトカードがトリガーされる
 *
 * 全 variant (dashboard-a..d) で共通利用. AuthGuard を外しているので
 * 認証なしでも見える. 実 API には接続しない.
 */

import type {
  PlumbingSummary,
  EmploymentRiskScore,
  MarketEventsData,
  PolicyRegimeData,
} from '@/types';

export const MOCK_PLUMBING: PlumbingSummary = {
  timestamp: '2026-04-09T08:30:00Z',
  layers: {
    layer1: {
      stress_score: 65,
      interpretation: 'FRB の QT 進行で政策流動性が縮小しています',
      z_score: 1.4,
      net_liquidity: 5_280_000,
      fed_data: {
        date: '2026-04-08',
        soma_assets: 6_820_000,
        reserves: 3_140_000,
        rrp: 480_000,
        tga: 720_000,
      },
    },
    layer2a: {
      stress_score: 35,
      interpretation: '銀行セクターは健全, KRE/SRF にストレスなし',
      interpretation_type: 'NORMAL',
      alerts: [],
    },
    layer2b: {
      stress_score: 55,
      interpretation: 'マージンデットの 2 年変化率がやや高め',
      phase: 'EXPANSION',
      margin_debt_2y: 0.18,
      margin_debt_1y: 0.12,
      it_bubble_comparison: 0.45,
      it_bubble_peak: 0.4,
    },
  },
  credit_pressure: {
    level: 'Medium',
    pressure_count: 2,
    components: {
      hy_spread: { value: 4.2, status: 'normal' },
      ig_spread: { value: 1.1, status: 'warning' },
      ted_spread: { value: 0.3, status: 'normal' },
    },
    alerts: ['IG クレジットスプレッドが 1.1% に拡大'],
  },
  market_state: {
    code: 'POLICY_TIGHTENING',
    label: '政策引き締め',
    description: 'FRB が金融を引き締め中. 政策流動性が縮小しています.',
    action: '選別投資. 新規ポジションは控えめに.',
    color: 'yellow',
    comment: 'L1 が高水準だが L2A 銀行・L2B 市場は健全. 段階的な引き締めとして機能',
    all_states: [],
    state_count: 1,
  },
  market_indicators: {
    date: '2026-04-08',
    vix: 18.4,
    dxy: 104.2,
    sp500: 5810,
    nasdaq: 18420,
  },
  interest_rates: {
    date: '2026-04-08',
    fed_funds: 4.75,
    treasury_2y: 4.32,
    treasury_10y: 4.28,
    treasury_spread: -0.04,
  },
  credit_spreads: {
    date: '2026-04-08',
    hy_spread: 4.2,
    ig_spread: 1.1,
    ted_spread: 0.3,
  },
};

export const MOCK_ECONOMIC: EmploymentRiskScore = {
  total_score: 52,
  phase: {
    code: 'CAUTION',
    label: '警戒期',
    description: '複数の景気指標が悪化しています',
    action: '新規投資を控え, 守り重視のポジションへ',
    color: 'orange',
    position_limit: 0.5,
  },
  categories: [
    {
      name: '雇用',
      score: 26,
      max_score: 50,
      components: [
        { name: 'NFP 3M 平均', score: 8, max_score: 15, detail: '+85K (前月 +120K)', status: 'warning' },
        { name: '失業率変化', score: 10, max_score: 15, detail: '4.2% (3 ヶ月連続上昇)', status: 'warning' },
        { name: '新規失業保険申請', score: 6, max_score: 10, detail: '232K (4 週平均)', status: 'normal' },
        { name: 'JOLTS 求人率', score: 2, max_score: 10, detail: '4.8% (低下中)', status: 'warning' },
      ],
    },
    {
      name: '消費',
      score: 14,
      max_score: 25,
      components: [
        { name: '実質個人所得 YoY', score: 5, max_score: 10, detail: '+1.2%', status: 'warning' },
        { name: '消費者信頼感', score: 6, max_score: 10, detail: '88.5 (悪化中)', status: 'warning' },
        { name: 'クレジット延滞率', score: 3, max_score: 5, detail: '3.4%', status: 'warning' },
      ],
    },
    {
      name: '構造',
      score: 12,
      max_score: 25,
      components: [
        { name: '失業率トレンド', score: 6, max_score: 10, detail: '上昇傾向', status: 'warning' },
        { name: 'サームルール', score: 4, max_score: 10, detail: '0.33 (未発動)', status: 'normal' },
        { name: '長期失業率', score: 2, max_score: 5, detail: '0.9%', status: 'normal' },
      ],
    },
  ],
  sahm_rule: {
    current_u3: 4.2,
    u3_3m_avg: 4.13,
    u3_12m_low_3m_avg: 3.8,
    sahm_value: 0.33,
    triggered: false,
    peak_out: false,
    near_peak_out: false,
  },
  alert_factors: [
    '失業率が 3 ヶ月連続上昇 (3.9% → 4.2%)',
    '消費者信頼感が 6 ヶ月低下 (95 → 88.5)',
    'JOLTS 求人率が低下傾向',
  ],
  timestamp: '2026-04-09T08:30:00Z',
  latest_nfp: null,
  latest_claims: null,
  nfp_history: [],
  claims_history: [],
  consumer_history: [],
};

export const MOCK_EVENTS: MarketEventsData = {
  events: [
    {
      event_type: 'CREDIT_SPREAD_WIDENING',
      event_label: 'IG クレジットスプレッド拡大',
      severity: 'WARNING',
      description: 'IG スプレッドが 1.1% に拡大. リスク回避の兆候',
      trigger_value: 1.1,
      threshold: 1.0,
    },
    {
      event_type: 'FED_QT',
      event_label: 'FRB QT 継続',
      severity: 'ALERT',
      description: '量的引き締めにより L1 流動性が縮小中',
      trigger_value: 65,
      threshold: 60,
    },
  ],
  event_count: 2,
  highest_severity: 'ALERT',
  timestamp: '2026-04-09T08:30:00Z',
};

export const MOCK_POLICY: PolicyRegimeData = {
  regime: 'QT_MODE',
  regime_label: '量的引き締め (QT)',
  description: 'FRB がバランスシートを縮小中. 流動性が緩やかに低下',
  fed_action_room: {
    rate_cut_room: { level: 'Medium', room_pct: 4.75, comment: '利下げ余地あり (FFR 4.75%)' },
    absorption_room: { level: 'High', rrp_buffer: 480_000, comment: 'RRP 残高 480B でバッファー充分' },
    fiscal_assist_potential: { level: 'Medium', tga_level: 720_000, comment: 'TGA 720B 維持' },
    overall_room: 'Medium',
  },
  signals: ['RRP 残高 480B', 'TGA 720B', 'SOMA 縮小ペース 100B/月'],
  fed_comment: 'インフレ再加速の警戒継続. QT は当面継続の見込み',
};

/** Variant 切替リンク (各 dashboard-x ページの上部に表示) */
export const VARIANT_LINKS = [
  { href: '/dashboard-a', key: 'a', label: '案 A: マガジン' },
  { href: '/dashboard-b', key: 'b', label: '案 B: 1 画面 (refined)' },
  { href: '/dashboard-c', key: 'c', label: '案 C: ストーリー' },
  { href: '/dashboard-d', key: 'd', label: '案 D: ミニマル' },
  { href: '/dashboard-e', key: 'e', label: '案 E: 旧スタイル light化' },
] as const;

/** 統合インサイトのテキスト生成 (本物の dashboard と同じロジック) */
export function getIntegratedInsight(stateCode: string, phaseCode: string): {
  main: string;
  sub: string;
  color: 'green' | 'cyan' | 'yellow' | 'orange' | 'red';
} {
  const isShock = stateCode === 'LIQUIDITY_SHOCK';
  const isCrisis = phaseCode === 'CRISIS' || phaseCode === 'CONTRACTION';
  const isTight = stateCode === 'POLICY_TIGHTENING' || stateCode === 'CREDIT_CONTRACTION' || stateCode === 'SPLIT_BUBBLE';
  const isCaution = phaseCode === 'CAUTION';
  const isHealthy = stateCode === 'HEALTHY' || stateCode === 'FINANCIAL_RALLY';
  const isSafe = phaseCode === 'EXPANSION';

  if (isShock && isCrisis) return { main: '両システムが危険シグナル', sub: 'フルキャッシュ推奨 — 流動性・景気ともに深刻な状態です', color: 'red' };
  if (isShock || isCrisis) return { main: '一方のシステムが危険シグナル', sub: '大幅なリスク縮小を検討してください', color: 'red' };
  if (isTight && isCaution) return { main: '両システムが警戒シグナル', sub: '新規投資を控え, 守り重視の姿勢が適切です', color: 'orange' };
  if (isTight || isCaution) return { main: '一方のシステムが警戒シグナル', sub: '慎重な姿勢を維持しましょう', color: 'yellow' };
  if (isHealthy && isSafe) return { main: '両システムが安全シグナル', sub: '通常の投資活動が可能な環境です', color: 'green' };
  return { main: '現在のシグナルは中立的', sub: '状況を注視しながら様子見が適切です', color: 'cyan' };
}

/** 5×5 マトリクスデータ */
export const STATE_LABELS = ['健全相場', '中立', '政策引き締め', '信用収縮', '流動性ショック'];
export const PHASE_LABELS = ['拡大期', '減速期', '警戒期', '収縮期', '危機'];

export const MATRIX_DATA: string[][] = [
  ['積極投資 OK', '慎重に継続', '利確検討', 'ポジション縮小', '利確急ぐ'],
  ['通常投資', '様子見', '新規控え', '防御的に', '大幅縮小'],
  ['選別投資', '新規控え', '守り重視', 'リスク縮小', 'キャッシュ寄せ'],
  ['ポジション縮小', '守り重視', '大幅縮小', 'キャッシュ確保', 'フルキャッシュ'],
  ['キャッシュ寄せ', '大幅縮小', 'フルキャッシュ', 'フルキャッシュ', 'フルキャッシュ'],
];

export const MATRIX_COLORS: ('green' | 'cyan' | 'yellow' | 'orange' | 'red')[][] = [
  ['green', 'green', 'yellow', 'orange', 'red'],
  ['green', 'cyan', 'yellow', 'orange', 'red'],
  ['yellow', 'yellow', 'orange', 'orange', 'red'],
  ['orange', 'orange', 'red', 'red', 'red'],
  ['red', 'red', 'red', 'red', 'red'],
];

export function stateToRow(code: string): number {
  if (code === 'HEALTHY' || code === 'FINANCIAL_RALLY') return 0;
  if (code === 'NEUTRAL' || code === 'MARKET_OVERSHOOT') return 1;
  if (code === 'POLICY_TIGHTENING') return 2;
  if (code === 'CREDIT_CONTRACTION' || code === 'SPLIT_BUBBLE') return 3;
  if (code === 'LIQUIDITY_SHOCK') return 4;
  return 1;
}

export function phaseToCol(code: string): number {
  if (code === 'EXPANSION') return 0;
  if (code === 'SLOWDOWN') return 1;
  if (code === 'CAUTION') return 2;
  if (code === 'CONTRACTION') return 3;
  if (code === 'CRISIS') return 4;
  return 1;
}

/** 動的インサイトカード */
export type InsightCard = {
  title: string;
  description: string;
  color: 'green' | 'cyan' | 'yellow' | 'orange' | 'red';
};

export function getInsightCards(): InsightCard[] {
  return [
    {
      title: '量的引き締め中 (QT)',
      description: 'FRB がバランスシートを縮小中. 流動性が緩やかに低下しています.',
      color: 'orange',
    },
    {
      title: '政策流動性の縮小',
      description: 'L1 ストレス 65 — FRB の資金供給が縮小しています.',
      color: 'orange',
    },
    {
      title: '景気悪化の兆候',
      description: '景気スコア 52/100 — 雇用・消費の複数指標が悪化しています.',
      color: 'orange',
    },
    {
      title: 'IG クレジットスプレッド拡大',
      description: 'IG スプレッドが 1.1% に拡大. リスク回避の兆候.',
      color: 'yellow',
    },
  ];
}

/** Tailwind class マッピング (景気/流動性ステータス色) */
export function statusClasses(color: 'green' | 'cyan' | 'yellow' | 'orange' | 'red') {
  const map = {
    green: { text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', dot: 'bg-emerald-500', soft: 'bg-emerald-500/10' },
    cyan: { text: 'text-cyan-700', bg: 'bg-cyan-50', border: 'border-cyan-200', dot: 'bg-cyan-500', soft: 'bg-cyan-500/10' },
    yellow: { text: 'text-yellow-700', bg: 'bg-yellow-50', border: 'border-yellow-200', dot: 'bg-yellow-500', soft: 'bg-yellow-500/10' },
    orange: { text: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200', dot: 'bg-orange-500', soft: 'bg-orange-500/10' },
    red: { text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500', soft: 'bg-red-500/10' },
  };
  return map[color];
}
