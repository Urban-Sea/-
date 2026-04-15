'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

import { AuthGuard } from '@/components/providers/AuthGuard';
import { GlassCard, StatusChip } from '@/components/shared/glass';
import { Skeleton } from '@/components/ui/skeleton';
import { useDiscoveryToday } from '@/lib/api';
import type { DiscoveredStock } from '@/types';

// ── Preset color mapping ──

const PRESET_LABELS: Record<string, { label: string; color: string; description: string }> = {
  momentum: { label: '上昇トレンド', color: 'blue', description: 'SMA200上 × 52W高値圏' },
  pullback: { label: '押し目', color: 'orange', description: '上昇トレンド中の一時下落' },
  quality: { label: 'ファンダ優良', color: 'green', description: '高ROE × 低PER × 利益成長' },
  breakout: { label: 'ブレイクアウト', color: 'purple', description: '新高値 × 出来高急増' },
  sustained: { label: '継続上昇', color: 'red', description: 'SMA20>50>200整列 × 半年+30%' },
};

// ── Sort helpers ──

type SortField = 'finviz_score' | 'ticker' | 'price' | 'rsi' | 'beta';

function getSortValue(stock: DiscoveredStock, field: SortField): number | string {
  switch (field) {
    case 'finviz_score': return stock.finviz_score;
    case 'ticker': return stock.ticker;
    case 'price': return stock.fundament.Price ?? 0;
    case 'rsi': return stock.fundament.RSI ?? 0;
    case 'beta': return stock.fundament.Beta ?? 0;
  }
}

function formatPct(value: number | null | undefined): string {
  if (value == null) return '-';
  return `${(value * 100).toFixed(1)}%`;
}

function formatNum(value: number | null | undefined, decimals = 2): string {
  if (value == null) return '-';
  return value.toFixed(decimals);
}

// ── Page ──

function DiscoveryPage() {
  const { data, error, isLoading } = useDiscoveryToday();
  const router = useRouter();

  const [sortField, setSortField] = useState<SortField>('finviz_score');
  const [sortAsc, setSortAsc] = useState(false);
  const [presetFilter, setPresetFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data?.tickers) return [];
    let list = data.tickers;
    if (presetFilter) {
      list = list.filter(t => t.presets.includes(presetFilter));
    }
    return [...list].sort((a, b) => {
      const va = getSortValue(a, sortField);
      const vb = getSortValue(b, sortField);
      if (typeof va === 'string' && typeof vb === 'string') {
        return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const na = typeof va === 'number' ? va : 0;
      const nb = typeof vb === 'number' ? vb : 0;
      return sortAsc ? na - nb : nb - na;
    });
  }, [data, sortField, sortAsc, presetFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortAsc
      ? <ArrowUp className="w-3 h-3 text-blue-500" />
      : <ArrowDown className="w-3 h-3 text-blue-500" />;
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl p-4">
        <GlassCard className="p-6">
          <p className="text-sm text-red-500">Discovery データの取得に失敗しました</p>
        </GlassCard>
      </div>
    );
  }

  if (!data || data.tickers.length === 0) {
    return (
      <div className="mx-auto max-w-6xl p-4">
        <GlassCard className="p-6">
          <p className="text-sm text-muted-foreground">
            Discovery データがまだありません。finviz-scan.py → finviz-publish.py を実行してください。
          </p>
        </GlassCard>
      </div>
    );
  }

  const allPresets = Object.keys(data.preset_counts);

  return (
    <div className="mx-auto max-w-6xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Search className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">銘柄発掘</h1>
        <span className="text-xs text-muted-foreground">米国株</span>
        <span className="text-xs text-muted-foreground ml-auto">
          スキャン日: {data.scan_date}
        </span>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GlassCard className="p-4">
          <div className="text-xs text-muted-foreground">スキャン銘柄</div>
          <div className="text-xl font-bold tabular-nums font-mono">{data.total_unique}</div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="text-xs text-muted-foreground">選出銘柄</div>
          <div className="text-xl font-bold tabular-nums font-mono">{data.after_threshold}</div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="text-xs text-muted-foreground">閾値</div>
          <div className="text-xl font-bold tabular-nums font-mono">{data.threshold}</div>
        </GlassCard>
        <GlassCard className="p-4">
          <div className="text-xs text-muted-foreground">条件別ヒット数</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {allPresets.map(p => (
              <span key={p} className="text-xs tabular-nums">
                {PRESET_LABELS[p]?.label ?? p}: {data.preset_counts[p]}
              </span>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Preset Filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setPresetFilter(null)}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
            presetFilter === null
              ? 'bg-foreground text-background border-foreground'
              : 'bg-transparent text-muted-foreground border-border hover:border-foreground/50'
          }`}
        >
          全て ({data.after_threshold})
        </button>
        {allPresets.map(p => {
          const info = PRESET_LABELS[p];
          return (
            <button
              key={p}
              onClick={() => setPresetFilter(presetFilter === p ? null : p)}
              title={info?.description}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                presetFilter === p
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-transparent text-muted-foreground border-border hover:border-foreground/50'
              }`}
            >
              {info?.label ?? p} ({data.preset_counts[p] ?? 0})
            </button>
          );
        })}
      </div>

      {/* Table */}
      <GlassCard className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50">
              {([
                ['ticker', 'Ticker'],
                ['finviz_score', 'Score'],
                ['price', 'Price'],
                ['rsi', 'RSI'],
                ['beta', 'Beta'],
              ] as [SortField, string][]).map(([field, label]) => (
                <th
                  key={field}
                  onClick={() => handleSort(field)}
                  className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none"
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <SortIcon field={field} />
                  </span>
                </th>
              ))}
              <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">
                SMA200
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">
                該当条件
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(stock => (
              <tr
                key={stock.ticker}
                onClick={() => router.push(`/signals?ticker=${stock.ticker}`)}
                className="border-b border-border/30 hover:bg-muted/50 cursor-pointer transition-colors"
              >
                <td className="px-3 py-2 font-mono font-semibold text-foreground">
                  {stock.ticker}
                </td>
                <td className="px-3 py-2 font-mono tabular-nums">
                  {stock.finviz_score.toFixed(2)}
                </td>
                <td className="px-3 py-2 font-mono tabular-nums">
                  {formatNum(stock.fundament.Price)}
                </td>
                <td className="px-3 py-2 font-mono tabular-nums">
                  {formatNum(stock.fundament.RSI, 1)}
                </td>
                <td className="px-3 py-2 font-mono tabular-nums">
                  {formatNum(stock.fundament.Beta)}
                </td>
                <td className="px-3 py-2 font-mono tabular-nums text-xs">
                  {formatPct(stock.fundament.SMA200)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {stock.presets.map(p => {
                      const info = PRESET_LABELS[p];
                      return (
                        <StatusChip
                          key={p}
                          label={info?.label ?? p}
                          color={info?.color ?? 'blue'}
                        />
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            該当する銘柄がありません
          </div>
        )}
      </GlassCard>
    </div>
  );
}

export default function DiscoveryPageWrapper() {
  return (
    <AuthGuard>
      <Suspense fallback={null}>
        <DiscoveryPage />
      </Suspense>
    </AuthGuard>
  );
}
