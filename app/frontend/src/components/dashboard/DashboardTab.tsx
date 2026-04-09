'use client';

/**
 * 統合分析ダッシュボード タブ 1 (本体)
 *
 * 本ファイルは [app/dashboard/page.tsx] から切り出されたもので、
 * - 認証ありの本番ルート (/dashboard)
 * - 認証なしの visual review プレビュー (/dashboard-preview)
 * の両方から再利用される.
 */

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Droplets, ShieldAlert, BarChart3, Briefcase,
  ShieldCheck, AlertTriangle, AlertOctagon, OctagonAlert,
} from 'lucide-react';
import {
  GlassCard, ScoreRing, GaugeBar, ScoreLegend,
} from '@/components/shared/glass';
import type {
  PlumbingSummary, EmploymentRiskScore, MarketEventsData, PolicyRegimeData,
} from '@/types';

// ============================================================
// Helpers
// ============================================================

function fmt(v: number | null | undefined, d = 0): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function colorClasses(color: string) {
  const map: Record<string, { text: string; bg: string; border: string; dot: string }> = {
    green: { text: 'text-blue-600', bg: 'bg-blue-500/8', border: 'border-blue-500/20', dot: 'bg-blue-400' },
    cyan: { text: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500/8', border: 'border-cyan-500/20', dot: 'bg-cyan-400' },
    yellow: { text: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/8', border: 'border-yellow-500/20', dot: 'bg-yellow-400' },
    orange: { text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/8', border: 'border-orange-500/20', dot: 'bg-orange-400' },
    red: { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/8', border: 'border-red-500/20', dot: 'bg-red-400 animate-pulse' },
    gray: { text: 'text-zinc-600 dark:text-zinc-400', bg: 'bg-zinc-500/8', border: 'border-zinc-500/20', dot: 'bg-zinc-400' },
  };
  return map[color] || map.gray;
}

// ── Insight Generation (State × Phase) ──

function getIntegratedInsight(stateCode: string, phaseCode: string): { main: string; sub: string; color: string } {
  const isShock = stateCode === 'LIQUIDITY_SHOCK';
  const isCrisis = phaseCode === 'CRISIS' || phaseCode === 'CONTRACTION';
  const isTight = stateCode === 'POLICY_TIGHTENING' || stateCode === 'CREDIT_CONTRACTION' || stateCode === 'SPLIT_BUBBLE';
  const isCaution = phaseCode === 'CAUTION';
  const isHealthy = stateCode === 'HEALTHY' || stateCode === 'FINANCIAL_RALLY';
  const isSafe = phaseCode === 'EXPANSION';

  if (isShock && isCrisis) return { main: '両システムが危険シグナル', sub: 'フルキャッシュ推奨 — 流動性・景気ともに深刻な状態です', color: 'red' };
  if (isShock || isCrisis) return { main: '一方のシステムが危険シグナル', sub: '大幅なリスク縮小を検討してください', color: 'red' };
  if (isTight && isCaution) return { main: '両システムが警戒シグナル', sub: '新規投資を控え、守り重視の姿勢が適切です', color: 'orange' };
  if (isTight || isCaution) return { main: '一方のシステムが警戒シグナル', sub: '慎重な姿勢を維持しましょう', color: 'yellow' };
  if (isHealthy && isSafe) return { main: '両システムが安全シグナル', sub: '通常の投資活動が可能な環境です', color: 'green' };
  return { main: '現在のシグナルは中立的', sub: '状況を注視しながら様子見が適切です', color: 'cyan' };
}

// ── State × Phase Matrix Data ──

const STATE_LABELS = ['健全相場', '中立', '政策引き締め', '信用収縮', '流動性ショック'];
const PHASE_LABELS = ['拡大期', '減速期', '警戒期', '収縮期', '危機'];

const MATRIX_DATA: string[][] = [
  ['積極投資OK', '慎重に継続', '利確検討', 'ポジション縮小', '利確急ぐ'],
  ['通常投資', '様子見', '新規控え', '防御的に', '大幅縮小'],
  ['選別投資', '新規控え', '守り重視', 'リスク縮小', 'キャッシュ寄せ'],
  ['ポジション縮小', '守り重視', '大幅縮小', 'キャッシュ確保', 'フルキャッシュ'],
  ['キャッシュ寄せ', '大幅縮小', 'フルキャッシュ', 'フルキャッシュ', 'フルキャッシュ'],
];

const MATRIX_COLORS: string[][] = [
  ['green', 'green', 'yellow', 'orange', 'red'],
  ['green', 'cyan', 'yellow', 'orange', 'red'],
  ['yellow', 'yellow', 'orange', 'orange', 'red'],
  ['orange', 'orange', 'red', 'red', 'red'],
  ['red', 'red', 'red', 'red', 'red'],
];

function stateToRow(code: string): number {
  if (code === 'HEALTHY' || code === 'FINANCIAL_RALLY') return 0;
  if (code === 'NEUTRAL' || code === 'MARKET_OVERSHOOT') return 1;
  if (code === 'POLICY_TIGHTENING') return 2;
  if (code === 'CREDIT_CONTRACTION' || code === 'SPLIT_BUBBLE') return 3;
  if (code === 'LIQUIDITY_SHOCK') return 4;
  return 1;
}

function phaseToCol(code: string): number {
  if (code === 'EXPANSION') return 0;
  if (code === 'SLOWDOWN') return 1;
  if (code === 'CAUTION') return 2;
  if (code === 'CONTRACTION') return 3;
  if (code === 'CRISIS') return 4;
  return 1;
}

// ── Dynamic Insight Cards ──

interface InsightCard {
  title: string;
  description: string;
  color: string;
}

function getInsightCards(
  plumbing: PlumbingSummary | undefined,
  economic: EmploymentRiskScore | undefined,
  policy: PolicyRegimeData | undefined,
  events: MarketEventsData | undefined,
): InsightCard[] {
  const cards: InsightCard[] = [];

  if (policy) {
    if (policy.regime === 'QT_MODE') {
      cards.push({ title: '量的引き締め中（QT）', description: 'FRBが資産を縮小中。流動性が緩やかに低下しています。', color: 'orange' });
    } else if (policy.regime === 'QE_MODE') {
      cards.push({ title: '量的緩和中（QE）', description: 'FRBが市場に資金を供給中。流動性は潤沢です。', color: 'green' });
    } else if (policy.regime === 'PIVOT_WATCH') {
      cards.push({ title: '政策転換の兆候', description: 'FRBの方針変更が示唆されています。注視が必要です。', color: 'cyan' });
    }
  }

  const l1 = plumbing?.layers?.layer1?.stress_score;
  if (l1 != null) {
    if (l1 >= 60) {
      cards.push({ title: '政策流動性の縮小', description: `L1ストレス ${fmt(l1)} — FRBの資金供給が縮小しています。`, color: 'orange' });
    } else if (l1 <= 30) {
      cards.push({ title: '政策流動性は潤沢', description: `L1ストレス ${fmt(l1)} — 市場への資金供給は十分です。`, color: 'green' });
    }
  }

  const l2a = plumbing?.layers?.layer2a?.stress_score;
  if (l2a != null && l2a >= 65) {
    cards.push({ title: '銀行システムにストレス', description: `L2Aストレス ${fmt(l2a)} — 銀行セクターに警戒が必要です。`, color: 'red' });
  }

  const l2b = plumbing?.layers?.layer2b?.stress_score;
  if (l2b != null && l2b >= 70) {
    cards.push({ title: '市場レバレッジが高水準', description: `L2Bストレス ${fmt(l2b)} — 投資家の信用取引が危険水準です。`, color: 'red' });
  }

  if (economic && economic.total_score >= 60) {
    cards.push({ title: '景気悪化の兆候', description: `景気スコア ${fmt(economic.total_score)}/100 — 雇用・消費の複数指標が悪化しています。`, color: 'orange' });
  }

  if (economic?.sahm_rule?.triggered) {
    cards.push({ title: 'サームルール発動', description: '失業率が急上昇。過去のリセッションではこのシグナルが100%的中しています。', color: 'red' });
  }

  if (events && events.events.some(e => e.severity === 'CRITICAL')) {
    const criticals = events.events.filter(e => e.severity === 'CRITICAL');
    cards.push({
      title: '重大イベント検出中',
      description: criticals.map(e => e.event_label).join('、') + ' — 短期的な市場混乱に警戒してください。',
      color: 'red',
    });
  }

  return cards;
}

// ============================================================
// Loading state
// ============================================================

export function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}

// ============================================================
// Today's Verdict Banner
// ============================================================

/**
 * Today's Verdict Banner — 初見ユーザーが 5 秒で「今どうすべきか」を理解できるトップバナー.
 * - 巨大なアクション (マトリクス由来) + 平易な日本語の理由
 * - Lucide アイコン (ShieldCheck/ShieldAlert/AlertTriangle/AlertOctagon/OctagonAlert) で重要度を視覚化
 * - デジタル庁 signal-* トークンで配色 (緑/青/黄/橙/赤 の 5 段階)
 * - 最終更新タイムスタンプ表示
 */
function TodaysVerdictBanner({ stateCode, phaseCode }: {
  stateCode: string; phaseCode: string;
}) {
  const insight = getIntegratedInsight(stateCode, phaseCode);
  const row = stateToRow(stateCode);
  const col = phaseToCol(phaseCode);
  const matrixColor = MATRIX_COLORS[row][col];

  // 5 段階 severity (matrix の 5 色をそのまま 1:1 マッピング)
  type Severity = 'safe' | 'safe-mid' | 'caution-mild' | 'caution' | 'danger';
  const severity: Severity =
    matrixColor === 'green' ? 'safe'
    : matrixColor === 'cyan' ? 'safe-mid'
    : matrixColor === 'yellow' ? 'caution-mild'
    : matrixColor === 'orange' ? 'caution'
    : 'danger';

  const SeverityIcon =
    severity === 'safe' ? ShieldCheck
    : severity === 'safe-mid' ? ShieldAlert
    : severity === 'caution-mild' ? AlertTriangle
    : severity === 'caution' ? AlertOctagon
    : OctagonAlert;

  const tones: Record<Severity, { bg: string; border: string; iconBg: string; text: string }> = {
    'safe':         { bg: 'bg-signal-safe-100',    border: 'border-signal-safe-300',    iconBg: 'bg-signal-safe-900',    text: 'text-signal-safe-900' },
    'safe-mid':     { bg: 'bg-brand-100',          border: 'border-brand-200',          iconBg: 'bg-brand-700',          text: 'text-brand-900' },
    'caution-mild': { bg: 'bg-[#FFF8E0]',          border: 'border-[#FFE07A]',          iconBg: 'bg-[#B8860B]',          text: 'text-[#7A5500]' },
    'caution':      { bg: 'bg-signal-caution-100', border: 'border-signal-caution-300', iconBg: 'bg-signal-caution-900', text: 'text-signal-caution-900' },
    'danger':       { bg: 'bg-signal-danger-100',  border: 'border-signal-danger-300',  iconBg: 'bg-signal-danger-900',  text: 'text-signal-danger-900' },
  };
  const tone = tones[severity];

  return (
    <section
      className={`relative rounded-2xl border ${tone.border} ${tone.bg} overflow-hidden plumb-animate-scale`}
      aria-label="Today's verdict — 今日の投資判断"
    >
      <div className="p-6 md:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center gap-6">
          <div className={`shrink-0 w-16 h-16 md:w-20 md:h-20 rounded-2xl ${tone.iconBg} flex items-center justify-center self-start lg:self-center`}>
            <SeverityIcon className="w-8 h-8 md:w-10 md:h-10 text-white" strokeWidth={2.5} aria-hidden="true" />
          </div>

          <div className="flex-1 space-y-2 min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground font-mono">
              INTEGRATED ANALYSIS
            </p>
            <h2 className={`text-2xl md:text-3xl font-bold tracking-tight ${tone.text}`}>
              {insight.main}
            </h2>
            <p className="text-sm md:text-base text-muted-foreground max-w-3xl leading-relaxed">
              {insight.sub}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// Sub-components
// ============================================================

function PlumbingCard({ plumbing, events }: { plumbing: PlumbingSummary; events: MarketEventsData | undefined }) {
  const state = plumbing.market_state;
  const sc = state ? colorClasses(state.color) : colorClasses('gray');
  const l1 = plumbing.layers?.layer1?.stress_score ?? 0;
  const l2a = plumbing.layers?.layer2a?.stress_score ?? 0;
  const l2b = plumbing.layers?.layer2b?.stress_score ?? 0;

  return (
    <GlassCard stagger={1} className="relative before:absolute before:top-0 before:left-0 before:w-1 before:h-full before:rounded-l-xl before:bg-gradient-to-b before:from-blue-500/30 before:to-transparent">
      <div className="p-5 pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400 font-mono">PLUMBING SYSTEM</p>
            <h3 className="text-lg font-bold">米国金融流動性モニター</h3>
            <p className="text-sm text-muted-foreground">金融市場の流動性の健全性を監視</p>
          </div>
          {state && (
            <Badge variant="outline" className={`${sc.text} ${sc.border} text-xs font-mono`}>
              {state.label}
            </Badge>
          )}
        </div>
      </div>

      <div className="px-5 pb-3">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'L1 政策', score: l1, color: 'text-blue-600' },
            { label: 'L2A 銀行', score: l2a, color: 'text-muted-foreground' },
            { label: 'L2B 市場', score: l2b, color: 'text-muted-foreground' },
          ].map((layer) => (
            <div key={layer.label} className="text-center space-y-1.5">
              <ScoreRing score={Math.round(layer.score)} size={56} strokeWidth={4} />
              <p className={`text-xs font-bold uppercase tracking-wider ${layer.color}`}>{layer.label}</p>
              <GaugeBar score={layer.score} />
            </div>
          ))}
        </div>
      </div>

      {events && events.events.length > 0 && (
        <div className="px-5 pb-3 border-t border-border/50 pt-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">検出イベント</p>
          <div className="space-y-1.5">
            {events.events.slice(0, 3).map((ev, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${ev.severity === 'CRITICAL' ? 'bg-red-400 animate-pulse' : ev.severity === 'ALERT' ? 'bg-amber-400' : 'bg-yellow-400'}`} />
                <span className="text-sm text-muted-foreground">{ev.event_label}</span>
                <Badge variant="outline" className="text-xs ml-auto">{ev.severity}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-5 pb-4 pt-2">
        <Link href="/liquidity" className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">
          詳細を見る →
        </Link>
      </div>
    </GlassCard>
  );
}

function EconomicCard({ economic }: { economic: EmploymentRiskScore }) {
  const { phase, categories, total_score, alert_factors } = economic;
  const pc = colorClasses(phase.color);

  return (
    <GlassCard stagger={2} className="relative before:absolute before:top-0 before:left-0 before:w-1 before:h-full before:rounded-l-xl before:bg-gradient-to-b before:from-blue-500/30 before:to-transparent">
      <div className="p-5 pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600 font-mono">ECONOMIC ALERT</p>
            <h3 className="text-lg font-bold">米国景気リスク評価モニター</h3>
            <p className="text-sm text-muted-foreground">雇用・消費者・構造の3軸で景気を評価</p>
          </div>
          <Badge variant="outline" className={`${pc.text} ${pc.border} text-xs font-mono`}>
            {phase.label}
          </Badge>
        </div>
      </div>

      <div className="px-5 pb-3">
        <div className="flex items-center justify-center gap-6">
          <div className="text-center space-y-1">
            <ScoreRing score={total_score} size={72} strokeWidth={5} />
            <p className="text-xs font-bold text-muted-foreground font-mono">総合</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {categories.map((cat) => {
              const pct = Math.round((cat.score / cat.max_score) * 100);
              const catColor = cat.name === '雇用' ? 'text-blue-600'
                : 'text-muted-foreground';
              return (
                <div key={cat.name} className="text-center space-y-1">
                  <ScoreRing score={pct} size={48} strokeWidth={3} />
                  <p className={`text-xs font-bold uppercase tracking-wider ${catColor}`}>{cat.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{cat.score}/{cat.max_score}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {alert_factors.length > 0 && (
        <div className="px-5 pb-3 border-t border-border/50 pt-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">アラートファクター</p>
          <div className="space-y-1.5">
            {alert_factors.slice(0, 3).map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="text-sm text-muted-foreground">{f}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-5 pb-4 pt-2">
        <Link href="/employment" className="text-xs font-medium text-blue-600 hover:underline">
          詳細を見る →
        </Link>
      </div>
    </GlassCard>
  );
}

function StatePhaseMatrix({ currentRow, currentCol }: { currentRow: number; currentCol: number }) {
  const cellBg = (color: string): string => {
    // 5 段階の matrix 色を デジタル庁 signal-* トークンへマッピング
    const m: Record<string, string> = {
      green:  'bg-signal-safe-100 text-signal-safe-900',
      cyan:   'bg-brand-100 text-brand-900',
      yellow: 'bg-[#FFF8E0] text-[#7A5500]',
      orange: 'bg-signal-caution-100 text-signal-caution-900',
      red:    'bg-signal-danger-100 text-signal-danger-900',
    };
    return m[color] || '';
  };

  return (
    <GlassCard stagger={3}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground font-mono">STATE × PHASE MATRIX</p>
            <h3 className="text-lg font-bold mt-1">投資判断マトリクス</h3>
          </div>
          <ScoreLegend />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="text-left py-2 px-2 text-muted-foreground font-mono text-xs w-28">流動性 State ↓</th>
                {PHASE_LABELS.map((p, i) => (
                  <th key={i} className={`text-center py-2 px-1 font-mono text-xs ${i === currentCol ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-muted-foreground'}`}>
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STATE_LABELS.map((s, row) => (
                <tr key={row}>
                  <td className={`py-2 px-2 font-mono text-xs ${row === currentRow ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-muted-foreground'}`}>
                    {s}
                  </td>
                  {MATRIX_DATA[row].map((advice, col) => {
                    const isActive = row === currentRow && col === currentCol;
                    return (
                      <td key={col} className="py-1.5 px-1">
                        <div className={`rounded-lg px-2 py-2 text-center text-xs font-medium transition-all ${cellBg(MATRIX_COLORS[row][col])} ${isActive ? 'ring-2 ring-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.3)] scale-105' : ''}`}>
                          {advice}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground mt-3 text-center">
          青枠 = 現在のポジション｜行 = 金融流動性の状態｜列 = 景気フェーズ
        </p>
      </div>
    </GlassCard>
  );
}

function InsightCardsSection({ cards }: { cards: InsightCard[] }) {
  if (cards.length === 0) return null;

  return (
    <div className="space-y-2 plumb-animate-in plumb-stagger-4">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground font-mono px-1">INSIGHTS</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((card, i) => {
          const cc = colorClasses(card.color);
          return (
            <GlassCard key={i}>
              <div className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${cc.dot}`} />
                  <h4 className={`text-sm font-bold ${cc.text}`}>{card.title}</h4>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{card.description}</p>
              </div>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}

const NAV_ICONS: Record<string, React.ReactNode> = {
  liquidity: <Droplets className="w-4 h-4" />,
  employment: <ShieldAlert className="w-4 h-4" />,
  signals: <BarChart3 className="w-4 h-4" />,
  holdings: <Briefcase className="w-4 h-4" />,
};

function NavigationCards() {
  const pages = [
    { href: '/liquidity', key: 'liquidity', title: '米国金融流動性モニター', sub: 'FRB・銀行・市場レバレッジの3層ストレスを分析', color: 'blue' },
    { href: '/employment', key: 'employment', title: '米国景気リスク評価モニター', sub: '雇用・消費者・構造の3軸で景気リスクを評価', color: 'green' },
    { href: '/signals', key: 'signals', title: '銘柄分析', sub: 'エントリー判定・Exit分析・シグナル履歴', color: 'neutral' },
    { href: '/holdings', key: 'holdings', title: 'ポートフォリオ', sub: '保有管理・取引記録・統計', color: 'neutral' },
  ];

  const colorMap: Record<string, { text: string; bg: string }> = {
    blue:    { text: 'text-blue-600',     bg: 'bg-blue-500/10' },
    green:   { text: 'text-blue-600',     bg: 'bg-blue-500/10' },
    neutral: { text: 'text-foreground',   bg: 'bg-neutral-100' },
  };

  return (
    <div className="space-y-2 plumb-animate-in plumb-stagger-5">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground font-mono px-1">NAVIGATION</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {pages.map((p) => {
          const c = colorMap[p.color] || colorMap.blue;
          return (
            <Link key={p.href} href={p.href}>
              <GlassCard className="cursor-pointer group">
                <div className="p-4 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center ${c.bg} ${c.text}`}>
                      {NAV_ICONS[p.key]}
                    </div>
                    <h4 className={`text-sm font-bold group-hover:underline ${c.text}`}>{p.title}</h4>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{p.sub}</p>
                </div>
              </GlassCard>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// DashboardTab — main export
// ============================================================

export function DashboardTab({ plumbing, economic, events, policy }: {
  plumbing: PlumbingSummary; economic: EmploymentRiskScore;
  events: MarketEventsData | undefined; policy: PolicyRegimeData | undefined;
}) {
  const stateCode = plumbing.market_state?.code || 'NEUTRAL';
  const phaseCode = economic.phase.code;

  const currentRow = stateToRow(stateCode);
  const currentCol = phaseToCol(phaseCode);

  const insightCards = getInsightCards(plumbing, economic, policy, events);

  return (
    <div className="space-y-5">
      {/* Section 1: Today's Verdict — 初見が 5 秒で「今どうすべきか」を理解 */}
      <TodaysVerdictBanner
        stateCode={stateCode}
        phaseCode={phaseCode}
      />

      {/* Section 2: Dual System Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PlumbingCard plumbing={plumbing} events={events} />
        <EconomicCard economic={economic} />
      </div>

      {/* Section 3: State × Phase Matrix */}
      <StatePhaseMatrix currentRow={currentRow} currentCol={currentCol} />

      {/* Section 4: Dynamic Insight Cards */}
      <InsightCardsSection cards={insightCards} />

      {/* Section 5: Navigation Cards */}
      <NavigationCards />
    </div>
  );
}
