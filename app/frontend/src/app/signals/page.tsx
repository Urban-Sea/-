'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import CandlestickChart from '@/components/charts/CandlestickChart';
import LineChartCanvas from '@/components/charts/LineChartCanvas';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { getSignal, getStockHistory, getExitAnalysis, getSignalHistory, getChartMarkers, getBatchSignals, useStocks, useRegime, useWatchlist, addWatchlistTicker, removeWatchlistTicker } from '@/lib/api';
import { GlassCard, StatusChip, Metric, DocSection, DocTable } from '@/components/shared/glass';
import { TickerIcon } from '@/components/shared/TickerIcon';
import { useUser } from '@/components/providers/UserProvider';
import type { SignalResponse, StockHistoryData, ExitAnalysisResponse, SignalHistoryResponse, ChartMarkersResponse, BatchResponse } from '@/types';

type Mode = 'balanced' | 'aggressive' | 'conservative';
type Tab = 'entry' | 'holding' | 'history' | 'system';
type Period = '1d' | '5d' | '1mo' | '3mo' | '6mo' | 'ytd' | '1y' | '5y' | 'max';
type ChartType = 'line' | 'candlestick';
type ChartOption = 'ema' | 'fvg' | 'bos' | 'choch';

const modeLabels: Record<Mode, { label: string; desc: string }> = {
  balanced: { label: '標準', desc: 'RS下落時はエントリー禁止。最もバランスが良い。' },
  aggressive: { label: '積極型', desc: 'RS無視で全エントリー。機会重視。' },
  conservative: { label: '慎重型', desc: 'RS下落時は50%サイズ。リスク抑制。' },
};

const defaultQuickTickers = ['NVDA', 'TSLA', 'META', 'PLTR', 'COIN', 'IONQ', 'SOUN', 'RKLB'];
const periods: { value: Period; label: string }[] = [
  { value: '1d', label: '1日' },
  { value: '5d', label: '5日' },
  { value: '1mo', label: '1M' },
  { value: '3mo', label: '3M' },
  { value: '6mo', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1Y' },
  { value: '5y', label: '5Y' },
  { value: 'max', label: '全期間' },
];
const chartOptionLabels: Record<ChartOption, { label: string; title: string }> = {
  ema: { label: 'EMA', title: '8/21 移動平均線' },
  fvg: { label: 'FVG', title: '価格ギャップ' },
  bos: { label: 'BOS', title: '構造変化' },
  choch: { label: 'CHoCH', title: 'トレンド転換' },
};

export default function SignalsPageWrapper() {
  return (
    <Suspense fallback={null}>
      <SignalsPage />
    </Suspense>
  );
}

function SignalsPage() {
  const [ticker, setTicker] = useState('');
  const [mode, setMode] = useState<Mode>('balanced');
  const [signal, setSignal] = useState<SignalResponse | null>(null);
  const { data: regimeData } = useRegime();
  const regime = regimeData ?? null;
  const { data: stocksData } = useStocks({ active_only: true });
  const stocks = stocksData?.stocks ?? [];
  const [history, setHistory] = useState<StockHistoryData[]>([]);
  const [exitAnalysis, setExitAnalysis] = useState<ExitAnalysisResponse | null>(null);
  const [signalHistory, setSignalHistory] = useState<SignalHistoryResponse | null>(null);
  const [chartMarkers, setChartMarkers] = useState<ChartMarkersResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('entry');
  const [period, setPeriod] = useState<Period>('6mo');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [chartOptions, setChartOptions] = useState<Set<ChartOption>>(new Set(['ema']));
  const [entryPrice, setEntryPrice] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [batchResults, setBatchResults] = useState<BatchResponse | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [exitLoading, setExitLoading] = useState(false);
  const [quickTickers, setQuickTickers] = useState<string[]>(defaultQuickTickers);
  const [showAddTicker, setShowAddTicker] = useState(false);
  const [newTickerInput, setNewTickerInput] = useState('');

  // Watchlist: backend sync (authenticated) or localStorage fallback
  const { email } = useUser();
  const { data: wlData, mutate: mutateWl } = useWatchlist();
  const migrated = useRef(false);

  // Sync quickTickers from backend watchlist when available
  useEffect(() => {
    if (!wlData?.watchlists?.length) return;
    const defaultWl = wlData.watchlists.find(w => w.is_default) ?? wlData.watchlists[0];
    if (defaultWl?.tickers?.length) {
      setQuickTickers(defaultWl.tickers);
    }
  }, [wlData]);

  // One-time migration: localStorage → backend on first auth
  useEffect(() => {
    if (!email || migrated.current) return;
    if (wlData && wlData.watchlists.length === 0) {
      const saved = localStorage.getItem('quickTickers');
      if (saved) {
        try {
          const local: string[] = JSON.parse(saved);
          if (local.length > 0) {
            migrated.current = true;
            Promise.all(local.map(t => addWatchlistTicker(t))).then(() => mutateWl());
          }
        } catch { /* ignore */ }
      }
    }
  }, [email, wlData, mutateWl]);

  // URL params support: /signals?ticker=AAPL&tab=holding
  const searchParams = useSearchParams();
  const [initialParamsHandled, setInitialParamsHandled] = useState(false);

  useEffect(() => {
    if (initialParamsHandled) return;
    const paramTicker = searchParams.get('ticker');
    const paramTab = searchParams.get('tab') as Tab | null;
    if (paramTicker) {
      setTicker(paramTicker.toUpperCase());
      if (paramTab && ['entry', 'holding', 'history', 'system'].includes(paramTab)) {
        setActiveTab(paramTab);
      }
      setInitialParamsHandled(true);
      // Auto-analyze after state update
      setTimeout(() => handleAnalyze(paramTicker.toUpperCase()), 100);
    } else {
      setInitialParamsHandled(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, initialParamsHandled]);

  // Load localStorage fallback (unauthenticated only)
  useEffect(() => {
    if (email) return; // skip — backend is the source of truth
    const saved = localStorage.getItem('quickTickers');
    if (saved) {
      try {
        setQuickTickers(JSON.parse(saved));
      } catch {
        // ignore parse errors
      }
    }
  }, [email]);

  const addQuickTicker = async (t: string) => {
    const tick = t.trim().toUpperCase();
    if (!tick) return;
    if (quickTickers.includes(tick)) return;
    const newList = [...quickTickers, tick];
    setQuickTickers(newList);
    setNewTickerInput('');
    setShowAddTicker(false);
    if (email) {
      try { await addWatchlistTicker(tick); mutateWl(); } catch { /* ignore */ }
    } else {
      localStorage.setItem('quickTickers', JSON.stringify(newList));
    }
  };

  const removeQuickTicker = async (t: string) => {
    const newList = quickTickers.filter(x => x !== t);
    setQuickTickers(newList);
    if (email) {
      try { await removeWatchlistTicker(t); mutateWl(); } catch { /* ignore */ }
    } else {
      localStorage.setItem('quickTickers', JSON.stringify(newList));
    }
  };

  const handleAnalyze = async (t?: string) => {
    const targetTicker = t || ticker;
    if (!targetTicker.trim()) {
      setError('ティッカーを入力してください');
      return;
    }
    setLoading(true);
    setError(null);
    setSignal(null);
    setBatchResults(null);
    setHistory([]);
    setExitAnalysis(null);
    setChartMarkers(null);
    setTicker(targetTicker.toUpperCase());
    try {
      const [signalRes, historyRes, markersRes] = await Promise.all([
        getSignal(targetTicker.toUpperCase(), mode),
        getStockHistory(targetTicker.toUpperCase(), period),
        getChartMarkers(targetTicker.toUpperCase(), period).catch(() => null),
      ]);
      setSignal(signalRes);
      setHistory(historyRes.data);
      setChartMarkers(markersRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'シグナル取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleExitAnalysis = async () => {
    if (!ticker || !entryPrice) return;
    const price = parseFloat(entryPrice);
    if (isNaN(price) || price <= 0) {
      setError('有効なエントリー価格を入力してください');
      return;
    }
    setExitLoading(true);
    setError(null);
    try {
      const res = await getExitAnalysis(ticker, price, entryDate || undefined);
      setExitAnalysis(res);
    } catch (err) {
      console.error('Exit analysis failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`保有分析に失敗しました: ${msg}`);
    } finally {
      setExitLoading(false);
    }
  };

  const handleFetchSignalHistory = async () => {
    if (!ticker) return;
    setHistoryLoading(true);
    try {
      const res = await getSignalHistory(ticker, '1y', mode);
      setSignalHistory(res);
    } catch (err) {
      console.error('Signal history failed:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handlePeriodChange = async (p: Period) => {
    setPeriod(p);
    if (ticker) {
      try {
        const [historyRes, markersRes] = await Promise.all([
          getStockHistory(ticker, p),
          getChartMarkers(ticker, p).catch(() => null),
        ]);
        setHistory(historyRes.data);
        setChartMarkers(markersRes);
      } catch (err) {
        console.error('History fetch failed:', err);
      }
    }
  };

  const toggleChartOption = (option: ChartOption) => {
    setChartOptions(prev => {
      const next = new Set(prev);
      if (next.has(option)) next.delete(option);
      else next.add(option);
      return next;
    });
  };

  const getRegimeColor = (r: string) => {
    switch (r) {
      case 'BULL': return 'text-emerald-600 dark:text-emerald-400';
      case 'BEAR': return 'text-red-600 dark:text-red-400';
      case 'RECOVERY': return 'text-blue-600 dark:text-blue-400';
      case 'WEAKENING': return 'text-orange-600 dark:text-orange-400';
      default: return 'text-zinc-500 dark:text-zinc-400';
    }
  };

  const getRegimeBadge = (r: string) => {
    switch (r) {
      case 'BULL': return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
      case 'BEAR': return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20';
      case 'RECOVERY': return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
      case 'WEAKENING': return 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20';
      default: return 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20';
    }
  };

  const chartData = history.map((d, i) => {
    const ema8 = calculateEMA(history.slice(0, i + 1).map(h => h.close), 8);
    const ema21 = calculateEMA(history.slice(0, i + 1).map(h => h.close), 21);
    return { date: d.date, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume, ema8, ema21 };
  });

  return (
    <div className="space-y-4 w-full px-4 lg:px-6">
      {/* ── Page Header ── */}
      <div className="plumb-animate-in">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-blue-500 via-cyan-400 to-purple-500" />
              <h1 className="text-2xl font-bold tracking-tight text-foreground">シグナル分析</h1>
            </div>
            <p className="text-xs text-muted-foreground pl-3.5">統合エントリーシステム・チャート・保有管理</p>
          </div>
          {/* Mode Selector */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">運用モード</span>
            <div className="flex gap-0.5 plumb-glass rounded-lg p-1">
              {(Object.keys(modeLabels) as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    mode === m
                      ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.15)]'
                      : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  {modeLabels[m].label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Search Section ── */}
      <GlassCard stagger={1}>
        <div className="p-4 space-y-3">
          {/* Row 1: Input + Actions */}
          <div className="flex gap-2 items-center flex-wrap">
            <div className="relative">
              <input
                type="text"
                placeholder="ティッカー (例: NVDA)"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                list="stock-list"
                className="plumb-glass rounded-lg px-3 py-2 text-sm w-40 focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-600 text-foreground"
              />
              <datalist id="stock-list">
                {stocks.map((s) => (
                  <option key={s.ticker} value={s.ticker}>{s.name}</option>
                ))}
              </datalist>
            </div>
            <button
              onClick={() => handleAnalyze()}
              disabled={loading}
              className="px-5 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
            >
              {loading ? '分析中...' : '分析'}
            </button>
            <button
              onClick={async () => {
                setBatchLoading(true);
                setBatchResults(null);
                setSignal(null);
                setError(null);
                try {
                  const res = await getBatchSignals(quickTickers, mode);
                  setBatchResults(res);
                } catch (err) {
                  setError(err instanceof Error ? err.message : '一括分析に失敗しました');
                } finally {
                  setBatchLoading(false);
                }
              }}
              disabled={batchLoading || loading}
              className="px-4 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 plumb-glass text-zinc-400 hover:text-cyan-400 hover:border-cyan-500/30"
            >
              {batchLoading ? '分析中...' : '一括分析'}
            </button>
          </div>

          {/* Row 2: Quick Tickers */}
          <div className="flex gap-1.5 flex-wrap items-center pt-3 border-t border-border">
            <span className="text-xs text-muted-foreground uppercase tracking-wider mr-1 font-medium">Quick</span>
            {quickTickers.map((t) => (
              <span
                key={t}
                className="group relative flex items-center gap-1.5 px-2.5 py-1.5 plumb-glass rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-500/30 transition-all cursor-pointer"
              >
                <TickerIcon ticker={t} size={20} />
                <span onClick={() => handleAnalyze(t)}>{t}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeQuickTicker(t); }}
                  className="hidden group-hover:inline text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 font-bold text-xs ml-0.5"
                >
                  ×
                </button>
              </span>
            ))}
            {showAddTicker ? (
              <span className="flex items-center gap-1">
                <input
                  type="text"
                  value={newTickerInput}
                  onChange={(e) => setNewTickerInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && addQuickTicker(newTickerInput)}
                  placeholder="AAPL"
                  className="plumb-glass rounded px-2.5 py-1.5 text-xs w-16 focus:outline-none focus:ring-1 focus:ring-blue-500/50 text-foreground"
                  autoFocus
                />
                <button onClick={() => addQuickTicker(newTickerInput)} className="px-2.5 py-1.5 bg-blue-500/20 text-blue-700 dark:text-blue-400 rounded text-xs font-bold hover:bg-blue-500/30">OK</button>
                <button onClick={() => { setShowAddTicker(false); setNewTickerInput(''); }} className="px-2.5 py-1.5 border border-red-500/30 text-red-500 dark:text-red-400 rounded text-xs font-bold hover:bg-red-500/10">×</button>
              </span>
            ) : (
              <button
                onClick={() => setShowAddTicker(true)}
                className="px-2.5 py-1.5 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-500 dark:text-zinc-600 text-xs font-semibold hover:border-blue-500/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                + 追加
              </button>
            )}
          </div>
        </div>
      </GlassCard>

      {/* ── Error ── */}
      {error && (
        <div className="plumb-animate-in rounded-xl border border-red-500/30 bg-red-500/5 px-5 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* ── Loading ── */}
      {(loading || batchLoading) && (
        <div className="flex justify-center items-center py-12 gap-3 text-muted-foreground">
          <div className="w-6 h-6 border-2 border-zinc-300 dark:border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm">{batchLoading ? '一括分析中...' : '分析中...'}</span>
        </div>
      )}

      {/* ── Market Regime Bar (Batch) ── */}
      {regime && !loading && batchResults && (
        <GlassCard stagger={1}>
          <div className="px-5 py-3 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Regime</span>
              <span className={`text-lg font-bold ${getRegimeColor(regime.regime)}`}>{regime.regime}</span>
              <span className="text-sm text-muted-foreground">{regime.description}</span>
            </div>
            <div className="flex gap-5">
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground uppercase font-medium">SPY</div>
                <div className="text-sm font-semibold font-mono text-foreground">${regime.benchmark_price.toFixed(2)}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground uppercase font-medium">200 EMA</div>
                <div className="text-sm font-semibold font-mono text-foreground">${regime.benchmark_ema_long.toFixed(2)}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground uppercase font-medium">21傾き</div>
                <div className={`text-sm font-semibold font-mono ${regime.ema_short_slope >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {regime.ema_short_slope >= 0 ? '+' : ''}{regime.ema_short_slope.toFixed(3)}
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* ── Batch Results ── */}
      {batchResults && !batchLoading && (
        <div className="space-y-3 plumb-animate-in">
          {/* Summary */}
          <GlassCard>
            <div className="px-5 py-3 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-foreground">一括分析結果</span>
                <span className="text-sm text-muted-foreground">{batchResults.total_analyzed}銘柄 / {modeLabels[mode].label}モード</span>
              </div>
              <StatusChip label={`エントリー可能: ${batchResults.entry_ready_count}`} color="green" />
            </div>
          </GlassCard>

          {/* Card Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {batchResults.results.map((r, idx) => {
              const rsColors: Record<string, string> = { UP: 'text-emerald-600 dark:text-emerald-400', FLAT: 'text-yellow-600 dark:text-yellow-400', DOWN: 'text-red-600 dark:text-red-400' };
              const rsLabels: Record<string, string> = { UP: '上昇', FLAT: '横ばい', DOWN: '下落' };
              const rsTrend = r.relative_strength?.trend || 'FLAT';
              return (
                <div
                  key={r.ticker}
                  onClick={() => { setBatchResults(null); handleAnalyze(r.ticker); }}
                  className={`plumb-glass plumb-glass-hover rounded-xl p-4 cursor-pointer plumb-animate-in plumb-stagger-${Math.min(idx + 1, 8)} ${
                    r.error ? 'border-red-500/30' : r.entry_allowed ? 'border-l-2 border-l-emerald-500' : ''
                  }`}
                >
                  {r.error ? (
                    <>
                      <div className="flex items-center gap-2">
                        <TickerIcon ticker={r.ticker} size={28} />
                        <span className="text-lg font-bold text-foreground">{r.ticker}</span>
                      </div>
                      <div className="text-xs text-red-400 mt-2">Error</div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <TickerIcon ticker={r.ticker} size={28} />
                          <span className="text-lg font-bold text-foreground">{r.ticker}</span>
                        </div>
                        <span className="text-sm font-semibold font-mono text-foreground">${r.price?.toFixed(2)}</span>
                      </div>
                      <div className="mb-2 flex items-center gap-2">
                        <StatusChip label={r.entry_allowed ? '買いシグナル' : 'エントリーなし'} color={r.entry_allowed ? 'green' : 'blue'} />
                        {r.position_size_pct > 0 && (
                          <span className="text-[10px] text-muted-foreground">サイズ: {r.position_size_pct}%</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-xs text-muted-foreground">
                        <span>統合判定: <span className={`font-semibold ${r.combined_ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 dark:text-zinc-600'}`}>{r.combined_ready ? '達成' : '未達'}</span></span>
                        <span>RS: <span className={`font-semibold ${rsColors[rsTrend]}`}>{rsLabels[rsTrend]}</span></span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Signal Result ── */}
      {signal && !loading && (
        <div className="space-y-4 plumb-animate-in">
          {/* Hero Card */}
          <div className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden plumb-animate-scale">
            <div className="absolute inset-0 bg-zinc-100/50 dark:bg-zinc-500/[0.02]" />
            <div className="relative p-5 md:p-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <TickerIcon ticker={signal.ticker} size={72} />
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-extrabold tracking-tight text-foreground">{signal.ticker}</span>
                      {(() => {
                        const stock = stocks.find(s => s.ticker === signal.ticker);
                        return stock?.name ? <span className="text-xs text-muted-foreground max-w-[200px] truncate">{stock.name}</span> : null;
                      })()}
                    </div>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-xl font-bold font-mono text-foreground">${signal.price.toFixed(2)}</span>
                      <span className={`text-sm font-semibold ${signal.price_change_pct >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                        {signal.price_change_pct >= 0 ? '+' : ''}{signal.price_change_pct.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <span className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold border ${
                    signal.relative_strength.trend === 'UP' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : signal.relative_strength.trend === 'DOWN' ? 'bg-red-500/10 text-red-400 border-red-500/20'
                    : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                  }`}>
                    RS: {signal.relative_strength.trend}
                  </span>
                  <span className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold border ${getRegimeBadge(signal.regime)}`}>
                    市場: {signal.regime}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Chart Section ── */}
          <GlassCard stagger={2}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Chart Type */}
                  <div className="flex gap-0.5 plumb-glass rounded-lg p-1">
                    <button
                      onClick={() => setChartType('line')}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        chartType === 'line' ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400' : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >ライン</button>
                    <button
                      onClick={() => setChartType('candlestick')}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        chartType === 'candlestick' ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400' : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >ローソク足</button>
                  </div>
                  {/* Chart Options */}
                  <div className="flex gap-0.5 plumb-glass rounded-lg p-1">
                    {(Object.keys(chartOptionLabels) as ChartOption[]).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => toggleChartOption(opt)}
                        title={chartOptionLabels[opt].title}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                          chartOptions.has(opt)
                            ? opt === 'ema' ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                            : opt === 'fvg' ? 'bg-purple-400/20 text-purple-700 dark:text-purple-400'
                            : opt === 'bos' ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                            : 'bg-purple-500/20 text-purple-700 dark:text-purple-400'
                            : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                        }`}
                      >
                        {chartOptionLabels[opt].label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Period */}
                <div className="flex gap-0.5 plumb-glass rounded-lg p-1">
                  {periods.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => handlePeriodChange(p.value)}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        period === p.value ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400' : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-[450px] rounded-lg overflow-hidden">
                {chartType === 'candlestick' ? (
                  <CandlestickChart
                    data={chartData}
                    showEMA={chartOptions.has('ema')}
                    showBOS={chartOptions.has('bos')}
                    showCHoCH={chartOptions.has('choch')}
                    showFVG={chartOptions.has('fvg')}
                    bosMarkers={chartMarkers?.bos || []}
                    chochMarkers={chartMarkers?.choch || []}
                    fvgMarkers={chartMarkers?.fvg || []}
                  />
                ) : (
                  <LineChartCanvas
                    data={chartData}
                    showEMA={chartOptions.has('ema')}
                  />
                )}
              </div>

              {/* Chart Legend */}
              <div className="flex gap-4 mt-3 justify-center text-xs text-muted-foreground flex-wrap">
                {chartType === 'candlestick' && (
                  <>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#26a69a]" /> 陽線</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#ef5350]" /> 陰線</span>
                  </>
                )}
                {chartType === 'candlestick' && chartOptions.has('bos') && (
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400" /> BOS</span>
                )}
                {chartType === 'candlestick' && chartOptions.has('choch') && (
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-purple-500" /> CHoCH</span>
                )}
                {chartType === 'candlestick' && chartOptions.has('fvg') && (
                  <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-purple-400/30 border border-purple-400/50 rounded-sm" /> FVG</span>
                )}
              </div>
            </div>
          </GlassCard>

          {/* ── Analysis Tabs ── */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)} className="plumb-tabs">
            <TabsList variant="line">
              <TabsTrigger value="entry">エントリー判定</TabsTrigger>
              <TabsTrigger value="holding">保有分析</TabsTrigger>
              <TabsTrigger value="history">過去シグナル</TabsTrigger>
              <TabsTrigger value="system">システム解説</TabsTrigger>
            </TabsList>

            {/* ── Tab: Entry ── */}
            <TabsContent value="entry">
              <GlassCard stagger={1}>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-5">
                    <span className="text-base font-bold text-foreground">エントリー判定パネル</span>
                    <span className="text-sm text-muted-foreground">統合エントリーシステム</span>
                    <StatusChip label={modeLabels[mode].label} color="blue" />
                  </div>

                  {/* Regime Info */}
                  {regime && (
                    <div className="flex items-center gap-4 mb-5 px-4 py-3 plumb-glass rounded-lg text-sm flex-wrap">
                      <Metric label="市場" value="">
                        <span className={`text-sm font-bold ${getRegimeColor(regime.regime)}`}>{regime.regime}</span>
                      </Metric>
                      <span className="w-px h-4 bg-border" />
                      <span className="text-muted-foreground">SPY: <span className="text-foreground font-mono font-semibold">${regime.benchmark_price.toFixed(2)}</span></span>
                      <span className="text-muted-foreground">200EMA: <span className="text-foreground font-mono font-semibold">${regime.benchmark_ema_long.toFixed(2)}</span></span>
                      <span className="text-muted-foreground">傾き: <span className={`font-mono font-semibold ${regime.ema_short_slope >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{regime.ema_short_slope >= 0 ? '+' : ''}{regime.ema_short_slope.toFixed(3)}</span></span>
                    </div>
                  )}

                  {/* Verdict Hero */}
                  <div className={`relative text-center py-8 rounded-xl mb-5 border overflow-hidden ${
                    signal.entry_allowed
                      ? 'border-emerald-500/30'
                      : 'border-zinc-200 dark:border-zinc-800'
                  }`}>
                    {signal.entry_allowed && (
                      <div className="absolute inset-0 bg-emerald-500/[0.06] dark:bg-emerald-500/[0.04]" />
                    )}
                    {signal.entry_allowed && (
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[100px] rounded-full blur-[60px] opacity-20 plumb-glow" style={{ background: '#10b981' }} />
                    )}
                    <div className="relative">
                      <div className={`text-4xl font-extrabold tracking-[0.2em] ${
                        signal.entry_allowed ? 'text-emerald-500 dark:text-emerald-400' : 'text-zinc-400 dark:text-zinc-600'
                      }`}>
                        {signal.entry_allowed ? 'BUY' : 'NO ENTRY'}
                      </div>
                      <div className="text-sm text-muted-foreground mt-2">
                        {signal.entry_allowed
                          ? `ポジションサイズ: ${signal.position_size_pct}%`
                          : signal.mode_note || '条件未達成'}
                      </div>
                    </div>
                  </div>

                  {/* Toggle Details */}
                  <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 border-t border-border text-xs text-muted-foreground hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                  >
                    <span>{showDetails ? '詳細を閉じる' : '詳細を見る'}</span>
                    <svg className={`w-3 h-3 transition-transform duration-200 ${showDetails ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>

                  {/* Details */}
                  {showDetails && (
                    <div className="mt-4 space-y-4 plumb-animate-in">
                      <div className="grid grid-cols-3 gap-3">
                        <ConditionCard label="統合判定" value={signal.combined_ready ? 'READY' : 'NOT READY'} isPositive={signal.combined_ready} sub="CHoCH + EMA収束" />
                        <ConditionCard label="弱気CHoCH" value={signal.conditions.bearish_choch?.found ? 'FOUND' : 'NONE'} isPositive={signal.conditions.bearish_choch?.found || false} sub={signal.conditions.bearish_choch?.date?.slice(0, 10) || ''} />
                        <ConditionCard label="強気CHoCH" value={signal.conditions.bullish_choch?.found ? 'FOUND' : 'NONE'} isPositive={signal.conditions.bullish_choch?.found || false} sub={signal.conditions.bullish_choch?.date?.slice(0, 10) || ''} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <ConditionCard label="EMA収束" value={`${signal.conditions.ema_convergence?.value?.toFixed(2) || 'N/A'}%`} isPositive={signal.conditions.ema_convergence?.converged || false} sub={`閾値: ${signal.conditions.ema_convergence?.threshold}%`} />
                        <ConditionCard label="相対強度（RS）" value={signal.relative_strength.trend} isPositive={signal.relative_strength.trend !== 'DOWN'} sub={`${signal.relative_strength.change_pct >= 0 ? '+' : ''}${signal.relative_strength.change_pct.toFixed(2)}%`} />
                      </div>
                    </div>
                  )}
                </div>
              </GlassCard>
            </TabsContent>

            {/* ── Tab: Holding ── */}
            <TabsContent value="holding">
              <GlassCard stagger={1}>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-5">
                    <span className="text-base font-bold text-foreground">保有分析パネル</span>
                    <StatusChip label="5層Exit System" color="purple" />
                  </div>

                  {/* Entry Inputs */}
                  <div className="flex gap-4 mb-5 flex-wrap items-end">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1.5 font-medium">エントリー価格</label>
                      <input
                        type="number"
                        value={entryPrice}
                        onChange={(e) => setEntryPrice(e.target.value)}
                        placeholder="例: 25.50"
                        step="0.01"
                        className="plumb-glass rounded-lg px-3 py-2 w-32 focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-600 text-foreground"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1.5 font-medium">エントリー日（任意）</label>
                      <input
                        type="date"
                        value={entryDate}
                        onChange={(e) => setEntryDate(e.target.value)}
                        className="plumb-glass rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-all text-foreground"
                      />
                    </div>
                    <button
                      onClick={handleExitAnalysis}
                      disabled={exitLoading || !entryPrice}
                      className="px-5 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                    >
                      {exitLoading ? '分析中...' : '保有分析'}
                    </button>
                    {signal && (
                      <span className="text-xs text-muted-foreground">現在価格: <span className="font-mono font-semibold text-foreground">${signal.price.toFixed(2)}</span></span>
                    )}
                  </div>

                  {/* Loading */}
                  {exitLoading && (
                    <div className="flex justify-center items-center py-8 gap-3 text-muted-foreground">
                      <div className="w-5 h-5 border-2 border-zinc-300 dark:border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
                      <span className="text-sm">分析中...</span>
                    </div>
                  )}

                  {/* Exit Analysis Results */}
                  {exitAnalysis && !exitLoading && (
                    <div className="space-y-4 plumb-animate-in">
                      {/* Exit Summary Hero */}
                      <div className={`relative p-5 rounded-xl border overflow-hidden ${
                        exitAnalysis.should_exit ? 'border-red-500/30' : 'border-emerald-500/30'
                      }`}>
                        <div className={`absolute inset-0 ${exitAnalysis.should_exit ? 'bg-red-500/[0.04]' : 'bg-emerald-500/[0.04]'}`} />
                        {exitAnalysis.should_exit && (
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[100px] rounded-full blur-[60px] opacity-15 plumb-glow" style={{ background: '#ef4444' }} />
                        )}
                        <div className="relative flex items-center justify-between flex-wrap gap-4">
                          <div className="flex items-center gap-5">
                            <div>
                              <span className="text-xs text-muted-foreground uppercase block font-medium">総合判定</span>
                              <span className={`text-3xl font-extrabold tracking-wider ${exitAnalysis.should_exit ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                {exitAnalysis.should_exit ? 'EXIT' : 'HOLD'}
                              </span>
                            </div>
                            {exitAnalysis.should_exit && exitAnalysis.exit_pct > 0 && (
                              <div>
                                <span className="text-xs text-muted-foreground uppercase block font-medium">売却比率</span>
                                <span className="text-xl font-bold text-red-600 dark:text-red-400">{exitAnalysis.exit_pct}%</span>
                              </div>
                            )}
                            <StatusChip
                              label={exitAnalysis.urgency}
                              color={exitAnalysis.urgency === 'LOW' ? 'green' : exitAnalysis.urgency === 'MEDIUM' ? 'amber' : exitAnalysis.urgency === 'HIGH' ? 'orange' : 'red'}
                            />
                          </div>
                          <div className="flex gap-6">
                            <div className="text-center">
                              <div className="text-xs text-muted-foreground uppercase font-medium">エントリー</div>
                              <div className="text-sm font-semibold font-mono text-foreground">${exitAnalysis.entry_price.toFixed(2)}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-xs text-muted-foreground uppercase font-medium">現在価格</div>
                              <div className="text-sm font-semibold font-mono text-foreground">${exitAnalysis.current_price.toFixed(2)}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-xs text-muted-foreground uppercase font-medium">含み損益</div>
                              <div className={`text-lg font-bold font-mono ${exitAnalysis.pnl_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                {exitAnalysis.pnl_pct >= 0 ? '+' : ''}{exitAnalysis.pnl_pct.toFixed(2)}%
                              </div>
                            </div>
                          </div>
                        </div>
                        {exitAnalysis.exit_reason && (
                          <div className="relative mt-4 pt-3 border-t border-border text-sm text-muted-foreground">
                            <span className="text-muted-foreground">理由:</span> {exitAnalysis.exit_reason}
                          </div>
                        )}
                      </div>

                      {/* EMA Status & Structure Stop */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="plumb-glass rounded-xl p-4">
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3 font-medium">EMAステータス</div>
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              { label: 'EMA 8', val: exitAnalysis.ema_status?.ema_8, above: exitAnalysis.ema_status?.above_ema_8 },
                              { label: 'EMA 13', val: exitAnalysis.ema_status?.ema_13, above: exitAnalysis.ema_status?.above_ema_13 },
                              { label: 'EMA 21', val: exitAnalysis.ema_status?.ema_21, above: exitAnalysis.ema_status?.above_ema_21 },
                            ].map((e) => (
                              <div key={e.label} className="text-center">
                                <div className="text-xs text-muted-foreground font-medium">{e.label}</div>
                                <div className="text-sm font-semibold font-mono mt-0.5 text-foreground">${(e.val ?? 0).toFixed(2)}</div>
                                <div className={`text-xs font-bold mt-0.5 ${e.above ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                  {e.above ? '上' : '下'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="plumb-glass rounded-xl p-4">
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3 font-medium">ストップライン</div>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-xs text-muted-foreground font-medium">構造ストップ</div>
                              <div className="text-lg font-bold text-red-600 dark:text-red-400 font-mono">${(exitAnalysis.structure_stop ?? 0).toFixed(2)}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground font-medium">ストップまでの距離</div>
                              <div className={`text-sm font-semibold font-mono ${
                                ((exitAnalysis.current_price - (exitAnalysis.structure_stop ?? 0)) / exitAnalysis.current_price * 100) > 5
                                  ? 'text-emerald-400' : 'text-orange-400'
                              }`}>
                                {((exitAnalysis.current_price - (exitAnalysis.structure_stop ?? 0)) / exitAnalysis.current_price * 100).toFixed(1)}%
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Exit Layers */}
                      <div className="plumb-glass rounded-xl p-4">
                        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3 font-medium">レイヤー判定</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {exitAnalysis.layers.map((layer, idx) => (
                            <div key={layer.layer} className={`plumb-glass rounded-lg p-3.5 plumb-animate-in plumb-stagger-${Math.min(idx + 1, 8)}`}>
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-xs text-muted-foreground font-mono font-medium">L{layer.layer}</span>
                                <StatusChip
                                  label={layer.status}
                                  color={layer.status === 'SAFE' ? 'green' : layer.status === 'WARNING' ? 'orange' : 'red'}
                                />
                              </div>
                              <div className="text-sm font-semibold text-foreground">{layer.name}</div>
                              {layer.detail && <div className="text-xs text-muted-foreground mt-1 truncate">{layer.detail}</div>}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Targets */}
                      {exitAnalysis.targets.length > 0 && (
                        <div className="plumb-glass rounded-xl p-4">
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3 font-medium">利確ターゲット</div>
                          <div className="flex gap-3 flex-wrap">
                            {exitAnalysis.targets.map((t, i) => (
                              <div key={i} className={`plumb-glass rounded-lg px-4 py-3 text-center min-w-[100px] plumb-animate-in plumb-stagger-${Math.min(i + 1, 8)}`}>
                                <div className="text-xs text-muted-foreground uppercase font-medium">{t.type}</div>
                                <div className="text-base font-bold font-mono mt-0.5 text-foreground">${t.price.toFixed(2)}</div>
                                <div className="text-sm text-emerald-600 dark:text-emerald-400 font-mono font-semibold">+{t.pct.toFixed(1)}%</div>
                                {t.exit_pct > 0 && (
                                  <div className="text-xs text-muted-foreground mt-1">売却 {t.exit_pct}%</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Empty State */}
                  {!exitAnalysis && !exitLoading && (
                    <div className="text-center py-10 text-muted-foreground text-sm">
                      エントリー価格を入力して「保有分析」をクリックしてください
                    </div>
                  )}
                </div>
              </GlassCard>
            </TabsContent>

            {/* ── Tab: History ── */}
            <TabsContent value="history">
              <GlassCard stagger={1}>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-5">
                    <span className="text-base font-bold text-foreground">過去シグナル履歴（1年間）</span>
                    {signalHistory && (
                      <span className="text-sm text-muted-foreground">({signalHistory.total_signals || signalHistory.stats.total_signals}件)</span>
                    )}
                    <button
                      onClick={handleFetchSignalHistory}
                      disabled={historyLoading}
                      className="ml-auto px-4 py-1.5 rounded-lg text-sm font-bold transition-all disabled:opacity-50 bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30"
                    >
                      {historyLoading ? '取得中...' : '分析実行'}
                    </button>
                  </div>

                  {signalHistory && (
                    <div className="space-y-4 plumb-animate-in">
                      {/* Summary Stats */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="plumb-glass rounded-lg px-4 py-3 flex items-center gap-3">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                          <span className="text-sm text-muted-foreground">買い: <strong className="text-emerald-500 dark:text-emerald-400">{signalHistory.stats.entry_count || signalHistory.timeline?.filter(s => s.type === 'ENTRY').length || 0}</strong></span>
                        </div>
                        <div className="plumb-glass rounded-lg px-4 py-3 flex items-center gap-3">
                          <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                          <span className="text-sm text-muted-foreground">RSI過熱: <strong className="text-orange-500 dark:text-orange-400">{signalHistory.stats.rsi_high_count || signalHistory.timeline?.filter(s => s.type === 'RSI_HIGH').length || 0}</strong></span>
                        </div>
                      </div>

                      {/* Exit Summary */}
                      {signalHistory.timeline && signalHistory.timeline.filter(s => s.type === 'EXIT').length > 0 && (
                        <div className="plumb-glass rounded-lg px-4 py-3">
                          <div className="flex gap-4 flex-wrap items-center">
                            <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">決済</span>
                            {(() => {
                              const exitSignals = signalHistory.timeline.filter(s => s.type === 'EXIT');
                              const exitByCat: Record<string, number> = {};
                              exitSignals.forEach(s => { exitByCat[s.exit_type || 'OTHER'] = (exitByCat[s.exit_type || 'OTHER'] || 0) + 1; });
                              return (
                                <>
                                  {exitByCat['MIRROR_FULL'] && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                                      <span className="text-xs text-muted-foreground">Mirror FULL <strong className="text-red-600 dark:text-red-400">{exitByCat['MIRROR_FULL']}</strong><span className="text-[10px] text-muted-foreground ml-1">(100%)</span></span>
                                    </div>
                                  )}
                                  {exitByCat['MIRROR_WARN'] && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                                      <span className="text-xs text-muted-foreground">Mirror WARN <strong className="text-orange-600 dark:text-orange-400">{exitByCat['MIRROR_WARN']}</strong><span className="text-[10px] text-muted-foreground ml-1">(50%)</span></span>
                                    </div>
                                  )}
                                  {exitByCat['TRAIL'] && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                                      <span className="text-xs text-muted-foreground">Trail <strong className="text-purple-600 dark:text-purple-400">{exitByCat['TRAIL']}</strong><span className="text-[10px] text-muted-foreground ml-1">(100%)</span></span>
                                    </div>
                                  )}
                                  {exitByCat['BEAR_CHOCH'] && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2.5 h-2.5 rounded-full bg-pink-400" />
                                      <span className="text-xs text-muted-foreground">CHoCH <strong className="text-pink-600 dark:text-pink-400">{exitByCat['BEAR_CHOCH']}</strong><span className="text-[10px] text-muted-foreground ml-1">(警告)</span></span>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Timeline */}
                      {signalHistory.timeline && signalHistory.timeline.length > 0 ? (
                        <div className="relative pl-6">
                          <div className="absolute left-[7px] top-0 bottom-0 w-0.5 bg-gradient-to-b from-zinc-300 dark:from-zinc-700 to-zinc-200/50 dark:to-zinc-800/50 rounded" />
                          {signalHistory.timeline.slice().reverse().map((s, i) => {
                            const getTypeStyle = () => {
                              switch (s.type) {
                                case 'ENTRY':
                                  return { dot: 'bg-emerald-500 border-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]', badge: 'green', label: '買いシグナル' };
                                case 'RSI_HIGH':
                                  return { dot: 'bg-orange-500 border-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]', badge: 'orange', label: 'RSI過熱' };
                                case 'EXIT': {
                                  const exitColors: Record<string, { dot: string; badge: string; label: string }> = {
                                    'MIRROR_FULL': { dot: 'bg-red-500 border-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]', badge: 'red', label: 'Mirror FULL' },
                                    'MIRROR_WARN': { dot: 'bg-orange-500 border-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]', badge: 'orange', label: 'Mirror WARN' },
                                    'TRAIL': { dot: 'bg-purple-500 border-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]', badge: 'purple', label: 'Trail' },
                                    'BEAR_CHOCH': { dot: 'bg-pink-400 border-pink-400 shadow-[0_0_8px_rgba(244,114,182,0.4)]', badge: 'red', label: 'CHoCH' },
                                  };
                                  return exitColors[s.exit_type || ''] || { dot: 'bg-red-500 border-red-500', badge: 'red', label: 'EXIT' };
                                }
                                default:
                                  return { dot: 'bg-zinc-500 border-zinc-500', badge: 'blue', label: s.type };
                              }
                            };
                            const style = getTypeStyle();
                            const dateRange = s.days > 1 ? `${s.date} ~ ${s.end_date}` : s.date;
                            const priceRange = s.days > 1 && s.end_price ? `$${s.price.toFixed(2)} → $${s.end_price.toFixed(2)}` : `$${s.price.toFixed(2)}`;
                            return (
                              <div key={i} className="relative py-3 border-b border-border last:border-b-0">
                                <div className={`absolute -left-[21px] top-4 w-2.5 h-2.5 rounded-full border-2 ${style.dot}`} />
                                <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                                  <span className="text-xs text-muted-foreground font-mono">{dateRange}</span>
                                  <StatusChip label={style.label} color={style.badge} />
                                  {s.days > 1 && (
                                    <span className="text-xs px-1.5 py-0.5 rounded plumb-glass text-muted-foreground">{s.days}日間</span>
                                  )}
                                  <span className="text-sm font-semibold font-mono text-foreground">{priceRange}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">{s.detail}</div>
                              </div>
                            );
                          })}
                        </div>
                      ) : signalHistory.signals && signalHistory.signals.length > 0 ? (
                        <div className="relative pl-6">
                          <div className="absolute left-[7px] top-0 bottom-0 w-0.5 bg-gradient-to-b from-zinc-300 dark:from-zinc-700 to-zinc-200/50 dark:to-zinc-800/50 rounded" />
                          {signalHistory.signals.slice().reverse().map((s, i) => (
                            <div key={i} className="relative py-3 border-b border-border last:border-b-0">
                              <div className="absolute -left-[21px] top-4 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                              <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                                <span className="text-xs text-muted-foreground font-mono">{s.date}</span>
                                <StatusChip label="買いシグナル" color="green" />
                                <span className="text-sm font-semibold font-mono text-foreground">${s.price.toFixed(2)}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                買いシグナル（RS: {s.rs_diff >= 0 ? 'UP' : 'DOWN'}）EMA収束 {s.ema_convergence}%
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-10 text-muted-foreground text-sm">
                          過去1年間にシグナルは検出されませんでした
                        </div>
                      )}
                    </div>
                  )}

                  {!signalHistory && !historyLoading && (
                    <div className="text-center py-10 text-muted-foreground text-sm">
                      「分析実行」をクリックして過去シグナルを取得してください
                    </div>
                  )}
                </div>
              </GlassCard>
            </TabsContent>

            {/* ── Tab: System ── */}
            <TabsContent value="system">
              <div className="space-y-3 plumb-animate-in">
                <DocSection title="統合エントリーシステム 概要" defaultOpen>
                  <p>
                    統合エントリーシステムは、CHoCH（トレンド転換）、EMA収束、相対強度（RS）の3条件を統合し、
                    バックテスト検証済みのパラメータで売買タイミングを判定するシステムです。
                  </p>
                </DocSection>

                <DocSection title="エントリー条件">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="plumb-glass rounded-lg p-4">
                      <h4 className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mb-2">1. 弱気CHoCH</h4>
                      <p className="text-xs leading-relaxed text-muted-foreground">直近10個の転換点から弱気CHoCHを検出。下落トレンドの転換を確認。</p>
                    </div>
                    <div className="plumb-glass rounded-lg p-4">
                      <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 mb-2">2. 強気CHoCH</h4>
                      <p className="text-xs leading-relaxed text-muted-foreground">弱気CHoCH後の強気CHoCHを検出。上昇トレンドへの転換を確認。</p>
                    </div>
                    <div className="plumb-glass rounded-lg p-4">
                      <h4 className="text-sm font-bold text-cyan-600 dark:text-cyan-400 mb-2">3. EMA収束</h4>
                      <p className="text-xs leading-relaxed text-muted-foreground">8EMA と 21EMA が 1.5ATR 以内に収束。エントリーポイントの確認。</p>
                    </div>
                  </div>
                </DocSection>

                <DocSection title="運用モード比較">
                  <DocTable
                    headers={['モード', '説明', '平均リターン', 'PF']}
                    rows={[
                      ['標準', 'RS下落時はエントリー禁止', '+7.54%', '3.61'],
                      ['積極型', 'RS無視で全エントリー', '+6.63%', '3.15'],
                      ['慎重型', 'RS下落時は50%サイズ', '+6.96%', '3.64'],
                    ]}
                  />
                </DocSection>

                <DocSection title="5層Exit System">
                  <DocTable
                    headers={['レイヤー', '名称', 'アクション']}
                    rows={[
                      ['P1', 'トレンド崩壊', '100%即時売却'],
                      ['P2', '損切りライン', 'ATR x 3.0で発動'],
                      ['P3', '反転パターン', 'CHoCH検出で警告'],
                      ['P4', '過熱度', 'RSI 7/10/13日で判定'],
                      ['P5', 'Time Stop', '期限ベースの管理'],
                    ]}
                  />
                </DocSection>

                <DocSection title="バックテスト結果（23銘柄 / 4年間）">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="plumb-glass rounded-lg p-4 text-center">
                      <div className="text-xs text-muted-foreground uppercase mb-1 font-medium">標準</div>
                      <div className="text-base font-bold text-blue-600 dark:text-blue-400">+7.54%</div>
                      <div className="text-xs text-muted-foreground">PF 3.61</div>
                    </div>
                    <div className="plumb-glass rounded-lg p-4 text-center">
                      <div className="text-xs text-muted-foreground uppercase mb-1 font-medium">積極型</div>
                      <div className="text-base font-bold text-orange-600 dark:text-orange-400">+6.63%</div>
                      <div className="text-xs text-muted-foreground">PF 3.15</div>
                    </div>
                    <div className="plumb-glass rounded-lg p-4 text-center">
                      <div className="text-xs text-muted-foreground uppercase mb-1 font-medium">慎重型</div>
                      <div className="text-base font-bold text-emerald-600 dark:text-emerald-400">+6.96%</div>
                      <div className="text-xs text-muted-foreground">PF 3.64</div>
                    </div>
                  </div>
                </DocSection>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

function ConditionCard({ label, value, isPositive, sub }: {
  label: string; value: string; isPositive: boolean; sub?: string;
}) {
  return (
    <div className="plumb-gradient-border rounded-xl">
      <div className="plumb-glass rounded-xl p-4 text-center">
        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2 font-medium">{label}</div>
        <div className={`text-xl font-bold ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 dark:text-zinc-500'}`}>
          {value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-1.5 font-mono">{sub}</div>}
      </div>
    </div>
  );
}

function calculateEMA(prices: number[], period: number): number | undefined {
  if (prices.length < period) return undefined;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}
