'use client';

import { useState, type ReactNode } from 'react';

// ============================================================
// Helper functions
// ============================================================

export function scoreHue(score: number) {
  if (score < 30) return { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', ring: 'stroke-emerald-500 dark:stroke-emerald-400', border: 'border-emerald-500/20' };
  if (score < 50) return { text: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/10', ring: 'stroke-yellow-500 dark:stroke-yellow-400', border: 'border-yellow-500/20' };
  if (score < 70) return { text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/10', ring: 'stroke-orange-500 dark:stroke-orange-400', border: 'border-orange-500/20' };
  return { text: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10', ring: 'stroke-red-500 dark:stroke-red-400', border: 'border-red-500/20' };
}

export function scoreBarClass(score: number): string {
  if (score < 30) return 'bg-emerald-500';
  if (score < 50) return 'bg-yellow-500';
  if (score < 70) return 'bg-orange-500';
  return 'bg-red-500';
}

export function scoreLabel(score: number): string {
  if (score < 30) return '安全';
  if (score < 50) return '注意';
  if (score < 70) return '警戒';
  return '危険';
}

// ============================================================
// Glass components
// ============================================================

export function GlassCard({ children, className = '', stagger = 0 }: {
  children: ReactNode; className?: string; stagger?: number;
}) {
  return (
    <div className={`plumb-glass plumb-glass-hover rounded-xl plumb-animate-in ${stagger > 0 ? `plumb-stagger-${stagger}` : ''} ${className}`}>
      {children}
    </div>
  );
}

export function ScoreRing({ score, size = 64, strokeWidth = 4 }: {
  score: number; size?: number; strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(score, 100) / 100) * circumference;
  const h = scoreHue(score);
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="plumb-score-ring">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-black/10 dark:text-white/5" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} className={`${h.ring} plumb-ring-progress`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-lg font-bold tabular-nums font-mono ${h.text}`}>{score}</span>
      </div>
    </div>
  );
}

export function GaugeBar({ score, className = '' }: { score: number; className?: string }) {
  return (
    <div className={`w-full h-1.5 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden ${className}`}>
      <div className={`h-full rounded-full plumb-gauge-bar ${scoreBarClass(score)}`} style={{ width: `${Math.min(score, 100)}%` }} />
    </div>
  );
}

export function Metric({ label, value, sub, children }: {
  label: string; value: string; sub?: string; children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2 group">
      <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium tabular-nums font-mono text-foreground">{value}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        {children}
      </div>
    </div>
  );
}

export function StatusChip({ label, color }: { label: string; color: string }) {
  const colorMap: Record<string, string> = {
    red: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/25',
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25',
    green: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
    blue: 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/25',
    purple: 'text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/25',
    orange: 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/25',
    cyan: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/25',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${colorMap[color] ?? colorMap.blue}`}>
      {label}
    </span>
  );
}

export function ScoreLegend() {
  const levels = [
    { range: '0-29', label: '安全', color: 'bg-emerald-500' },
    { range: '30-49', label: '注意', color: 'bg-yellow-500' },
    { range: '50-69', label: '警戒', color: 'bg-orange-500' },
    { range: '70+', label: '危険', color: 'bg-red-500' },
  ];
  return (
    <div className="flex items-center gap-3">
      {levels.map((l) => (
        <div key={l.range} className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${l.color}`} />
          <span className="text-xs text-muted-foreground font-mono">{l.range}</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Doc components (for system explanation tabs)
// ============================================================

export function DocSection({ title, children, defaultOpen = false }: {
  title: string; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <GlassCard>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-5 text-left">
        <h3 className="text-base font-bold text-foreground">{title}</h3>
        <svg className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed space-y-3 border-t border-border pt-4">
          {children}
        </div>
      )}
    </GlassCard>
  );
}

export function DocTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h, i) => <th key={i} className="text-left py-2 pr-4 text-muted-foreground font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50">
              {row.map((cell, j) => <td key={j} className="py-2 pr-4 font-mono text-foreground">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
