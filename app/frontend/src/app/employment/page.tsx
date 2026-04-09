'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LayoutDashboard, History, LineChart, BookOpen } from 'lucide-react';
import { useEmploymentRiskScore, useRiskHistory } from '@/lib/api';
import { AuthGuard } from '@/components/providers/AuthGuard';
import {
  scoreHue, scoreLabel,
  GlassCard, ScoreRing, GaugeBar, StatusChip, ScoreLegend, DocSection, DocTable,
} from '@/components/shared/glass';
import EconChartCanvas from '@/components/charts/EconChartCanvas';
import type { ChartSeries, ChartReferenceLine, ChartBackgroundZone, ChartEventMarker } from '@/components/charts/EconChartCanvas';
import type { EmploymentRiskScore, RiskScoreCategory } from '@/types';

// ============================================================
// Digital Agency color tokens (正典: ~/Desktop/policy-dashboard-assets)
// ============================================================
const DA = {
  brand900: '#0017C1',
  brand700: '#0017C1',
  brand500: '#3460FB',
  brand400: '#7096F8',
  brand200: '#C5D7FB',
  brand100: '#E8F1FE',
  safe500: '#259D63',
  safe300: '#9BD4B5',
  safe100: '#E6F5EC',
  caution500: '#FB5B01',
  caution400: '#FF8D44',
  caution300: '#FFC199',
  caution100: '#FFEEE2',
  danger500: '#FE3939',
  danger300: '#FFBBBB',
  danger100: '#FDEEEE',
  neutral900: '#4D4D4D',
  neutral700: '#767676',
  neutral500: '#999999',
  neutral300: '#CCCCCC',
  neutral200: '#E6E6E6',
  neutral100: '#F2F2F2',
} as const;

// Compute latest value + delta vs first point of visible window
function lastAndDelta(arr: Array<Record<string, unknown>>, field: string): {
  last: number | null; delta: number | null; deltaPct: number | null;
} {
  if (!arr || arr.length === 0) return { last: null, delta: null, deltaPct: null };
  let last: number | null = null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i][field];
    if (typeof v === 'number' && Number.isFinite(v)) { last = v; break; }
  }
  let first: number | null = null;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i][field];
    if (typeof v === 'number' && Number.isFinite(v)) { first = v; break; }
  }
  if (last == null || first == null) return { last, delta: null, deltaPct: null };
  const delta = last - first;
  const deltaPct = first !== 0 ? (delta / Math.abs(first)) * 100 : null;
  return { last, delta, deltaPct };
}

// 5 phase definitions for risk score
const RISK_PHASES = [
  { code: 'EXPANSION',   label: '拡大期',   range: '0-20',   min: 0,  max: 20,  color: DA.safe500,    bg: DA.safe100,    border: DA.safe300 },
  { code: 'SLOWDOWN',    label: '減速期',   range: '21-40',  min: 20, max: 40,  color: DA.brand500,   bg: DA.brand100,   border: DA.brand200 },
  { code: 'CAUTION',     label: '警戒期',   range: '41-60',  min: 40, max: 60,  color: DA.caution400, bg: DA.caution100, border: DA.caution300 },
  { code: 'CONTRACTION', label: '収縮期',   range: '61-80',  min: 60, max: 80,  color: DA.caution500, bg: DA.caution100, border: DA.caution300 },
  { code: 'CRISIS',      label: '危機',     range: '81-100', min: 80, max: 100, color: DA.danger500,  bg: DA.danger100,  border: DA.danger300 },
] as const;

function phaseForScore(score: number) {
  for (const p of RISK_PHASES) {
    if (score >= p.min && score < p.max) return p;
  }
  return RISK_PHASES[RISK_PHASES.length - 1];
}

// ============================================================
// Helpers
// ============================================================

function fmt(v: number | null | undefined, d = 0): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtK(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${fmt(v)}K`;
}
function fmtPct(v: number | null | undefined, d = 1): string {
  if (v == null) return '—';
  return `${v.toFixed(d)}%`;
}

function phaseColors(color: string) {
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

function subScoreDot(status: string): string {
  if (status === 'danger') return 'bg-red-400 animate-pulse';
  if (status === 'warning') return 'bg-amber-400';
  return 'bg-emerald-400';
}

const glowMap: Record<string, string> = {
  green: '#10b981', cyan: '#06b6d4', yellow: '#eab308', orange: '#f97316', red: '#ef4444',
};


// ============================================================
// TAB 1: Dashboard
// ============================================================

function EconomicPhaseHero({ data }: { data: EmploymentRiskScore }) {
  const { phase, categories, sahm_rule } = data;
  const c = phaseColors(phase.color);
  const isDanger = phase.color === 'red' || phase.color === 'orange';

  return (
    <div className={`relative rounded-2xl border ${c.border} overflow-hidden plumb-animate-scale`}>
      <div className={`absolute inset-0 ${c.bg}`} />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] rounded-full blur-[100px] opacity-20 plumb-glow"
        style={{ background: glowMap[phase.color] || '#71717a' }} />
      <div className="relative p-6 md:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${c.dot} ring-4 ring-current/10`} />
              <h2 className={`text-3xl md:text-4xl font-bold tracking-tight ${c.text}`}>{phase.label}</h2>
              <Badge variant="outline" className={`${c.text} ${c.border} text-xs font-mono ml-2`}>
                {data.total_score}/100
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground max-w-lg leading-relaxed pl-6">{phase.description}</p>
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium ml-6 ${isDanger ? 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20' : 'bg-muted text-muted-foreground border border-border'}`}>
              {phase.action}
            </div>
            <div className="flex items-center gap-2 pl-6 mt-1">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-mono">ポジション上限</span>
              <span className={`text-sm font-bold font-mono ${c.text}`}>{phase.position_limit}%</span>
            </div>
          </div>
          <div className="flex items-center gap-6 lg:gap-8">
            <div className="text-center space-y-1">
              <ScoreRing score={data.total_score} size={88} strokeWidth={6} />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">総合</p>
              <p className="text-[10px] text-muted-foreground font-mono">{data.total_score}/100</p>
            </div>
            {categories?.map((cat) => {
              const pct = Math.round((cat.score / cat.max_score) * 100);
              const catColor = cat.name === '雇用' ? 'text-blue-600 dark:text-blue-400'
                : cat.name === '消費' ? 'text-amber-600 dark:text-amber-400'
                : 'text-purple-600 dark:text-purple-400';
              return (
                <div key={cat.name} className="text-center space-y-1">
                  <ScoreRing score={pct} size={72} strokeWidth={5} />
                  <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${catColor}`}>{cat.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">{cat.score}/{cat.max_score}</p>
                </div>
              );
            })}
          </div>
        </div>
        {sahm_rule?.triggered && (
          <div className="mt-5 rounded-lg bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-600 dark:text-red-300 leading-relaxed plumb-shimmer-bg">
            サームルール発動中: Sahm値 {sahm_rule.sahm_value?.toFixed(2)} ≥ 0.50 — 景気後退シグナル
            {sahm_rule.peak_out && ' (ピークアウト検知: 前月より改善)'}
            {sahm_rule.near_peak_out && !sahm_rule.peak_out && ' (ピークアウト接近: 改善の兆し)'}
          </div>
        )}
      </div>
    </div>
  );
}

function KeyMetricsBar({ data }: { data: EmploymentRiskScore }) {
  const { latest_nfp, latest_claims, sahm_rule } = data;
  const nfpChange = latest_nfp?.nfp_change;
  const u3 = latest_nfp?.u3_rate;
  const claims = latest_claims?.initial_claims;
  const sahm = sahm_rule?.sahm_value;

  const nfpColor = nfpChange == null ? '' : nfpChange < 0 ? 'text-red-600 dark:text-red-400' : nfpChange < 100 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';
  const u3Color = u3 == null ? '' : u3 > 5.0 ? 'text-red-600 dark:text-red-400' : u3 > 4.5 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';
  const claimsColor = claims == null ? '' : claims > 300000 ? 'text-red-600 dark:text-red-400' : claims > 250000 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';
  const sahmColor = sahm == null ? '' : sahm >= 0.5 ? 'text-red-600 dark:text-red-400' : sahm >= 0.3 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';

  const items = [
    { label: 'NFP変化', value: fmtK(nfpChange), color: nfpColor },
    { label: '失業率 U3', value: fmtPct(u3), color: u3Color },
    { label: '新規申請', value: claims != null ? fmt(claims) : '—', color: claimsColor },
    { label: 'Sahm値', value: sahm != null ? sahm.toFixed(2) : '—', color: sahmColor },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 plumb-animate-in plumb-stagger-2">
      {items.map((item) => (
        <div key={item.label} className="plumb-glass rounded-lg px-4 py-3.5 flex items-center justify-between plumb-glass-hover">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{item.label}</span>
          <span className={`text-lg font-bold tabular-nums font-mono ${item.color}`}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function CategoryCard({ category, number, color, stagger }: {
  category: RiskScoreCategory; number: string; color: string; stagger: number;
}) {
  const pct = Math.round((category.score / category.max_score) * 100);
  const h = scoreHue(pct);
  const colorMap: Record<string, { accent: string; gradient: string }> = {
    blue: { accent: 'text-blue-600 dark:text-blue-400', gradient: 'before:bg-gradient-to-b before:from-blue-500/30 before:to-transparent' },
    amber: { accent: 'text-amber-600 dark:text-amber-400', gradient: 'before:bg-gradient-to-b before:from-amber-500/30 before:to-transparent' },
    purple: { accent: 'text-purple-600 dark:text-purple-400', gradient: 'before:bg-gradient-to-b before:from-purple-500/30 before:to-transparent' },
  };
  const cm = colorMap[color] || colorMap.blue;

  return (
    <GlassCard stagger={stagger} className={`plumb-gradient-border ${cm.gradient}`}>
      <div className="p-5 pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-0.5">
            <p className={`text-[11px] font-bold uppercase tracking-[0.2em] ${cm.accent}`}>{number}</p>
            <h3 className="text-base font-bold text-foreground">{category.name}カテゴリ</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{category.score}/{category.max_score}点</p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <ScoreRing score={pct} size={56} strokeWidth={4} />
            <Badge variant="outline" className={`text-[10px] ${h.text} ${h.border} font-mono`}>{scoreLabel(pct)}</Badge>
          </div>
        </div>
        <GaugeBar score={pct} className="mt-3" />
      </div>
      <div className="px-5 pb-5 space-y-1">
        {category.components.map((comp) => (
          <div key={comp.name} className="flex items-center justify-between py-2 group">
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${subScoreDot(comp.status)}`} />
              <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{comp.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium tabular-nums font-mono text-foreground">{comp.score}/{comp.max_score}</span>
              <StatusChip label={comp.status === 'danger' ? '危険' : comp.status === 'warning' ? '注意' : '正常'}
                color={comp.status === 'danger' ? 'red' : comp.status === 'warning' ? 'amber' : 'green'} />
            </div>
          </div>
        ))}
        <div className="mt-3 space-y-1.5">
          {category.components.filter((c) => c.status !== 'normal').map((comp) => (
            <div key={comp.name} className={`rounded-lg p-2.5 text-xs ${comp.status === 'danger' ? 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/15' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/15'}`}>
              {comp.detail}
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

function SahmRulePanel({ sahm }: { sahm: EmploymentRiskScore['sahm_rule'] }) {
  const sahmPct = sahm.sahm_value != null ? Math.min((sahm.sahm_value / 1.0) * 100, 100) : 0;
  const thresholdPct = 50; // 0.5 out of 1.0 = 50%

  return (
    <GlassCard stagger={5}>
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${sahm.triggered ? 'bg-red-400 animate-pulse' : 'bg-emerald-400'}`} />
          <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-orange-600 dark:text-orange-400">
            サームルール インジケーター
          </h3>
          {sahm.triggered && (
            <Badge variant="outline" className="text-[10px] text-red-600 dark:text-red-400 border-red-500/20 font-mono ml-auto">発動中</Badge>
          )}
          {sahm.triggered && sahm.peak_out && (
            <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-mono">ピークアウト</Badge>
          )}
          {sahm.triggered && sahm.near_peak_out && !sahm.peak_out && (
            <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/20 font-mono">ピークアウト接近</Badge>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg bg-zinc-100/80 dark:bg-zinc-900/50 p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">現在U3</p>
            <p className="text-lg font-bold font-mono">{sahm.current_u3 != null ? `${sahm.current_u3}%` : '—'}</p>
          </div>
          <div className="rounded-lg bg-zinc-100/80 dark:bg-zinc-900/50 p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">U3 3M平均</p>
            <p className="text-lg font-bold font-mono">{sahm.u3_3m_avg != null ? `${sahm.u3_3m_avg}%` : '—'}</p>
          </div>
          <div className="rounded-lg bg-zinc-100/80 dark:bg-zinc-900/50 p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">12M低値 3M平均</p>
            <p className="text-lg font-bold font-mono">{sahm.u3_12m_low_3m_avg != null ? `${sahm.u3_12m_low_3m_avg}%` : '—'}</p>
          </div>
          <div className={`rounded-lg p-3 text-center ${sahm.triggered ? 'bg-red-500/10 border border-red-500/20' : 'bg-emerald-500/10 border border-emerald-500/20'}`}>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Sahm値</p>
            <p className={`text-xl font-bold font-mono ${sahm.triggered ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {sahm.sahm_value != null ? sahm.sahm_value.toFixed(2) : '—'}
            </p>
          </div>
        </div>

        {/* Gauge */}
        <div className="space-y-1.5">
          <div className="relative w-full h-3 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
            <div className={`absolute h-full rounded-full plumb-gauge-bar ${sahm.triggered ? 'bg-red-500' : sahmPct > 30 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${sahmPct}%` }} />
            {/* Threshold marker */}
            <div className="absolute top-0 h-full w-0.5 bg-red-500/70" style={{ left: `${thresholdPct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
            <span>0.00</span>
            <span className="text-red-500">0.50 (発動)</span>
            <span>1.00</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          サームルール: 失業率の3ヶ月移動平均が過去12ヶ月の最低値から0.5%以上上昇した場合、景気後退入りと判定。過去の景気後退を100%的中。
        </p>
      </div>
    </GlassCard>
  );
}

function DashboardTab({ data }: { data: EmploymentRiskScore }) {
  return (
    <div className="space-y-4">
      <EconomicPhaseHero data={data} />
      <KeyMetricsBar data={data} />
      {data.categories?.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <CategoryCard category={data.categories[0]} number="CAT 1" color="blue" stagger={3} />
          {data.categories[1] && <CategoryCard category={data.categories[1]} number="CAT 2" color="amber" stagger={4} />}
          {data.categories[2] && <CategoryCard category={data.categories[2]} number="CAT 3" color="purple" stagger={5} />}
        </div>
      )}
      <SahmRulePanel sahm={data.sahm_rule} />
      {data.alert_factors?.length > 0 && (
        <GlassCard stagger={6}>
          <div className="p-5">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400 mb-3">警戒要因</h3>
            <div className="space-y-1.5">
              {data.alert_factors.map((factor, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                  {factor}
                </div>
              ))}
            </div>
          </div>
        </GlassCard>
      )}
      <div className="flex justify-end">
        <p className="text-[10px] text-muted-foreground font-mono">
          UPD {new Date(data.timestamp).toLocaleString('ja-JP')}
        </p>
      </div>
    </div>
  );
}

// ============================================================
// TAB 2: Risk History (NEW)
// ============================================================

const QUICK_RANGES: Array<{ name: string; months?: number; start?: string; end?: string }> = [
  { name: 'ALL' },
  { name: '10Y', months: 120 },
  { name: '5Y', months: 60 },
  { name: '3Y', months: 36 },
  { name: '1Y', months: 12 },
  { name: 'ITバブル', start: '2001-01-01', end: '2003-06-01' },
  { name: 'GFC', start: '2007-06-01', end: '2010-06-01' },
  { name: 'COVID', start: '2019-12-01', end: '2021-06-01' },
];

const ECONOMIC_EVENTS: ChartEventMarker[] = [
  { date: '2001-03', label: 'ITバブル崩壊', color: DA.danger500 },
  { date: '2008-09', label: 'リーマンショック', color: DA.danger500 },
  { date: '2011-08', label: '米国債格下げ', color: DA.caution500 },
  { date: '2020-03', label: 'COVID-19', color: DA.danger500 },
  { date: '2022-03', label: 'FRB利上げ開始', color: DA.caution500 },
  { date: '2024-08', label: 'Sahmトリガー', color: DA.caution500 },
];

interface YearAnalysis {
  year: string;
  avgScore: number;
  range: string;
  phase: string;
  scores: string;
  situation: string;
  verdict: string;
}

const YEAR_ANALYSIS: YearAnalysis[] = [
  { year: '2001', avgScore: 61, range: '29-75', phase: 'SLOWDOWN→CONTRACTION', scores: 'E=35 C=9 S=13',
    situation: 'ITバブル崩壊。NASDAQ -78%。9/11テロ。3月にNBERがリセッション認定。',
    verdict: 'CONTRACTION(75pt)到達。雇用(E=35)+消費(C=9)+構造(S=13)の全カテゴリ悪化を検出' },
  { year: '2002', avgScore: 64, range: '47-73', phase: 'CONTRACTION→CAUTION', scores: 'E=39 C=9 S=13',
    situation: 'エンロン・ワールドコム破綻。企業会計スキャンダル。ダブルディップ懸念。',
    verdict: 'CONTRACTION(73pt)が継続。雇用悪化(E=39)と消費悪化(C=9)の同時検出。実際の景気後退期' },
  { year: '2003', avgScore: 51, range: '32-66', phase: 'CONTRACTION→CAUTION→SLOWDOWN', scores: 'E=28 C=5 S=15',
    situation: 'イラク戦争開始(3月)。景気回復開始。FRBが1%まで利下げ。',
    verdict: 'H1はCONTRACTION、H2にSLOWDOWNへ。回復の過程を正確に反映' },
  { year: '2004', avgScore: 25, range: '18-32', phase: 'SLOWDOWN→EXPANSION', scores: 'E=9 C=2 S=14',
    situation: '景気拡大。住宅ブーム加速。FRBが利上げ開始(6月)。',
    verdict: 'ITバブル後の回復完了。年末にEXPANSION定着' },
  { year: '2005', avgScore: 21, range: '16-32', phase: 'EXPANSION→SLOWDOWN', scores: 'E=5 C=5 S=11',
    situation: '住宅バブルのピーク。サブプライムローン急拡大。雇用は絶好調。',
    verdict: '雇用は健全(E=5)だが構造(S=11)が残存。消費者信頼感にも変動あり' },
  { year: '2006', avgScore: 21, range: '12-33', phase: 'EXPANSION→SLOWDOWN', scores: 'E=8 C=2 S=10',
    situation: '住宅市場にピークの兆し。製造業は堅調。年末に減速の兆候。',
    verdict: '表面的にはEXPANSION。住宅市場の悪化はまだ雇用に波及せず' },
  { year: '2007', avgScore: 33, range: '13-52', phase: 'EXPANSION→CAUTION', scores: 'E=16 C=4 S=11',
    situation: 'サブプライム危機の発端。住宅市場崩壊開始。12月にNBERがリセッション認定。',
    verdict: 'H1はEXPANSION、H2にCAUTION(52pt)まで悪化。急速悪化を正しく検出' },
  { year: '2008', avgScore: 74, range: '52-84', phase: 'CAUTION→CONTRACTION→CRISIS', scores: 'E=40 C=16 S=14',
    situation: 'リーマンショック(9月)。金融システム崩壊。大規模な雇用喪失が始まる。',
    verdict: 'CAUTION→CONTRACTION→CRISIS(12月84pt)。段階的悪化を正確に反映' },
  { year: '2009', avgScore: 83, range: '79-88', phase: 'CRISIS', scores: 'E=42 C=16 S=21',
    situation: 'GFC最悪期。失業率10%到達。3月にS&P500が底値(666)。',
    verdict: 'CRISIS判定がほぼ通年。88pt(1月)がモデル史上最高スコア' },
  { year: '2010', avgScore: 51, range: '26-78', phase: 'CONTRACTION→CAUTION→SLOWDOWN', scores: 'E=23 C=4 S=22',
    situation: 'GFC後の緩やかな回復開始。構造的な弱さは残存。',
    verdict: 'CONTRACTION(1月78pt)→SLOWDOWN(12月26pt)の段階的回復を正確に反映' },
  { year: '2011', avgScore: 33, range: '25-41', phase: 'SLOWDOWN→CAUTION', scores: 'E=8 C=2 S=21',
    situation: '米国債格下げ(8月)。欧州債務危機。二番底懸念。',
    verdict: '構造スコア(S=21)が高止まりだが、雇用・消費は改善' },
  { year: '2012', avgScore: 30, range: '23-39', phase: 'SLOWDOWN', scores: 'E=8 C=1 S=20',
    situation: '緩やかな回復持続。QE3開始(9月)。財政の崖問題。',
    verdict: '構造スコアが依然高いがSLOWDOWN判定は妥当' },
  { year: '2013', avgScore: 36, range: '32-41', phase: 'SLOWDOWN→CAUTION', scores: 'E=5 C=8 S=20',
    situation: 'テーパータントラム(5月)。政府閉鎖(10月)。回復は加速。',
    verdict: '構造改善に時間がかかっている局面を正しく反映' },
  { year: '2014', avgScore: 25, range: '19-36', phase: 'SLOWDOWN→EXPANSION', scores: 'E=3 C=1 S=20',
    situation: 'GFC後の回復途上。Q4に原油暴落。製造業が減速開始。',
    verdict: '構造的な弱さは事実だが、雇用・消費が健全' },
  { year: '2015', avgScore: 22, range: '19-29', phase: 'EXPANSION→SLOWDOWN', scores: 'E=3 C=0 S=18',
    situation: '製造業リセッション。原油暴落、中国人民元切下げ(8月)、ISM50割れ。',
    verdict: '実際にSLOWDOWNだった。リセッション入りはしなかったが警戒は妥当' },
  { year: '2016', avgScore: 23, range: '19-28', phase: 'EXPANSION→SLOWDOWN', scores: 'E=4 C=3 S=14',
    situation: 'Brexit(6月)。大統領選挙不確実性。2015年ショックからの緩やかな回復。',
    verdict: '不確実性の年で、過度に楽観でも悲観でもない' },
  { year: '2017', avgScore: 16, range: '11-22', phase: 'EXPANSION', scores: 'E=5 C=2 S=9',
    situation: 'トランプ減税期待。強い成長。失業率低下。',
    verdict: '構造改善が明確。EXPANSION判定は正解' },
  { year: '2018', avgScore: 9, range: '3-14', phase: 'EXPANSION', scores: 'E=4 C=1 S=4',
    situation: '好景気のピーク。利上げ進行。Q4に株式急落。',
    verdict: 'JOLTS比率が初めて1.0超え。構造が最も健全だった時期' },
  { year: '2019', avgScore: 10, range: '5-17', phase: 'EXPANSION', scores: 'E=6 C=2 S=2',
    situation: '米中貿易戦争。8月に逆イールド（リセッション予兆とされた）。',
    verdict: '偽陽性なし。逆イールドでパニックが起きたがモデルはEXPANSION維持' },
  { year: '2020', avgScore: 52, range: '4-84', phase: 'EXPANSION→CRISIS→CAUTION', scores: 'E=22 C=9 S=18',
    situation: 'COVID-19パンデミック。3月ロックダウン。4月に2200万人失業。',
    verdict: '1ヶ月で検出。4-6月に84pt(CRISIS)。外生ショックへの反応は完璧' },
  { year: '2021', avgScore: 14, range: '2-60', phase: 'CAUTION→EXPANSION', scores: 'E=5 C=3 S=6',
    situation: 'V字回復。大規模財政刺激策。ワクチン接種進行。',
    verdict: '1月60pt(CAUTION)→4月以降2-12pt(EXPANSION)。急回復を正確に反映' },
  { year: '2022', avgScore: 15, range: '8-20', phase: 'EXPANSION', scores: 'E=0 C=14 S=1',
    situation: 'インフレ急騰、FRB利上げ、株式ベアマーケット(-27%)。リセッションではない。',
    verdict: '重要: 偽陽性なし。株価は大幅下落したが雇用が健全(E=0)でEXPANSION維持' },
  { year: '2023', avgScore: 11, range: '5-21', phase: 'EXPANSION', scores: 'E=4 C=4 S=2',
    situation: 'ソフトランディング成功。AI boom。SVB破綻もシステミックリスクに発展せず。',
    verdict: '年末にSahm値が上昇開始したが、全体としてEXPANSION' },
  { year: '2024', avgScore: 28, range: '15-42', phase: 'EXPANSION→SLOWDOWN→CAUTION', scores: 'E=18 C=4 S=5',
    situation: '景気減速。NFP下方修正。Sahm値0.53(8月)でトリガー。FRB利下げ開始(9月)。',
    verdict: '8月の42ptはSahmトリガーを正しく反映。利下げ後にやや改善' },
  { year: '2025', avgScore: 43, range: '25-59', phase: 'SLOWDOWN→CAUTION', scores: 'E=24 C=8 S=9',
    situation: 'トランプ関税。DOGE大量解雇。不確実性拡大。NFP減速。',
    verdict: '現在進行形。CAUTION判定は妥当。12月に59pt(CONTRACTION目前)' },
  { year: '2026', avgScore: 46, range: '46-46', phase: 'CAUTION', scores: 'E=23 C=11 S=10',
    situation: '不確実性継続。NFP弱い。K字型拡大。',
    verdict: '現在進行形' },
];

const RISK_BG_ZONES: ChartBackgroundZone[] = [
  { yMin: 0,  yMax: 20,  color: 'rgba(37,157,99,0.06)' },   // safe (緑)
  { yMin: 20, yMax: 40,  color: 'rgba(52,96,251,0.06)' },   // brand (青)
  { yMin: 40, yMax: 60,  color: 'rgba(255,141,68,0.06)' },  // caution-light
  { yMin: 60, yMax: 80,  color: 'rgba(251,91,1,0.07)' },    // caution
  { yMin: 80, yMax: 100, color: 'rgba(254,57,57,0.07)' },   // danger
];

const PHASE_STYLE: Record<string, { bg: string; text: string }> = {
  EXPANSION: { bg: 'bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400' },
  SLOWDOWN: { bg: 'bg-cyan-500/15', text: 'text-cyan-600 dark:text-cyan-400' },
  CAUTION: { bg: 'bg-yellow-500/15', text: 'text-yellow-600 dark:text-yellow-400' },
  CONTRACTION: { bg: 'bg-orange-500/15', text: 'text-orange-600 dark:text-orange-400' },
  CRISIS: { bg: 'bg-red-500/15', text: 'text-red-600 dark:text-red-400' },
};

function YearByYearAnalysis() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <GlassCard>
      <div className="p-5 space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-3">年別バックテスト解説</h3>
        <div className="space-y-1">
          {YEAR_ANALYSIS.map((ya) => {
            const phases = ya.phase.split('→').map(p => p.trim());
            const isOpen = expanded === ya.year;
            return (
              <div key={ya.year}>
                <button
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
                  onClick={() => setExpanded(isOpen ? null : ya.year)}
                >
                  <span className="text-sm font-bold font-mono w-10 shrink-0">{ya.year}</span>
                  <span className="flex items-center gap-0.5">
                    {phases.map((p, i) => {
                      const s = PHASE_STYLE[p] || PHASE_STYLE.EXPANSION;
                      return (
                        <span key={i} className="flex items-center">
                          {i > 0 && <span className="text-[9px] text-muted-foreground mx-0.5">→</span>}
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold font-mono ${s.bg} ${s.text}`}>{p}</span>
                        </span>
                      );
                    })}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground">{ya.avgScore}pt</span>
                  <span className="text-[10px] text-muted-foreground font-mono">[{ya.range}]</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{isOpen ? '▼' : '▶'}</span>
                </button>
                {isOpen && (
                  <div className="ml-14 pb-3 space-y-1.5 plumb-animate-in">
                    <p className="text-xs text-foreground leading-relaxed">{ya.situation}</p>
                    <p className="text-[11px] font-mono text-muted-foreground">{ya.scores}</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">{ya.verdict}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </GlassCard>
  );
}

function RiskHistoryTab({ realtimeScore, realtimePhase }: { realtimeScore: number; realtimePhase: typeof RISK_PHASES[number] }) {
  const { data: histData, error: histError, isLoading: loading, mutate } = useRiskHistory(350);
  const [showSP500, setShowSP500] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [activeRange, setActiveRange] = useState<string>('ALL');
  const chartRef = useRef<HTMLDivElement>(null);

  const applyRange = useCallback((qr: typeof QUICK_RANGES[number]) => {
    const container = chartRef.current;
    const h = histData?.history;
    if (!container || !h || h.length === 0) return;
    const btn = container.querySelector('[data-chart-viewport]') as HTMLButtonElement | null;
    if (!btn) return;

    setActiveRange(qr.name);
    if (!qr.months && !qr.start) {
      btn.setAttribute('data-start', h[0].date);
      btn.setAttribute('data-end', h[h.length - 1].date);
      btn.click();
      return;
    }
    if (qr.months) {
      const endIdx = h.length;
      const startIdx = Math.max(0, endIdx - qr.months);
      btn.setAttribute('data-start', h[startIdx].date);
      btn.setAttribute('data-end', h[endIdx - 1].date);
      btn.click();
      return;
    }
    if (qr.start && qr.end) {
      btn.setAttribute('data-start', qr.start);
      btn.setAttribute('data-end', qr.end);
      btn.click();
    }
  }, [histData]);

  if (loading) return <div className="flex items-center justify-center py-24"><Skeleton className="h-[420px] w-full rounded-xl" /></div>;
  if (histError) return <div className="flex flex-col items-center justify-center py-24 text-sm text-neutral-500">{histError instanceof Error ? histError.message : 'データ取得失敗'}<Button variant="outline" size="sm" className="mt-3" onClick={() => mutate()}>再試行</Button></div>;
  if (!histData || histData.history.length === 0) return <div className="flex items-center justify-center py-24 text-sm text-neutral-500">リスク履歴データがありません</div>;

  // Build chart series — line color shifts based on latest phase for visual cue, but
  // we use a single brand-700 line for stability. Background zones already convey the phase.
  const series: ChartSeries[] = [
    {
      data: histData.history.map((h) => ({ x: h.date, y: h.total_score })),
      type: 'area', color: DA.brand500, label: 'リスクスコア',
    },
  ];

  if (showSP500 && histData.sp500.length > 0) {
    const sp500Map = new Map<string, number>();
    for (const s of histData.sp500) {
      sp500Map.set(s.date.substring(0, 7), s.close);
    }
    const alignedSP500 = histData.history.map((h) => ({
      x: h.date,
      y: sp500Map.get(h.date.substring(0, 7)) ?? null,
    }));
    series.push({
      data: alignedSP500,
      type: 'line', color: DA.neutral700, label: 'S&P 500', dashed: true,
      yAxisSide: 'right',
    });
  }

  // Phase reference lines — labels in DA colors so they read as the same scale
  const refLines: ChartReferenceLine[] = [
    { y: 20, color: DA.safe300,    label: '拡大', dashed: true },
    { y: 40, color: DA.brand200,   label: '減速', dashed: true },
    { y: 60, color: DA.caution300, label: '警戒', dashed: true },
    { y: 80, color: DA.caution500, label: '収縮', dashed: true },
  ];

  // Header stats — current score + delta from earliest visible point
  const last = histData.history[histData.history.length - 1];
  const first = histData.history[0];
  const deltaScore = last && first ? last.total_score - first.total_score : null;
  const currentPhase = last ? phaseForScore(last.total_score) : RISK_PHASES[0];

  return (
    <div className="space-y-3 plumb-animate-in">
      {/* ============ Toolbar (period + crisis presets + event toggle) ============ */}
      <div className="rounded-xl border border-neutral-200 bg-card p-3 md:p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Period segmented */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-neutral-500">期間</span>
          <div className="inline-flex items-center rounded-md border border-neutral-200 bg-white overflow-hidden">
            {QUICK_RANGES.filter(qr => !qr.start).map((qr, i) => {
              const isActive = activeRange === qr.name;
              return (
                <button
                  key={qr.name}
                  onClick={() => applyRange(qr)}
                  className={`px-3.5 py-1.5 text-[11px] font-bold tracking-wider transition-colors ${
                    i > 0 ? 'border-l border-neutral-200' : ''
                  } ${
                    isActive
                      ? 'bg-[var(--brand-100)] text-[var(--brand-700)]'
                      : 'text-neutral-700 hover:bg-neutral-50'
                  }`}
                >{qr.name}</button>
              );
            })}
          </div>
        </div>

        {/* Crisis chips */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-neutral-500">クライシス</span>
          <div className="flex items-center gap-1.5">
            {QUICK_RANGES.filter(qr => qr.start).map((qr) => {
              const isActive = activeRange === qr.name;
              return (
                <button
                  key={qr.name}
                  onClick={() => applyRange(qr)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors ${
                    isActive
                      ? 'bg-[var(--brand-100)] text-[var(--brand-700)] border-[var(--brand-200)]'
                      : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-300'
                  }`}
                >{qr.name}</button>
              );
            })}
          </div>
        </div>

        {/* Event toggle */}
        <label className="ml-auto flex items-center gap-2 cursor-pointer text-[11px] text-neutral-700 hover:text-foreground">
          <input
            type="checkbox"
            checked={showEvents}
            onChange={(e) => setShowEvents(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--brand-500)]"
          />
          <span>イベント表示</span>
        </label>
      </div>

      {/* ============ Main chart card ============ */}
      <div className="rounded-xl border border-neutral-200 bg-card">
        {/* Chart header — show BOTH realtime + historical to clarify the discrepancy */}
        <div className="flex flex-wrap items-end justify-between gap-4 p-5 pb-3 border-b border-neutral-100">
          <div>
            <h3 className="text-[18px] font-bold text-foreground tracking-tight">リスクスコア時系列</h3>
            <p className="text-[11px] text-neutral-500 mt-1">雇用 (50点) + 消費 (25点) + 構造 (25点) = 0–100</p>
          </div>
          <div className="flex items-end gap-4">
            {/* Realtime — primary, matches dashboard */}
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-[0.15em] text-neutral-500 font-medium">現在 (リアルタイム)</p>
              <div className="flex items-end gap-2 mt-1">
                <p className="text-[24px] leading-none font-bold tabular-nums text-foreground">
                  {Math.round(realtimeScore)}
                  <span className="text-[12px] text-neutral-400 font-normal ml-1">/100</span>
                </p>
                <div
                  className="px-2 py-0.5 rounded-md text-[10px] font-bold border"
                  style={{
                    color: realtimePhase.color,
                    backgroundColor: realtimePhase.bg,
                    borderColor: realtimePhase.border,
                  }}
                >
                  {realtimePhase.label}
                </div>
              </div>
            </div>
            {/* Historical — secondary, the chart's actual last point */}
            <div className="text-right pl-4 border-l border-neutral-200">
              <p className="text-[10px] uppercase tracking-[0.15em] text-neutral-500 font-medium">履歴最終 (バックテスト)</p>
              <div className="flex items-end gap-2 mt-1">
                <p className="text-[18px] leading-none font-bold tabular-nums text-neutral-700">
                  {last ? Math.round(last.total_score) : '—'}
                </p>
                <div
                  className="px-2 py-0.5 rounded-md text-[10px] font-bold border"
                  style={{
                    color: currentPhase.color,
                    backgroundColor: currentPhase.bg,
                    borderColor: currentPhase.border,
                  }}
                >
                  {currentPhase.label}
                </div>
                {deltaScore != null && (
                  <div className={`px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums ${
                    deltaScore <= 0
                      ? 'text-[var(--signal-safe-500)] bg-[var(--signal-safe-100)]'
                      : 'text-[var(--signal-danger-500)] bg-[var(--signal-danger-100)]'
                  }`}>
                    {deltaScore >= 0 ? '+' : ''}{deltaScore.toFixed(0)}pt
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Note: explain the discrepancy */}
        <div className="px-5 pt-2 pb-2 bg-[var(--brand-100)]/30 border-b border-neutral-100">
          <p className="text-[11px] text-neutral-700 leading-relaxed">
            <strong className="text-[var(--brand-700)]">Note</strong>: 履歴計算は <strong>雇用乖離 (8点)</strong> と <strong>インフレ乖離 (5点)</strong> を含まないため
            理論最大は 90 点 (Truflation/ADP 等の手動データソースは過去取得不可)。
            危機局面 (GFC/COVID 等) では含まれる成分だけで 80+ に到達するので警戒検出は維持されますが、
            <strong>平時の先行警告 (今の {Math.round(realtimeScore)} → {last ? Math.round(last.total_score) : '—'} の差)</strong> は履歴側で再現できません。
          </p>
        </div>

        {/* Overlay toggles row */}
        <div className="px-5 py-2 border-b border-neutral-100 flex items-center gap-4">
          <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-neutral-500">オーバーレイ</span>
          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-neutral-700 hover:text-foreground">
            <input
              type="checkbox"
              checked={showSP500}
              onChange={(e) => setShowSP500(e.target.checked)}
              className="w-3.5 h-3.5 accent-[var(--neutral-700)]"
            />
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-[2px] bg-[var(--neutral-700)]" />
              S&P 500
            </span>
          </label>
        </div>

        {/* Chart canvas */}
        <div className="p-4 md:p-5" ref={chartRef}>
          <EconChartCanvas
            series={series}
            referenceLines={refLines}
            backgroundZones={RISK_BG_ZONES}
            eventMarkers={showEvents ? ECONOMIC_EVENTS : undefined}
            yAxisFormat={(v) => `${Math.round(v)}`}
            yAxisRightFormat={(v) => v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v)}`}
            height={440}
            initialShowAll
          />
        </div>

        {/* Footer: phase legend + data range */}
        <div className="px-5 pb-4 pt-1 space-y-3">
          <div className="grid grid-cols-5 gap-1.5">
            {RISK_PHASES.map((p) => (
              <div
                key={p.code}
                className="rounded-md px-2 py-1.5 text-center text-[10px] border"
                style={{
                  color: p.color,
                  backgroundColor: p.bg,
                  borderColor: p.border,
                }}
              >
                <div className="font-bold">{p.label}</div>
                <div className="opacity-70 tabular-nums">{p.range}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-500">
            <span className="font-medium">
              データ範囲: <span className="tabular-nums">{histData.history[0]?.date}</span> → <span className="tabular-nums">{histData.history[histData.history.length - 1]?.date}</span>
            </span>
            <span>出典: FRED, S&P CapIQ</span>
          </div>
        </div>
      </div>

      {/* Year-by-year analysis */}
      <YearByYearAnalysis />

      <p className="text-[10px] text-neutral-500 text-center">
        ※ 過去スコアは雇用乖離・インフレ乖離を含まないため、リアルタイムスコアより低めに表示されます
      </p>
    </div>
  );
}

// ============================================================
// TAB 3: Indicator Charts (Canvas)
// ============================================================

type EconChartType = 'nfp' | 'nfp-level' | 'unemployment' | 'claims' | 'wages' | 'sahm' | 'sentiment' | 'income';

const ECON_CHART_TYPES: { key: EconChartType; label: string; sub: string; unit: string }[] = [
  { key: 'nfp',          label: 'NFP推移',         sub: '非農業部門雇用者数 月次変化',         unit: 'K人' },
  { key: 'nfp-level',    label: 'NFP累積',         sub: '雇用者数の絶対値 + S&P500 / 不況帯',  unit: 'M人' },
  { key: 'unemployment', label: '失業率',           sub: 'U3 (公式) / U6 (実質)',                unit: '%' },
  { key: 'claims',       label: '失業保険',         sub: '新規申請 + 4W平均 / 継続申請',          unit: '件' },
  { key: 'wages',        label: '賃金',             sub: '平均時給 + MoM変化率',                  unit: '$' },
  { key: 'sahm',         label: 'Sahm Rule',        sub: 'U3 3M平均 − 12M最低',                   unit: 'pp' },
  { key: 'sentiment',    label: '消費者信頼感',     sub: 'ミシガン大学 UMCSENT',                  unit: 'pt' },
  { key: 'income',       label: '実質個人所得',     sub: 'W875RX1 YoY',                            unit: '%' },
];

// 米国の主要な不況期間 (NBER 公式認定)。NFP 累積チャートの背景帯で「フラット化 → 不況」の文脈を可視化する。
// データ範囲は 1999 年〜なので湾岸戦争 (1990-91) は省略。
const RECESSION_PERIODS: { xMin: string; xMax: string; label: string }[] = [
  { xMin: '2001-03', xMax: '2001-11', label: 'IT バブル崩壊' },
  { xMin: '2007-12', xMax: '2009-06', label: 'GFC' },
  { xMin: '2020-02', xMax: '2020-04', label: 'COVID' },
];

const RECESSION_BG_ZONES: ChartBackgroundZone[] = RECESSION_PERIODS.map(p => ({
  xMin: p.xMin,
  xMax: p.xMax,
  color: 'rgba(254,57,57,0.10)', // DA.danger500 alpha 10%
}));

function useChartData(data: EmploymentRiskScore, sp500: Array<{ date: string; close: number }> | undefined) {
  return useMemo(() => {
    const nfpChron = [...data.nfp_history].reverse();
    const claimsChron = [...data.claims_history].reverse();

    // NFP レベル系列 (current_value, 千人 → 百万人換算)。
    // 1999-01 〜 直近月。「フラット化 → 不況」のナラティブ用。
    const nfpLevelChron = nfpChron
      .filter((d) => d.current_value != null)
      .map((d) => ({
        period: d.reference_period.substring(0, 7), // "YYYY-MM"
        level_m: (d.current_value as number) / 1000, // 千人 → 百万人
      }));

    // S&P500 月次クローズ系列 (risk-history エンドポイントから渡される)。
    // NFP と同じ月次キーに丸めて重ね描き可能にする。
    const sp500ByMonth = new Map<string, number>();
    for (const p of sp500 ?? []) {
      const key = p.date.substring(0, 7);
      sp500ByMonth.set(key, p.close);
    }
    // NFP と同じ月キー配列 (NFP が無い月は SP500 もスキップ、前後アライン)
    const nfpLevelChartData = nfpLevelChron.map((d) => ({
      x: d.period,
      y: d.level_m,
    }));
    const sp500ChartData = nfpLevelChron.map((d) => ({
      x: d.period,
      y: sp500ByMonth.get(d.period) ?? null,
    }));

    const sentimentChron = (data.consumer_history || [])
      .filter((d) => d.indicator === 'UMCSENT' && d.current_value != null)
      .sort((a, b) => a.reference_period.localeCompare(b.reference_period));

    const incomeChron = (data.consumer_history || [])
      .filter((d) => d.indicator === 'W875RX1' && d.current_value != null)
      .sort((a, b) => a.reference_period.localeCompare(b.reference_period))
      .map((d, i, arr) => ({
        ...d,
        yoy: i >= 12 && arr[i - 12].current_value
          ? parseFloat((((d.current_value! - arr[i - 12].current_value!) / Math.abs(arr[i - 12].current_value!)) * 100).toFixed(2))
          : null,
      }));

    const sahmChartData = (() => {
      const u3Values = nfpChron.filter((d) => d.u3_rate != null).map((d) => ({ period: d.reference_period, u3: d.u3_rate as number }));
      if (u3Values.length < 3) return [];
      const result: Array<{ period: string; sahm_value: number }> = [];
      for (let i = 2; i < u3Values.length; i++) {
        const avg3m = (u3Values[i].u3 + u3Values[i - 1].u3 + u3Values[i - 2].u3) / 3;
        const startIdx = Math.max(0, i - 11);
        let minAvg3m = avg3m;
        for (let j = startIdx; j <= i; j++) {
          if (j >= 2) {
            const a = (u3Values[j].u3 + u3Values[j - 1].u3 + u3Values[j - 2].u3) / 3;
            minAvg3m = Math.min(minAvg3m, a);
          }
        }
        result.push({ period: u3Values[i].period, sahm_value: parseFloat((avg3m - minAvg3m).toFixed(2)) });
      }
      return result;
    })();

    const nfpWithAvg = nfpChron.map((d, i) => {
      let avg3m: number | null = null;
      if (i >= 2 && nfpChron[i].nfp_change != null && nfpChron[i - 1].nfp_change != null && nfpChron[i - 2].nfp_change != null) {
        avg3m = Math.round(((nfpChron[i].nfp_change as number) + (nfpChron[i - 1].nfp_change as number) + (nfpChron[i - 2].nfp_change as number)) / 3);
      }
      return { ...d, nfp_3m_avg: avg3m };
    });

    return {
      nfpChron,
      claimsChron,
      sentimentChron,
      incomeChron,
      sahmChartData,
      nfpWithAvg,
      // NFP 累積チャート用 (1999 年〜現在の月次レベル値 + 同じ月キーに整列した S&P500)
      nfpLevelChartData,
      sp500ChartData,
      // 直近 NFP レベル値 (百万人) - mini tile の stat 表示用
      latestNFPLevelM: nfpLevelChartData.length > 0 ? nfpLevelChartData[nfpLevelChartData.length - 1].y : null,
      // YoY 変化率 (%) - stat 表示用
      nfpLevelYoY: (() => {
        if (nfpLevelChartData.length < 13) return null;
        const latest = nfpLevelChartData[nfpLevelChartData.length - 1].y;
        const yearAgo = nfpLevelChartData[nfpLevelChartData.length - 13].y;
        if (latest == null || yearAgo == null || yearAgo === 0) return null;
        return parseFloat((((latest - yearAgo) / yearAgo) * 100).toFixed(2));
      })(),
    };
  }, [data, sp500]);
}

function getChartConfig(chartType: EconChartType, cd: ReturnType<typeof useChartData>): {
  series: ChartSeries[];
  referenceLines?: ChartReferenceLine[];
  backgroundZones?: ChartBackgroundZone[];
  yAxisFormat?: (v: number) => string;
  yAxisRightFormat?: (v: number) => string;
} {
  switch (chartType) {
    case 'nfp':
      return {
        series: [
          { data: cd.nfpWithAvg.map((d) => ({ x: d.reference_period, y: d.nfp_change })), type: 'bar', color: DA.brand400, label: 'NFP変化 (K)' },
          { data: cd.nfpWithAvg.map((d) => ({ x: d.reference_period, y: d.nfp_3m_avg })), type: 'line', color: DA.caution500, label: '3M平均' },
        ],
        referenceLines: [
          { y: 0,   color: DA.neutral300, dashed: false },
          { y: 100, color: DA.caution300, label: '100K' },
        ],
        yAxisFormat: (v) => `${Math.round(v)}K`,
      };
    case 'nfp-level': {
      // NFP の絶対値 (百万人) を line で。S&P500 を右軸に重ね描き。
      // 背景に過去 3 つの不況帯 (IT バブル / GFC / COVID) を入れて
      // 「NFP がフラットになり始めると不況の前兆」というナラティブを視覚化。
      const hasSP500 = cd.sp500ChartData.some((p) => p.y != null);
      return {
        series: [
          { data: cd.nfpLevelChartData, type: 'line', color: DA.brand500, label: 'NFP (百万人)' },
          ...(hasSP500
            ? [{ data: cd.sp500ChartData, type: 'line' as const, color: DA.danger500, label: 'S&P500', yAxisSide: 'right' as const }]
            : []),
        ],
        backgroundZones: RECESSION_BG_ZONES,
        yAxisFormat: (v) => `${v.toFixed(0)}M`,
        yAxisRightFormat: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      };
    }
    case 'unemployment':
      return {
        series: [
          { data: cd.nfpChron.map((d) => ({ x: d.reference_period, y: d.u3_rate })), type: 'area', color: DA.brand500, label: 'U3 失業率' },
          { data: cd.nfpChron.map((d) => ({ x: d.reference_period, y: d.u6_rate })), type: 'line', color: DA.brand700, label: 'U6 実質失業率', dashed: true },
        ],
        referenceLines: [
          { y: 4.5, color: DA.caution300, label: '警戒 4.5%' },
          { y: 5.0, color: DA.danger300,  label: '危険 5.0%' },
        ],
        yAxisFormat: (v) => `${v.toFixed(1)}%`,
      };
    case 'claims':
      return {
        series: [
          { data: cd.claimsChron.map((d) => ({ x: d.week_ending, y: d.initial_claims })), type: 'area', color: DA.brand500, label: '新規申請' },
          { data: cd.claimsChron.map((d) => ({ x: d.week_ending, y: d.initial_claims_4w_avg })), type: 'line', color: DA.caution500, label: '4W移動平均' },
          { data: cd.claimsChron.map((d) => ({ x: d.week_ending, y: d.continued_claims })), type: 'line', color: DA.brand700, label: '継続申請', dashed: true, yAxisSide: 'right' },
        ],
        referenceLines: [
          { y: 250000, color: DA.caution300, label: '250K' },
          { y: 300000, color: DA.danger300,  label: '300K' },
        ],
        yAxisFormat: (v) => `${(v / 1000).toFixed(0)}K`,
        yAxisRightFormat: (v) => `${(v / 1000).toFixed(0)}K`,
      };
    case 'wages':
      return {
        series: [
          { data: cd.nfpChron.map((d) => ({ x: d.reference_period, y: d.avg_hourly_earnings })), type: 'area', color: DA.safe500, label: '平均時給 ($)' },
          { data: cd.nfpChron.map((d) => ({ x: d.reference_period, y: d.wage_mom })), type: 'line', color: DA.caution500, label: '賃金MoM (%)', dashed: true, yAxisSide: 'right' },
        ],
        yAxisFormat: (v) => `$${v.toFixed(1)}`,
        yAxisRightFormat: (v) => `${v.toFixed(2)}%`,
      };
    case 'sahm':
      return {
        series: [
          { data: cd.sahmChartData.map((d) => ({ x: d.period, y: d.sahm_value })), type: 'area', color: DA.caution500, label: 'Sahm値' },
        ],
        referenceLines: [
          { y: 0.3, color: DA.caution300, label: '警戒 0.3' },
          { y: 0.5, color: DA.danger300,  label: '発動 0.5' },
        ],
        yAxisFormat: (v) => v.toFixed(2),
      };
    case 'sentiment':
      return {
        series: [
          { data: cd.sentimentChron.map((d) => ({ x: d.reference_period, y: d.current_value })), type: 'area', color: DA.brand500, label: 'UMCSENT' },
        ],
        referenceLines: [
          { y: 80, color: DA.safe300,    label: '良好 80' },
          { y: 70, color: DA.caution300, label: '警戒 70' },
          { y: 60, color: DA.danger300,  label: '危険 60' },
        ],
        yAxisFormat: (v) => v.toFixed(0),
      };
    case 'income': {
      const filtered = cd.incomeChron.filter((d) => d.yoy != null);
      return {
        series: [
          { data: filtered.map((d) => ({ x: d.reference_period, y: d.yoy })), type: 'area', color: DA.brand500, label: '実質個人所得 YoY (%)' },
        ],
        referenceLines: [
          { y: 0, color: DA.neutral300, dashed: false },
          { y: 1, color: DA.caution300, label: '警戒 1%' },
          { y: 3, color: DA.safe300,    label: '良好 3%' },
        ],
        yAxisFormat: (v) => `${v.toFixed(1)}%`,
      };
    }
    default:
      return { series: [] };
  }
}

type IndicatorViewMode = 'overview' | 'detail';

// Compute "latest value + delta" for the header chip on each indicator
function indicatorStat(chartType: EconChartType, cd: ReturnType<typeof useChartData>): {
  value: string; delta: number | null; deltaUnit?: string;
} | null {
  switch (chartType) {
    case 'nfp': {
      const arr = cd.nfpWithAvg as unknown as Array<Record<string, unknown>>;
      const r = lastAndDelta(arr, 'nfp_change');
      return { value: r.last != null ? `${Math.round(r.last)}K` : '—', delta: r.deltaPct };
    }
    case 'nfp-level': {
      // 直近 NFP 累積値 (百万人) + YoY 変化率 (%)
      if (cd.latestNFPLevelM == null) return { value: '—', delta: null };
      return {
        value: `${cd.latestNFPLevelM.toFixed(1)}M`,
        delta: cd.nfpLevelYoY,
      };
    }
    case 'unemployment': {
      const arr = cd.nfpChron as unknown as Array<Record<string, unknown>>;
      const r = lastAndDelta(arr, 'u3_rate');
      return { value: r.last != null ? `${r.last.toFixed(1)}%` : '—', delta: r.deltaPct, deltaUnit: 'pp' };
    }
    case 'claims': {
      const arr = cd.claimsChron as unknown as Array<Record<string, unknown>>;
      const r = lastAndDelta(arr, 'initial_claims');
      return { value: r.last != null ? `${(r.last / 1000).toFixed(0)}K` : '—', delta: r.deltaPct };
    }
    case 'wages': {
      const arr = cd.nfpChron as unknown as Array<Record<string, unknown>>;
      const r = lastAndDelta(arr, 'avg_hourly_earnings');
      return { value: r.last != null ? `$${r.last.toFixed(2)}` : '—', delta: r.deltaPct };
    }
    case 'sahm': {
      const arr = cd.sahmChartData as unknown as Array<Record<string, unknown>>;
      const r = lastAndDelta(arr, 'sahm_value');
      return { value: r.last != null ? r.last.toFixed(2) : '—', delta: null };
    }
    case 'sentiment': {
      const arr = cd.sentimentChron as unknown as Array<Record<string, unknown>>;
      const r = lastAndDelta(arr, 'current_value');
      return { value: r.last != null ? r.last.toFixed(0) : '—', delta: r.deltaPct };
    }
    case 'income': {
      const arr = cd.incomeChron.filter((d) => d.yoy != null) as unknown as Array<Record<string, unknown>>;
      const r = lastAndDelta(arr, 'yoy');
      return { value: r.last != null ? `${r.last.toFixed(1)}%` : '—', delta: null };
    }
  }
}

const INDICATOR_PERIODS: Array<{ name: string; years?: number }> = [
  { name: 'ALL' },
  { name: '10Y', years: 10 },
  { name: '5Y',  years: 5 },
  { name: '3Y',  years: 3 },
  { name: '1Y',  years: 1 },
];

function IndicatorChartsTab({ data }: { data: EmploymentRiskScore }) {
  const [viewMode, setViewMode] = useState<IndicatorViewMode>('overview');
  const [chartType, setChartType] = useState<EconChartType>('nfp');
  const [period, setPeriod] = useState<string>('ALL');
  // S&P500 を取得する目的で risk-history を共有 fetch (RiskHistoryTab と SWR キャッシュ共有)。
  // months=350 = ~29 年で NFP の DB 範囲 (1999-) と一致。
  const { data: histData } = useRiskHistory(350);
  const cd = useChartData(data, histData?.sp500);
  const config = getChartConfig(chartType, cd);
  const currentMeta = ECON_CHART_TYPES.find((c) => c.key === chartType)!;
  const stat = indicatorStat(chartType, cd);
  const detailChartRef = useRef<HTMLDivElement>(null);

  // Apply period viewport on the detail mode chart canvas via the
  // [data-chart-viewport] hidden button exposed by EconChartCanvas.
  const applyPeriod = useCallback((p: string) => {
    setPeriod(p);
    const container = detailChartRef.current;
    if (!container) return;
    const dataPts = config.series[0]?.data ?? [];
    if (dataPts.length === 0) return;
    const firstDate = dataPts[0].x;
    const lastDate = dataPts[dataPts.length - 1].x;
    let startDate = firstDate;
    if (p !== 'ALL') {
      const preset = INDICATOR_PERIODS.find((q) => q.name === p);
      const years = preset?.years ?? 1;
      const last = new Date(lastDate.length >= 10 ? lastDate.slice(0, 10) : lastDate);
      if (!isNaN(last.getTime())) {
        last.setFullYear(last.getFullYear() - years);
        const targetStr = last.toISOString().slice(0, 10);
        const idx = dataPts.findIndex((d) => d.x >= targetStr);
        startDate = idx >= 0 ? dataPts[idx].x : firstDate;
      }
    }
    const btn = container.querySelector('[data-chart-viewport]') as HTMLButtonElement | null;
    if (btn) {
      btn.setAttribute('data-start', startDate);
      btn.setAttribute('data-end', lastDate);
      btn.click();
    }
  }, [config]);

  // Reset period to ALL when chart type changes (so a fresh chart shows everything)
  useEffect(() => {
    setPeriod('ALL');
  }, [chartType]);

  return (
    <div className="space-y-3 plumb-animate-in">
      {/* ============ Toolbar (view mode toggle + period) ============ */}
      <div className="rounded-xl border border-neutral-200 bg-card p-3 md:p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="inline-flex items-center rounded-md border border-neutral-200 bg-white overflow-hidden">
          {[
            { v: 'overview' as IndicatorViewMode, label: '一覧' },
            { v: 'detail' as IndicatorViewMode, label: '詳細' },
          ].map((m, i) => {
            const isActive = viewMode === m.v;
            return (
              <button
                key={m.v}
                onClick={() => setViewMode(m.v)}
                className={`px-3.5 py-1.5 text-[11px] font-bold tracking-wider transition-colors ${
                  i > 0 ? 'border-l border-neutral-200' : ''
                } ${
                  isActive ? 'bg-[var(--brand-100)] text-[var(--brand-700)]' : 'text-neutral-700 hover:bg-neutral-50'
                }`}
              >{m.label}</button>
            );
          })}
        </div>

        {/* Period selector — only for detail mode */}
        {viewMode === 'detail' && (
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-neutral-500">期間</span>
            <div className="inline-flex items-center rounded-md border border-neutral-200 bg-white overflow-hidden">
              {INDICATOR_PERIODS.map((qr, i) => {
                const isActive = period === qr.name;
                return (
                  <button
                    key={qr.name}
                    onClick={() => applyPeriod(qr.name)}
                    className={`px-3.5 py-1.5 text-[11px] font-bold tracking-wider transition-colors ${
                      i > 0 ? 'border-l border-neutral-200' : ''
                    } ${
                      isActive
                        ? 'bg-[var(--brand-100)] text-[var(--brand-700)]'
                        : 'text-neutral-700 hover:bg-neutral-50'
                    }`}
                  >{qr.name}</button>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-[11px] text-neutral-500 ml-auto hidden md:block">
          {viewMode === 'overview'
            ? '7 指標を一覧表示。タイルクリックで詳細へ'
            : 'チャート上でドラッグ/スクロールでズーム・パン'}
        </p>
      </div>

      {/* ============ OVERVIEW MODE: 7 mini tile grid ============ */}
      {viewMode === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {ECON_CHART_TYPES.map((ct) => {
            const cfg = getChartConfig(ct.key, cd);
            const tStat = indicatorStat(ct.key, cd);
            const isEmpty = cfg.series.length === 0 || cfg.series[0].data.length === 0;
            const open = () => { setChartType(ct.key); setViewMode('detail'); };
            return (
              <div
                key={ct.key}
                role="button"
                tabIndex={0}
                onClick={open}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
                className="cursor-pointer text-left rounded-xl border border-neutral-200 bg-card hover:border-[var(--brand-400)] hover:shadow-[0_0_0_3px_var(--brand-100)] focus:outline-none focus:border-[var(--brand-500)] transition-all overflow-hidden"
              >
                {/* Tile header */}
                <div className="px-4 pt-3.5 pb-2 flex items-start justify-between gap-3 border-b border-neutral-100">
                  <div className="min-w-0">
                    <h4 className="text-[13px] font-bold text-foreground tracking-tight truncate">{ct.label}</h4>
                    <p className="text-[10px] text-neutral-500 mt-0.5 truncate">{ct.sub}</p>
                  </div>
                  {tStat && (
                    <div className="shrink-0 text-right">
                      <p className="text-[16px] leading-none font-bold tabular-nums text-foreground">{tStat.value}</p>
                      {tStat.delta != null && (
                        <p className={`text-[10px] font-bold tabular-nums mt-1 ${
                          tStat.delta >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'
                        }`}>
                          {tStat.delta >= 0 ? '+' : ''}{tStat.delta.toFixed(1)}{tStat.deltaUnit ?? '%'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {/* Mini chart */}
                <div className="px-2 py-1">
                  {isEmpty ? (
                    <div className="h-[180px] flex items-center justify-center text-[11px] text-neutral-400">データなし</div>
                  ) : (
                    <EconChartCanvas
                      series={cfg.series}
                      referenceLines={cfg.referenceLines}
                      backgroundZones={cfg.backgroundZones}
                      yAxisFormat={cfg.yAxisFormat}
                      yAxisRightFormat={cfg.yAxisRightFormat}
                      height={200}
                      initialShowAll
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ============ DETAIL MODE: Single chart + segmented bar ============ */}
      {viewMode === 'detail' && (
        <>
          {/* Chart type segmented bar */}
          <div className="rounded-xl border border-neutral-200 bg-card overflow-hidden">
            <div className="flex overflow-x-auto scrollbar-hide">
              {ECON_CHART_TYPES.map((ct, i) => {
                const isActive = chartType === ct.key;
                return (
                  <button
                    key={ct.key}
                    onClick={() => setChartType(ct.key)}
                    className={`flex-1 min-w-[120px] px-4 py-2.5 text-[12px] font-medium whitespace-nowrap relative transition-colors ${
                      i > 0 ? 'border-l border-neutral-200' : ''
                    } ${
                      isActive ? 'text-[var(--brand-700)] bg-[var(--brand-100)]/40' : 'text-neutral-700 hover:bg-neutral-50'
                    }`}
                  >
                    {ct.label}
                    {isActive && <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-[var(--brand-500)]" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main chart card */}
          <div className="rounded-xl border border-neutral-200 bg-card">
            {/* Header */}
            <div className="flex flex-wrap items-end justify-between gap-4 p-5 pb-3 border-b border-neutral-100">
              <div>
                <h3 className="text-[18px] font-bold text-foreground tracking-tight">{currentMeta.label}</h3>
                <p className="text-[11px] text-neutral-500 mt-1">{currentMeta.sub}</p>
              </div>
              {stat && (
                <div className="flex items-end gap-3">
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-[0.15em] text-neutral-500 font-medium">直近値</p>
                    <p className="text-[24px] leading-none font-bold tabular-nums text-foreground mt-1">{stat.value}</p>
                  </div>
                  {stat.delta != null && (
                    <div className={`px-2.5 py-1 rounded-md text-[11px] font-bold tabular-nums border ${
                      stat.delta >= 0
                        ? 'text-[var(--signal-safe-500)] bg-[var(--signal-safe-100)] border-[var(--signal-safe-300)]/40'
                        : 'text-[var(--signal-danger-500)] bg-[var(--signal-danger-100)] border-[var(--signal-danger-300)]/50'
                    }`}>
                      {stat.delta >= 0 ? '+' : ''}{stat.delta.toFixed(1)}{stat.deltaUnit ?? '%'}
                      <span className="ml-1 font-normal text-[9px] uppercase tracking-wider opacity-70">期間</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Canvas — key forces remount on chart type change so initialShowAll re-applies */}
            <div className="p-4 md:p-5" ref={detailChartRef}>
              {config.series.length === 0 || config.series[0].data.length === 0 ? (
                <div className="h-[420px] flex items-center justify-center text-sm text-neutral-500">データが不足しています</div>
              ) : (
                <EconChartCanvas
                  key={chartType}
                  series={config.series}
                  referenceLines={config.referenceLines}
                  backgroundZones={config.backgroundZones}
                  yAxisFormat={config.yAxisFormat}
                  yAxisRightFormat={config.yAxisRightFormat}
                  height={420}
                  initialShowAll
                />
              )}
            </div>
            {/* Footer */}
            <div className="px-5 pb-4 pt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-500">
              <span className="font-medium">出典: FRED, BLS, ミシガン大学</span>
              <span>更新: {new Date(data.timestamp).toLocaleDateString('ja-JP')}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// TAB 3: System Docs
// ============================================================

function SystemDocsTab() {
  return (
    <div className="space-y-3 plumb-animate-in">
      <DocSection title="システム概要" defaultOpen>
        <p>米国経済の「リセッションリスク」を0-100で数値化し、投資行動を制御するシステム。</p>
        <p className="mt-2">
          <strong>総合スコア = 雇用 (50点) + 消費 (25点) + 構造 (25点)</strong>
        </p>
        <p className="mt-2">FRED APIから自動取得した経済指標で計算。バックテスト勝率: 減速期(21-40)で買い = 勝率81%, 平均+8.4%/6ヶ月。</p>
        <DocTable headers={['カテゴリ', '配点', '役割']}
          rows={[
            ['雇用', '50点', '最重要。NFPトレンド・サームルール・失業保険水準・雇用矛盾'],
            ['消費', '25点', '消費者動向。実質個人所得・消費者信頼感・クレカ延滞率・賃金'],
            ['構造', '25点', '労働市場の質。求人倍率・U6-U3スプレッド・労働参加率'],
          ]} />
      </DocSection>

      <DocSection title="雇用カテゴリ (50点)">
        <DocTable headers={['コンポーネント', '配点', '閾値']}
          rows={[
            ['NFPトレンド', '25点', '>200K=0, 150-200K=5, 100-150K=10, 50-100K=15, 0-50K=20, <0=25'],
            ['サームルール', '15点', '>=0.5=15(発動), 0.3-0.5=8, 0.15-0.3=4, <0.15=0'],
            ['失業保険', '5点', '4W平均: >=300K=5, 250-300K=3, 220-250K=1, <220K=0'],
            ['雇用矛盾', '5点', 'NFP下方修正: 2回以上=5, 1回=2, 正常=0'],
          ]} />
      </DocSection>

      <DocSection title="消費カテゴリ (25点)">
        <DocTable headers={['コンポーネント', '配点', 'データソース', '閾値']}
          rows={[
            ['実質個人所得', '10点', 'W875RX1 YoY%', '>=3%=0, 1-3%=3, 0-1%=6, <0%=10'],
            ['消費者信頼感', '5点', 'UMCSENT', '>=80=0, 70-80=1, 60-70=3, <60=5'],
            ['クレカ延滞率', '5点', 'DRCCLACBS YoY変化', '<+0.2pp=0, 0.2-0.5=1, 0.5-1.0=3, >=1.0=5'],
            ['賃金圧力', '5点', 'MoM%', 'マイナス=3, >0.5%=2, 正常=0'],
          ]} />
      </DocSection>

      <DocSection title="構造カテゴリ (25点)">
        <DocTable headers={['コンポーネント', '配点', '閾値']}
          rows={[
            ['求人倍率', '15点', 'JOLTS/失業者数: >=1.2=0, 1.0-1.2=5, 0.8-1.0=10, <0.8=15'],
            ['U6-U3スプレッド', '5点', '>=5.0%=5, 4.5-5.0=3, 4.0-4.5=1, <4.0=0'],
            ['労働参加率', '5点', '<62%=5, 62-62.5%=3, 62.5-63%=1, >63%=0'],
          ]} />
      </DocSection>

      <DocSection title="5フェーズ分類">
        <DocTable headers={['スコア', 'フェーズ', 'ポジション上限', '行動指針']}
          rows={[
            ['0-20', '拡大期 (EXPANSION)', '80%', '過熱警戒。利確・回転を意識'],
            ['21-40', '減速期 (SLOWDOWN)', '100%', '最良の買い場。積極投資OK'],
            ['41-60', '警戒期 (CAUTION)', '70%', '現物のみ。新規抑制'],
            ['61-80', '収縮期 (CONTRACTION)', '40%', '信用取引禁止。最も危険'],
            ['81-100', '危機 (CRISIS)', '60%', '底値圏。分割で現物仕込み'],
          ]} />
        <p className="mt-2 text-amber-600 dark:text-amber-400">
          ※ SLOWDOWNが100%なのはバックテストで最高リターン(+8.4%/6mo)を記録したため。CRISISの60%は底値圏での逆張り用。
        </p>
      </DocSection>

      <DocSection title="サームルール">
        <p>
          <strong>計算</strong>: 失業率(U3)の3ヶ月移動平均 − 過去12ヶ月の最低値の3ヶ月移動平均
        </p>
        <p className="mt-2">
          この値が <strong>0.5%以上</strong> になった場合、景気後退入りと判定（過去の景気後退を100%的中）。
        </p>
        <p className="mt-2">
          発動時は警告フラグとして表示。ピークアウト検知（前月比でSahm値が低下）により回復の兆しも判定。
        </p>
      </DocSection>

      <DocSection title="システムの限界">
        <DocTable headers={['限界', '説明']}
          rows={[
            ['遅行指標', '雇用データは景気サイクルの遅行段階で悪化するため、先行的な警告には限界あり'],
            ['急激なショック', 'コロナ型の急落やブラックスワンイベントは月次データでは検知不可'],
            ['金融政策起因', '2022年型（金利急上昇による株安）は直接的に検知できない'],
            ['月次更新', 'NFP発表日まで更新されないため、リアルタイム対応は不可能'],
          ]} />
      </DocSection>

      <DocSection title="データ更新スケジュール">
        <DocTable headers={['データ', '頻度', 'ソース']}
          rows={[
            ['NFP (雇用統計)', '月次', 'FRED: PAYEMS (BLS 毎月第1金曜)'],
            ['失業率 U3/U6', '月次', 'FRED: UNRATE, U6RATE'],
            ['平均時給', '月次', 'FRED: CES0500000003'],
            ['労働参加率', '月次', 'FRED: CIVPART'],
            ['JOLTS求人件数', '月次', 'FRED: JTSJOL'],
            ['失業者数', '月次', 'FRED: UNEMPLOY'],
            ['新規失業保険申請', '週次', 'FRED: ICSA (毎週木曜)'],
            ['実質個人所得', '月次', 'FRED: W875RX1'],
            ['消費者信頼感', '月次', 'FRED: UMCSENT (ミシガン大学)'],
            ['クレカ延滞率', '四半期', 'FRED: DRCCLACBS'],
          ]} />
      </DocSection>
    </div>
  );
}

// ============================================================
// Loading & Error
// ============================================================

function LoadingSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <div className="space-y-2"><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-80" /></div>
        <Skeleton className="h-9 w-20" />
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-56 w-full rounded-2xl" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-xl" />)}
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-5">
        <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
      </div>
      <h2 className="text-lg font-bold mb-2 text-foreground">データ取得エラー</h2>
      <p className="text-sm text-muted-foreground mb-5 text-center max-w-md">{error}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>再試行</Button>
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================

export default function EmploymentPage() {
  return (
    <AuthGuard>
      <EmploymentContent />
    </AuthGuard>
  );
}

function EmploymentContent() {
  const { data, error: riskError, isLoading, isValidating, mutate } = useEmploymentRiskScore();

  const refreshing = isValidating && !isLoading;
  const handleRefresh = () => mutate();

  if (isLoading) return <LoadingSkeleton />;
  if (riskError) return <ErrorState error={riskError instanceof Error ? riskError.message : 'データの取得に失敗しました'} onRetry={handleRefresh} />;
  if (!data || !data.phase || !data.categories || !data.sahm_rule) {
    return <ErrorState error="データ構造が不正です。再取得してください。" onRetry={handleRefresh} />;
  }

  return (
    <div className="space-y-4 pb-10">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 plumb-animate-in">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-blue-500 to-orange-500" />
            <h1 className="text-2xl font-bold tracking-tight">米国景気リスク評価モニター</h1>
          </div>
          <p className="text-xs text-muted-foreground pl-3.5">雇用・消費・構造指標による5段階リセッションリスク評価</p>
        </div>
        <div className="flex items-center gap-4">
          <ScoreLegend />
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} className="text-xs font-mono">
            {refreshing ? (
              <span className="flex items-center gap-1.5">
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                更新中
              </span>
            ) : '更新'}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="dashboard" className="plumb-tabs">
        <TabsList variant="line" className="plumb-glass rounded-lg px-1 py-0.5 w-full justify-start border-none">
          <TabsTrigger value="dashboard" className="text-[11px] font-mono uppercase tracking-wider"><LayoutDashboard className="w-3.5 h-3.5 mr-1.5" />ダッシュボード</TabsTrigger>
          <TabsTrigger value="risk-history" className="text-[11px] font-mono uppercase tracking-wider"><History className="w-3.5 h-3.5 mr-1.5" />過去リスクスコア履歴</TabsTrigger>
          <TabsTrigger value="indicators" className="text-[11px] font-mono uppercase tracking-wider"><LineChart className="w-3.5 h-3.5 mr-1.5" />指標グラフ</TabsTrigger>
          <TabsTrigger value="docs" className="text-[11px] font-mono uppercase tracking-wider"><BookOpen className="w-3.5 h-3.5 mr-1.5" />システム解説</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <DashboardTab data={data} />
        </TabsContent>

        <TabsContent value="risk-history">
          <RiskHistoryTab realtimeScore={data.total_score} realtimePhase={phaseForScore(data.total_score)} />
        </TabsContent>

        <TabsContent value="indicators">
          <IndicatorChartsTab data={data} />
        </TabsContent>

        <TabsContent value="docs">
          <SystemDocsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
