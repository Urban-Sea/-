'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LayoutDashboard, BookOpen, Droplets, ShieldAlert, BarChart3, Briefcase } from 'lucide-react';
import {
  usePlumbingSummary,
  useEmploymentRiskScore,
  useMarketEvents,
  usePolicyRegime,
  useRegime,
} from '@/lib/api';
import { AuthGuard } from '@/components/providers/AuthGuard';
import {
  GlassCard, ScoreRing, GaugeBar, StatusChip, ScoreLegend, DocSection, DocTable,
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

/** Map plumbing state code to display info */
function stateInfo(code: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    HEALTHY: { label: '健全相場', color: 'green' },
    FINANCIAL_RALLY: { label: '健全相場', color: 'green' },
    NEUTRAL: { label: '中立', color: 'cyan' },
    MARKET_OVERSHOOT: { label: '中立', color: 'cyan' },
    POLICY_TIGHTENING: { label: '政策引き締め', color: 'yellow' },
    SPLIT_BUBBLE: { label: '信用収縮', color: 'orange' },
    CREDIT_CONTRACTION: { label: '信用収縮', color: 'orange' },
    LIQUIDITY_SHOCK: { label: '流動性ショック', color: 'red' },
  };
  return map[code] || { label: code, color: 'gray' };
}

/** Map economic phase code to display info */
function phaseInfo(code: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    EXPANSION: { label: '拡大期', color: 'green' },
    SLOWDOWN: { label: '減速期', color: 'yellow' },
    CAUTION: { label: '警戒期', color: 'orange' },
    CONTRACTION: { label: '収縮期', color: 'red' },
    CRISIS: { label: '危機', color: 'red' },
  };
  return map[code] || { label: code, color: 'gray' };
}

function colorClasses(color: string) {
  const map: Record<string, { text: string; bg: string; border: string; dot: string }> = {
    green: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/8', border: 'border-emerald-500/20', dot: 'bg-emerald-400' },
    cyan: { text: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-500/8', border: 'border-cyan-500/20', dot: 'bg-cyan-400' },
    yellow: { text: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/8', border: 'border-yellow-500/20', dot: 'bg-yellow-400' },
    orange: { text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/8', border: 'border-orange-500/20', dot: 'bg-orange-400' },
    red: { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/8', border: 'border-red-500/20', dot: 'bg-red-400 animate-pulse' },
    gray: { text: 'text-zinc-600 dark:text-zinc-400', bg: 'bg-zinc-500/8', border: 'border-zinc-500/20', dot: 'bg-zinc-400' },
  };
  return map[color] || map.gray;
}

const glowMap: Record<string, string> = {
  green: '#10b981', cyan: '#06b6d4', yellow: '#eab308', orange: '#f97316', red: '#ef4444',
};

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

  // Policy Regime
  if (policy) {
    if (policy.regime === 'QT_MODE') {
      cards.push({ title: '量的引き締め中（QT）', description: 'FRBが資産を縮小中。流動性が緩やかに低下しています。', color: 'orange' });
    } else if (policy.regime === 'QE_MODE') {
      cards.push({ title: '量的緩和中（QE）', description: 'FRBが市場に資金を供給中。流動性は潤沢です。', color: 'green' });
    } else if (policy.regime === 'PIVOT_WATCH') {
      cards.push({ title: '政策転換の兆候', description: 'FRBの方針変更が示唆されています。注視が必要です。', color: 'cyan' });
    }
  }

  // Layer 1 - Policy Liquidity
  const l1 = plumbing?.layers?.layer1?.stress_score;
  if (l1 != null) {
    if (l1 >= 60) {
      cards.push({ title: '政策流動性の縮小', description: `L1ストレス ${fmt(l1)} — FRBの資金供給が縮小しています。`, color: 'orange' });
    } else if (l1 <= 30) {
      cards.push({ title: '政策流動性は潤沢', description: `L1ストレス ${fmt(l1)} — 市場への資金供給は十分です。`, color: 'green' });
    }
  }

  // Layer 2A - Banking
  const l2a = plumbing?.layers?.layer2a?.stress_score;
  if (l2a != null && l2a >= 65) {
    cards.push({ title: '銀行システムにストレス', description: `L2Aストレス ${fmt(l2a)} — 銀行セクターに警戒が必要です。`, color: 'red' });
  }

  // Layer 2B - Market Leverage
  const l2b = plumbing?.layers?.layer2b?.stress_score;
  if (l2b != null && l2b >= 70) {
    cards.push({ title: '市場レバレッジが高水準', description: `L2Bストレス ${fmt(l2b)} — 投資家の信用取引が危険水準です。`, color: 'red' });
  }

  // Macro Score
  if (economic && economic.total_score >= 60) {
    cards.push({ title: '景気悪化の兆候', description: `景気スコア ${fmt(economic.total_score)}/100 — 雇用・消費の複数指標が悪化しています。`, color: 'orange' });
  }

  // Sahm Rule
  if (economic?.sahm_rule?.triggered) {
    cards.push({ title: 'サームルール発動', description: '失業率が急上昇。過去のリセッションではこのシグナルが100%的中しています。', color: 'red' });
  }

  // Critical Events
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

function LoadingSkeleton() {
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
// TAB 1: Dashboard sections
// ============================================================

/** Hero — Integrated insight based on State × Phase */
function IntegratedHero({ stateCode, phaseCode, stateLabel: stLabel, phaseLabel: phLabel, stateColor, phaseColor }: {
  stateCode: string; phaseCode: string;
  stateLabel: string; phaseLabel: string;
  stateColor: string; phaseColor: string;
}) {
  const insight = getIntegratedInsight(stateCode, phaseCode);
  const c = colorClasses(insight.color);

  return (
    <div className={`relative rounded-2xl border ${c.border} overflow-hidden plumb-animate-scale`}>
      <div className={`absolute inset-0 ${c.bg}`} />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] rounded-full blur-[100px] opacity-20 plumb-glow"
        style={{ background: glowMap[insight.color] || '#71717a' }} />
      <div className="relative p-6 md:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          {/* Left: Insight text */}
          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground font-mono">INTEGRATED ANALYSIS</p>
            <h2 className={`text-2xl md:text-3xl font-bold tracking-tight ${c.text}`}>{insight.main}</h2>
            <p className="text-sm text-muted-foreground max-w-lg leading-relaxed">{insight.sub}</p>
          </div>
          {/* Right: Dual badges */}
          <div className="flex flex-col gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-muted-foreground uppercase w-8">流動性</span>
              <Badge variant="outline" className={`${colorClasses(stateColor).text} ${colorClasses(stateColor).border} text-xs font-mono`}>
                {stLabel}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-muted-foreground uppercase w-8">景気</span>
              <Badge variant="outline" className={`${colorClasses(phaseColor).text} ${colorClasses(phaseColor).border} text-xs font-mono`}>
                {phLabel}
              </Badge>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Plumbing System Card (left) */
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
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400 font-mono">PLUMBING SYSTEM</p>
            <h3 className="text-base font-bold">米国金融流動性モニター</h3>
            <p className="text-xs text-muted-foreground">金融市場の流動性の健全性を監視</p>
          </div>
          {state && (
            <Badge variant="outline" className={`${sc.text} ${sc.border} text-xs font-mono`}>
              {state.label}
            </Badge>
          )}
        </div>
      </div>

      {/* 3-Ring scores */}
      <div className="px-5 pb-3">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'L1 政策', score: l1, color: 'text-blue-600 dark:text-blue-400' },
            { label: 'L2A 銀行', score: l2a, color: 'text-purple-600 dark:text-purple-400' },
            { label: 'L2B 市場', score: l2b, color: 'text-cyan-600 dark:text-cyan-400' },
          ].map((layer) => (
            <div key={layer.label} className="text-center space-y-1.5">
              <ScoreRing score={Math.round(layer.score)} size={56} strokeWidth={4} />
              <p className={`text-[10px] font-bold uppercase tracking-wider ${layer.color}`}>{layer.label}</p>
              <GaugeBar score={layer.score} />
            </div>
          ))}
        </div>
      </div>

      {/* Events */}
      {events && events.events.length > 0 && (
        <div className="px-5 pb-3 border-t border-border/50 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">検出イベント</p>
          <div className="space-y-1.5">
            {events.events.slice(0, 3).map((ev, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${ev.severity === 'CRITICAL' ? 'bg-red-400 animate-pulse' : ev.severity === 'ALERT' ? 'bg-amber-400' : 'bg-yellow-400'}`} />
                <span className="text-xs text-muted-foreground">{ev.event_label}</span>
                <Badge variant="outline" className="text-[9px] ml-auto">{ev.severity}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Link to detail page */}
      <div className="px-5 pb-4 pt-2">
        <Link href="/liquidity" className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">
          詳細を見る →
        </Link>
      </div>
    </GlassCard>
  );
}

/** Economic Warning System Card (right) */
function EconomicCard({ economic }: { economic: EmploymentRiskScore }) {
  const { phase, categories, total_score, alert_factors } = economic;
  const pc = colorClasses(phase.color);

  return (
    <GlassCard stagger={2} className="relative before:absolute before:top-0 before:left-0 before:w-1 before:h-full before:rounded-l-xl before:bg-gradient-to-b before:from-emerald-500/30 before:to-transparent">
      <div className="p-5 pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400 font-mono">ECONOMIC ALERT</p>
            <h3 className="text-base font-bold">米国景気リスク評価モニター</h3>
            <p className="text-xs text-muted-foreground">雇用・消費者・構造の3軸で景気を評価</p>
          </div>
          <Badge variant="outline" className={`${pc.text} ${pc.border} text-xs font-mono`}>
            {phase.label}
          </Badge>
        </div>
      </div>

      {/* Total score ring + category rings */}
      <div className="px-5 pb-3">
        <div className="flex items-center justify-center gap-6">
          <div className="text-center space-y-1">
            <ScoreRing score={total_score} size={72} strokeWidth={5} />
            <p className="text-[10px] font-bold text-muted-foreground font-mono">総合</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {categories.map((cat) => {
              const pct = Math.round((cat.score / cat.max_score) * 100);
              const catColor = cat.name === '雇用' ? 'text-blue-600 dark:text-blue-400'
                : cat.name === '消費' ? 'text-amber-600 dark:text-amber-400'
                : 'text-purple-600 dark:text-purple-400';
              return (
                <div key={cat.name} className="text-center space-y-1">
                  <ScoreRing score={pct} size={48} strokeWidth={3} />
                  <p className={`text-[9px] font-bold uppercase tracking-wider ${catColor}`}>{cat.name}</p>
                  <p className="text-[9px] text-muted-foreground font-mono">{cat.score}/{cat.max_score}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Alert factors */}
      {alert_factors.length > 0 && (
        <div className="px-5 pb-3 border-t border-border/50 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">アラートファクター</p>
          <div className="space-y-1.5">
            {alert_factors.slice(0, 3).map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="text-xs text-muted-foreground">{f}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Link */}
      <div className="px-5 pb-4 pt-2">
        <Link href="/employment" className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline">
          詳細を見る →
        </Link>
      </div>
    </GlassCard>
  );
}

/** State × Phase Matrix */
function StatePhaseMatrix({ currentRow, currentCol }: { currentRow: number; currentCol: number }) {
  const cellBg = (color: string): string => {
    const m: Record<string, string> = {
      green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      cyan: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
      yellow: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
      orange: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
      red: 'bg-red-500/10 text-red-700 dark:text-red-300',
    };
    return m[color] || '';
  };

  return (
    <GlassCard stagger={3}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground font-mono">STATE × PHASE MATRIX</p>
            <h3 className="text-base font-bold mt-1">投資判断マトリクス</h3>
          </div>
          <ScoreLegend />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left py-2 px-2 text-muted-foreground font-mono text-[10px] w-28">流動性 State ↓</th>
                {PHASE_LABELS.map((p, i) => (
                  <th key={i} className={`text-center py-2 px-1 font-mono text-[10px] ${i === currentCol ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-muted-foreground'}`}>
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STATE_LABELS.map((s, row) => (
                <tr key={row}>
                  <td className={`py-2 px-2 font-mono text-[10px] ${row === currentRow ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-muted-foreground'}`}>
                    {s}
                  </td>
                  {MATRIX_DATA[row].map((advice, col) => {
                    const isActive = row === currentRow && col === currentCol;
                    return (
                      <td key={col} className="py-1.5 px-1">
                        <div className={`rounded-lg px-2 py-2 text-center text-[10px] font-medium transition-all ${cellBg(MATRIX_COLORS[row][col])} ${isActive ? 'ring-2 ring-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.3)] scale-105' : ''}`}>
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

        <p className="text-[10px] text-muted-foreground mt-3 text-center">
          青枠 = 現在のポジション｜行 = 金融流動性の状態｜列 = 景気フェーズ
        </p>
      </div>
    </GlassCard>
  );
}

/** Dynamic Insight Cards */
function InsightCardsSection({ cards }: { cards: InsightCard[] }) {
  if (cards.length === 0) return null;

  return (
    <div className="space-y-2 plumb-animate-in plumb-stagger-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground font-mono px-1">INSIGHTS</p>
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
                <p className="text-xs text-muted-foreground leading-relaxed">{card.description}</p>
              </div>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}

/** Navigation Cards — links to all other pages */
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
    { href: '/signals', key: 'signals', title: '銘柄分析', sub: 'エントリー判定・Exit分析・シグナル履歴', color: 'purple' },
    { href: '/holdings', key: 'holdings', title: 'ポートフォリオ', sub: '保有管理・取引記録・統計', color: 'amber' },
  ];

  const colorMap: Record<string, { text: string; bg: string }> = {
    blue: { text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10' },
    green: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
    purple: { text: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/10' },
    amber: { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
  };

  return (
    <div className="space-y-2 plumb-animate-in plumb-stagger-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground font-mono px-1">NAVIGATION</p>
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
                  <p className="text-xs text-muted-foreground leading-relaxed">{p.sub}</p>
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
// TAB 1: Full Dashboard
// ============================================================

function DashboardTab({ plumbing, economic, events, policy }: {
  plumbing: PlumbingSummary; economic: EmploymentRiskScore;
  events: MarketEventsData | undefined; policy: PolicyRegimeData | undefined;
}) {
  const stateCode = plumbing.market_state?.code || 'NEUTRAL';
  const phaseCode = economic.phase.code;
  const si = stateInfo(stateCode);
  const pi = phaseInfo(phaseCode);

  const currentRow = stateToRow(stateCode);
  const currentCol = phaseToCol(phaseCode);

  const insightCards = getInsightCards(plumbing, economic, policy, events);

  return (
    <div className="space-y-5">
      {/* Section 1: Hero */}
      <IntegratedHero
        stateCode={stateCode}
        phaseCode={phaseCode}
        stateLabel={si.label}
        phaseLabel={pi.label}
        stateColor={si.color}
        phaseColor={pi.color}
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


// ============================================================
// TAB 2: System Guide (beginner-friendly)
// ============================================================

function SystemGuideTab() {
  return (
    <div className="space-y-3">
      <DocSection title="このダッシュボードの使い方" defaultOpen>
        <p>このダッシュボードは、<strong>2つの独立したシステム</strong>を1画面で統合して表示しています。</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 my-3">
          <div className="plumb-glass rounded-lg p-3">
            <p className="text-xs font-bold text-blue-600 dark:text-blue-400 mb-1">米国金融流動性モニター</p>
            <p className="text-xs">金融市場の流動性（FRB資金、銀行、レバレッジ）が正常に機能しているかを監視します。短期的な市場の健全性を表します。</p>
          </div>
          <div className="plumb-glass rounded-lg p-3">
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-1">米国景気リスク評価モニター</p>
            <p className="text-xs">雇用・消費者・経済構造の3つの軸から、実体経済の健全性を評価します。中長期的な景気動向を表します。</p>
          </div>
        </div>
        <p><strong>色の意味：</strong></p>
        <div className="flex flex-wrap gap-3 my-2">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500" /> <span className="text-xs">安全 — 通常投資OK</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-yellow-500" /> <span className="text-xs">注意 — 慎重に</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-orange-500" /> <span className="text-xs">警戒 — 守り重視</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500" /> <span className="text-xs">危険 — リスク縮小</span></span>
        </div>
        <p><strong>マトリクスの読み方：</strong>行（流動性の状態）と列（景気のフェーズ）の交差点が、現在の投資環境を示します。青い枠が「今ここ」の位置です。</p>
      </DocSection>

      <DocSection title="米国金融流動性モニターとは">
        <p>金融市場でお金がスムーズに流れているかどうかを3つのレイヤーで監視しています。</p>
        <DocTable
          headers={['レイヤー', '何を見ているか', 'スコアの意味']}
          rows={[
            ['L1 政策流動性', 'FRBのバランスシート（SOMA、準備預金、RRP、TGA）', 'FRBが市場にどれだけ資金を供給しているか'],
            ['L2A 銀行システム', '銀行の準備預金、KRE（地銀ETF）、SRF利用、IG格付け', '銀行セクターの健全性'],
            ['L2B 市場流動性', 'マージンデット（信用取引残高）の2年変化率', '投資家のレバレッジ水準'],
          ]}
        />
        <p className="mt-2"><strong>流動性の状態（State）：</strong></p>
        <DocTable
          headers={['状態', '意味', '投資への影響']}
          rows={[
            ['健全相場 (HEALTHY)', '全レイヤーが正常', '積極的な投資が可能'],
            ['中立 (NEUTRAL)', '特に問題なし', '通常通りの投資'],
            ['政策引き締め (TIGHTENING)', 'FRBが金融を引き締め中', '選別投資、新規は控えめに'],
            ['信用収縮 (CONTRACTION)', '銀行・信用市場にストレス', '防御的なポジションへ'],
            ['流動性ショック (SHOCK)', '深刻な流動性危機', 'キャッシュ確保を最優先'],
          ]}
        />
      </DocSection>

      <DocSection title="米国景気リスク評価モニターとは">
        <p>実体経済の健全性を<strong>100点満点</strong>で評価するシステムです。スコアが高いほど景気悪化のリスクが高いことを意味します。</p>
        <DocTable
          headers={['カテゴリ', '配点', '主な指標']}
          rows={[
            ['雇用', '50点', '非農業部門雇用者数(NFP)、失業率、新規失業保険申請、JOLTS'],
            ['消費者', '25点', '実質個人所得、消費者信頼感、クレジットカード延滞率'],
            ['構造', '25点', '失業率トレンド、サームルール、長期失業率'],
          ]}
        />
        <p className="mt-2"><strong>景気フェーズ：</strong></p>
        <DocTable
          headers={['フェーズ', 'スコア', '意味']}
          rows={[
            ['拡大期 (EXPANSION)', '0 〜 20', '景気は好調、通常投資OK'],
            ['減速期 (SLOWDOWN)', '21 〜 40', '成長鈍化の兆候、慎重に'],
            ['警戒期 (CAUTION)', '41 〜 60', '複数指標が悪化、守り重視'],
            ['収縮期 (CONTRACTION)', '61 〜 80', '明確な景気後退、リスク縮小'],
            ['危機 (CRISIS)', '81 〜 100', '深刻な景気後退、キャッシュ最優先'],
          ]}
        />
        <p className="mt-2"><strong>サームルールとは：</strong>失業率の3ヶ月移動平均が、過去12ヶ月の最低値から0.5%以上上昇すると「発動」します。過去のリセッションで100%的中しているため、非常に重要な指標です。</p>
      </DocSection>

      <DocSection title="マトリクスの読み方">
        <p>投資判断マトリクスは、<strong>流動性State（行）</strong>と<strong>景気Phase（列）</strong>の掛け合わせで、推奨される投資姿勢を示します。</p>
        <div className="plumb-glass rounded-lg p-3 my-3 space-y-2">
          <p className="text-xs"><strong>行（縦軸）= 金融市場の状態</strong> — 短期的な流動性の健全さ。FRBの動き、銀行の健全性、レバレッジの水準を反映します。</p>
          <p className="text-xs"><strong>列（横軸）= 実体経済の状態</strong> — 中長期的な景気動向。雇用、消費、経済構造の健全性を反映します。</p>
        </div>
        <p><strong>読み方の例：</strong></p>
        <DocTable
          headers={['位置', '意味', '推奨アクション']}
          rows={[
            ['左上（健全相場 × 拡大期）', '金融も景気も良好', '積極投資OK — フルポジションで構いません'],
            ['中央（中立 × 警戒期）', '金融は問題ないが景気に陰り', '新規控え — 既存ポジションは維持、新規は慎重に'],
            ['右下（流動性ショック × 危機）', '金融も景気も深刻', 'フルキャッシュ — 全てのリスク資産を縮小'],
          ]}
        />
      </DocSection>

      <DocSection title="過去の危機とシステムの反応">
        <p>このシステムが過去の大きなイベントでどう反応したかを見てみましょう。</p>
        <div className="space-y-3 my-3">
          {[
            { year: '2008年9月', event: 'リーマン・ショック', state: '流動性ショック', phase: '危機',
              detail: '全レイヤーが危険水準を突破。景気スコアも80超に。マトリクスは「フルキャッシュ」を示していました。' },
            { year: '2020年3月', event: 'コロナ・ショック', state: '流動性ショック', phase: '警戒期→危機',
              detail: '突然の流動性枯渇により金融流動性が一気に悪化。ただしFRBの迅速な緩和により早期に回復しました。' },
            { year: '2022年', event: 'FRB利上げサイクル', state: '政策引き締め', phase: '注意期',
              detail: 'L1が徐々に上昇（FRBがQTを実施）。景気スコアは40前後で推移。マトリクスは「選別投資〜新規控え」を示していました。' },
            { year: '2023年3月', event: 'SVB破綻', state: '信用収縮', phase: '注意期',
              detail: '銀行セクター（L2A）が急上昇。ただし景気全体は大きく悪化せず、一時的なストレスでした。' },
          ].map((crisis) => (
            <div key={crisis.year} className="plumb-glass rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <StatusChip label={crisis.state} color={crisis.state.includes('ショック') ? 'red' : crisis.state.includes('収縮') ? 'orange' : 'yellow'} />
                <StatusChip label={crisis.phase} color={crisis.phase.includes('危機') ? 'red' : crisis.phase.includes('警戒') ? 'orange' : 'amber'} />
              </div>
              <p className="text-xs font-bold mt-2">{crisis.year} — {crisis.event}</p>
              <p className="text-xs text-muted-foreground mt-1">{crisis.detail}</p>
            </div>
          ))}
        </div>
        <p className="text-xs mt-2"><strong>学び：</strong>流動性の悪化は急激（日〜週単位）、景気の悪化は緩やか（月〜四半期単位）。両方が同時に悪化した場合が最も危険です。</p>
      </DocSection>

      <DocSection title="注意事項">
        <div className="space-y-2">
          <div className="plumb-glass rounded-lg p-3">
            <p className="text-xs font-bold text-amber-600 dark:text-amber-400 mb-1">遅行性について</p>
            <p className="text-xs">多くの経済指標は遅行指標です。雇用統計は1ヶ月遅れ、GDP確報値は3ヶ月遅れで発表されます。このシステムは「早期警戒」を目指していますが、完全なリアルタイムではありません。</p>
          </div>
          <div className="plumb-glass rounded-lg p-3">
            <p className="text-xs font-bold text-amber-600 dark:text-amber-400 mb-1">投資助言ではありません</p>
            <p className="text-xs">このシステムは情報提供を目的としています。投資判断はご自身の責任で行ってください。マトリクスの推奨は一般的なガイダンスであり、個別の投資状況を考慮していません。</p>
          </div>
          <div className="plumb-glass rounded-lg p-3">
            <p className="text-xs font-bold text-amber-600 dark:text-amber-400 mb-1">前例のないイベント</p>
            <p className="text-xs">過去のパターンに基づくシステムのため、全く新しいタイプの危機には対応できない可能性があります。常に複数の情報源を参照してください。</p>
          </div>
        </div>
      </DocSection>
    </div>
  );
}


// ============================================================
// Main Page
// ============================================================

export default function IntegratedDashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}

function DashboardContent() {
  const { data: plumbing, isLoading: loadP } = usePlumbingSummary();
  const { data: economic, isLoading: loadE } = useEmploymentRiskScore();
  const { data: events } = useMarketEvents();
  const { data: policy } = usePolicyRegime();
  // regime is used indirectly via plumbing.market_state
  useRegime();

  const isLoading = loadP || loadE;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="plumb-animate-in">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-blue-500 to-emerald-500" />
          <h1 className="text-2xl font-bold tracking-tight">統合分析ダッシュボード</h1>
        </div>
        <p className="text-xs text-muted-foreground pl-3.5">流動性・景気リスクの統合モニタリング</p>
      </div>

      <Tabs defaultValue="dashboard" className="plumb-tabs">
        <TabsList variant="line" className="plumb-glass rounded-lg px-1 py-0.5 w-full justify-start border-none">
          <TabsTrigger value="dashboard" className="text-[11px] font-mono uppercase tracking-wider"><LayoutDashboard className="w-3.5 h-3.5 mr-1.5" />ダッシュボード</TabsTrigger>
          <TabsTrigger value="guide" className="text-[11px] font-mono uppercase tracking-wider"><BookOpen className="w-3.5 h-3.5 mr-1.5" />システム解説</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          {isLoading || !plumbing || !economic ? (
            <LoadingSkeleton />
          ) : (
            <DashboardTab plumbing={plumbing} economic={economic} events={events} policy={policy} />
          )}
        </TabsContent>

        <TabsContent value="guide" className="mt-4">
          <SystemGuideTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
