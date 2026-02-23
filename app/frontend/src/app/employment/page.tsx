'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { getEmploymentRiskScore, getRiskHistory } from '@/lib/api';
import {
  scoreHue, scoreLabel,
  GlassCard, ScoreRing, GaugeBar, StatusChip, ScoreLegend, DocSection, DocTable,
} from '@/components/shared/glass';
import EconChartCanvas from '@/components/charts/EconChartCanvas';
import type { ChartSeries, ChartReferenceLine, ChartBackgroundZone, ChartEventMarker } from '@/components/charts/EconChartCanvas';
import type { EmploymentRiskScore, RiskScoreCategory, RiskHistoryResponse } from '@/types';

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
            {categories.map((cat) => {
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
        {sahm_rule.triggered && (
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
  const sahm = sahm_rule.sahm_value;

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
      <div className="grid gap-4 lg:grid-cols-3">
        <CategoryCard category={data.categories[0]} number="CAT 1" color="blue" stagger={3} />
        {data.categories[1] && <CategoryCard category={data.categories[1]} number="CAT 2" color="amber" stagger={4} />}
        {data.categories[2] && <CategoryCard category={data.categories[2]} number="CAT 3" color="purple" stagger={5} />}
      </div>
      <SahmRulePanel sahm={data.sahm_rule} />
      {data.alert_factors.length > 0 && (
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
  { date: '2001-03', label: 'ITバブル崩壊', color: 'rgba(239,68,68,0.5)' },
  { date: '2008-09', label: 'リーマンショック', color: 'rgba(239,68,68,0.5)' },
  { date: '2011-08', label: '米国債格下げ', color: 'rgba(234,179,8,0.4)' },
  { date: '2020-03', label: 'COVID-19', color: 'rgba(239,68,68,0.5)' },
  { date: '2022-03', label: 'FRB利上げ開始', color: 'rgba(234,179,8,0.4)' },
  { date: '2024-08', label: 'Sahmトリガー', color: 'rgba(249,115,22,0.4)' },
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
  { year: '2001', avgScore: 46, range: '16-59', phase: 'EXPANSION→CAUTION', scores: 'E=31 C=0 S=13',
    situation: 'ITバブル崩壊。NASDAQ -78%。9/11テロ。3月にNBERがリセッション認定。',
    verdict: 'H1のEXPANSIONからCAUTION(59pt)へ急速悪化。C=0は前年データ不足(2000年未取得)による制約' },
  { year: '2002', avgScore: 62, range: '47-73', phase: 'CAUTION→CONTRACTION', scores: 'E=39 C=7 S=13',
    situation: 'エンロン・ワールドコム破綻。企業会計スキャンダル。ダブルディップ懸念。',
    verdict: 'CONTRACTION(73pt)到達。雇用悪化(E=39)と消費悪化(C=7)の同時検出。実際の景気後退期' },
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
  { yMin: 0, yMax: 20, color: 'rgba(16,185,129,0.06)' },
  { yMin: 20, yMax: 40, color: 'rgba(6,182,212,0.06)' },
  { yMin: 40, yMax: 60, color: 'rgba(234,179,8,0.06)' },
  { yMin: 60, yMax: 80, color: 'rgba(249,115,22,0.06)' },
  { yMin: 80, yMax: 100, color: 'rgba(239,68,68,0.06)' },
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

  // Map year → event labels from chart markers
  const eventByYear = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const ev of ECONOMIC_EVENTS) {
      const y = ev.date.slice(0, 4);
      if (!map[y]) map[y] = [];
      map[y].push(ev.label);
    }
    return map;
  }, []);

  return (
    <GlassCard>
      <div className="p-5 space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-3">年別バックテスト解説</h3>
        <div className="space-y-1">
          {YEAR_ANALYSIS.map((ya) => {
            const phases = ya.phase.split('→').map(p => p.trim());
            const isOpen = expanded === ya.year;
            const events = eventByYear[ya.year];
            return (
              <div key={ya.year}>
                <button
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
                  onClick={() => setExpanded(isOpen ? null : ya.year)}
                >
                  <span className="shrink-0 w-10 text-center">
                    <span className="text-sm font-bold font-mono block">{ya.year}</span>
                    {events && events.map((e: string, i: number) => (
                      <span key={i} className="text-[8px] text-red-500 dark:text-red-400 font-bold block leading-tight">{e}</span>
                    ))}
                  </span>
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

function RiskHistoryTab() {
  const [histData, setHistData] = useState<RiskHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSP500, setShowSP500] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRiskHistory(300);
      setHistData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データ取得失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const handleShowAll = useCallback(() => {
    const container = chartRef.current;
    const h = histData?.history;
    if (!container || !h || h.length === 0) return;
    const btn = container.querySelector('[data-chart-viewport]') as HTMLButtonElement | null;
    if (btn) {
      btn.setAttribute('data-start', h[0].date);
      btn.setAttribute('data-end', h[h.length - 1].date);
      btn.click();
    }
  }, [histData]);

  if (loading) return <div className="flex items-center justify-center py-24"><Skeleton className="h-[400px] w-full rounded-xl" /></div>;
  if (error) return <div className="flex flex-col items-center justify-center py-24 text-sm text-muted-foreground">{error}<Button variant="outline" size="sm" className="mt-3" onClick={fetchHistory}>再試行</Button></div>;
  if (!histData || histData.history.length === 0) return <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">リスク履歴データがありません</div>;

  const series: ChartSeries[] = [
    {
      data: histData.history.map((h) => ({ x: h.date, y: h.total_score })),
      type: 'line', color: '#ef4444', label: 'リスクスコア',
    },
  ];

  if (showSP500 && histData.sp500.length > 0) {
    series.push({
      data: histData.sp500.map((s) => ({ x: s.date, y: s.close })),
      type: 'line', color: '#10b981', label: 'S&P 500',
      yAxisSide: 'right',
    });
  }

  const refLines: ChartReferenceLine[] = [
    { y: 20, color: 'rgba(16,185,129,0.3)', label: 'EXPANSION', dashed: true },
    { y: 40, color: 'rgba(6,182,212,0.3)', label: 'SLOWDOWN', dashed: true },
    { y: 60, color: 'rgba(234,179,8,0.3)', label: 'CAUTION', dashed: true },
    { y: 80, color: 'rgba(249,115,22,0.3)', label: 'CONTRACTION', dashed: true },
  ];

  return (
    <div className="space-y-4 plumb-animate-in">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground plumb-glass rounded-lg px-3 py-1.5 cursor-pointer">
          <input type="checkbox" checked={showSP500} onChange={(e) => setShowSP500(e.target.checked)}
            className="w-3 h-3 rounded accent-emerald-500" />
          S&P 500
        </label>
        <Button variant="outline" size="sm" className="text-[11px] font-mono h-7" onClick={handleShowAll}>
          ズームリセット
        </Button>
      </div>

      <GlassCard>
        <div className="p-5" ref={chartRef}>
          <EconChartCanvas
            series={series}
            referenceLines={refLines}
            backgroundZones={RISK_BG_ZONES}
            eventMarkers={ECONOMIC_EVENTS}
            yAxisFormat={(v) => `${Math.round(v)}`}
            yAxisRightFormat={(v) => v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v)}`}
            height={420}
          />
        </div>
      </GlassCard>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_RANGES.map((qr) => (
          <Button key={qr.name} variant="outline" size="sm" className="text-[11px] font-mono h-7 px-3"
            onClick={() => {
              const container = chartRef.current;
              if (!container) return;
              if (!qr.months && !qr.start) {
                handleShowAll();
                return;
              }
              if (qr.months) {
                const h = histData?.history;
                if (!h || h.length === 0) return;
                const endIdx = h.length;
                const startIdx = Math.max(0, endIdx - qr.months);
                const btn = container.querySelector('[data-chart-viewport]') as HTMLButtonElement | null;
                if (btn) {
                  btn.setAttribute('data-start', h[startIdx].date);
                  btn.setAttribute('data-end', h[endIdx - 1].date);
                  btn.click();
                }
                return;
              }
              if (qr.start && qr.end) {
                const btn = container.querySelector('[data-chart-viewport]') as HTMLButtonElement | null;
                if (btn) {
                  btn.setAttribute('data-start', qr.start);
                  btn.setAttribute('data-end', qr.end);
                  btn.click();
                }
              }
            }}>
            {qr.name}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-1">
        {[
          { label: '拡大期', range: '0-20', color: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' },
          { label: '減速期', range: '21-40', color: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400' },
          { label: '警戒期', range: '41-60', color: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' },
          { label: '収縮期', range: '61-80', color: 'bg-orange-500/20 text-orange-600 dark:text-orange-400' },
          { label: '危機', range: '81-100', color: 'bg-red-500/20 text-red-600 dark:text-red-400' },
        ].map((p) => (
          <div key={p.label} className={`rounded-lg px-2 py-1.5 text-center text-[10px] font-mono ${p.color}`}>
            <div className="font-bold">{p.label}</div>
            <div className="opacity-70">{p.range}</div>
          </div>
        ))}
      </div>

      {/* Year-by-year analysis */}
      <YearByYearAnalysis />

      <p className="text-[10px] text-muted-foreground text-center">
        ※ 過去スコアは雇用乖離・インフレ乖離を含まないため、リアルタイムスコアより低めに表示されます
      </p>
    </div>
  );
}

// ============================================================
// TAB 3: Indicator Charts (Canvas)
// ============================================================

type EconChartType = 'nfp' | 'unemployment' | 'claims' | 'wages' | 'sahm' | 'sentiment' | 'income';

const ECON_CHART_TYPES: { key: EconChartType; label: string }[] = [
  { key: 'nfp', label: 'NFP推移' },
  { key: 'unemployment', label: '失業率' },
  { key: 'claims', label: '失業保険' },
  { key: 'wages', label: '賃金' },
  { key: 'sahm', label: 'Sahm Rule' },
  { key: 'sentiment', label: '消費者信頼感' },
  { key: 'income', label: '実質個人所得' },
];

function useChartData(data: EmploymentRiskScore) {
  const nfpChron = [...data.nfp_history].reverse();
  const claimsChron = [...data.claims_history].reverse();

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

  return { nfpChron, claimsChron, sentimentChron, incomeChron, sahmChartData, nfpWithAvg };
}

function getChartConfig(chartType: EconChartType, cd: ReturnType<typeof useChartData>): {
  series: ChartSeries[];
  referenceLines?: ChartReferenceLine[];
  yAxisFormat?: (v: number) => string;
  yAxisRightFormat?: (v: number) => string;
} {
  switch (chartType) {
    case 'nfp':
      return {
        series: [
          { data: cd.nfpWithAvg.map((d) => ({ x: d.reference_period, y: d.nfp_change })), type: 'bar', color: '#3b82f6', label: 'NFP変化 (K)' },
          { data: cd.nfpWithAvg.map((d) => ({ x: d.reference_period, y: d.nfp_3m_avg })), type: 'line', color: '#f59e0b', label: '3ヶ月平均' },
        ],
        referenceLines: [
          { y: 0, color: 'rgba(239,68,68,0.4)', dashed: false },
          { y: 100, color: 'rgba(251,191,36,0.3)', label: '100K' },
        ],
        yAxisFormat: (v) => `${Math.round(v)}K`,
      };
    case 'unemployment':
      return {
        series: [
          { data: cd.nfpChron.map((d) => ({ x: d.reference_period, y: d.u3_rate })), type: 'area', color: '#3b82f6', label: 'U3 失業率' },
          { data: cd.nfpChron.map((d) => ({ x: d.reference_period, y: d.u6_rate })), type: 'line', color: '#a855f7', label: 'U6 実質失業率', dashed: true },
        ],
        referenceLines: [
          { y: 4.5, color: 'rgba(251,191,36,0.3)', label: '警戒 4.5%' },
          { y: 5.0, color: 'rgba(239,68,68,0.3)', label: '危険 5.0%' },
        ],
        yAxisFormat: (v) => `${v.toFixed(1)}%`,
      };
    case 'claims':
      return {
        series: [
          { data: cd.claimsChron.map((d) => ({ x: d.week_ending, y: d.initial_claims })), type: 'area', color: '#06b6d4', label: '新規申請' },
          { data: cd.claimsChron.map((d) => ({ x: d.week_ending, y: d.initial_claims_4w_avg })), type: 'line', color: '#f59e0b', label: '4W移動平均' },
          { data: cd.claimsChron.map((d) => ({ x: d.week_ending, y: d.continued_claims })), type: 'line', color: '#a855f7', label: '継続申請', dashed: true, yAxisSide: 'right' },
        ],
        referenceLines: [
          { y: 250000, color: 'rgba(251,191,36,0.3)', label: '250K' },
          { y: 300000, color: 'rgba(239,68,68,0.3)', label: '300K' },
        ],
        yAxisFormat: (v) => `${(v / 1000).toFixed(0)}K`,
        yAxisRightFormat: (v) => `${(v / 1000).toFixed(0)}K`,
      };
    case 'wages':
      return {
        series: [
          { data: cd.nfpChron.map((d) => ({ x: d.reference_period, y: d.avg_hourly_earnings })), type: 'area', color: '#10b981', label: '平均時給 ($)' },
          { data: cd.nfpChron.map((d) => ({ x: d.reference_period, y: d.wage_mom })), type: 'line', color: '#f97316', label: '賃金MoM (%)', dashed: true, yAxisSide: 'right' },
        ],
        yAxisFormat: (v) => `$${v.toFixed(1)}`,
        yAxisRightFormat: (v) => `${v.toFixed(2)}%`,
      };
    case 'sahm':
      return {
        series: [
          { data: cd.sahmChartData.map((d) => ({ x: d.period, y: d.sahm_value })), type: 'area', color: '#f97316', label: 'Sahm値' },
        ],
        referenceLines: [
          { y: 0.3, color: 'rgba(251,191,36,0.4)', label: '警戒 0.3' },
          { y: 0.5, color: 'rgba(239,68,68,0.5)', label: '発動 0.5' },
        ],
        yAxisFormat: (v) => v.toFixed(2),
      };
    case 'sentiment':
      return {
        series: [
          { data: cd.sentimentChron.map((d) => ({ x: d.reference_period, y: d.current_value })), type: 'area', color: '#f59e0b', label: 'UMCSENT' },
        ],
        referenceLines: [
          { y: 80, color: 'rgba(16,185,129,0.3)', label: '良好 80' },
          { y: 70, color: 'rgba(251,191,36,0.3)', label: '警戒 70' },
          { y: 60, color: 'rgba(239,68,68,0.4)', label: '危険 60' },
        ],
      };
    case 'income': {
      const filtered = cd.incomeChron.filter((d) => d.yoy != null);
      return {
        series: [
          { data: filtered.map((d) => ({ x: d.reference_period, y: d.yoy })), type: 'area', color: '#8b5cf6', label: '実質個人所得 YoY (%)' },
        ],
        referenceLines: [
          { y: 0, color: 'rgba(239,68,68,0.4)', dashed: false },
          { y: 1, color: 'rgba(251,191,36,0.3)', label: '警戒 1%' },
          { y: 3, color: 'rgba(16,185,129,0.3)', label: '良好 3%' },
        ],
        yAxisFormat: (v) => `${v.toFixed(1)}%`,
      };
    }
    default:
      return { series: [] };
  }
}

function IndicatorChartsTab({ data }: { data: EmploymentRiskScore }) {
  const [chartType, setChartType] = useState<EconChartType>('nfp');
  const cd = useChartData(data);
  const config = getChartConfig(chartType, cd);

  if (config.series.length === 0 || config.series[0].data.length === 0) {
    return <div className="h-[400px] flex items-center justify-center text-sm text-muted-foreground">データが不足しています</div>;
  }

  return (
    <div className="space-y-4 plumb-animate-in">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 plumb-glass rounded-lg p-1 overflow-x-auto">
          {ECON_CHART_TYPES.map((ct) => (
            <button key={ct.key} onClick={() => setChartType(ct.key)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-medium whitespace-nowrap transition-colors ${
                chartType === ct.key ? 'bg-black/[0.06] dark:bg-white/[0.08] text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}>{ct.label}</button>
          ))}
        </div>
      </div>

      <GlassCard>
        <div className="p-5">
          <EconChartCanvas
            series={config.series}
            referenceLines={config.referenceLines}
            yAxisFormat={config.yAxisFormat}
            yAxisRightFormat={config.yAxisRightFormat}
            height={400}
          />
        </div>
      </GlassCard>
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
  const [data, setData] = useState<EmploymentRiskScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const riskScore = await getEmploymentRiskScore();
      setData(riskScore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState error={error} onRetry={() => fetchData()} />;
  if (!data) return null;

  return (
    <div className="space-y-4 pb-10">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 plumb-animate-in">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-blue-500 to-orange-500" />
            <h1 className="text-2xl font-bold tracking-tight">米国景気警戒システム</h1>
          </div>
          <p className="text-xs text-muted-foreground pl-3.5">雇用・消費・構造指標による5段階リセッションリスク評価</p>
        </div>
        <div className="flex items-center gap-4">
          <ScoreLegend />
          <Button variant="outline" size="sm" onClick={() => fetchData(true)} disabled={refreshing} className="text-xs font-mono">
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
          <TabsTrigger value="dashboard" className="text-[11px] font-mono uppercase tracking-wider">ダッシュボード</TabsTrigger>
          <TabsTrigger value="risk-history" className="text-[11px] font-mono uppercase tracking-wider">過去リスクスコア履歴</TabsTrigger>
          <TabsTrigger value="indicators" className="text-[11px] font-mono uppercase tracking-wider">指標グラフ</TabsTrigger>
          <TabsTrigger value="docs" className="text-[11px] font-mono uppercase tracking-wider">システム解説</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <DashboardTab data={data} />
        </TabsContent>

        <TabsContent value="risk-history">
          <RiskHistoryTab />
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
