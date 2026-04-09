'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LayoutDashboard, LineChart, FlaskConical, BookOpen } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import EconChartCanvas from '@/components/charts/EconChartCanvas';
import type { ChartSeries, ChartReferenceLine, ChartEventMarker } from '@/components/charts/EconChartCanvas';
import { usePlumbingSummary, useHistoryCharts, useBacktestStates, useMarketEvents, usePolicyRegime } from '@/lib/api';
import { AuthGuard } from '@/components/providers/AuthGuard';
import {
  scoreHue, scoreLabel,
  GlassCard, ScoreRing, GaugeBar, Metric, StatusChip, ScoreLegend, DocSection, DocTable,
} from '@/components/shared/glass';
import type {
  PlumbingSummary, LayerStress, CreditPressure, MarketStateInfo,
  MarketEventsData, PolicyRegimeData,
} from '@/types';

// ============================================================
// Liquidity-specific Helpers
// ============================================================

function fmt(v: number | null | undefined, d = 0): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtB(v: number | null | undefined): string {
  if (v == null) return '—';
  return `$${fmt(v, 0)}B`;
}
function fmtPct(v: number | null | undefined, d = 2): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;
}
function fmtPctNoSign(v: number | null | undefined, d = 2): string {
  if (v == null) return '—';
  return `${v.toFixed(d)}%`;
}

function stateColors(color: string) {
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
function sensorDot(status: string): string {
  if (status === 'danger') return 'bg-red-400 animate-pulse';
  if (status === 'warning') return 'bg-amber-400';
  return 'bg-emerald-400';
}

// ============================================================
// TAB 1: Dashboard (existing content)
// ============================================================

function MarketStateHero({ state, l1, l2a, l2b }: {
  state: MarketStateInfo; l1: number; l2a: number; l2b: number;
}) {
  const c = stateColors(state.color);
  const isDanger = state.color === 'red' || state.color === 'orange';
  return (
    <div className={`relative rounded-2xl border ${c.border} overflow-hidden plumb-animate-scale`}>
      <div className={`absolute inset-0 ${c.bg}`} />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] rounded-full blur-[100px] opacity-20 plumb-glow"
        style={{ background: state.color === 'green' ? '#10b981' : state.color === 'red' ? '#ef4444' : state.color === 'orange' ? '#f97316' : state.color === 'yellow' ? '#eab308' : state.color === 'cyan' ? '#06b6d4' : '#71717a' }} />
      <div className="relative p-6 md:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${c.dot} ring-4 ring-current/10`} />
              <h2 className={`text-3xl md:text-4xl font-bold tracking-tight ${c.text}`}>{state.label}</h2>
            </div>
            {state.state_count > 1 && (
              <div className="flex flex-wrap gap-1.5 pl-6">
                {state.all_states.slice(1).map((s) => { const sc = stateColors(s.color); return (
                  <Badge key={s.code} variant="outline" className={`${sc.text} ${sc.border} text-[10px] font-mono`}>{s.label}</Badge>
                ); })}
              </div>
            )}
            <p className="text-sm text-muted-foreground max-w-lg leading-relaxed pl-6">{state.description}</p>
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium ml-6 ${isDanger ? 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20' : 'bg-muted text-muted-foreground border border-border'}`}>
              {state.action}
            </div>
          </div>
          <div className="flex items-center gap-6 lg:gap-8">
            {[
              { label: 'L1', sub: '政策', score: l1, accent: 'text-blue-600 dark:text-blue-400' },
              { label: 'L2A', sub: '銀行', score: l2a, accent: 'text-purple-600 dark:text-purple-400' },
              { label: 'L2B', sub: '市場', score: l2b, accent: 'text-cyan-600 dark:text-cyan-400' },
            ].map((item) => (
              <div key={item.label} className="text-center space-y-1">
                <ScoreRing score={item.score} size={72} strokeWidth={5} />
                <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${item.accent}`}>{item.label}</p>
                <p className="text-[10px] text-muted-foreground">{item.sub}</p>
              </div>
            ))}
          </div>
        </div>
        {state.comment && (
          <div className="mt-5 rounded-lg bg-black/[0.04] dark:bg-black/30 border border-black/[0.06] dark:border-white/[0.04] p-4 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed plumb-shimmer-bg">{state.comment}</div>
        )}
      </div>
    </div>
  );
}

function IndicatorBar({ indicators }: { indicators: { vix?: number; dxy?: number; sp500?: number; nasdaq?: number } | null }) {
  if (!indicators) return null;
  const vixColor = (v: number) => v > 30 ? 'text-red-600 dark:text-red-400' : v > 20 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';
  const dxyColor = (v: number) => v > 110 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground';
  const items = [
    { label: 'VIX', value: indicators.vix, format: (v: number) => v.toFixed(2), color: indicators.vix ? vixColor(indicators.vix) : '' },
    { label: 'DXY', value: indicators.dxy, format: (v: number) => v.toFixed(2), color: indicators.dxy ? dxyColor(indicators.dxy) : '' },
    { label: 'S&P 500', value: indicators.sp500, format: (v: number) => fmt(v), color: 'text-foreground' },
    { label: 'NASDAQ', value: indicators.nasdaq, format: (v: number) => fmt(v), color: 'text-foreground' },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 plumb-animate-in plumb-stagger-2">
      {items.map((item) => (
        <div key={item.label} className="plumb-glass rounded-lg px-4 py-3.5 flex items-center justify-between plumb-glass-hover">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{item.label}</span>
          <span className={`text-lg font-bold tabular-nums font-mono ${item.color}`}>
            {item.value != null ? item.format(item.value) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

function LayerHeader({ number, label, sub, color, score }: {
  number: string; label: string; sub: string; color: string; score: number;
}) {
  const h = scoreHue(score);
  return (
    <div className="p-5 pb-3">
      <div className="flex items-start justify-between">
        <div className="space-y-0.5">
          <p className={`text-[11px] font-bold uppercase tracking-[0.2em] ${color}`}>{number}</p>
          <h3 className="text-base font-bold text-foreground">{label}</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{sub}</p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <ScoreRing score={score} size={56} strokeWidth={4} />
          <Badge variant="outline" className={`text-[10px] ${h.text} ${h.border} font-mono`}>{scoreLabel(score)}</Badge>
        </div>
      </div>
      <GaugeBar score={score} className="mt-3" />
    </div>
  );
}

function Layer1Card({ layer }: { layer: LayerStress }) {
  const fed = layer.fed_data;
  const netLiq = layer.net_liquidity ?? 0;
  return (
    <GlassCard stagger={3} className="plumb-gradient-border before:bg-gradient-to-b before:from-blue-500/30 before:to-transparent">
      <LayerHeader number="LAYER 1" label="政策流動性" sub="元栓 — FRBバランスシート" color="text-blue-600 dark:text-blue-400" score={layer.stress_score} />
      <div className="px-5 pb-5 space-y-3">
        <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{layer.interpretation}</p>
        {fed && (<>
          <div className="rounded-lg bg-zinc-100/80 dark:bg-zinc-900/50 p-3 space-y-0.5">
            <Metric label="SOMA資産" value={fmtB(fed.soma_assets)} />
            <Metric label="準備預金" value={fmtB(fed.reserves)} />
            <Metric label="RRP" value={fmtB(fed.rrp)} />
            <Metric label="TGA" value={fmtB(fed.tga)} />
          </div>
          <div className="rounded-lg bg-blue-500/10 dark:bg-blue-500/[0.08] border border-blue-500/20 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] text-blue-700 dark:text-blue-300 uppercase tracking-wider font-medium">純流動性</p>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">SOMA − RRP − TGA</p>
              </div>
              <p className="text-xl font-bold tabular-nums font-mono text-blue-700 dark:text-blue-300">{fmtB(netLiq)}</p>
            </div>
            {layer.z_score != null && (
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-blue-500/15">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">Z-Score</span>
                <span className={`text-sm font-mono font-bold ${layer.z_score > 1 ? 'text-emerald-700 dark:text-emerald-300' : layer.z_score < -1 ? 'text-red-700 dark:text-red-300' : 'text-foreground'}`}>
                  {layer.z_score > 0 ? '+' : ''}{layer.z_score}
                </span>
              </div>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">UPD {fed.date}</p>
        </>)}
      </div>
    </GlassCard>
  );
}

function Layer2ACard({ layer }: { layer: LayerStress }) {
  const c = layer.components as Record<string, unknown> | undefined;
  return (
    <GlassCard stagger={4} className="plumb-gradient-border before:bg-gradient-to-b before:from-purple-500/30 before:to-transparent">
      <LayerHeader number="LAYER 2A" label="銀行システム" sub="銀行間流動性 — 準備預金・KRE・SRF" color="text-purple-600 dark:text-purple-400" score={layer.stress_score} />
      <div className="px-5 pb-5 space-y-3">
        <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{layer.interpretation}</p>
        {c && (
          <div className="rounded-lg bg-zinc-100/80 dark:bg-zinc-900/50 p-3 space-y-0.5">
            {c.reserves_value != null && (
              <Metric label="準備預金" value={fmtB(c.reserves_value as number)}>
                {c.reserves_change_mom != null && (
                  <StatusChip label={`${(c.reserves_change_mom as number) > 0 ? '+' : ''}${(c.reserves_change_mom as number).toFixed(1)}%`}
                    color={(c.reserves_change_mom as number) < 0 ? 'red' : 'green'} />
                )}
              </Metric>
            )}
            {c.kre_52w_change != null && (
              <Metric label="KRE 52W変化率" value={fmtPct(c.kre_52w_change as number, 1)}>
                <StatusChip label={(c.kre_52w_change as number) < -20 ? '危険' : (c.kre_52w_change as number) < -10 ? '警戒' : '安定'}
                  color={(c.kre_52w_change as number) < -20 ? 'red' : (c.kre_52w_change as number) < -10 ? 'amber' : 'green'} />
              </Metric>
            )}
            {c.srf_usage != null && <Metric label="SRF利用 (30日)" value={`$${fmt(c.srf_usage as number)}B`} />}
            {c.ig_spread != null && (
              <Metric label="IGスプレッド" value={fmtPctNoSign(c.ig_spread as number)}>
                <StatusChip label={(c.ig_spread as number) > 1.5 ? '拡大' : '正常'}
                  color={(c.ig_spread as number) > 1.5 ? 'red' : (c.ig_spread as number) > 1.0 ? 'amber' : 'green'} />
              </Metric>
            )}
          </div>
        )}
        {layer.alerts && layer.alerts.length > 0 && (
          <div className="space-y-1.5">
            {layer.alerts.map((alert, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 dark:bg-amber-500/[0.06] border border-amber-500/20">
                <span className="text-amber-600 dark:text-amber-400 text-[11px] mt-0.5 shrink-0">&#9650;</span>
                <span className="text-xs text-amber-800 dark:text-amber-200">{alert}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function Layer2BCard({ layer }: { layer: LayerStress }) {
  const itPct = layer.it_bubble_comparison ?? 0;
  return (
    <GlassCard stagger={5} className="plumb-gradient-border before:bg-gradient-to-b before:from-cyan-500/30 before:to-transparent">
      <LayerHeader number="LAYER 2B" label="リスク許容度" sub="蛇口 — 信用取引・MMF" color="text-cyan-600 dark:text-cyan-400" score={layer.stress_score} />
      <div className="px-5 pb-5 space-y-3">
        <div className="rounded-lg bg-zinc-100/80 dark:bg-zinc-900/50 p-3 space-y-0.5">
          {layer.margin_debt_2y != null && <Metric label="信用取引 2Y変化率" value={fmtPct(layer.margin_debt_2y, 1)} />}
          {layer.margin_debt_1y != null && <Metric label="信用取引 1Y変化率" value={fmtPct(layer.margin_debt_1y, 1)} />}
          {layer.components && (layer.components as Record<string, unknown>).mmf_change != null && (
            <Metric label="MMF 3M変化率" value={fmtPctNoSign((layer.components as Record<string, unknown>).mmf_change as number, 1)} sub="逆相関" />
          )}
          <p className="text-[10px] text-muted-foreground/60 pt-1">※ MMF増加＝資金がリスク資産から退避 → 株式にネガティブ</p>
        </div>
        {layer.it_bubble_comparison != null && (
          <div className="rounded-lg bg-zinc-100/80 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 tracking-wider font-medium">ITバブル比較 <span className="text-[10px] opacity-70">(信用取引残高対2Y変化率)</span></p>
              <span className={`text-base font-bold tabular-nums font-mono ${itPct >= 80 ? 'text-red-700 dark:text-red-300' : itPct >= 60 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                {itPct.toFixed(0)}%
              </span>
            </div>
            <div className="relative">
              <div className="flex h-3 rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-800/80">
                <div className="h-full bg-emerald-500/40 dark:bg-emerald-500/30" style={{ width: '50%' }} />
                <div className="h-full bg-yellow-500/40 dark:bg-yellow-500/30" style={{ width: '20%' }} />
                <div className="h-full bg-orange-500/40 dark:bg-orange-500/30" style={{ width: '20%' }} />
                <div className="h-full bg-red-500/40 dark:bg-red-500/30" style={{ width: '10%' }} />
              </div>
              <div className="absolute top-1/2 -translate-y-1/2 w-1 h-4 rounded-full bg-zinc-800 dark:bg-white shadow-lg shadow-black/20 dark:shadow-white/20 transition-all duration-1000"
                style={{ left: `${Math.min(itPct, 100)}%` }} />
            </div>
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-zinc-500 dark:text-zinc-400">0</span><span className="text-zinc-500 dark:text-zinc-400">50</span><span className="text-amber-600 dark:text-amber-400">70</span>
              <span className="text-red-600 dark:text-red-400">PEAK {layer.it_bubble_peak?.toFixed(0)}%</span>
            </div>
          </div>
        )}
        {layer.phase && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">フェーズ</span>
            <Badge variant="outline" className="text-[11px] text-cyan-700 dark:text-cyan-300 border-cyan-500/25 dark:border-cyan-500/20 font-mono">{layer.phase}</Badge>
          </div>
        )}
        {layer.data_date && <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">UPD {layer.data_date}</p>}
      </div>
    </GlassCard>
  );
}

function NetLiquidityFlow({ fed }: { fed: { soma_assets: number | null; rrp: number | null; tga: number | null } | undefined }) {
  if (!fed) return null;
  const soma = fed.soma_assets ?? 0, rrp = fed.rrp ?? 0, tga = fed.tga ?? 0;
  const net = soma - rrp - tga, max = soma || 1;
  const segments = [
    { label: 'SOMA', value: soma, pct: 100, color: 'border-blue-500/25 dark:border-blue-500/20 bg-blue-500/10 dark:bg-blue-500/[0.06]', accent: 'text-blue-700 dark:text-blue-300', op: '' },
    { label: 'RRP', value: rrp, pct: (rrp / max) * 100, color: 'border-orange-500/25 dark:border-orange-500/20 bg-orange-500/10 dark:bg-orange-500/[0.06]', accent: 'text-orange-700 dark:text-orange-300', op: '−' },
    { label: 'TGA', value: tga, pct: (tga / max) * 100, color: 'border-amber-500/25 dark:border-amber-500/20 bg-amber-500/10 dark:bg-amber-500/[0.06]', accent: 'text-amber-700 dark:text-amber-300', op: '−' },
    { label: 'NET', value: net, pct: (net / max) * 100, color: 'border-emerald-500/25 dark:border-emerald-500/20 bg-emerald-500/10 dark:bg-emerald-500/[0.06] ring-1 ring-emerald-500/15', accent: 'text-emerald-700 dark:text-emerald-300', op: '=' },
  ];
  return (
    <GlassCard stagger={6}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 rounded-full bg-blue-500" />
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">純流動性フロー</p>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">SOMA − RRP − TGA = Net</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {segments.map((s) => (
            <div key={s.label} className={`rounded-xl border p-4 ${s.color} plumb-flow-pipe transition-all duration-300 hover:scale-[1.02]`}>
              <div className="flex items-center gap-1.5 mb-2">
                {s.op && <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">{s.op}</span>}
                <p className={`text-[11px] font-bold uppercase tracking-wider ${s.accent}`}>{s.label}</p>
              </div>
              <p className={`text-xl font-bold tabular-nums font-mono ${s.accent}`}>{fmtB(s.value)}</p>
              <div className="mt-3 h-1.5 rounded-full bg-zinc-200/60 dark:bg-zinc-800/60 overflow-hidden">
                <div className="h-full rounded-full bg-current opacity-40 dark:opacity-30 plumb-gauge-bar" style={{ width: `${Math.min(Math.max(s.pct, 0), 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

function CreditPressurePanel({ credit }: { credit: CreditPressure }) {
  const levelColor = credit.level === 'High' ? 'text-red-700 dark:text-red-300' : credit.level === 'Medium' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300';
  const levelBg = credit.level === 'High' ? 'bg-red-500/12 dark:bg-red-500/10 border-red-500/25 dark:border-red-500/20' : credit.level === 'Medium' ? 'bg-amber-500/12 dark:bg-amber-500/10 border-amber-500/25 dark:border-amber-500/20' : 'bg-emerald-500/12 dark:bg-emerald-500/10 border-emerald-500/25 dark:border-emerald-500/20';
  const sensors = [
    { label: 'HYスプレッド', sub: 'ハイイールド債', value: credit.components.hy_spread?.value, format: fmtPctNoSign, status: credit.components.hy_spread?.status ?? 'normal', info: '> 5% 危険' },
    { label: 'IGスプレッド', sub: '投資適格債', value: credit.components.ig_spread?.value, format: fmtPctNoSign, status: credit.components.ig_spread?.status ?? 'normal', info: '> 1.5% 危険' },
    { label: 'イールドカーブ', sub: '10Y − 2Y', value: credit.components.yield_curve?.value,
      format: (v: number | null | undefined) => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—',
      status: credit.components.yield_curve?.status ?? 'normal', info: '逆転 = 景気後退' },
    { label: 'DXY', sub: 'ドル指数', value: credit.components.dxy?.value,
      format: (v: number | null | undefined) => v != null ? v.toFixed(1) : '—',
      status: credit.components.dxy?.status ?? 'normal', info: '> 110 ドル高警戒' },
  ];
  return (
    <GlassCard stagger={7}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 rounded-full bg-amber-500" />
            <div>
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">信用圧力センサー</p>
              <p className="text-[11px] text-muted-foreground/80">Layer 3 — クレジット・金利・為替の横断圧力</p>
            </div>
          </div>
          <Badge className={`${levelBg} ${levelColor} border text-[11px] font-mono`}>
            {credit.level === 'High' ? 'HIGH' : credit.level === 'Medium' ? 'MED' : 'LOW'}
          </Badge>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {sensors.map((s) => (
            <Tooltip key={s.label}>
              <TooltipTrigger asChild>
                <div className="rounded-xl bg-zinc-100/80 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700/50 p-4 text-center transition-all duration-200 hover:border-zinc-300 dark:hover:border-zinc-600/60 cursor-default">
                  <div className="flex items-center justify-center gap-1.5 mb-2">
                    <span className={`w-2 h-2 rounded-full ${sensorDot(s.status)}`} />
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">{s.label}</p>
                  </div>
                  <p className={`text-2xl font-bold tabular-nums font-mono ${s.status === 'danger' ? 'text-red-700 dark:text-red-300' : s.status === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'}`}>
                    {s.format(s.value)}
                  </p>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5">{s.sub}</p>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">{s.info}</p></TooltipContent>
            </Tooltip>
          ))}
        </div>
        {credit.alerts.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {credit.alerts.map((alert, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 dark:bg-amber-500/[0.06] border border-amber-500/20">
                <span className="text-amber-600 dark:text-amber-400 text-[11px] mt-0.5 shrink-0">&#9650;</span>
                <span className="text-xs text-amber-800 dark:text-amber-200">{alert}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function EventDetectionPanel({ eventsData }: { eventsData: MarketEventsData | null }) {
  if (!eventsData) return null;
  const { events, highest_severity } = eventsData;

  if (events.length === 0) {
    return (
      <GlassCard stagger={8}>
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 rounded-full bg-emerald-500" />
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">イベント検出</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/[0.08] border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-sm text-emerald-700 dark:text-emerald-300 font-medium">異常イベントは検出されていません</span>
          </div>
        </div>
      </GlassCard>
    );
  }

  const severityConfig = {
    CRITICAL: { bg: 'bg-red-500/10 dark:bg-red-500/[0.08]', border: 'border-red-500/25 dark:border-red-500/20', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500 dark:bg-red-400 animate-pulse', badge: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/25' },
    ALERT: { bg: 'bg-amber-500/10 dark:bg-amber-500/[0.08]', border: 'border-amber-500/25 dark:border-amber-500/20', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500 dark:bg-amber-400', badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25' },
    WARNING: { bg: 'bg-yellow-500/10 dark:bg-yellow-500/[0.06]', border: 'border-yellow-500/25 dark:border-yellow-500/20', text: 'text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-500 dark:bg-yellow-400', badge: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/25' },
  };
  const headerColor = highest_severity === 'CRITICAL' ? 'bg-red-500' : highest_severity === 'ALERT' ? 'bg-amber-500' : 'bg-yellow-500';

  return (
    <GlassCard stagger={8}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className={`w-1 h-4 rounded-full ${headerColor}`} />
            <div>
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">イベント検出</p>
              <p className="text-[11px] text-muted-foreground/80">市場ストレスイベントの自動検出</p>
            </div>
          </div>
          <Badge variant="outline" className={`text-[11px] font-mono ${severityConfig[highest_severity as keyof typeof severityConfig]?.badge ?? ''}`}>
            {events.length}件検出
          </Badge>
        </div>
        <div className="space-y-2.5">
          {events.map((ev, i) => {
            const cfg = severityConfig[ev.severity] ?? severityConfig.WARNING;
            return (
              <div key={i} className={`rounded-lg ${cfg.bg} border ${cfg.border} p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full mt-0.5 shrink-0 ${cfg.dot}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-bold ${cfg.text}`}>{ev.event_label}</span>
                        <Badge variant="outline" className={`text-[10px] font-mono ${cfg.badge}`}>{ev.severity}</Badge>
                      </div>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">{ev.description}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-base font-bold font-mono tabular-nums ${cfg.text}`}>{ev.trigger_value.toFixed(1)}</p>
                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400">閾値: {ev.threshold.toFixed(1)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </GlassCard>
  );
}

function PolicyRegimeCard({ regimeData }: { regimeData: PolicyRegimeData | null }) {
  if (!regimeData) return null;
  const { regime, regime_label, description, fed_action_room, signals, fed_comment } = regimeData;

  const regimeColors: Record<string, { text: string; bg: string; border: string }> = {
    PIVOT_CONFIRMED: { text: 'text-cyan-700 dark:text-cyan-300', bg: 'bg-cyan-500/10 dark:bg-cyan-500/[0.08]', border: 'border-cyan-500/25 dark:border-cyan-500/20' },
    PIVOT_EARLY: { text: 'text-cyan-700 dark:text-cyan-300', bg: 'bg-cyan-500/8 dark:bg-cyan-500/[0.06]', border: 'border-cyan-500/20 dark:border-cyan-500/15' },
    QE_MODE: { text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/10 dark:bg-emerald-500/[0.08]', border: 'border-emerald-500/25 dark:border-emerald-500/20' },
    QT_ACTIVE: { text: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-500/10 dark:bg-orange-500/[0.08]', border: 'border-orange-500/25 dark:border-orange-500/20' },
    QT_EXHAUSTED: { text: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-500/8 dark:bg-orange-500/[0.06]', border: 'border-orange-500/20 dark:border-orange-500/15' },
    NEUTRAL_POLICY: { text: 'text-zinc-700 dark:text-zinc-300', bg: 'bg-zinc-500/8 dark:bg-zinc-500/[0.06]', border: 'border-zinc-500/20 dark:border-zinc-500/15' },
  };
  const rc = regimeColors[regime] ?? regimeColors.NEUTRAL_POLICY;

  const levelToPct = (item: { level: string; room_pct?: number | null }): number => {
    if (item.room_pct != null) return Math.min(Math.max(item.room_pct * 100, 0), 100);
    const map: Record<string, number> = { High: 80, Ample: 80, Available: 70, Medium: 50, Moderate: 50, Low: 20, Limited: 20, Unknown: 5 };
    return map[item.level] ?? 5;
  };
  const levelJa: Record<string, string> = { High: '高', Ample: '十分', Available: 'あり', Medium: '中', Moderate: '中程度', Low: '低', Limited: '限定的', Unknown: '—' };
  const overallJa: Record<string, string> = { Ample: '十分', Moderate: '中程度', Limited: '限定的', Unknown: '不明' };
  const roomMeters = [
    { label: '利下げ余地', value: levelToPct(fed_action_room.rate_cut_room), level: fed_action_room.rate_cut_room.level },
    { label: '吸収余地', value: levelToPct(fed_action_room.absorption_room), level: fed_action_room.absorption_room.level },
    { label: '財政余地', value: levelToPct(fed_action_room.fiscal_assist_potential), level: fed_action_room.fiscal_assist_potential.level },
  ];

  return (
    <GlassCard stagger={2}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 rounded-full bg-indigo-500" />
            <div>
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.15em]">政策レジーム</p>
              <p className="text-[11px] text-muted-foreground/80">FRBの政策スタンス判定</p>
            </div>
          </div>
          <Badge variant="outline" className={`text-xs font-mono font-bold ${rc.text} ${rc.border}`}>
            {regime_label}
          </Badge>
        </div>

        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-4">{description}</p>

        {/* Fed Action Room meters */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {roomMeters.map((m) => {
            const meterColor = m.value >= 60 ? 'bg-emerald-500' : m.value >= 30 ? 'bg-amber-500' : 'bg-red-500';
            return (
              <div key={m.label} className="rounded-lg bg-zinc-100/80 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-700/50 p-3">
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-medium mb-2">{m.label}</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                    <div className={`h-full rounded-full ${meterColor} plumb-gauge-bar`} style={{ width: `${m.value}%` }} />
                  </div>
                  <span className={`text-xs font-bold ${m.value >= 60 ? 'text-emerald-600 dark:text-emerald-400' : m.value >= 30 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{levelJa[m.level] ?? m.level}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Overall room */}
        <div className={`rounded-lg ${rc.bg} border ${rc.border} p-4 mb-4`}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400 uppercase tracking-wider font-medium">総合対応余地</span>
            <span className={`text-xl font-bold ${rc.text}`}>{overallJa[fed_action_room.overall_room] ?? fed_action_room.overall_room}</span>
          </div>
        </div>

        {/* Signals */}
        {signals.length > 0 && (
          <div className="space-y-1.5 mb-4">
            {signals.map((sig, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-md bg-zinc-100/60 dark:bg-zinc-900/30 border border-zinc-200/50 dark:border-zinc-700/30">
                <span className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0">&#9679;</span>
                <span className="text-xs text-zinc-600 dark:text-zinc-400">{sig}</span>
              </div>
            ))}
          </div>
        )}

        {/* Fed comment */}
        {fed_comment && (
          <div className="rounded-lg bg-zinc-100/80 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-700/40 p-4">
            <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">{fed_comment}</p>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function DashboardTab({ data, eventsData, regimeData }: {
  data: PlumbingSummary;
  eventsData: MarketEventsData | null;
  regimeData: PolicyRegimeData | null;
}) {
  const { layers, market_state, credit_pressure, market_indicators } = data;
  const l1 = layers.layer1, l2a = layers.layer2a, l2b = layers.layer2b;
  return (
    <div className="space-y-4">
      {market_state && l1 && l2a && l2b && <MarketStateHero state={market_state} l1={l1.stress_score} l2a={l2a.stress_score} l2b={l2b.stress_score} />}
      <IndicatorBar indicators={market_indicators} />
      <EventDetectionPanel eventsData={eventsData} />
      <div className="grid gap-4 lg:grid-cols-3">
        {l1 && <Layer1Card layer={l1} />}
        {l2a && <Layer2ACard layer={l2a} />}
        {l2b && <Layer2BCard layer={l2b} />}
      </div>
      {credit_pressure && <CreditPressurePanel credit={credit_pressure} />}
      {l1?.fed_data && <NetLiquidityFlow fed={l1.fed_data} />}
      <PolicyRegimeCard regimeData={regimeData} />
      <div className="flex justify-end">
        <p className="text-[10px] text-muted-foreground font-mono">
          {data.timestamp ? `LAST UPDATE ${new Date(data.timestamp).toLocaleString('ja-JP')}` : ''}
        </p>
      </div>
    </div>
  );
}

// ============================================================
// TAB 2: History Charts
// ============================================================

// Canvas chart helpers
function toSeries(
  arr: Array<Record<string, unknown>>,
  field: string,
  opts: Partial<ChartSeries> & { label: string; color: string },
): ChartSeries {
  return {
    data: arr.map(r => ({ x: r.date as string, y: r[field] as number | null })),
    type: opts.type ?? 'line',
    ...opts,
  };
}

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
  caution500: '#FB5B01',
  caution400: '#FF8D44',
  caution300: '#FFC199',
  danger500: '#FE3939',
  danger300: '#FFBBBB',
  neutral900: '#4D4D4D',
  neutral700: '#767676',
  neutral500: '#999999',
  neutral300: '#CCCCCC',
  neutral200: '#E6E6E6',
} as const;

function mergeOverlay(
  base: Array<Record<string, unknown>>,
  marketIndicators: Array<Record<string, unknown>>,
  showSP500: boolean,
  showNASDAQ: boolean,
): ChartSeries[] {
  if (!showSP500 && !showNASDAQ) return [];
  const miMap = new Map(marketIndicators.map(r => [r.date as string, r]));
  const overlay: ChartSeries[] = [];
  if (showSP500) {
    overlay.push({
      data: base.map(r => { const mi = miMap.get(r.date as string); return { x: r.date as string, y: mi ? (mi.sp500 as number | null) : null }; }),
      type: 'line', color: DA.neutral700, label: 'S&P500', dashed: true, yAxisSide: 'right',
    });
  }
  if (showNASDAQ) {
    overlay.push({
      data: base.map(r => { const mi = miMap.get(r.date as string); return { x: r.date as string, y: mi ? (mi.nasdaq as number | null) : null }; }),
      type: 'line', color: DA.neutral500, label: 'NASDAQ', dashed: true, yAxisSide: 'right',
    });
  }
  return overlay;
}

// Chart types with subtitle for the chart header
const CHART_TYPES = [
  { key: 'net_liquidity', label: 'Net Liquidity', sub: 'SOMA − RRP − TGA', unit: '$B' },
  { key: 'margin_debt', label: '信用取引残高', sub: 'FINRA Margin Debt', unit: 'M$' },
  { key: 'kre', label: 'KRE（地銀）', sub: 'SPDR S&P Regional Banking ETF', unit: 'USD' },
  { key: 'spreads', label: 'クレジットスプレッド', sub: 'High-Yield / Investment-Grade OAS', unit: '%' },
  { key: 'vix', label: 'VIX', sub: 'CBOE Volatility Index', unit: 'pt' },
  { key: 'layer_scores', label: 'Layerスコア', sub: 'L1 政策 / L2A 銀行 / L2B 市場', unit: '0-100' },
  { key: 'divergence', label: '乖離分析', sub: 'L2 vs L1 標準偏差', unit: 'σ' },
] as const;

const PERIODS = [
  { label: '1Y', value: '1y' },
  { label: '2Y', value: '2y' },
  { label: '5Y', value: '5y' },
  { label: '10Y', value: '10y' },
  { label: 'ALL', value: 'all' },
];

// Crisis presets with key event dates for vertical markers on the chart
const CRISIS_PRESETS = [
  {
    label: 'リーマン', start: '2007-06-01', end: '2010-06-01',
    events: [
      { date: '2008-09', label: 'Lehman' },
      { date: '2008-10', label: 'TARP' },
      { date: '2009-03', label: 'QE1' },
    ],
  },
  {
    label: '欧州債務', start: '2011-01-01', end: '2012-12-31',
    events: [
      { date: '2011-08', label: 'S&P米国格下げ' },
      { date: '2012-07', label: 'Whatever it takes' },
    ],
  },
  {
    label: 'コロナ', start: '2019-10-01', end: '2021-06-01',
    events: [
      { date: '2020-03', label: 'COVID crash' },
      { date: '2020-03', label: 'QE Infinity' },
    ],
  },
  {
    label: 'QT', start: '2021-10-01', end: '2023-12-31',
    events: [
      { date: '2022-03', label: '利上げ開始' },
      { date: '2023-03', label: 'SVB破綻' },
    ],
  },
] as const;

// Major events visible on long timelines (5Y / 10Y / ALL)
const MAJOR_EVENTS = [
  { date: '2008-09', label: 'Lehman' },
  { date: '2020-03', label: 'COVID' },
  { date: '2022-03', label: '利上げ開始' },
  { date: '2023-03', label: 'SVB' },
];

type ChartType = typeof CHART_TYPES[number]['key'];

// Extract latest value + delta vs first point of visible window
function lastAndDelta(arr: Array<Record<string, unknown>>, field: string): { last: number | null; delta: number | null; deltaPct: number | null } {
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

type ViewMode = 'overview' | 'detail';

function HistoryChartsTab() {
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [period, setPeriod] = useState('2y');
  const [chartType, setChartType] = useState<ChartType>('net_liquidity');
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);
  const [showSP500, setShowSP500] = useState(false);
  const [showNASDAQ, setShowNASDAQ] = useState(false);
  const [showEvents, setShowEvents] = useState(true);

  const { data: histData, error: histError, isLoading: loading } = useHistoryCharts(
    period,
    customRange?.start,
    customRange?.end,
  );
  const error = histError ? (histError instanceof Error ? histError.message : 'データ取得エラー') : null;

  const handlePeriod = (p: string) => { setCustomRange(null); setPeriod(p); };
  const handleCrisis = (start: string, end: string) => { setCustomRange({ start, end }); };

  // Active crisis preset (if any)
  const activeCrisis = customRange ? CRISIS_PRESETS.find(c => c.start === customRange.start) : null;

  // Compute event markers based on selection (crisis events) or major events on long timelines
  const eventMarkers: ChartEventMarker[] | undefined = (() => {
    if (!showEvents) return undefined;
    if (activeCrisis) return [...activeCrisis.events];
    if (period === '5y' || period === '10y' || period === 'all') return MAJOR_EVENTS;
    return undefined;
  })();

  // Current chart meta (title, sub, unit)
  const currentMeta = CHART_TYPES.find(c => c.key === chartType)!;

  // Compute latest value + delta for any chart type (used by header + grid tiles)
  function statFor(ct: ChartType): { value: string; delta: number | null; deltaUnit?: string } | null {
    if (!histData) return null;
    const d = histData.data;
    switch (ct) {
      case 'net_liquidity': {
        const r = lastAndDelta(d.net_liquidity, 'net_liquidity');
        return { value: r.last != null ? `$${Math.round(r.last).toLocaleString()}B` : '—', delta: r.deltaPct };
      }
      case 'margin_debt': {
        const r = lastAndDelta(d.margin_debt, 'debit_balance');
        return { value: r.last != null ? `${(r.last / 1000).toFixed(0)}K` : '—', delta: r.deltaPct };
      }
      case 'kre': {
        const r = lastAndDelta(d.bank_sector, 'kre_close');
        return { value: r.last != null ? `$${r.last.toFixed(2)}` : '—', delta: r.deltaPct };
      }
      case 'spreads': {
        const r = lastAndDelta(d.credit_spreads, 'hy_spread');
        return { value: r.last != null ? `${r.last.toFixed(2)}%` : '—', delta: r.deltaPct, deltaUnit: 'pp' };
      }
      case 'vix': {
        const r = lastAndDelta(d.market_indicators, 'vix');
        return { value: r.last != null ? r.last.toFixed(2) : '—', delta: r.deltaPct };
      }
      case 'layer_scores': {
        const lsData = d.layer_scores ?? [];
        if (lsData.length === 0) return null;
        const r = lastAndDelta(lsData as Array<Record<string, unknown>>, 'layer1');
        return { value: r.last != null ? r.last.toFixed(0) : '—', delta: r.deltaPct };
      }
      case 'divergence': {
        const dvData = d.layer_divergence ?? [];
        if (dvData.length === 0) return null;
        const r = lastAndDelta(dvData as Array<Record<string, unknown>>, 'divergence');
        return { value: r.last != null ? `${r.last.toFixed(2)}σ` : '—', delta: null };
      }
      default: return null;
    }
  }
  const headerStat = statFor(chartType);

  function buildChartConfig(ct: ChartType): {
    series: ChartSeries[];
    refs: ChartReferenceLine[];
    yFmt?: (v: number) => string;
    yRFmt?: (v: number) => string;
    empty?: boolean;
  } | null {
    if (!histData) return null;
    const d = histData.data;
    let series: ChartSeries[] = [];
    let refs: ChartReferenceLine[] = [];
    let yFmt: ((v: number) => string) | undefined;
    let yRFmt: ((v: number) => string) | undefined;

    switch (ct) {
      case 'net_liquidity': {
        series = [
          toSeries(d.net_liquidity, 'net_liquidity', { type: 'area', color: DA.brand500, label: 'Net Liquidity' }),
          ...mergeOverlay(d.net_liquidity, d.market_indicators, showSP500, showNASDAQ),
        ];
        yFmt = (v) => `$${Math.round(v).toLocaleString()}B`;
        yRFmt = (v) => Math.round(v).toLocaleString();
        break;
      }
      case 'margin_debt': {
        series = [
          toSeries(d.margin_debt, 'debit_balance', { type: 'bar', color: DA.brand400, label: '残高 (M$)' }),
          toSeries(d.margin_debt, 'change_2y', { type: 'line', color: DA.caution500, label: '2Y変化率 (%)', dashed: true, yAxisSide: 'right' }),
          ...mergeOverlay(d.margin_debt, d.market_indicators, showSP500, showNASDAQ),
        ];
        yFmt = (v) => `${(v / 1000).toFixed(0)}K`;
        yRFmt = (v) => `${v.toFixed(0)}%`;
        break;
      }
      case 'kre': {
        series = [
          toSeries(d.bank_sector, 'kre_close', { type: 'area', color: DA.brand700, label: 'KRE ($)' }),
          toSeries(d.bank_sector, 'kre_52w_change', { type: 'line', color: DA.caution500, label: '52W変化率 (%)', dashed: true, yAxisSide: 'right' }),
          ...mergeOverlay(d.bank_sector, d.market_indicators, showSP500, showNASDAQ),
        ];
        yFmt = (v) => `$${v.toFixed(0)}`;
        yRFmt = (v) => `${v.toFixed(0)}%`;
        break;
      }
      case 'spreads': {
        series = [
          toSeries(d.credit_spreads, 'hy_spread', { type: 'line', color: DA.danger500, label: 'HYスプレッド' }),
          toSeries(d.credit_spreads, 'ig_spread', { type: 'line', color: DA.caution500, label: 'IGスプレッド' }),
          ...mergeOverlay(d.credit_spreads, d.market_indicators, showSP500, showNASDAQ),
        ];
        refs = [{ y: 5, color: DA.danger300, label: 'HY危険', dashed: true }];
        yFmt = (v) => `${v.toFixed(2)}%`;
        yRFmt = (v) => Math.round(v).toLocaleString();
        break;
      }
      case 'vix': {
        series = [
          toSeries(d.market_indicators, 'vix', { type: 'area', color: DA.caution500, label: 'VIX' }),
          ...mergeOverlay(d.market_indicators, d.market_indicators, showSP500, showNASDAQ),
        ];
        refs = [
          { y: 20, color: DA.caution300, label: '警戒', dashed: true },
          { y: 30, color: DA.danger300, label: '危険', dashed: true },
        ];
        yFmt = (v) => v.toFixed(0);
        yRFmt = (v) => Math.round(v).toLocaleString();
        break;
      }
      case 'layer_scores': {
        const lsData = d.layer_scores ?? [];
        if (lsData.length === 0) return { series: [], refs: [], empty: true };
        series = [
          toSeries(lsData, 'layer1', { type: 'line', color: DA.brand700, label: 'L1 政策' }),
          toSeries(lsData, 'layer2a', { type: 'line', color: DA.brand500, label: 'L2A 銀行' }),
          toSeries(lsData, 'layer2b', { type: 'line', color: DA.brand400, label: 'L2B 市場' }),
        ];
        refs = [
          { y: 30, color: DA.safe300, label: '安全', dashed: true },
          { y: 70, color: DA.danger300, label: '危険', dashed: true },
        ];
        yFmt = (v) => v.toFixed(0);
        break;
      }
      case 'divergence': {
        const divData = d.layer_divergence ?? [];
        if (divData.length === 0) return { series: [], refs: [], empty: true };
        series = [
          toSeries(divData, 'divergence', { type: 'area', color: DA.brand500, label: '乖離 (σ)' }),
        ];
        refs = [
          { y: 0, color: DA.neutral300, dashed: false },
          { y: 1, color: DA.danger300, label: '+1σ 注意', dashed: true },
          { y: -1, color: DA.safe300, label: '-1σ 買い候補', dashed: true },
        ];
        yFmt = (v) => `${v.toFixed(1)}σ`;
        break;
      }
      default:
        return null;
    }

    return { series, refs, yFmt, yRFmt };
  }

  function renderChart() {
    const cfg = buildChartConfig(chartType);
    if (!cfg) return null;
    if (cfg.empty) {
      return <div className="h-[400px] flex items-center justify-center text-sm text-muted-foreground">データがありません</div>;
    }
    return (
      <EconChartCanvas
        series={cfg.series}
        referenceLines={cfg.refs.length > 0 ? cfg.refs : undefined}
        eventMarkers={eventMarkers}
        yAxisFormat={cfg.yFmt}
        yAxisRightFormat={cfg.yRFmt}
        height={420}
      />
    );
  }

  const allowOverlay = chartType !== 'divergence' && chartType !== 'layer_scores';
  const deltaUnit = (headerStat as { deltaUnit?: string } | null)?.deltaUnit ?? '%';

  return (
    <div className="space-y-3 plumb-animate-in">
      {/* ============ Toolbar (view mode + period + crisis presets) ============ */}
      <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-card p-3 md:p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* View mode toggle */}
        <div className="inline-flex items-center rounded-md border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.02] overflow-hidden">
          {[
            { v: 'overview' as ViewMode, label: '一覧' },
            { v: 'detail' as ViewMode, label: '詳細' },
          ].map((m, i) => {
            const isActive = viewMode === m.v;
            return (
              <button
                key={m.v}
                onClick={() => setViewMode(m.v)}
                className={`px-3.5 py-1.5 text-[11px] font-bold tracking-wider transition-colors ${
                  i > 0 ? 'border-l border-neutral-200 dark:border-white/10' : ''
                } ${
                  isActive
                    ? 'bg-[var(--brand-100)] text-[var(--brand-700)] dark:text-[var(--brand-400)]'
                    : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/[0.04]'
                }`}
              >{m.label}</button>
            );
          })}
        </div>

        {/* Period segmented control */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-neutral-500">期間</span>
          <div className="inline-flex items-center rounded-md border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.02] overflow-hidden">
            {PERIODS.map((p, i) => {
              const isActive = period === p.value && !customRange;
              return (
                <button
                  key={p.value}
                  onClick={() => handlePeriod(p.value)}
                  className={`px-3.5 py-1.5 text-[11px] font-bold tracking-wider transition-colors ${
                    i > 0 ? 'border-l border-neutral-200 dark:border-white/10' : ''
                  } ${
                    isActive
                      ? 'bg-[var(--brand-100)] text-[var(--brand-700)] dark:text-[var(--brand-400)]'
                      : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-white/[0.04]'
                  }`}
                >{p.label}</button>
              );
            })}
          </div>
        </div>

        {/* Crisis preset chips */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-neutral-500">クライシス</span>
          <div className="flex items-center gap-1.5">
            {CRISIS_PRESETS.map((c) => {
              const isActive = customRange?.start === c.start;
              return (
                <button
                  key={c.label}
                  onClick={() => handleCrisis(c.start, c.end)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors ${
                    isActive
                      ? 'bg-[var(--brand-100)] text-[var(--brand-700)] border-[var(--brand-200)] dark:bg-[var(--brand-100)]/20 dark:text-[var(--brand-400)] dark:border-[var(--brand-400)]/30'
                      : 'bg-white dark:bg-white/[0.02] text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-white/10 hover:border-neutral-300 dark:hover:border-white/20'
                  }`}
                >{c.label}</button>
              );
            })}
          </div>
        </div>

        {/* Event toggle */}
        <label className="ml-auto flex items-center gap-2 cursor-pointer text-[11px] text-neutral-700 dark:text-neutral-300 hover:text-foreground">
          <input
            type="checkbox"
            checked={showEvents}
            onChange={(e) => setShowEvents(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--brand-500)]"
          />
          <span>イベント表示</span>
        </label>
      </div>

      {/* ============ OVERVIEW MODE: Grid of all charts (Power BI style) ============ */}
      {viewMode === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {CHART_TYPES.map((ct) => {
            const cfg = buildChartConfig(ct.key);
            const stat = statFor(ct.key);
            const isEmpty = !cfg || cfg.empty;
            const open = () => { setChartType(ct.key); setViewMode('detail'); };
            return (
              <div
                key={ct.key}
                role="button"
                tabIndex={0}
                onClick={open}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
                className="cursor-pointer text-left rounded-xl border border-neutral-200 dark:border-white/10 bg-card hover:border-[var(--brand-400)] hover:shadow-[0_0_0_3px_var(--brand-100)] focus:outline-none focus:border-[var(--brand-500)] transition-all overflow-hidden group"
              >
                {/* Tile header */}
                <div className="px-4 pt-3.5 pb-2 flex items-start justify-between gap-3 border-b border-neutral-100 dark:border-white/[0.06]">
                  <div className="min-w-0">
                    <h4 className="text-[13px] font-bold text-foreground tracking-tight truncate">{ct.label}</h4>
                    <p className="text-[10px] text-neutral-500 mt-0.5 truncate">{ct.sub}</p>
                  </div>
                  {stat && (
                    <div className="shrink-0 text-right">
                      <p className="text-[16px] leading-none font-bold tabular-nums text-foreground">{stat.value}</p>
                      {stat.delta != null && (
                        <p className={`text-[10px] font-bold tabular-nums mt-1 ${
                          stat.delta >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'
                        }`}>
                          {stat.delta >= 0 ? '+' : ''}{stat.delta.toFixed(1)}{stat.deltaUnit ?? '%'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {/* Mini chart */}
                <div className="px-2 py-1">
                  {isEmpty || !cfg ? (
                    <div className="h-[180px] flex items-center justify-center text-[11px] text-neutral-400">データなし</div>
                  ) : (
                    <EconChartCanvas
                      series={cfg.series}
                      referenceLines={cfg.refs.length > 0 ? cfg.refs : undefined}
                      eventMarkers={eventMarkers}
                      yAxisFormat={cfg.yFmt}
                      yAxisRightFormat={cfg.yRFmt}
                      height={200}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ============ DETAIL MODE: Single large chart with type selector ============ */}
      {viewMode === 'detail' && (<>
      {/* Chart type segmented bar */}
      <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-card overflow-hidden">
        <div className="flex overflow-x-auto scrollbar-hide">
          {CHART_TYPES.map((ct, i) => {
            const isActive = chartType === ct.key;
            return (
              <button
                key={ct.key}
                onClick={() => setChartType(ct.key)}
                className={`flex-1 min-w-[120px] px-4 py-2.5 text-[12px] font-medium whitespace-nowrap relative transition-colors ${
                  i > 0 ? 'border-l border-neutral-200 dark:border-white/10' : ''
                } ${
                  isActive
                    ? 'text-[var(--brand-700)] dark:text-[var(--brand-400)] bg-[var(--brand-100)]/40 dark:bg-[var(--brand-100)]/10'
                    : 'text-neutral-700 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-white/[0.03]'
                }`}
              >
                {ct.label}
                {isActive && (
                  <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-[var(--brand-500)]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main chart card */}
      <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-card">
        {/* Chart header */}
        <div className="flex flex-wrap items-end justify-between gap-4 p-5 pb-3 border-b border-neutral-100 dark:border-white/[0.06]">
          <div>
            <h3 className="text-[18px] font-bold text-foreground tracking-tight">{currentMeta.label}</h3>
            <p className="text-[11px] text-neutral-500 mt-1">{currentMeta.sub}</p>
          </div>
          {headerStat && (
            <div className="flex items-end gap-3">
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[0.15em] text-neutral-500 font-medium">直近値</p>
                <p className="text-[24px] leading-none font-bold tabular-nums text-foreground mt-1">
                  {headerStat.value}
                </p>
              </div>
              {headerStat.delta != null && (
                <div className={`px-2.5 py-1 rounded-md text-[11px] font-bold tabular-nums border ${
                  headerStat.delta >= 0
                    ? 'text-[var(--signal-safe-500)] bg-[var(--signal-safe-100)] border-[var(--signal-safe-300)]/40'
                    : 'text-[var(--signal-danger-500)] bg-[var(--signal-danger-100)] border-[var(--signal-danger-300)]/50'
                }`}>
                  {headerStat.delta >= 0 ? '+' : ''}{headerStat.delta.toFixed(1)}{deltaUnit}
                  <span className="ml-1 font-normal text-[9px] uppercase tracking-wider opacity-70">期間</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Overlay toggles row */}
        {allowOverlay && (
          <div className="px-5 py-2 border-b border-neutral-100 dark:border-white/[0.06] flex items-center gap-4">
            <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-neutral-500">オーバーレイ</span>
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-neutral-700 dark:text-neutral-300 hover:text-foreground">
              <input
                type="checkbox"
                checked={showSP500}
                onChange={(e) => setShowSP500(e.target.checked)}
                className="w-3.5 h-3.5 accent-[var(--neutral-700)]"
              />
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3 h-[2px] bg-[var(--neutral-700)] dark:bg-neutral-400" />
                S&P 500
              </span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-neutral-700 dark:text-neutral-300 hover:text-foreground">
              <input
                type="checkbox"
                checked={showNASDAQ}
                onChange={(e) => setShowNASDAQ(e.target.checked)}
                className="w-3.5 h-3.5 accent-[var(--neutral-500)]"
              />
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3 h-[2px] bg-[var(--neutral-500)] dark:bg-neutral-500" />
                NASDAQ
              </span>
            </label>
          </div>
        )}

        {/* Chart canvas */}
        <div className="p-4 md:p-5">
          {loading ? (
            <div className="h-[420px] flex items-center justify-center">
              <div className="text-sm text-neutral-500">Loading…</div>
            </div>
          ) : error ? (
            <div className="h-[420px] flex items-center justify-center">
              <div className="text-sm text-[var(--signal-danger-500)]">{error}</div>
            </div>
          ) : (
            renderChart()
          )}
        </div>

        {/* Footer */}
        {histData && (
          <div className="px-5 pb-4 pt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-500">
            <span className="font-medium">
              データ範囲: <span className="tabular-nums">{histData.start_date}</span> → <span className="tabular-nums">{histData.end_date}</span>
            </span>
            <span>出典: FRED, FRB H.4.1, FINRA, Yahoo Finance</span>
          </div>
        )}
      </div>
      </>)}

      {/* Common loading / error display for overview mode */}
      {viewMode === 'overview' && (loading || error) && (
        <div className="rounded-xl border border-neutral-200 dark:border-white/10 bg-card p-8">
          {loading
            ? <div className="text-sm text-neutral-500 text-center">Loading…</div>
            : <div className="text-sm text-[var(--signal-danger-500)] text-center">{error}</div>}
        </div>
      )}

      {/* Common footer for overview mode */}
      {viewMode === 'overview' && histData && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-500 px-1">
          <span className="font-medium">
            データ範囲: <span className="tabular-nums">{histData.start_date}</span> → <span className="tabular-nums">{histData.end_date}</span>
          </span>
          <span>出典: FRED, FRB H.4.1, FINRA, Yahoo Finance</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TAB 3: Backtest
// ============================================================

const STATE_COLOR_MAP: Record<string, string> = {
  green: 'text-emerald-600 dark:text-emerald-400', cyan: 'text-cyan-600 dark:text-cyan-400', yellow: 'text-yellow-600 dark:text-yellow-400',
  orange: 'text-orange-600 dark:text-orange-400', red: 'text-red-600 dark:text-red-400', gray: 'text-zinc-600 dark:text-zinc-400',
};
const STATE_DOT_MAP: Record<string, string> = {
  green: 'bg-emerald-400', cyan: 'bg-cyan-400', yellow: 'bg-yellow-400',
  orange: 'bg-orange-400', red: 'bg-red-400', gray: 'bg-zinc-400',
};

function BacktestTab() {
  const { data: btData, error: btError, isLoading: loading } = useBacktestStates(120);
  const [stateFilter, setStateFilter] = useState<string>('ALL');

  if (loading) return <div className="h-96 flex items-center justify-center"><Skeleton className="h-8 w-40" /></div>;
  if (btError) return <div className="text-red-600 dark:text-red-400 text-sm text-center py-20">{btError instanceof Error ? btError.message : 'データ取得エラー'}</div>;
  if (!btData) return null;

  const { state_definitions, states, state_stats } = btData;

  // Count occurrences for filter buttons
  const stateCounts: Record<string, number> = {};
  for (const s of states) {
    stateCounts[s.state_code] = (stateCounts[s.state_code] || 0) + 1;
  }

  const filteredStates = stateFilter === 'ALL' ? states : states.filter(s => s.state_code === stateFilter);
  const sortedStates = [...filteredStates].reverse(); // newest first

  return (
    <div className="space-y-5 plumb-animate-in">
      {/* State Definitions */}
      <GlassCard stagger={1}>
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-purple-500" />
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">状態定義テーブル</p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] font-mono">状態</TableHead>
                  <TableHead className="text-[10px] font-mono">条件</TableHead>
                  <TableHead className="text-[10px] font-mono">説明</TableHead>
                  <TableHead className="text-[10px] font-mono">アクション</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state_definitions.map((def) => (
                  <TableRow key={def.code} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                    <TableCell className="py-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${STATE_DOT_MAP[def.color] ?? 'bg-zinc-400'}`} />
                        <span className={`text-xs font-medium ${STATE_COLOR_MAP[def.color] ?? 'text-zinc-600 dark:text-zinc-400'}`}>{def.label}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-[10px] text-cyan-600/80 dark:text-cyan-400/80 font-mono py-2">{def.conditions}</TableCell>
                    <TableCell className="text-[10px] text-muted-foreground py-2 max-w-[200px]">{def.description}</TableCell>
                    <TableCell className="text-[10px] text-yellow-600/80 dark:text-yellow-400/80 font-medium py-2">{def.action}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </GlassCard>

      {/* Event Timeline */}
      {btData.event_timeline && btData.event_timeline.length > 0 && (
        <GlassCard stagger={2}>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-4 rounded-full bg-amber-500" />
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">歴史的クライシス</p>
              <span className="text-[9px] text-muted-foreground/70">（主要イベント時の市場状態）</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {btData.event_timeline.map((ev) => {
                const sc = stateColors(ev.color);
                return (
                  <div key={ev.event} className={`rounded-xl border ${sc.border} ${sc.bg} p-4 transition-all duration-200 hover:scale-[1.01]`}>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <p className="text-xs font-bold text-foreground">{ev.event}</p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{ev.event_date}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                        <span className={`text-[10px] font-medium ${sc.text}`}>{ev.state_label}</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground mb-3 leading-relaxed">{ev.description}</p>
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <p className="text-[9px] text-muted-foreground">L1</p>
                        <p className={`text-xs font-bold font-mono tabular-nums ${scoreHue(ev.layer1_stress).text}`}>{ev.layer1_stress}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground">L2A</p>
                        <p className={`text-xs font-bold font-mono tabular-nums ${scoreHue(ev.layer2a_stress).text}`}>{ev.layer2a_stress}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground">L2B</p>
                        <p className={`text-xs font-bold font-mono tabular-nums ${scoreHue(ev.layer2b_stress).text}`}>{ev.layer2b_stress}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground">6M</p>
                        <p className={`text-xs font-bold font-mono tabular-nums ${
                          ev.return_6m == null ? 'text-muted-foreground' : ev.return_6m >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                        }`}>
                          {ev.return_6m != null ? `${ev.return_6m >= 0 ? '+' : ''}${ev.return_6m}%` : '—'}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </GlassCard>
      )}

      {/* State Performance Stats */}
      {Object.keys(state_stats).length > 0 && (
        <GlassCard stagger={2}>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-4 rounded-full bg-blue-500" />
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">状態別パフォーマンス</p>
              <span className="text-[9px] text-muted-foreground/70">（S&P500 6ヶ月後リターン）</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {state_definitions.filter(d => state_stats[d.code]).map((def) => {
                const ss = state_stats[def.code];
                if (!ss) return null;
                return (
                  <div key={def.code} className="rounded-xl bg-black/[0.03] dark:bg-black/20 border border-black/[0.06] dark:border-white/[0.03] p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`w-2 h-2 rounded-full ${STATE_DOT_MAP[def.color] ?? 'bg-zinc-400'}`} />
                      <span className={`text-xs font-medium ${STATE_COLOR_MAP[def.color] ?? 'text-zinc-600 dark:text-zinc-400'}`}>{def.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[9px] text-muted-foreground">平均6Mリターン</p>
                        <p className={`text-sm font-bold font-mono tabular-nums ${ss.avg_return_6m >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {ss.avg_return_6m >= 0 ? '+' : ''}{ss.avg_return_6m}%
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground">勝率</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-foreground">{ss.win_rate}%</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground">最大DD</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-red-600 dark:text-red-400">{ss.max_drawdown}%</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground">件数</p>
                        <p className="text-sm font-bold font-mono tabular-nums text-foreground">{ss.sample_count}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </GlassCard>
      )}

      {/* State filter + Occurrence History */}
      <GlassCard stagger={3}>
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-cyan-500" />
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em]">発生履歴</p>
            <span className="text-[9px] text-muted-foreground/70">({btData.total_months}ヶ月)</span>
          </div>

          {/* Filter buttons */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button onClick={() => setStateFilter('ALL')}
              className={`px-2.5 py-1 rounded-md text-[10px] font-mono transition-colors ${stateFilter === 'ALL' ? 'bg-black/[0.06] dark:bg-white/[0.08] text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              ALL ({states.length})
            </button>
            {state_definitions.map((def) => {
              const cnt = stateCounts[def.code] || 0;
              if (cnt === 0) return null;
              return (
                <button key={def.code} onClick={() => setStateFilter(def.code)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    stateFilter === def.code
                      ? `${STATE_COLOR_MAP[def.color]} bg-black/[0.04] dark:bg-white/[0.06]`
                      : 'text-muted-foreground hover:text-foreground'
                  }`}>
                  {def.label} ({cnt})
                </button>
              );
            })}
          </div>

          {/* Table */}
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] font-mono sticky top-0 bg-card">日付</TableHead>
                  <TableHead className="text-[10px] font-mono sticky top-0 bg-card">状態</TableHead>
                  <TableHead className="text-[10px] font-mono sticky top-0 bg-card text-right">L1</TableHead>
                  <TableHead className="text-[10px] font-mono sticky top-0 bg-card text-right">L2A</TableHead>
                  <TableHead className="text-[10px] font-mono sticky top-0 bg-card text-right">L2B</TableHead>
                  <TableHead className="text-[10px] font-mono sticky top-0 bg-card text-right">SP500</TableHead>
                  <TableHead className="text-[10px] font-mono sticky top-0 bg-card text-right">6Mリターン</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedStates.map((s, i) => (
                  <TableRow key={i} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                    <TableCell className="text-[10px] font-mono text-muted-foreground py-1.5">{s.date}</TableCell>
                    <TableCell className="py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${STATE_DOT_MAP[s.color] ?? 'bg-zinc-400'}`} />
                        <span className={`text-[10px] font-medium ${STATE_COLOR_MAP[s.color] ?? 'text-zinc-600 dark:text-zinc-400'}`}>{s.state_label}</span>
                      </div>
                    </TableCell>
                    <TableCell className={`text-[10px] font-mono tabular-nums text-right py-1.5 ${scoreHue(s.layer1_stress).text}`}>{s.layer1_stress}</TableCell>
                    <TableCell className={`text-[10px] font-mono tabular-nums text-right py-1.5 ${scoreHue(s.layer2a_stress).text}`}>{s.layer2a_stress}</TableCell>
                    <TableCell className={`text-[10px] font-mono tabular-nums text-right py-1.5 ${scoreHue(s.layer2b_stress).text}`}>{s.layer2b_stress}</TableCell>
                    <TableCell className="text-[10px] font-mono tabular-nums text-right py-1.5 text-foreground">{s.sp500 ? fmt(s.sp500) : '—'}</TableCell>
                    <TableCell className={`text-[10px] font-mono tabular-nums text-right py-1.5 ${
                      s.return_6m == null ? 'text-muted-foreground' : s.return_6m >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                    }`}>
                      {s.return_6m != null ? `${s.return_6m >= 0 ? '+' : ''}${s.return_6m}%` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

// ============================================================
// TAB 4: System Docs (Static)
// ============================================================

function SystemDocsTab() {
  return (
    <div className="space-y-3 plumb-animate-in">
      <DocSection title="システム概要 ─ 3層流動性モデル" defaultOpen={true}>
        <p>FRBの金融システムを3層モデルで分類し、市場の流動性を監視します。</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
          {[
            { layer: 'Layer 1', name: '政策流動性（元栓）', desc: 'FRBバランスシートのNet Liquidity（SOMA - RRP - TGA）をZ-scoreで評価。政策レベルの流動性供給を測定。', color: 'border-blue-500/20 text-blue-600 dark:text-blue-400' },
            { layer: 'Layer 2A', name: '銀行システム（銀行間流動性）', desc: '準備預金、KRE（地銀ETF）、SRF利用、IGスプレッドの加重スコア。銀行間の資金伝達を監視。', color: 'border-purple-500/20 text-purple-600 dark:text-purple-400' },
            { layer: 'Layer 2B', name: 'リスク許容度（蛇口）', desc: '信用取引残高2年変化率（80%）+ MMF変化率（20%）。市場参加者のリスクテイク度を測定。', color: 'border-cyan-500/20 text-cyan-600 dark:text-cyan-400' },
          ].map((l) => (
            <div key={l.layer} className={`rounded-lg border ${l.color} p-3`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${l.color.split(' ')[1]}`}>{l.layer}</p>
              <p className="text-xs font-medium mt-1">{l.name}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{l.desc}</p>
            </div>
          ))}
        </div>
      </DocSection>

      <DocSection title="Layer 1: 政策流動性 ─ 計算方法">
        <p className="font-mono text-cyan-600/80 dark:text-cyan-400/80">Net Liquidity = SOMA資産 − RRP − TGA</p>
        <p className="mt-2">10年間のNet Liquidity履歴からZ-scoreを算出し、ストレススコア（0-100）に変換：</p>
        <DocTable headers={['Z-score', 'ストレス', '解釈']}
          rows={[
            ['> +1.5', '0-15', '流動性豊富（QE期など）'],
            ['+0.5 〜 +1.5', '15-30', '安全圏'],
            ['-0.5 〜 +0.5', '30-50', '中立'],
            ['-1.5 〜 -0.5', '50-70', 'やや逼迫（QT期）'],
            ['< -1.5', '70-90', '流動性危機水準'],
            ['< -2.0', '90-100', '極度のストレス'],
          ]} />
      </DocSection>

      <DocSection title="Layer 2A: 銀行システム ─ 4指標ウェイト">
        <DocTable headers={['指標', 'ウェイト', '安全', '警戒', '危険']}
          rows={[
            ['SRF利用', '40%', '0日/30日', '3日以上', '10日以上（90日）'],
            ['準備預金 MoM', '20%', '> +3%', '-5% 〜 0%', '< -10%'],
            ['KRE 52W変化率', '20%', '> +10%', '-10% 〜 0%', '< -30%'],
            ['IGスプレッド', '20%', '< 1.0%', '1.0-1.5%', '> 2.0%'],
          ]} />
        <p className="mt-2 text-amber-600/70 dark:text-amber-400/70">解釈タイプ: スコア50以上の場合、SRF主導なら「FED_DEPENDENCY」、KRE/IG主導なら「CREDIT_STRESS」、両方なら「CRISIS」と判定。</p>
      </DocSection>

      <DocSection title="Layer 2B: リスク許容度 ─ ITバブル比較">
        <p className="font-mono text-cyan-600/80 dark:text-cyan-400/80">Score = 信用取引残高2Y変化率 × 0.8 + MMF変化率(反転) × 0.2</p>
        <p className="mt-2">ITバブルピーク時の2年変化率 <span className="text-red-600 dark:text-red-400 font-mono">+104.68%</span> を基準に現在の過熱度を比較。</p>
        <DocTable headers={['フェーズ', 'スコア', '意味']}
          rows={[
            ['悲観期', '0-20', '信用収縮中、逆張り機会'],
            ['回復期', '20-40', '信用回復中'],
            ['成長期', '40-60', '正常な信用拡大'],
            ['過熱期', '60-80', '信用拡大が加速'],
            ['バブル期', '80-100', 'ITバブルに匹敵する過熱'],
          ]} />
      </DocSection>

      <DocSection title="市場状態（State）判定ロジック">
        <p>3層のストレススコアの組み合わせから8つの市場状態を判定：</p>
        <DocTable headers={['状態', '条件', 'アクション']}
          rows={[
            ['流動性ショック', 'L2A >= 65', '防御態勢、現金比率UP'],
            ['信用収縮', 'L2A >= 50', '信用取引厳禁、様子見'],
            ['政策引き締め', 'L1 >= 45', 'リスク資産への逆風に注意'],
            ['分断型バブル', 'L2A >= 40 AND L2B >= 70', '段階的にリスク縮小'],
            ['市場先行型', 'L2B >= 80 AND L2A < 35', '利確検討、新規抑制'],
            ['金融相場', 'L1 < 30 AND L2B > 60', '積極的にリスクオン'],
            ['健全相場', '全Layer < 35-40', '通常投資を継続'],
            ['中立', 'いずれにも該当しない', '現状維持'],
          ]} />
        <p className="mt-2 text-muted-foreground">判定は上から順に評価され、最初に該当した状態が主状態となります。複数該当する場合はすべて表示されます。</p>
      </DocSection>

      <DocSection title="Layer 3: 信用圧力センサー">
        <DocTable headers={['指標', '安全', '警戒', '危険']}
          rows={[
            ['HYスプレッド', '< 4%', '4-5%', '> 5%'],
            ['IGスプレッド', '< 1%', '1-1.5%', '> 1.5%'],
            ['イールドカーブ (10Y-2Y)', '> 0.5%', '0 〜 0.5%', '逆転 (< 0)'],
            ['DXY (ドル指数)', '< 100', '100-110', '> 110'],
          ]} />
      </DocSection>

      <DocSection title="指標クイックリファレンス">
        <DocTable headers={['Layer', '指標', '安全', '警戒', '危険']}
          rows={[
            ['L1', 'Net Liq Z-score', '> +0.5', '-0.5 〜 +0.5', '< -1.5'],
            ['L2A', 'KRE 52W%', '> +20%', '-10% 〜 0%', '< -30%'],
            ['L2A', '準備預金 MoM%', '> +3%', '-5% 〜 0%', '< -10%'],
            ['L2A', 'SRF利用', '0日', '1-3日/30日', '> 10日/90日'],
            ['L2A', 'IGスプレッド', '< 1.0%', '1.0-1.5%', '> 2.0%'],
            ['L2B', '信用取引 2Y%', '< +30%', '+30-60%', '> +80%'],
            ['L3', 'HYスプレッド', '< 4%', '4-5%', '> 5%'],
            ['L3', 'VIX', '< 20', '20-30', '> 30'],
          ]} />
      </DocSection>

      <DocSection title="QE/QT（量的緩和/引き締め）の仕組み">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-emerald-500/20 p-3">
            <p className="text-emerald-600 dark:text-emerald-400 font-bold text-[11px]">QE（量的緩和）</p>
            <p className="mt-1">FRBが国債を購入 → SOMA資産増加 → 準備預金増加 → 市場に資金流入</p>
            <p className="text-[10px] text-muted-foreground mt-1">効果: 金利低下、資産価格上昇、ドル安</p>
          </div>
          <div className="rounded-lg border border-red-500/20 p-3">
            <p className="text-red-600 dark:text-red-400 font-bold text-[11px]">QT（量的引き締め）</p>
            <p className="mt-1">FRBが国債を満期償還 → SOMA資産減少 → 準備預金減少 → 市場から資金流出</p>
            <p className="text-[10px] text-muted-foreground mt-1">効果: 金利上昇、資産価格下落、ドル高</p>
          </div>
        </div>
      </DocSection>

      <DocSection title="用語集">
        <DocTable headers={['用語', '説明']}
          rows={[
            ['SOMA', 'System Open Market Account — FRBの保有資産（国債、MBS等）'],
            ['RRP', 'Reverse Repo — FRBが市場から資金を吸収する仕組み'],
            ['TGA', 'Treasury General Account — 財務省のFRB口座残高'],
            ['SRF', 'Standing Repo Facility — FRBの常設レポファシリティ（緊急流動性供給）'],
            ['KRE', 'SPDR S&P Regional Banking ETF — 地方銀行の健全性指標'],
            ['Z-score', '平均からの標準偏差数。±2以上は統計的に稀なイベント'],
            ['HYスプレッド', 'ハイイールド債と国債の利回り差。信用リスクの指標'],
            ['信用取引残高', 'マージン口座の借入残高。レバレッジの指標'],
          ]} />
      </DocSection>

      <DocSection title="データ更新タイミング">
        <DocTable headers={['データ', '頻度', '備考']}
          rows={[
            ['FRBバランスシート', '毎週', 'H.4.1レポート（木曜日）'],
            ['信用取引残高', '毎月', 'FINRA発表（約3週間遅延）⚠️'],
            ['VIX / KRE / SP500', '毎日', '市場営業日'],
            ['クレジットスプレッド', '毎日', 'FRED / ICE BofA'],
            ['SRF利用', '毎日', 'NY Fed公表'],
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
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-xl" />)}
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

export default function LiquidityPage() {
  return (
    <AuthGuard>
      <LiquidityContent />
    </AuthGuard>
  );
}

function LiquidityContent() {
  const { data, error: summaryError, isLoading, isValidating, mutate } = usePlumbingSummary();
  const { data: eventsData } = useMarketEvents();
  const { data: regimeData } = usePolicyRegime();

  const refreshing = isValidating && !isLoading;
  const handleRefresh = () => mutate();

  if (isLoading) return <LoadingSkeleton />;
  if (summaryError) return <ErrorState error={summaryError instanceof Error ? summaryError.message : 'データの取得に失敗しました'} onRetry={handleRefresh} />;
  if (!data) return null;

  return (
    <div className="space-y-4 pb-10">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 plumb-animate-in">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-blue-500 to-purple-500" />
            <h1 className="text-2xl font-bold tracking-tight">米国金融流動性モニター</h1>
          </div>
          <p className="text-xs text-muted-foreground pl-3.5">FRB・銀行・信用取引の3層流動性モニタリング</p>
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
          <TabsTrigger value="history" className="text-[11px] font-mono uppercase tracking-wider"><LineChart className="w-3.5 h-3.5 mr-1.5" />履歴グラフ</TabsTrigger>
          <TabsTrigger value="backtest" className="text-[11px] font-mono uppercase tracking-wider"><FlaskConical className="w-3.5 h-3.5 mr-1.5" />過去検証</TabsTrigger>
          <TabsTrigger value="docs" className="text-[11px] font-mono uppercase tracking-wider"><BookOpen className="w-3.5 h-3.5 mr-1.5" />システム解説</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <DashboardTab data={data} eventsData={eventsData ?? null} regimeData={regimeData ?? null} />
        </TabsContent>

        <TabsContent value="history">
          <HistoryChartsTab />
        </TabsContent>

        <TabsContent value="backtest">
          <BacktestTab />
        </TabsContent>

        <TabsContent value="docs">
          <SystemDocsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
