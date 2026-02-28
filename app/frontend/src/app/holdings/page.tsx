'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Briefcase, TrendingUp, ArrowLeftRight, PieChart } from 'lucide-react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { AuthGuard } from '@/components/providers/AuthGuard';
import {
  useHoldingsInit, useTrades, useTradeStats, useBatchQuotes,
  usePortfolioHistory, useCashBalances,
  createHolding, updateHolding, deleteHolding, sellFromHolding,
  createCashBalance, updateCashBalance, deleteCashBalance,
} from '@/lib/api';
import { GlassCard, StatusChip, ScoreRing } from '@/components/shared/glass';
import { TickerIcon } from '@/components/shared/TickerIcon';
import DonutChart from '@/components/charts/DonutChart';
import EconChartCanvas from '@/components/charts/EconChartCanvas';
import type { ChartSeries } from '@/components/charts/EconChartCanvas';
import type { DonutSegment } from '@/components/charts/DonutChart';
import type { HoldingRecord, TradeRecord, TradeStats, StockQuote } from '@/types';

// ============================================================
// Constants & Helpers
// ============================================================

const SECTOR_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  'AI Infrastructure': { text: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/25' },
  'AI Chips':          { text: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/25' },
  'Space':             { text: 'text-cyan-600 dark:text-cyan-400',   bg: 'bg-cyan-500/10',   border: 'border-cyan-500/25' },
  'Nuclear':           { text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/25' },
  'Power Grid':        { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25' },
  'Robotics':          { text: 'text-pink-600 dark:text-pink-400',   bg: 'bg-pink-500/10',   border: 'border-pink-500/25' },
  'Drones':            { text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-500/10',  border: 'border-amber-500/25' },
  'Defense':           { text: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-500/10',  border: 'border-slate-500/25' },
  'Quantum':           { text: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/25' },
  'Crypto':            { text: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/25' },
  'Rare Minerals':     { text: 'text-teal-600 dark:text-teal-400',  bg: 'bg-teal-500/10',   border: 'border-teal-500/25' },
  'Finance':           { text: 'text-teal-600 dark:text-teal-400',  bg: 'bg-teal-500/10',   border: 'border-teal-500/25' },
  'Battery':           { text: 'text-lime-600 dark:text-lime-400',  bg: 'bg-lime-500/10',   border: 'border-lime-500/25' },
  'Tech':              { text: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/25' },
  'Index':             { text: 'text-zinc-600 dark:text-zinc-400',   bg: 'bg-zinc-500/10',   border: 'border-zinc-500/25' },
  'Other':             { text: 'text-zinc-500 dark:text-zinc-500',   bg: 'bg-zinc-500/10',   border: 'border-zinc-500/25' },
};

const SECTOR_OPTIONS = [
  'Space', 'AI Infrastructure', 'AI Chips', 'Nuclear', 'Power Grid',
  'Robotics', 'Drones', 'Defense', 'Quantum', 'Crypto',
  'Rare Minerals', 'Finance', 'Battery', 'Tech', 'Index', 'Other',
];

const ACCOUNT_COLORS: Record<string, { chipColor: string; border: string; text: string }> = {
  nisa:    { chipColor: 'green', border: 'border-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  tokutei: { chipColor: 'orange', border: 'border-orange-500', text: 'text-orange-600 dark:text-orange-400' },
};

const DONUT_SECTOR_COLORS: Record<string, string> = {
  'AI Infrastructure': '#a855f7', 'AI Chips': '#3b82f6',
  'Space': '#06b6d4', 'Nuclear': '#f97316', 'Power Grid': '#10b981',
  'Robotics': '#ec4899', 'Drones': '#f59e0b', 'Defense': '#64748b',
  'Quantum': '#8b5cf6', 'Crypto': '#eab308', 'Rare Minerals': '#14b8a6',
  'Finance': '#0d9488', 'Battery': '#84cc16', 'Tech': '#6366f1',
  'Index': '#71717a', 'Other': '#52525b',
};

const STOCK_PALETTE = [
  '#3b82f6', '#a855f7', '#06b6d4', '#10b981', '#f97316',
  '#ec4899', '#eab308', '#8b5cf6', '#14b8a6', '#6366f1',
];

function formatUSD(v: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
}
function formatJPY(v: number): string {
  return `¥${Math.round(v).toLocaleString('ja-JP')}`;
}
function formatPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}
function formatDate(d?: string): string {
  if (!d) return '—';
  return d.split('T')[0];
}
function sectorColor(sector?: string) {
  return SECTOR_COLORS[sector || 'Other'] || SECTOR_COLORS['Other'];
}
function accountLabel(type?: string): string {
  return type === 'nisa' ? 'NISA' : '特定';
}
function pnlClass(v: number): string {
  return v >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
}
function formatPrice(v: number, country: 'US' | 'JP'): string {
  return country === 'JP' ? formatJPY(v) : formatUSD(v);
}
function toUsd(value: number, country: 'US' | 'JP', fxRate: number): number {
  return country === 'JP' ? value / (fxRate > 0 ? fxRate : 150) : value;
}

// ============================================================
// FX Bar
// ============================================================

function FxBar({ fxRate, isLive, onFxRateChange }: { fxRate: number; isLive: boolean; onFxRateChange: (r: number) => void }) {
  return (
    <div className="plumb-glass rounded-lg px-4 py-3 flex items-center justify-between plumb-glass-hover plumb-animate-in plumb-stagger-1">
      <div className="flex items-center gap-4">
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">USD/JPY</span>
        <span className="text-lg font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">{fxRate.toFixed(2)}</span>
        {isLive && <span className="text-[9px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">LIVE</span>}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">上書き:</span>
        <Input
          type="number"
          step="0.01"
          key={fxRate}
          defaultValue={fxRate}
          className="w-24 h-7 text-xs font-mono text-right"
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v > 0) onFxRateChange(v);
          }}
        />
      </div>
    </div>
  );
}

// ============================================================
// Portfolio Hero (6 metrics)
// ============================================================

function PortfolioHero({ holdings, quotes, fxRate }: {
  holdings: HoldingRecord[]; quotes: Map<string, StockQuote>; fxRate: number;
}) {
  const totals = useMemo(() => {
    let valUsd = 0, costUsd = 0, valJpy = 0, costJpy = 0, fxPnl = 0;
    for (const h of holdings) {
      const country = inferCountry(h.ticker);
      const price = quotes.get(h.ticker)?.price ?? h.avg_price;
      const mv = h.shares * price;
      const cost = h.shares * h.avg_price;

      if (country === 'JP') {
        valUsd += mv / fxRate;
        costUsd += cost / fxRate;
        valJpy += mv;
        costJpy += cost;
      } else {
        valUsd += mv;
        costUsd += cost;
        valJpy += mv * fxRate;
        costJpy += cost * (h.fx_rate || fxRate);
        fxPnl += h.shares * h.avg_price * (fxRate - (h.fx_rate || fxRate));
      }
    }
    const pnlUsd = valUsd - costUsd;
    const pnlPctUsd = costUsd > 0 ? (pnlUsd / costUsd) * 100 : 0;
    const pnlJpy = valJpy - costJpy;
    const pnlPctJpy = costJpy > 0 ? (pnlJpy / costJpy) * 100 : 0;
    return { valUsd, valJpy, costUsd, costJpy, pnlUsd, pnlPctUsd, pnlJpy, pnlPctJpy, fxPnl };
  }, [holdings, quotes, fxRate]);

  const items = [
    { label: '総評価額', value: formatUSD(totals.valUsd), sub: formatJPY(totals.valJpy), color: '' },
    { label: '総取得額', value: formatUSD(totals.costUsd), sub: formatJPY(totals.costJpy), color: 'text-zinc-400' },
    { label: '含み損益 USD', value: formatUSD(totals.pnlUsd), sub: formatPct(totals.pnlPctUsd), color: pnlClass(totals.pnlUsd) },
    { label: '円換算損益', value: formatJPY(totals.pnlJpy), sub: formatPct(totals.pnlPctJpy), color: pnlClass(totals.pnlJpy) },
    { label: '為替損益', value: formatJPY(totals.fxPnl), sub: '', color: pnlClass(totals.fxPnl) },
    { label: '銘柄数', value: String(holdings.length), sub: '', color: 'text-blue-600 dark:text-blue-400' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 plumb-animate-in plumb-stagger-2">
      {items.map((item) => (
        <div key={item.label} className="plumb-glass rounded-lg px-4 py-3.5 plumb-glass-hover">
          <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-1">{item.label}</span>
          <span className={`text-lg font-bold tabular-nums font-mono ${item.color}`}>{item.value}</span>
          {item.sub && <span className="text-xs text-muted-foreground font-mono block mt-0.5">{item.sub}</span>}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Account Breakdown (NISA vs 特定)
// ============================================================

function AccountBreakdown({ holdings, quotes, fxRate }: {
  holdings: HoldingRecord[]; quotes: Map<string, StockQuote>; fxRate: number;
}) {
  const calc = useCallback((items: HoldingRecord[]) => {
    let val = 0, cost = 0;
    for (const h of items) {
      const country = inferCountry(h.ticker);
      const price = quotes.get(h.ticker)?.price ?? h.avg_price;
      val += toUsd(h.shares * price, country, fxRate);
      cost += toUsd(h.shares * h.avg_price, country, fxRate);
    }
    return { val, cost, pnl: val - cost, pct: cost > 0 ? ((val - cost) / cost) * 100 : 0, count: items.length };
  }, [quotes, fxRate]);

  const nisa = useMemo(() => calc(holdings.filter(h => h.account_type === 'nisa')), [holdings, calc]);
  const tokutei = useMemo(() => calc(holdings.filter(h => h.account_type !== 'nisa')), [holdings, calc]);

  const accounts = [
    { key: 'nisa', label: 'NISA口座', data: nisa, borderColor: 'border-l-emerald-500', titleColor: 'text-emerald-600 dark:text-emerald-400' },
    { key: 'tokutei', label: '特定口座', data: tokutei, borderColor: 'border-l-orange-500', titleColor: 'text-orange-600 dark:text-orange-400' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 plumb-animate-in plumb-stagger-3">
      {accounts.map(({ key, label, data, borderColor, titleColor }) => (
        <GlassCard key={key} className={`border-l-4 ${borderColor}`}>
          <div className="p-4">
            <p className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-3 ${titleColor}`}>{label}</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">評価額</p>
                <p className="text-sm font-bold font-mono tabular-nums">{formatUSD(data.val)}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{formatJPY(data.val * fxRate)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">含み損益</p>
                <p className={`text-sm font-bold font-mono tabular-nums ${pnlClass(data.pnl)}`}>{formatUSD(data.pnl)}</p>
                <p className={`text-[10px] font-mono ${pnlClass(data.pnl)}`}>{formatPct(data.pct)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">銘柄数</p>
                <p className="text-sm font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">{data.count}</p>
              </div>
            </div>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

// ============================================================
// Portfolio Charts (3 donut charts)
// ============================================================

function inferCountry(ticker: string): 'US' | 'JP' {
  if (/^\d+$/.test(ticker) || /^\d+\.T$/i.test(ticker)) return 'JP';
  return 'US';
}

const COUNTRY_COLORS: Record<string, string> = { US: '#3b82f6', JP: '#ef4444' };
const COUNTRY_LABELS: Record<string, string> = { US: '米国株', JP: '日本株' };

function PortfolioCharts({ holdings, quotes, fxRate }: {
  holdings: HoldingRecord[]; quotes: Map<string, StockQuote>; fxRate: number;
}) {
  const { sectorSegments, countrySegments, stockSegments, totalValUsd } = useMemo(() => {
    const sectorMap = new Map<string, number>();
    const countryMap = new Map<string, number>();
    const stockMap = new Map<string, number>();

    let totalVal = 0;
    for (const h of holdings) {
      const country = inferCountry(h.ticker);
      const price = quotes.get(h.ticker)?.price ?? h.avg_price;
      const mvUsd = toUsd(h.shares * price, country, fxRate);
      totalVal += mvUsd;

      const sector = h.sector || 'Other';
      sectorMap.set(sector, (sectorMap.get(sector) || 0) + mvUsd);

      countryMap.set(country, (countryMap.get(country) || 0) + mvUsd);

      stockMap.set(h.ticker, (stockMap.get(h.ticker) || 0) + mvUsd);
    }

    const sectorSegs: DonutSegment[] = Array.from(sectorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({
        label,
        value,
        color: DONUT_SECTOR_COLORS[label] || DONUT_SECTOR_COLORS['Other'],
      }));

    const countrySegs: DonutSegment[] = Array.from(countryMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({
        label: COUNTRY_LABELS[key] || key,
        value,
        color: COUNTRY_COLORS[key] || '#71717a',
      }));

    const stockSegs: DonutSegment[] = Array.from(stockMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], i) => ({
        label,
        value,
        color: STOCK_PALETTE[i % STOCK_PALETTE.length],
      }));

    return { sectorSegments: sectorSegs, countrySegments: countrySegs, stockSegments: stockSegs, totalValUsd: totalVal };
  }, [holdings, quotes]);

  if (holdings.length === 0) return null;

  const charts = [
    {
      title: 'セクター配分',
      segments: sectorSegments,
      centerValue: formatUSD(totalValUsd),
      centerLabel: '総評価額',
    },
    {
      title: '国別配分',
      segments: countrySegments,
      centerValue: String(countrySegments.length),
      centerLabel: '市場',
    },
    {
      title: '銘柄別配分',
      segments: stockSegments,
      centerValue: String(new Set(holdings.map(h => h.ticker)).size),
      centerLabel: '銘柄数',
    },
  ];

  return (
    <div className="plumb-animate-in plumb-stagger-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400 mb-2">ポートフォリオ配分</p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {charts.map((c) => (
          <GlassCard key={c.title}>
            <div className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">{c.title}</p>
              <DonutChart
                segments={c.segments}
                height={240}
                centerValue={c.centerValue}
                centerLabel={c.centerLabel}
                valueFormat={formatUSD}
                maxSegments={8}
              />
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Sector Breakdown
// ============================================================

function SectorBreakdown({ holdings, quotes, fxRate }: {
  holdings: HoldingRecord[]; quotes: Map<string, StockQuote>; fxRate: number;
}) {
  const sectors = useMemo(() => {
    const map = new Map<string, { val: number; cost: number; count: number }>();
    for (const h of holdings) {
      const sector = h.sector || 'Other';
      const country = inferCountry(h.ticker);
      const price = quotes.get(h.ticker)?.price ?? h.avg_price;
      const prev = map.get(sector) || { val: 0, cost: 0, count: 0 };
      prev.val += toUsd(h.shares * price, country, fxRate);
      prev.cost += toUsd(h.shares * h.avg_price, country, fxRate);
      prev.count += 1;
      map.set(sector, prev);
    }
    return Array.from(map.entries())
      .map(([name, d]) => ({ name, ...d, pnl: d.val - d.cost }))
      .sort((a, b) => b.val - a.val);
  }, [holdings, quotes, fxRate]);

  if (sectors.length === 0) return null;

  return (
    <div className="plumb-animate-in plumb-stagger-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400 mb-2">セクター別</p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
        {sectors.map(({ name, val, pnl }) => {
          const sc = sectorColor(name);
          return (
            <div key={name} className={`plumb-glass rounded-lg p-3 border-l-4 ${sc.border} plumb-glass-hover`}>
              <p className={`text-[11px] font-semibold mb-1 ${sc.text}`}>{name}</p>
              <p className="text-sm font-bold font-mono tabular-nums">{formatUSD(val)}</p>
              <p className="text-[10px] text-muted-foreground font-mono">{formatJPY(val * fxRate)}</p>
              <p className={`text-[10px] font-mono mt-1 ${pnlClass(pnl)}`}>{formatUSD(pnl)} ({formatPct(val > 0 ? (pnl / (val - pnl)) * 100 : 0)})</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Holdings Table
// ============================================================

type SortKey = 'ticker' | 'shares' | 'avg_price' | 'price' | 'market_value' | 'pnl';
type SortDir = 'asc' | 'desc';

function SortableHeader({ label, sortKey: key, currentKey, currentDir, onSort, align }: {
  label: string; sortKey: SortKey; currentKey: SortKey; currentDir: SortDir;
  onSort: (k: SortKey) => void; align?: 'right';
}) {
  const active = currentKey === key;
  return (
    <TableHead
      className={`text-[10px] uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => onSort(key)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active ? (
          <span className="text-blue-500">{currentDir === 'asc' ? '▲' : '▼'}</span>
        ) : (
          <span className="text-muted-foreground/40">⇅</span>
        )}
      </span>
    </TableHead>
  );
}

function HoldingsTable({ holdings, quotes, quotesLoading, fxRate, onEdit, onSell, onDelete }: {
  holdings: HoldingRecord[];
  quotes: Map<string, StockQuote>;
  quotesLoading: boolean;
  fxRate: number;
  onEdit: (h: HoldingRecord) => void;
  onSell: (h: HoldingRecord) => void;
  onDelete: (h: HoldingRecord) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('pnl');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = useCallback((key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  const sorted = useMemo(() => {
    return [...holdings].sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      const qA = quotes.get(a.ticker);
      const qB = quotes.get(b.ticker);
      const priceA = qA?.price ?? a.avg_price;
      const priceB = qB?.price ?? b.avg_price;

      switch (sortKey) {
        case 'ticker': va = a.ticker; vb = b.ticker; break;
        case 'shares': va = a.shares; vb = b.shares; break;
        case 'avg_price': va = toUsd(a.avg_price, inferCountry(a.ticker), fxRate); vb = toUsd(b.avg_price, inferCountry(b.ticker), fxRate); break;
        case 'price': va = toUsd(priceA, inferCountry(a.ticker), fxRate); vb = toUsd(priceB, inferCountry(b.ticker), fxRate); break;
        case 'market_value': va = toUsd(a.shares * priceA, inferCountry(a.ticker), fxRate); vb = toUsd(b.shares * priceB, inferCountry(b.ticker), fxRate); break;
        case 'pnl':
          va = toUsd(a.shares * priceA - a.shares * a.avg_price, inferCountry(a.ticker), fxRate);
          vb = toUsd(b.shares * priceB - b.shares * b.avg_price, inferCountry(b.ticker), fxRate);
          break;
      }
      if (typeof va === 'string' && typeof vb === 'string') {
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });
  }, [holdings, quotes, sortKey, sortDir]);

  if (holdings.length === 0) {
    return (
      <GlassCard stagger={5}>
        <div className="p-8 text-center text-muted-foreground">
          <p className="text-sm">保有銘柄がありません</p>
          <p className="text-xs mt-1">「+ 新規登録」ボタンから銘柄を追加してください</p>
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard stagger={5}>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHeader label="ティッカー" sortKey="ticker" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              <SortableHeader label="株数" sortKey="shares" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
              <SortableHeader label="平均取得" sortKey="avg_price" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
              <SortableHeader label="現在値" sortKey="price" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
              <SortableHeader label="評価額" sortKey="market_value" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
              <SortableHeader label="含み損益" sortKey="pnl" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
              <TableHead className="text-right text-[10px] uppercase tracking-wider">為替損益</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">口座</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">セクター</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">アクション</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((h) => {
              const quote = quotes.get(h.ticker);
              const country = inferCountry(h.ticker);
              const currentPrice = quote?.price ?? h.avg_price;
              const marketValue = h.shares * currentPrice;
              const costBasis = h.shares * h.avg_price;
              const pnl = marketValue - costBasis;
              const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
              const sc = sectorColor(h.sector);
              const ac = ACCOUNT_COLORS[h.account_type || 'tokutei'] || ACCOUNT_COLORS.tokutei;
              const fmt = country === 'JP' ? formatJPY : formatUSD;
              const fmtSub = country === 'JP' ? (v: number) => formatUSD(v / fxRate) : (v: number) => formatJPY(v * fxRate);

              return (
                <TableRow key={h.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <TickerIcon ticker={h.ticker} size={28} />
                      <div className="flex flex-col">
                        <span className="font-bold font-mono">{h.ticker}</span>
                        {quote?.name && <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{quote.name}</span>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{Number.isInteger(h.shares) ? h.shares : h.shares.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{fmt(h.avg_price)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {quotesLoading && !quote ? (
                      <Skeleton className="h-4 w-16 ml-auto" />
                    ) : quote ? (
                      fmt(currentPrice)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono tabular-nums">{fmt(marketValue)}</span>
                    <span className="text-[10px] text-muted-foreground font-mono block">{fmtSub(marketValue)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={`font-mono tabular-nums font-medium ${pnlClass(pnl)}`}>{fmt(pnl)}</span>
                    <span className={`text-[10px] font-mono block ${pnlClass(pnl)}`}>{formatPct(pnlPct)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    {country === 'JP' ? (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    ) : (() => {
                      const fxPnl = h.shares * h.avg_price * (fxRate - (h.fx_rate || fxRate));
                      return (
                        <>
                          <span className={`font-mono tabular-nums text-xs ${pnlClass(fxPnl)}`}>{formatJPY(fxPnl)}</span>
                        </>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <StatusChip label={accountLabel(h.account_type)} color={ac.chipColor} />
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${sc.text} ${sc.bg} ${sc.border}`}>
                      {h.sector || 'Other'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <a href={`/signals?ticker=${encodeURIComponent(h.ticker)}&tab=entry`} className="p-1 rounded hover:bg-purple-500/10 text-purple-600 dark:text-purple-400" title="シグナル分析">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" /></svg>
                      </a>
                      <a href={`/signals?ticker=${encodeURIComponent(h.ticker)}&tab=history`} className="p-1 rounded hover:bg-amber-500/10 text-amber-600 dark:text-amber-400" title="シグナル履歴">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                      </a>
                      <a href={`/signals?ticker=${encodeURIComponent(h.ticker)}&tab=holding`} className="p-1 rounded hover:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" title="Exit分析">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>
                      </a>
                      <button onClick={() => onEdit(h)} className="p-1 rounded hover:bg-blue-500/10 text-blue-600 dark:text-blue-400" title="編集">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" /></svg>
                      </button>
                      <button onClick={() => onSell(h)} className="p-1 rounded hover:bg-orange-500/10 text-orange-600 dark:text-orange-400" title="売却">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" /></svg>
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`${h.ticker} を削除しますか？`)) onDelete(h);
                        }}
                        className="p-1 rounded hover:bg-red-500/10 text-red-600 dark:text-red-400" title="削除"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </GlassCard>
  );
}

// ============================================================
// Add Holding Modal
// ============================================================

function AddHoldingModal({ open, onClose, onAdd }: {
  open: boolean; onClose: () => void; onAdd: (data: Partial<HoldingRecord>) => void;
}) {
  const [tickerValue, setTickerValue] = useState('');
  const isJP = inferCountry(tickerValue.toUpperCase()) === 'JP';

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onAdd({
      ticker: (fd.get('ticker') as string).toUpperCase(),
      shares: parseFloat(fd.get('shares') as string),
      avg_price: parseFloat(fd.get('avg_price') as string),
      entry_date: fd.get('entry_date') as string || undefined,
      account_type: (fd.get('account_type') as 'nisa' | 'tokutei') || 'tokutei',
      sector: (fd.get('sector') as string) || 'Other',
      fx_rate: isJP ? undefined : (parseFloat(fd.get('fx_rate') as string) || 150.0),
      thesis: (fd.get('thesis') as string) || undefined,
    });
    setTickerValue('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新規保有銘柄登録</DialogTitle>
          <DialogDescription>保有銘柄の情報を入力してください</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">ティッカー *</label>
              <Input name="ticker" required placeholder="AAPL" className="h-8 text-sm font-mono uppercase" value={tickerValue} onChange={(e) => setTickerValue(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">Entry日</label>
              <Input name="entry_date" type="date" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">平均取得価格 ({isJP ? '¥' : '$'}) *</label>
              <Input name="avg_price" type="number" step="0.01" required placeholder={isJP ? '2500' : '150.00'} className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">株数 *</label>
              <Input name="shares" type="number" step="0.01" required placeholder="100" className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">口座</label>
              <select name="account_type" className="w-full h-8 rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30">
                <option value="tokutei">特定</option>
                <option value="nisa">NISA</option>
              </select>
            </div>
            {!isJP && (
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground uppercase tracking-wider">取得為替</label>
                <Input name="fx_rate" type="number" step="0.01" defaultValue="150.00" className="h-8 text-sm font-mono" />
              </div>
            )}
            <div className="col-span-2 space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">セクター</label>
              <select name="sector" defaultValue="Other" className="w-full h-8 rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30">
                {SECTOR_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">投資テーマ / メモ</label>
              <Input name="thesis" placeholder="例: AI需要の成長に期待" className="h-8 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>キャンセル</Button>
            <Button type="submit" size="sm">登録</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Edit Holding Modal
// ============================================================

function EditHoldingModal({ holding, onClose, onSuccess }: {
  holding: HoldingRecord | null; onClose: () => void; onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!holding) return null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      await updateHolding(holding.id!, {
        shares: parseFloat(fd.get('shares') as string),
        avg_price: parseFloat(fd.get('avg_price') as string),
        account_type: (fd.get('account_type') as 'nisa' | 'tokutei') || 'tokutei',
        sector: (fd.get('sector') as string) || 'Other',
        target_price: fd.get('target_price') ? parseFloat(fd.get('target_price') as string) : undefined,
        stop_loss: fd.get('stop_loss') ? parseFloat(fd.get('stop_loss') as string) : undefined,
        thesis: (fd.get('thesis') as string) || undefined,
        notes: (fd.get('notes') as string) || undefined,
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!holding} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{holding.ticker} を編集</DialogTitle>
          <DialogDescription>保有情報を更新してください</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">ティッカー</label>
              <Input value={holding.ticker} disabled className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">口座</label>
              <select name="account_type" defaultValue={holding.account_type || 'tokutei'} className="w-full h-8 rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30">
                <option value="tokutei">特定</option>
                <option value="nisa">NISA</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">株数</label>
              <Input name="shares" type="number" step="0.01" defaultValue={holding.shares} className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">平均取得価格</label>
              <Input name="avg_price" type="number" step="0.01" defaultValue={holding.avg_price} className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">目標価格</label>
              <Input name="target_price" type="number" step="0.01" defaultValue={holding.target_price ?? ''} placeholder="—" className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">損切価格</label>
              <Input name="stop_loss" type="number" step="0.01" defaultValue={holding.stop_loss ?? ''} placeholder="—" className="h-8 text-sm font-mono" />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">セクター</label>
              <select name="sector" defaultValue={holding.sector || 'Other'} className="w-full h-8 rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30">
                {SECTOR_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">投資テーマ</label>
              <Input name="thesis" defaultValue={holding.thesis ?? ''} className="h-8 text-sm" />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">メモ</label>
              <Input name="notes" defaultValue={holding.notes ?? ''} className="h-8 text-sm" />
            </div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>キャンセル</Button>
            <Button type="submit" size="sm" disabled={loading}>{loading ? '更新中...' : '更新'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Sell Holding Modal
// ============================================================

function SellHoldingModal({ holding, currentPrice, onClose, onSuccess }: {
  holding: HoldingRecord | null; currentPrice: number | null; onClose: () => void; onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sellPrice, setSellPrice] = useState<number>(currentPrice ?? 0);
  const [sellShares, setSellShares] = useState<number>(holding?.shares ?? 0);

  const previewPnl = holding ? (sellPrice - holding.avg_price) * sellShares : 0;
  const previewPct = holding && holding.avg_price > 0 ? ((sellPrice / holding.avg_price) - 1) * 100 : 0;

  if (!holding) return null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      await sellFromHolding({
        holding_id: holding.id!,
        shares: parseFloat(fd.get('shares') as string),
        price: parseFloat(fd.get('price') as string),
        trade_date: fd.get('trade_date') as string,
        reason: (fd.get('reason') as string) || undefined,
        lessons_learned: (fd.get('lessons') as string) || undefined,
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '売却に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!holding} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-orange-600 dark:text-orange-400">{holding.ticker} を売却</DialogTitle>
          <DialogDescription>
            保有: {holding.shares}株 @ {formatPrice(holding.avg_price, inferCountry(holding.ticker))}
          </DialogDescription>
        </DialogHeader>

        {/* P&L Preview */}
        <div className={`rounded-lg p-3 text-center ${previewPnl >= 0 ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">見積P&L</p>
          <p className={`text-xl font-bold font-mono ${pnlClass(previewPnl)}`}>{formatPrice(previewPnl, inferCountry(holding.ticker))}</p>
          <p className={`text-xs font-mono ${pnlClass(previewPct)}`}>{formatPct(previewPct)}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">売却日 *</label>
              <Input name="trade_date" type="date" required defaultValue={new Date().toISOString().split('T')[0]} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">売却価格 *</label>
              <Input
                name="price" type="number" step="0.01" required
                defaultValue={currentPrice ?? ''}
                className="h-8 text-sm font-mono"
                onChange={(e) => setSellPrice(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">株数 *</label>
              <Input
                name="shares" type="number" step="0.01" required
                defaultValue={holding.shares}
                max={holding.shares}
                className="h-8 text-sm font-mono"
                onChange={(e) => setSellShares(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">売却理由</label>
              <select name="reason" className="w-full h-8 rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30">
                <option value="">未選択</option>
                <option value="利益確定">利益確定</option>
                <option value="損切り">損切り</option>
                <option value="トレイリング">トレイリング</option>
                <option value="BOS">BOS</option>
                <option value="ミラー反転">ミラー反転</option>
                <option value="テーマ終了">テーマ終了</option>
                <option value="リバランス">リバランス</option>
              </select>
            </div>
            <div className="col-span-2 space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider">学び / 振り返り</label>
              <Input name="lessons" placeholder="この取引から学んだこと" className="h-8 text-sm" />
            </div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>キャンセル</Button>
            <Button type="submit" size="sm" disabled={loading} className="bg-orange-600 hover:bg-orange-700 text-white">
              {loading ? '売却中...' : '売却実行'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Trades Tab
// ============================================================

function TradesTab({ trades }: { trades: TradeRecord[] }) {
  const [tickerFilter, setTickerFilter] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('ALL');

  const filtered = useMemo(() => {
    let result = trades;
    if (tickerFilter) result = result.filter(t => t.ticker.includes(tickerFilter.toUpperCase()));
    if (actionFilter !== 'ALL') result = result.filter(t => t.action === actionFilter);
    return result;
  }, [trades, tickerFilter, actionFilter]);

  return (
    <div className="space-y-3 plumb-animate-in">
      {/* Filter bar */}
      <div className="plumb-glass rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider">フィルター</span>
        <Input
          placeholder="ティッカー"
          value={tickerFilter}
          onChange={(e) => setTickerFilter(e.target.value)}
          className="w-28 h-7 text-xs font-mono uppercase"
        />
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-24 h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">ALL</SelectItem>
            <SelectItem value="BUY">BUY</SelectItem>
            <SelectItem value="SELL">SELL</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length}件</span>
      </div>

      {/* Table */}
      <GlassCard>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">取引履歴がありません</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] uppercase tracking-wider">日付</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">ティッカー</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">アクション</TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-wider">株数</TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-wider">価格</TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-wider">損益</TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-wider">保有日数</TableHead>
                  <TableHead className="text-[10px] uppercase tracking-wider">理由</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{formatDate(t.trade_date)}</TableCell>
                    <TableCell className="font-bold font-mono">{t.ticker}</TableCell>
                    <TableCell>
                      <StatusChip
                        label={t.action}
                        color={t.action === 'BUY' ? 'green' : 'red'}
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{t.shares.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatUSD(t.price)}</TableCell>
                    <TableCell className="text-right">
                      {t.profit_loss != null ? (
                        <>
                          <span className={`font-mono tabular-nums font-medium ${pnlClass(t.profit_loss)}`}>{formatUSD(t.profit_loss)}</span>
                          <span className={`text-[10px] font-mono block ${pnlClass(t.profit_loss)}`}>{formatPct(t.profit_loss_pct || 0)}</span>
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-xs">
                      {t.holding_days != null ? `${t.holding_days}日` : '—'}
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground">{t.reason || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

// ============================================================
// Stats Tab
// ============================================================

function StatsTab({ stats }: { stats: TradeStats }) {
  const winRatePct = Math.round(stats.win_rate * 100);

  const kpis = [
    { label: '総トレード数', value: String(stats.total_trades), sub: `BUY ${stats.buy_count} / SELL ${stats.sell_count}`, color: '' },
    { label: '総損益', value: formatUSD(stats.total_profit_loss), sub: '', color: pnlClass(stats.total_profit_loss) },
    { label: 'Profit Factor', value: stats.profit_factor.toFixed(2), sub: '', color: stats.profit_factor >= 2 ? 'text-emerald-600 dark:text-emerald-400' : stats.profit_factor >= 1 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400' },
    { label: '平均利益', value: formatUSD(stats.avg_profit), sub: '', color: 'text-emerald-600 dark:text-emerald-400' },
    { label: '平均損失', value: formatUSD(stats.avg_loss), sub: '', color: 'text-red-600 dark:text-red-400' },
    { label: '勝ち', value: String(stats.win_count), sub: '', color: 'text-emerald-600 dark:text-emerald-400' },
    { label: '負け', value: String(stats.loss_count), sub: '', color: 'text-red-600 dark:text-red-400' },
  ];

  return (
    <div className="space-y-4 plumb-animate-in">
      {/* Win Rate Hero */}
      <GlassCard>
        <div className="p-5 flex items-center gap-6">
          <ScoreRing score={winRatePct} size={80} strokeWidth={6} />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">勝率</p>
            <p className="text-3xl font-bold font-mono tabular-nums">{winRatePct}%</p>
            <p className="text-xs text-muted-foreground">{stats.win_count}勝 {stats.loss_count}敗 / {stats.sell_count}決済</p>
          </div>
        </div>
      </GlassCard>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="plumb-glass rounded-lg px-4 py-3.5 plumb-glass-hover">
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-1">{kpi.label}</span>
            <span className={`text-lg font-bold tabular-nums font-mono ${kpi.color}`}>{kpi.value}</span>
            {kpi.sub && <span className="text-xs text-muted-foreground font-mono block mt-0.5">{kpi.sub}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Asset Trends Tab (資産推移)
// ============================================================

type TrendPeriod = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';
const TREND_PERIODS: { key: TrendPeriod; label: string; months: number | 'ytd' }[] = [
  { key: '1M',  label: '1M',     months: 1 },
  { key: '3M',  label: '3M',     months: 3 },
  { key: '6M',  label: '6M',     months: 6 },
  { key: 'YTD', label: 'YTD',    months: 'ytd' },
  { key: '1Y',  label: '1Y',     months: 12 },
  { key: 'ALL', label: '全期間', months: 120 },
];

function AssetTrendsTab({ active }: { active: boolean }) {
  const [period, setPeriod] = useState<TrendPeriod>('1Y');
  const [currency, setCurrency] = useState<'USD' | 'JPY'>('JPY');

  const activeMonths = useMemo(() => {
    const opt = TREND_PERIODS.find((p) => p.key === period);
    if (opt?.months === 'ytd') return new Date().getMonth() + 1;
    return (opt?.months as number) ?? 12;
  }, [period]);

  const { data, error, isLoading } = usePortfolioHistory(activeMonths, active);

  if (isLoading) {
    return (
      <div className="space-y-4 plumb-animate-in">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
        <Skeleton className="h-[340px] rounded-2xl" />
        <Skeleton className="h-[260px] rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <GlassCard>
        <div className="p-8 text-center">
          <p className="text-red-500 text-sm">データの取得に失敗しました</p>
        </div>
      </GlassCard>
    );
  }

  const history = data?.history ?? [];
  const summary = data?.summary;

  if (history.length === 0) {
    return (
      <GlassCard>
        <div className="p-8 text-center text-muted-foreground">
          <p className="text-sm">取引履歴がありません</p>
          <p className="text-xs mt-1">取引を記録すると資産推移チャートが表示されます</p>
        </div>
      </GlassCard>
    );
  }

  const fx = summary?.fx_rate_usdjpy ?? 150;
  const isJpy = currency === 'JPY';
  const conv = (usd: number, rate: number) => isJpy ? usd * rate : usd;
  const fmt = isJpy ? formatJPY : formatUSD;

  // Return rate: (unrealized_pnl / total_cost) * 100
  const currentReturnRate = summary && summary.total_cost_usd > 0
    ? (summary.unrealized_pnl_usd / summary.total_cost_usd) * 100
    : 0;

  // Chart 1: Asset Trends (3 series, left axis only)
  const assetSeries: ChartSeries[] = [
    {
      data: history.map((p) => ({ x: p.date, y: conv(p.total_assets_usd, p.fx_rate_usdjpy) })),
      type: 'area',
      color: '#06b6d4',
      label: isJpy ? '総資産 (円)' : 'Total Assets',
    },
    {
      data: history.map((p) => ({ x: p.date, y: conv(p.total_market_value_usd, p.fx_rate_usdjpy) })),
      type: 'line',
      color: '#3b82f6',
      label: isJpy ? '時価 (円)' : 'Market Value',
    },
    {
      data: history.map((p) => ({ x: p.date, y: conv(p.total_cost_usd, p.fx_rate_usdjpy) })),
      type: 'line',
      color: '#71717a',
      label: isJpy ? '取得原価 (円)' : 'Cost Basis',
      dashed: true,
    },
  ];

  // Chart 2: Unrealized P&L (bar) + Return Rate % (line, right axis)
  const pnlSeries: ChartSeries[] = [
    {
      data: history.map((p) => ({ x: p.date, y: conv(p.unrealized_pnl_usd, p.fx_rate_usdjpy) })),
      type: 'bar',
      color: 'rgba(16,185,129,0.6)',
      barNegativeColor: 'rgba(239,68,68,0.6)',
      label: isJpy ? '含み損益 (円)' : 'Unrealized P&L',
    },
    {
      data: history.map((p) => ({
        x: p.date,
        y: p.total_cost_usd > 0 ? (p.unrealized_pnl_usd / p.total_cost_usd) * 100 : null,
      })),
      type: 'line',
      color: '#f59e0b',
      label: '収益率 (%)',
      yAxisSide: 'right' as const,
    },
  ];

  const summaryItems = [
    {
      label: '総資産',
      value: fmt(conv(summary?.total_assets_usd ?? 0, fx)),
      sub: isJpy ? formatUSD(summary?.total_assets_usd ?? 0) : formatJPY((summary?.total_assets_usd ?? 0) * fx),
      color: 'text-cyan-600 dark:text-cyan-400',
    },
    {
      label: 'ポートフォリオ時価',
      value: fmt(conv(summary?.total_market_value_usd ?? 0, fx)),
      sub: isJpy ? formatUSD(summary?.total_market_value_usd ?? 0) : formatJPY((summary?.total_market_value_usd ?? 0) * fx),
      color: '',
    },
    {
      label: '含み損益',
      value: fmt(conv(summary?.unrealized_pnl_usd ?? 0, fx)),
      sub: isJpy ? formatUSD(summary?.unrealized_pnl_usd ?? 0) : formatJPY((summary?.unrealized_pnl_usd ?? 0) * fx),
      color: pnlClass(summary?.unrealized_pnl_usd ?? 0),
    },
    {
      label: '現金残高',
      value: fmt(conv(summary?.total_cash_usd ?? 0, fx)),
      sub: isJpy ? formatUSD(summary?.total_cash_usd ?? 0) : formatJPY((summary?.total_cash_usd ?? 0) * fx),
      color: 'text-zinc-500 dark:text-zinc-400',
    },
    {
      label: '収益率',
      value: `${currentReturnRate >= 0 ? '+' : ''}${currentReturnRate.toFixed(2)}%`,
      sub: '含み損益 / 取得原価',
      color: pnlClass(currentReturnRate),
    },
  ];

  const yFmtAsset = isJpy
    ? (v: number) => v >= 1_000_000 ? `¥${(v / 10_000).toFixed(0)}万` : `¥${Math.round(v).toLocaleString()}`
    : (v: number) => `$${(v / 1000).toFixed(1)}K`;
  const yFmtPnl = isJpy
    ? (v: number) => {
        const abs = Math.abs(v);
        const sign = v < 0 ? '-' : '';
        return abs >= 1_000_000 ? `${sign}¥${(abs / 10_000).toFixed(0)}万` : `${sign}¥${Math.round(abs).toLocaleString()}`;
      }
    : (v: number) => `$${v.toFixed(0)}`;
  const yFmtPct = (v: number) => `${v.toFixed(1)}%`;

  return (
    <div className="space-y-4 plumb-animate-in">
      {/* Controls: Period selector + Currency toggle */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-0.5 plumb-glass rounded-lg p-1">
          {TREND_PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                period === p.key
                  ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400'
                  : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setCurrency('JPY')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              isJpy ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
            }`}
          >¥ JPY</button>
          <button
            onClick={() => setCurrency('USD')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              !isJpy ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'
            }`}
          >$ USD</button>
        </div>
      </div>

      {/* Summary Cards (5 cols) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {summaryItems.map((item) => (
          <div key={item.label} className="plumb-glass rounded-lg px-4 py-3.5 plumb-glass-hover">
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider block mb-1">{item.label}</span>
            <span className={`text-lg font-bold tabular-nums font-mono ${item.color}`}>{item.value}</span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 block mt-0.5 font-mono">{item.sub}</span>
          </div>
        ))}
      </div>

      {/* Chart 1: Asset Trends */}
      <GlassCard>
        <div className="p-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400 mb-3">資産推移</h3>
          <EconChartCanvas
            series={assetSeries}
            yAxisFormat={yFmtAsset}
            height={340}
            initialShowAll
          />
        </div>
      </GlassCard>

      {/* Chart 2: Unrealized P&L + Return Rate */}
      <GlassCard>
        <div className="p-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400 mb-3">含み損益 / 収益率</h3>
          <EconChartCanvas
            series={pnlSeries}
            yAxisFormat={yFmtPnl}
            yAxisRightFormat={yFmtPct}
            height={260}
            initialShowAll
          />
        </div>
      </GlassCard>
    </div>
  );
}

// ============================================================
// Cash Balance Section (現金管理)
// ============================================================

function CashBalanceSection({ fxRate }: { fxRate: number }) {
  const { data, mutate } = useCashBalances();
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const balances = useMemo(() => data?.balances ?? [], [data]);

  const totalJpy = useMemo(() => {
    return balances.reduce((sum, b) => {
      return sum + (b.currency === 'USD' ? b.amount * fxRate : b.amount);
    }, 0);
  }, [balances, fxRate]);

  const totalUsd = useMemo(() => {
    return balances.reduce((sum, b) => {
      return sum + (b.currency === 'JPY' ? b.amount / fxRate : b.amount);
    }, 0);
  }, [balances, fxRate]);

  const handleAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await createCashBalance({
        label: fd.get('label') as string,
        currency: (fd.get('currency') as string) || 'JPY',
        amount: parseFloat(fd.get('amount') as string),
        account_type: (fd.get('account_type') as string) || undefined,
      });
      setAdding(false);
      mutate();
    } catch {
      // handled silently
    }
  };

  const handleDelete = async (id: string, label: string) => {
    if (!window.confirm(`「${label}」を削除しますか？`)) return;
    await deleteCashBalance(id);
    mutate();
  };

  return (
    <GlassCard stagger={6}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">現金・預金残高</h3>
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono font-bold tabular-nums">{formatJPY(totalJpy)}</span>
            <span className="text-xs text-muted-foreground font-mono">({formatUSD(totalUsd)})</span>
            <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setAdding(true)}>+ 追加</Button>
          </div>
        </div>

        {balances.length === 0 && !adding ? (
          <p className="text-xs text-muted-foreground text-center py-4">現金残高を登録すると総資産に反映されます</p>
        ) : (
          <div className="space-y-1">
            {balances.map((b) => (
              <div key={b.id} className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0 group">
                {editId === b.id ? (
                  <form
                    className="flex items-center gap-2 w-full"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      await updateCashBalance(b.id, { amount: parseFloat(fd.get('amount') as string) });
                      setEditId(null);
                      mutate();
                    }}
                  >
                    <span className="text-xs font-medium w-28 truncate">{b.label}</span>
                    <Input name="amount" type="number" step="0.01" defaultValue={b.amount} className="h-6 w-32 text-xs font-mono" />
                    <Button type="submit" variant="outline" size="sm" className="h-6 text-[10px] px-2">保存</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setEditId(null)}>取消</Button>
                  </form>
                ) : (
                  <>
                    <span className="text-xs font-medium w-28 truncate">{b.label}</span>
                    <StatusChip label={b.currency} color={b.currency === 'USD' ? 'blue' : 'green'} />
                    {b.account_type && <StatusChip label={b.account_type === 'nisa' ? 'NISA' : b.account_type} color={b.account_type === 'nisa' ? 'green' : 'orange'} />}
                    <span className="ml-auto text-sm font-mono font-bold tabular-nums">
                      {b.currency === 'USD' ? formatUSD(b.amount) : formatJPY(b.amount)}
                    </span>
                    <div className="flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setEditId(b.id)} className="p-1 rounded hover:bg-blue-500/10 text-blue-600 dark:text-blue-400" title="編集">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" /></svg>
                      </button>
                      <button onClick={() => handleDelete(b.id, b.label)} className="p-1 rounded hover:bg-red-500/10 text-red-600 dark:text-red-400" title="削除">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add Form */}
        {adding && (
          <form onSubmit={handleAdd} className="flex items-center gap-2 mt-2 pt-2 border-t border-white/5">
            <Input name="label" required placeholder="ラベル (例: SBI証券)" className="h-7 w-32 text-xs" />
            <select name="currency" className="h-7 rounded-md border border-input bg-transparent px-2 text-xs dark:bg-input/30">
              <option value="JPY">JPY</option>
              <option value="USD">USD</option>
            </select>
            <Input name="amount" type="number" step="0.01" required placeholder="金額" className="h-7 w-28 text-xs font-mono" />
            <select name="account_type" className="h-7 rounded-md border border-input bg-transparent px-2 text-xs dark:bg-input/30">
              <option value="">—</option>
              <option value="tokutei">特定</option>
              <option value="nisa">NISA</option>
              <option value="bank">銀行</option>
            </select>
            <Button type="submit" variant="outline" size="sm" className="h-7 text-[10px] px-3">追加</Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-[10px] px-2" onClick={() => setAdding(false)}>取消</Button>
          </form>
        )}
      </div>
    </GlassCard>
  );
}

// ============================================================
// Loading Skeleton
// ============================================================

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
      {/* FX Bar */}
      <Skeleton className="h-12 w-full rounded-lg" />
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      {/* Account */}
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
      {/* Table */}
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

// ============================================================
// Main Page
// ============================================================

export default function HoldingsPage() {
  return (
    <AuthGuard>
      <HoldingsContent />
    </AuthGuard>
  );
}

function HoldingsContent() {
  const [activeTab, setActiveTab] = useState('portfolio');
  // Combined init: holdings + cash + FX in one request (3 RTT → 1 RTT)
  const { data: initData, error: holdingsError, isLoading: holdingsLoading, mutate: mutateInit } = useHoldingsInit();
  // Lazy load: only fetch trades/stats when their tabs are visited
  const tradesEnabled = activeTab === 'trades' || activeTab === 'stats';
  const { data: tradesData, isLoading: tradesLoading, mutate: mutateTrades } = useTrades({ limit: 100, enabled: tradesEnabled });
  const { data: stats, mutate: mutateStats } = useTradeStats(activeTab === 'stats');

  const holdings = initData?.holdings ?? [];
  const trades = tradesData?.trades ?? [];

  const tickers = useMemo(
    () => (holdings.length > 0 ? holdings.map((h) => h.ticker) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initData],
  );
  const { data: quotesData, isLoading: quotesLoading } = useBatchQuotes(tickers);

  const quotes = useMemo(() => {
    const map = new Map<string, StockQuote>();
    quotesData?.quotes.forEach((q) => map.set(q.ticker, q));
    return map;
  }, [quotesData]);

  // FX rate from init response
  const [fxRate, setFxRate] = useState(150.0);
  useEffect(() => {
    if (initData?.fx_rate) setFxRate(initData.fx_rate);
  }, [initData]);

  // Local state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<HoldingRecord | null>(null);
  const [sellTarget, setSellTarget] = useState<HoldingRecord | null>(null);

  const mutateAll = useCallback(() => {
    mutateInit();
    mutateTrades();
    mutateStats();
  }, [mutateInit, mutateTrades, mutateStats]);

  const handleAddHolding = useCallback((data: Partial<HoldingRecord>) => {
    const temp: HoldingRecord = {
      id: `temp-${Date.now()}`,
      user_id: '',
      ticker: data.ticker || '',
      shares: data.shares || 0,
      avg_price: data.avg_price || 0,
      ...data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as HoldingRecord;

    mutateInit(
      async (current) => {
        const result = await createHolding(data);
        const newHoldings = [...(current?.holdings ?? []), result];
        return {
          ...current!,
          holdings: newHoldings,
          total: newHoldings.length,
          total_value: newHoldings.reduce((s, h) => s + h.shares * h.avg_price, 0),
        };
      },
      {
        optimisticData: (current) => ({
          ...current!,
          holdings: [...(current?.holdings ?? []), temp],
          total: (current?.total ?? 0) + 1,
          total_value: (current?.total_value ?? 0) + temp.shares * temp.avg_price,
        }),
        rollbackOnError: true,
      },
    );
  }, [mutateInit]);

  const handleDelete = useCallback(async (h: HoldingRecord) => {
    try {
      await deleteHolding(h.id!);
      mutateAll();
    } catch {
      // error handled by confirm dialog
    }
  }, [mutateAll]);

  if (holdingsLoading) return <LoadingSkeleton />;

  if (holdingsError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-emerald-500 to-blue-500" />
          <h1 className="text-2xl font-bold tracking-tight">保有・取引管理</h1>
        </div>
        <GlassCard>
          <div className="p-8 text-center">
            <p className="text-red-500 text-sm mb-3">{holdingsError instanceof Error ? holdingsError.message : 'データの取得に失敗しました'}</p>
            <Button variant="outline" size="sm" onClick={() => mutateInit()}>再試行</Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 plumb-animate-in">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-emerald-500 to-blue-500" />
            <h1 className="text-2xl font-bold tracking-tight">ポートフォリオ</h1>
          </div>
          <p className="text-xs text-muted-foreground pl-3.5">保有管理・取引記録・統計</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAddModalOpen(true)}>
            + 新規登録
          </Button>
          <Button variant="outline" size="sm" onClick={() => mutateAll()}>更新</Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="plumb-glass rounded-lg p-1 border-none w-full justify-start">
          <TabsTrigger value="portfolio" className="text-[11px] font-mono uppercase tracking-wider data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400">
            <Briefcase className="w-3.5 h-3.5 mr-1.5" />ポートフォリオ ({holdings.length})
          </TabsTrigger>
          <TabsTrigger value="trends" className="text-[11px] font-mono uppercase tracking-wider data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400">
            <TrendingUp className="w-3.5 h-3.5 mr-1.5" />資産推移
          </TabsTrigger>
          <TabsTrigger value="trades" className="text-[11px] font-mono uppercase tracking-wider data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400">
            <ArrowLeftRight className="w-3.5 h-3.5 mr-1.5" />取引履歴{tradesData ? ` (${trades.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="stats" className="text-[11px] font-mono uppercase tracking-wider data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-600 dark:data-[state=active]:text-blue-400">
            <PieChart className="w-3.5 h-3.5 mr-1.5" />統計
          </TabsTrigger>
        </TabsList>

        {/* Portfolio Tab */}
        <TabsContent value="portfolio" className="mt-4 space-y-4">
          <FxBar fxRate={fxRate} isLive={!!initData?.fx_rate} onFxRateChange={setFxRate} />
          <PortfolioHero holdings={holdings} quotes={quotes} fxRate={fxRate} />
          <AccountBreakdown holdings={holdings} quotes={quotes} fxRate={fxRate} />
          <PortfolioCharts holdings={holdings} quotes={quotes} fxRate={fxRate} />
          <SectorBreakdown holdings={holdings} quotes={quotes} fxRate={fxRate} />
          <CashBalanceSection fxRate={fxRate} />
          <HoldingsTable
            holdings={holdings}
            quotes={quotes}
            quotesLoading={quotesLoading}
            fxRate={fxRate}
            onEdit={setEditTarget}
            onSell={setSellTarget}
            onDelete={handleDelete}
          />
        </TabsContent>

        {/* Asset Trends Tab */}
        <TabsContent value="trends" className="mt-4">
          <AssetTrendsTab active={activeTab === 'trends'} />
        </TabsContent>

        {/* Trades Tab */}
        <TabsContent value="trades" className="mt-4">
          {tradesLoading ? (
            <GlassCard><div className="p-8 text-center"><Skeleton className="h-4 w-32 mx-auto" /></div></GlassCard>
          ) : (
            <TradesTab trades={trades} />
          )}
        </TabsContent>

        {/* Stats Tab */}
        <TabsContent value="stats" className="mt-4">
          {stats ? (
            <StatsTab stats={stats} />
          ) : (
            <GlassCard>
              <div className="p-8 text-center text-muted-foreground text-sm">
                {tradesLoading ? <Skeleton className="h-4 w-32 mx-auto" /> : '統計データがありません'}
              </div>
            </GlassCard>
          )}
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <AddHoldingModal open={addModalOpen} onClose={() => setAddModalOpen(false)} onAdd={handleAddHolding} />
      <EditHoldingModal holding={editTarget} onClose={() => setEditTarget(null)} onSuccess={mutateAll} />
      <SellHoldingModal
        holding={sellTarget}
        currentPrice={sellTarget ? (quotes.get(sellTarget.ticker)?.price ?? null) : null}
        onClose={() => setSellTarget(null)}
        onSuccess={mutateAll}
      />
    </div>
  );
}
