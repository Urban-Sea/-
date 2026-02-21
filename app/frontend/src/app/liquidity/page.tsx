'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getPlumbingSummary } from '@/lib/api';
import type { PlumbingSummary, LayerStress, CreditPressure, MarketStateInfo } from '@/types';

// ============================================================
// Helpers
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

// Score → color palette
function scoreHue(score: number): { text: string; bg: string; ring: string; glow: string; border: string } {
  if (score < 30) return {
    text: 'text-emerald-400', bg: 'bg-emerald-500/10', ring: 'stroke-emerald-400',
    glow: 'shadow-emerald-500/20', border: 'border-emerald-500/20',
  };
  if (score < 50) return {
    text: 'text-yellow-400', bg: 'bg-yellow-500/10', ring: 'stroke-yellow-400',
    glow: 'shadow-yellow-500/20', border: 'border-yellow-500/20',
  };
  if (score < 70) return {
    text: 'text-orange-400', bg: 'bg-orange-500/10', ring: 'stroke-orange-400',
    glow: 'shadow-orange-500/20', border: 'border-orange-500/20',
  };
  return {
    text: 'text-red-400', bg: 'bg-red-500/10', ring: 'stroke-red-400',
    glow: 'shadow-red-500/20', border: 'border-red-500/20',
  };
}

function scoreBarClass(score: number): string {
  if (score < 30) return 'bg-emerald-500';
  if (score < 50) return 'bg-yellow-500';
  if (score < 70) return 'bg-orange-500';
  return 'bg-red-500';
}

function scoreLabel(score: number): string {
  if (score < 30) return '安全';
  if (score < 50) return '注意';
  if (score < 70) return '警戒';
  return '危険';
}

function stateColors(color: string) {
  const map: Record<string, { text: string; bg: string; border: string; dot: string; glow: string }> = {
    green: { text: 'text-emerald-400', bg: 'bg-emerald-500/8', border: 'border-emerald-500/20', dot: 'bg-emerald-400', glow: 'shadow-emerald-500/10' },
    cyan: { text: 'text-cyan-400', bg: 'bg-cyan-500/8', border: 'border-cyan-500/20', dot: 'bg-cyan-400', glow: 'shadow-cyan-500/10' },
    yellow: { text: 'text-yellow-400', bg: 'bg-yellow-500/8', border: 'border-yellow-500/20', dot: 'bg-yellow-400', glow: 'shadow-yellow-500/10' },
    orange: { text: 'text-orange-400', bg: 'bg-orange-500/8', border: 'border-orange-500/20', dot: 'bg-orange-400', glow: 'shadow-orange-500/10' },
    red: { text: 'text-red-400', bg: 'bg-red-500/8', border: 'border-red-500/20', dot: 'bg-red-400 animate-pulse', glow: 'shadow-red-500/15' },
    gray: { text: 'text-zinc-400', bg: 'bg-zinc-500/8', border: 'border-zinc-500/20', dot: 'bg-zinc-400', glow: '' },
  };
  return map[color] || map.gray;
}

function sensorDot(status: string): string {
  if (status === 'danger') return 'bg-red-400 animate-pulse';
  if (status === 'warning') return 'bg-amber-400';
  return 'bg-emerald-400';
}

// ============================================================
// Score Ring SVG (circular gauge)
// ============================================================

function ScoreRing({ score, size = 64, strokeWidth = 4 }: {
  score: number; size?: number; strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(score, 100) / 100) * circumference;
  const h = scoreHue(score);

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="plumb-score-ring">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-white/5"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`${h.ring} plumb-ring-progress`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-lg font-bold tabular-nums font-mono ${h.text}`}>{score}</span>
      </div>
    </div>
  );
}

// Inline horizontal gauge
function GaugeBar({ score, className = '' }: { score: number; className?: string }) {
  return (
    <div className={`w-full h-1 rounded-full bg-white/[0.04] overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full plumb-gauge-bar ${scoreBarClass(score)}`}
        style={{ width: `${Math.min(score, 100)}%` }}
      />
    </div>
  );
}

// ============================================================
// Metric display
// ============================================================

function Metric({ label, value, sub, children }: {
  label: string; value: string; sub?: string; children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 group">
      <span className="text-xs text-zinc-500 group-hover:text-zinc-400 transition-colors">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium tabular-nums font-mono">{value}</span>
        {sub && <span className="text-[10px] text-zinc-600">{sub}</span>}
        {children}
      </div>
    </div>
  );
}

function StatusChip({ label, color }: { label: string; color: string }) {
  const colorMap: Record<string, string> = {
    red: 'text-red-400 bg-red-500/10 border-red-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    green: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${colorMap[color] ?? colorMap.blue}`}>
      {label}
    </span>
  );
}

// ============================================================
// Glass Card wrapper
// ============================================================

function GlassCard({ children, className = '', stagger = 0 }: {
  children: ReactNode; className?: string; stagger?: number;
}) {
  return (
    <div className={`
      plumb-glass plumb-glass-hover rounded-xl
      plumb-animate-in ${stagger > 0 ? `plumb-stagger-${stagger}` : ''}
      ${className}
    `}>
      {children}
    </div>
  );
}

// ============================================================
// Market State Hero
// ============================================================

function MarketStateHero({ state, l1, l2a, l2b }: {
  state: MarketStateInfo; l1: number; l2a: number; l2b: number;
}) {
  const c = stateColors(state.color);
  const isDanger = state.color === 'red' || state.color === 'orange';

  return (
    <div className={`
      relative rounded-2xl border ${c.border} overflow-hidden
      plumb-animate-scale
    `}>
      {/* Background glow */}
      <div className={`absolute inset-0 ${c.bg}`} />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] rounded-full blur-[100px] opacity-20 plumb-glow"
        style={{ background: state.color === 'green' ? '#10b981' : state.color === 'red' ? '#ef4444' : state.color === 'orange' ? '#f97316' : state.color === 'yellow' ? '#eab308' : state.color === 'cyan' ? '#06b6d4' : '#71717a' }}
      />

      <div className="relative p-6 md:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          {/* Left: State Info */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full ${c.dot} ring-4 ring-current/10`} />
              <h2 className={`text-3xl md:text-4xl font-bold tracking-tight ${c.text}`}>
                {state.label}
              </h2>
            </div>

            {state.state_count > 1 && (
              <div className="flex flex-wrap gap-1.5 pl-6">
                {state.all_states.slice(1).map((s) => {
                  const sc = stateColors(s.color);
                  return (
                    <Badge key={s.code} variant="outline" className={`${sc.text} ${sc.border} text-[10px] font-mono`}>
                      {s.label}
                    </Badge>
                  );
                })}
              </div>
            )}

            <p className="text-sm text-zinc-400 max-w-lg leading-relaxed pl-6">
              {state.description}
            </p>

            <div className={`
              inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium ml-6
              ${isDanger ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-zinc-800/50 text-zinc-300 border border-zinc-700/50'}
            `}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              {state.action}
            </div>
          </div>

          {/* Right: Score Rings */}
          <div className="flex items-center gap-6 lg:gap-8">
            {[
              { label: 'L1', sub: '政策', score: l1, accent: 'text-blue-400' },
              { label: 'L2A', sub: '銀行', score: l2a, accent: 'text-purple-400' },
              { label: 'L2B', sub: '市場', score: l2b, accent: 'text-cyan-400' },
            ].map((item) => (
              <div key={item.label} className="text-center space-y-1">
                <ScoreRing score={item.score} size={72} strokeWidth={5} />
                <p className={`text-[10px] font-bold uppercase tracking-widest ${item.accent}`}>{item.label}</p>
                <p className="text-[10px] text-zinc-500">{item.sub}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Comment */}
        {state.comment && (
          <div className="mt-5 rounded-lg bg-black/30 border border-white/[0.04] p-4 text-sm text-zinc-300 leading-relaxed plumb-shimmer-bg">
            {state.comment}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Market Indicators Ticker Bar
// ============================================================

function IndicatorBar({ indicators }: {
  indicators: { vix?: number; dxy?: number; sp500?: number; nasdaq?: number } | null;
}) {
  if (!indicators) return null;

  const vixColor = (v: number) => v > 30 ? 'text-red-400' : v > 20 ? 'text-amber-400' : 'text-emerald-400';
  const dxyColor = (v: number) => v > 110 ? 'text-amber-400' : 'text-zinc-200';

  const items = [
    { label: 'VIX', value: indicators.vix, format: (v: number) => v.toFixed(2), color: indicators.vix ? vixColor(indicators.vix) : '' },
    { label: 'DXY', value: indicators.dxy, format: (v: number) => v.toFixed(2), color: indicators.dxy ? dxyColor(indicators.dxy) : '' },
    { label: 'S&P 500', value: indicators.sp500, format: (v: number) => fmt(v), color: 'text-zinc-200' },
    { label: 'NASDAQ', value: indicators.nasdaq, format: (v: number) => fmt(v), color: 'text-zinc-200' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 plumb-animate-in plumb-stagger-2">
      {items.map((item) => (
        <div key={item.label} className="plumb-glass rounded-lg px-4 py-3 flex items-center justify-between plumb-glass-hover">
          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{item.label}</span>
          <span className={`text-base font-bold tabular-nums font-mono ${item.color}`}>
            {item.value != null ? item.format(item.value) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Layer Cards
// ============================================================

function LayerHeader({ number, label, sub, color, score }: {
  number: string; label: string; sub: string; color: string; score: number;
}) {
  const h = scoreHue(score);
  return (
    <div className="p-5 pb-3">
      <div className="flex items-start justify-between">
        <div className="space-y-0.5">
          <p className={`text-[10px] font-bold uppercase tracking-[0.2em] ${color}`}>{number}</p>
          <h3 className="text-base font-bold">{label}</h3>
          <p className="text-[11px] text-zinc-500">{sub}</p>
        </div>
        <div className="flex flex-col items-center gap-1">
          <ScoreRing score={score} size={56} strokeWidth={4} />
          <Badge variant="outline" className={`text-[9px] ${h.text} ${h.border} font-mono`}>
            {scoreLabel(score)}
          </Badge>
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
      <LayerHeader
        number="LAYER 1" label="政策流動性" sub="元栓 — FRBバランスシート"
        color="text-blue-400" score={layer.stress_score}
      />
      <div className="px-5 pb-5 space-y-3">
        <p className="text-xs text-zinc-400 leading-relaxed">{layer.interpretation}</p>

        {fed && (
          <>
            <div className="rounded-lg bg-black/20 p-3 space-y-0.5">
              <Metric label="SOMA資産" value={fmtB(fed.soma_assets)} />
              <Metric label="準備預金" value={fmtB(fed.reserves)} />
              <Metric label="RRP" value={fmtB(fed.rrp)} />
              <Metric label="TGA" value={fmtB(fed.tga)} />
            </div>

            {/* Net Liquidity highlight */}
            <div className="rounded-lg bg-blue-500/[0.06] border border-blue-500/10 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-blue-400/70 uppercase tracking-wider font-medium">純流動性</p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">SOMA − RRP − TGA</p>
                </div>
                <p className="text-xl font-bold tabular-nums font-mono text-blue-400">{fmtB(netLiq)}</p>
              </div>
              {layer.z_score != null && (
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-blue-500/10">
                  <span className="text-[10px] text-zinc-500">Z-Score</span>
                  <span className={`text-xs font-mono font-bold ${layer.z_score > 1 ? 'text-emerald-400' : layer.z_score < -1 ? 'text-red-400' : 'text-zinc-300'}`}>
                    {layer.z_score > 0 ? '+' : ''}{layer.z_score}
                  </span>
                </div>
              )}
            </div>

            <p className="text-[10px] text-zinc-600 font-mono">UPD {fed.date}</p>
          </>
        )}
      </div>
    </GlassCard>
  );
}

function Layer2ACard({ layer }: { layer: LayerStress }) {
  const c = layer.components as Record<string, unknown> | undefined;

  return (
    <GlassCard stagger={4} className="plumb-gradient-border before:bg-gradient-to-b before:from-purple-500/30 before:to-transparent">
      <LayerHeader
        number="LAYER 2A" label="銀行システム" sub="配管 — 準備預金・KRE・SRF"
        color="text-purple-400" score={layer.stress_score}
      />
      <div className="px-5 pb-5 space-y-3">
        <p className="text-xs text-zinc-400 leading-relaxed">{layer.interpretation}</p>

        {c && (
          <div className="rounded-lg bg-black/20 p-3 space-y-0.5">
            {c.reserves_value != null && (
              <Metric label="準備預金" value={fmtB(c.reserves_value as number)}>
                {c.reserves_change_mom != null && (
                  <StatusChip
                    label={`${(c.reserves_change_mom as number) > 0 ? '+' : ''}${(c.reserves_change_mom as number).toFixed(1)}%`}
                    color={(c.reserves_change_mom as number) < 0 ? 'red' : 'green'}
                  />
                )}
              </Metric>
            )}
            {c.kre_52w_change != null && (
              <Metric label="KRE 52W変化率" value={fmtPct(c.kre_52w_change as number, 1)}>
                <StatusChip
                  label={(c.kre_52w_change as number) < -20 ? '危険' : (c.kre_52w_change as number) < -10 ? '警戒' : '安定'}
                  color={(c.kre_52w_change as number) < -20 ? 'red' : (c.kre_52w_change as number) < -10 ? 'amber' : 'green'}
                />
              </Metric>
            )}
            {c.srf_usage != null && (
              <Metric label="SRF利用 (30日)" value={`$${fmt(c.srf_usage as number)}B`} />
            )}
            {c.ig_spread != null && (
              <Metric label="IGスプレッド" value={fmtPctNoSign(c.ig_spread as number)}>
                <StatusChip
                  label={(c.ig_spread as number) > 1.5 ? '拡大' : '正常'}
                  color={(c.ig_spread as number) > 1.5 ? 'red' : (c.ig_spread as number) > 1.0 ? 'amber' : 'green'}
                />
              </Metric>
            )}
          </div>
        )}

        {/* Alerts */}
        {layer.alerts && layer.alerts.length > 0 && (
          <div className="space-y-1.5">
            {layer.alerts.map((alert, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/[0.05] border border-amber-500/10">
                <span className="text-amber-400 text-[10px] mt-0.5 shrink-0">&#9650;</span>
                <span className="text-[11px] text-amber-300/90">{alert}</span>
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
      <LayerHeader
        number="LAYER 2B" label="リスク許容度" sub="蛇口 — 信用取引・MMF"
        color="text-cyan-400" score={layer.stress_score}
      />
      <div className="px-5 pb-5 space-y-3">
        {/* Margin Debt */}
        <div className="rounded-lg bg-black/20 p-3 space-y-0.5">
          {layer.margin_debt_2y != null && (
            <Metric label="信用取引 2Y変化率" value={fmtPct(layer.margin_debt_2y, 1)} />
          )}
          {layer.margin_debt_1y != null && (
            <Metric label="信用取引 1Y変化率" value={fmtPct(layer.margin_debt_1y, 1)} sub="参考" />
          )}
          {layer.components && (layer.components as Record<string, unknown>).mmf_change != null && (
            <Metric label="MMF 3M変化率" value={fmtPctNoSign((layer.components as Record<string, unknown>).mmf_change as number, 1)} sub="逆相関" />
          )}
        </div>

        {/* IT Bubble Comparison — the premium gauge */}
        {layer.it_bubble_comparison != null && (
          <div className="rounded-lg bg-black/20 border border-white/[0.03] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">ITバブル比較</p>
              <span className={`text-sm font-bold tabular-nums font-mono ${itPct >= 80 ? 'text-red-400' : itPct >= 60 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {itPct.toFixed(0)}%
              </span>
            </div>

            {/* Multi-segment gauge */}
            <div className="relative">
              <div className="flex h-2.5 rounded-full overflow-hidden bg-zinc-800/80">
                {/* Green zone 0-50 */}
                <div className="h-full bg-emerald-500/30" style={{ width: '50%' }} />
                {/* Yellow zone 50-70 */}
                <div className="h-full bg-yellow-500/30" style={{ width: '20%' }} />
                {/* Orange zone 70-90 */}
                <div className="h-full bg-orange-500/30" style={{ width: '20%' }} />
                {/* Red zone 90-100 */}
                <div className="h-full bg-red-500/30" style={{ width: '10%' }} />
              </div>
              {/* Current position indicator */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-1 h-4 rounded-full bg-white shadow-lg shadow-white/20 transition-all duration-1000"
                style={{ left: `${Math.min(itPct, 100)}%` }}
              />
            </div>

            <div className="flex justify-between text-[9px] text-zinc-600 font-mono">
              <span>0</span>
              <span className="text-zinc-500">50</span>
              <span className="text-amber-500/60">70</span>
              <span className="text-red-500/60">PEAK {layer.it_bubble_peak?.toFixed(0)}%</span>
            </div>
          </div>
        )}

        {layer.phase && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500">フェーズ</span>
            <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-500/20 font-mono">
              {layer.phase}
            </Badge>
          </div>
        )}

        {layer.data_date && (
          <p className="text-[10px] text-zinc-600 font-mono">UPD {layer.data_date}</p>
        )}
      </div>
    </GlassCard>
  );
}

// ============================================================
// Net Liquidity Flow — Pipeline Visualization
// ============================================================

function NetLiquidityFlow({ fed }: {
  fed: { soma_assets: number | null; rrp: number | null; tga: number | null } | undefined;
}) {
  if (!fed) return null;
  const soma = fed.soma_assets ?? 0;
  const rrp = fed.rrp ?? 0;
  const tga = fed.tga ?? 0;
  const net = soma - rrp - tga;
  const max = soma || 1;

  const segments = [
    { label: 'SOMA', value: soma, pct: 100, color: 'border-blue-500/20 bg-blue-500/[0.06]', accent: 'text-blue-400', op: '' },
    { label: 'RRP', value: rrp, pct: (rrp / max) * 100, color: 'border-orange-500/20 bg-orange-500/[0.06]', accent: 'text-orange-400', op: '−' },
    { label: 'TGA', value: tga, pct: (tga / max) * 100, color: 'border-amber-500/20 bg-amber-500/[0.06]', accent: 'text-amber-400', op: '−' },
    { label: 'NET', value: net, pct: (net / max) * 100, color: 'border-emerald-500/20 bg-emerald-500/[0.06] ring-1 ring-emerald-500/10', accent: 'text-emerald-400', op: '=' },
  ];

  return (
    <GlassCard stagger={6}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 rounded-full bg-blue-500" />
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">純流動性フロー</p>
          </div>
          <p className="text-xs text-zinc-500 font-mono">SOMA − RRP − TGA = Net</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {segments.map((s) => (
            <div key={s.label} className={`rounded-xl border p-4 ${s.color} plumb-flow-pipe transition-all duration-300 hover:scale-[1.02]`}>
              <div className="flex items-center gap-1.5 mb-2">
                {s.op && <span className="text-[10px] text-zinc-500 font-mono">{s.op}</span>}
                <p className={`text-[10px] font-bold uppercase tracking-wider ${s.accent}`}>{s.label}</p>
              </div>
              <p className={`text-xl font-bold tabular-nums font-mono ${s.accent}`}>{fmtB(s.value)}</p>
              <div className="mt-3 h-1 rounded-full bg-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded-full bg-current opacity-30 plumb-gauge-bar"
                  style={{ width: `${Math.min(Math.max(s.pct, 0), 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

// ============================================================
// Credit Pressure — Sensor Grid
// ============================================================

function CreditPressurePanel({ credit }: { credit: CreditPressure }) {
  const levelColor = credit.level === 'High' ? 'text-red-400' : credit.level === 'Medium' ? 'text-amber-400' : 'text-emerald-400';
  const levelBg = credit.level === 'High' ? 'bg-red-500/10 border-red-500/20' : credit.level === 'Medium' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20';

  const sensors = [
    {
      label: 'HYスプレッド', sub: 'ハイイールド債',
      value: credit.components.hy_spread?.value,
      format: fmtPctNoSign, status: credit.components.hy_spread?.status ?? 'normal',
      info: '> 5% 危険',
    },
    {
      label: 'IGスプレッド', sub: '投資適格債',
      value: credit.components.ig_spread?.value,
      format: fmtPctNoSign, status: credit.components.ig_spread?.status ?? 'normal',
      info: '> 1.5% 危険',
    },
    {
      label: 'イールドカーブ', sub: '10Y − 2Y',
      value: credit.components.yield_curve?.value,
      format: (v: number | null | undefined) => {
        if (v == null) return '—';
        return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
      },
      status: credit.components.yield_curve?.status ?? 'normal',
      info: '逆転 = 景気後退',
    },
    {
      label: 'DXY', sub: 'ドル指数',
      value: credit.components.dxy?.value,
      format: (v: number | null | undefined) => v != null ? v.toFixed(1) : '—',
      status: credit.components.dxy?.status ?? 'normal',
      info: '> 110 ドル高警戒',
    },
  ];

  return (
    <GlassCard stagger={7}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 rounded-full bg-amber-500" />
            <div>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">信用圧力センサー</p>
              <p className="text-[10px] text-zinc-600">Layer 3 — クレジット・金利・為替の横断圧力</p>
            </div>
          </div>
          <Badge className={`${levelBg} ${levelColor} border text-[10px] font-mono`}>
            {credit.level === 'High' ? 'HIGH' : credit.level === 'Medium' ? 'MED' : 'LOW'}
          </Badge>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {sensors.map((s) => (
            <Tooltip key={s.label}>
              <TooltipTrigger asChild>
                <div className="rounded-xl bg-black/20 border border-white/[0.03] p-4 text-center transition-all duration-200 hover:border-white/[0.08] hover:bg-black/30 cursor-default">
                  <div className="flex items-center justify-center gap-1.5 mb-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${sensorDot(s.status)}`} />
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{s.label}</p>
                  </div>
                  <p className={`text-xl font-bold tabular-nums font-mono ${
                    s.status === 'danger' ? 'text-red-400' : s.status === 'warning' ? 'text-amber-400' : 'text-zinc-200'
                  }`}>
                    {s.format(s.value)}
                  </p>
                  <p className="text-[9px] text-zinc-600 mt-1.5">{s.sub}</p>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{s.info}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Alerts */}
        {credit.alerts.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {credit.alerts.map((alert, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/[0.04] border border-amber-500/[0.08]">
                <span className="text-amber-400 text-[10px] mt-0.5 shrink-0">&#9650;</span>
                <span className="text-[11px] text-amber-300/80">{alert}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

// ============================================================
// Score Legend
// ============================================================

function ScoreLegend() {
  const levels = [
    { range: '0-29', label: '安全', color: 'bg-emerald-500' },
    { range: '30-49', label: '注意', color: 'bg-yellow-500' },
    { range: '50-69', label: '警戒', color: 'bg-orange-500' },
    { range: '70+', label: '危険', color: 'bg-red-500' },
  ];

  return (
    <div className="flex items-center gap-3">
      {levels.map((l) => (
        <div key={l.range} className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${l.color}`} />
          <span className="text-[9px] text-zinc-500 font-mono">{l.range}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Loading
// ============================================================

function LoadingSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-20" />
      </div>
      <Skeleton className="h-56 w-full rounded-2xl" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-80 rounded-xl" />)}
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-44 w-full rounded-xl" />
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
      <h2 className="text-lg font-bold mb-2">データ取得エラー</h2>
      <p className="text-sm text-zinc-500 mb-5 text-center max-w-md">{error}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        再試行
      </Button>
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================

export default function LiquidityPage() {
  const [data, setData] = useState<PlumbingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const summary = await getPlumbingSummary();
      setData(summary);
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

  const { layers, market_state, credit_pressure, market_indicators } = data;
  const l1 = layers.layer1;
  const l2a = layers.layer2a;
  const l2b = layers.layer2b;

  return (
    <div className="space-y-4 pb-10">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 plumb-animate-in">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-blue-500 to-purple-500" />
            <h1 className="text-2xl font-bold tracking-tight">流動性配管システム</h1>
          </div>
          <p className="text-xs text-zinc-500 pl-3.5">
            FRB・銀行・信用取引の3層流動性モニタリング
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ScoreLegend />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="text-xs font-mono"
          >
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

      {/* Market State Hero */}
      {market_state && l1 && l2a && l2b && (
        <MarketStateHero
          state={market_state}
          l1={l1.stress_score}
          l2a={l2a.stress_score}
          l2b={l2b.stress_score}
        />
      )}

      {/* Market Indicators */}
      <IndicatorBar indicators={market_indicators} />

      {/* Three Layer Cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        {l1 && <Layer1Card layer={l1} />}
        {l2a && <Layer2ACard layer={l2a} />}
        {l2b && <Layer2BCard layer={l2b} />}
      </div>

      {/* Net Liquidity Flow */}
      {l1?.fed_data && <NetLiquidityFlow fed={l1.fed_data} />}

      {/* Credit Pressure */}
      {credit_pressure && <CreditPressurePanel credit={credit_pressure} />}

      {/* Timestamp */}
      <div className="flex justify-end">
        <p className="text-[10px] text-zinc-600 font-mono">
          {data.timestamp ? `LAST UPDATE ${new Date(data.timestamp).toLocaleString('ja-JP')}` : ''}
        </p>
      </div>
    </div>
  );
}
