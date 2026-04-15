'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import CandlestickChart from '@/components/charts/CandlestickChart';
import LineChartCanvas from '@/components/charts/LineChartCanvas';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Crosshair, History, BookOpen, ShieldAlert } from 'lucide-react';
import { getSignal, getStockHistory, getSignalHistory, getChartMarkers, getBatchSignals, useStocks, useRegime, useWatchlist, addWatchlistTicker, removeWatchlistTicker, createTrade, createHolding, useHoldings, deleteHolding, deleteTrade, getTrades } from '@/lib/api';
import { AuthGuard } from '@/components/providers/AuthGuard';
import { Skeleton } from '@/components/ui/skeleton';
import { GlassCard, StatusChip, Metric, DocSection } from '@/components/shared/glass';
import { TickerIcon } from '@/components/shared/TickerIcon';
import { useUser } from '@/components/providers/UserProvider';
import type { SignalResponse, StockHistoryData, SignalHistoryResponse, ChartMarkersResponse, BatchResponse } from '@/types';

// 色は CSS 変数 (var(--brand-*) / var(--signal-*)) で統一済み。
// hex 定数が必要になったら employment/page.tsx の DA をコピー。

type Mode = 'balanced' | 'aggressive' | 'conservative';
type ExitMode = 'standard' | 'stable';
type Tab = 'entry' | 'exit_analysis' | 'history' | 'system';
type Period = '1d' | '5d' | '1mo' | '3mo' | '6mo' | 'ytd' | '1y' | '5y' | 'max';
type ChartType = 'line' | 'candlestick';
type ChartOption = 'ema' | 'fvg' | 'bos' | 'choch' | 'ob' | 'ote' | 'pd';

// modeLabels は UI 非表示 (balanced 固定)。API 呼び出し時にのみ mode を使用。

// exitModeLabels は UI 非表示 (standard 固定)。API 呼び出し時にのみ exitMode を使用。

const defaultQuickTickers = ['NVDA', 'TSLA', 'META', 'PLTR', 'COIN', 'IONQ', 'SOUN', 'RKLB'];
const defaultJpTickers = [
  { ticker: '7203', name: 'トヨタ' },
  { ticker: '9984', name: 'ソフトバンクG' },
  { ticker: '6758', name: 'ソニーG' },
  { ticker: '8306', name: '三菱UFJ' },
  { ticker: '6861', name: 'キーエンス' },
  { ticker: '7974', name: '任天堂' },
  { ticker: '9983', name: 'ファストリ' },
  { ticker: '4063', name: '信越化学' },
];
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
  ob: { label: 'OB', title: 'オーダーブロック' },
  ote: { label: 'OTE', title: '最適エントリーゾーン' },
  pd: { label: 'P/D', title: 'プレミアム/ディスカウント' },
};

export default function SignalsPageWrapper() {
  return (
    <AuthGuard>
      <Suspense fallback={null}>
        <SignalsPage />
      </Suspense>
    </AuthGuard>
  );
}

function SignalsPage() {
  const [ticker, setTicker] = useState('');
  const [mode] = useState<Mode>('balanced');
  const [exitMode] = useState<ExitMode>('standard');
  const [signal, setSignal] = useState<SignalResponse | null>(null);
  const { data: regimeData } = useRegime();
  const regime = regimeData ?? null;
  const { data: stocksData } = useStocks({ active_only: true });
  const stocks = stocksData?.stocks ?? [];
  const [history, setHistory] = useState<StockHistoryData[]>([]);
  // exitAnalysis 削除 — holding タブ廃止により不要
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
  // entryPrice / entryDate 削除 — holding タブ廃止により不要
  const [batchResults, setBatchResults] = useState<BatchResponse | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  // exitLoading 削除 — holding タブ廃止により不要
  const { data: holdingsData, mutate: mutateHoldings } = useHoldings();
  const [entryRecording, setEntryRecording] = useState(false);
  const [quickTickers, setQuickTickers] = useState<string[]>(defaultQuickTickers);
  const [jpTickers, setJpTickers] = useState<Array<{ ticker: string; name: string }>>(defaultJpTickers);
  const [showAddTicker, setShowAddTicker] = useState(false);
  const [showAddJpTicker, setShowAddJpTicker] = useState(false);
  const [newTickerInput, setNewTickerInput] = useState('');
  const [newJpTickerInput, setNewJpTickerInput] = useState('');
  const [newJpNameInput, setNewJpNameInput] = useState('');

  // Watchlist: backend sync (authenticated) or localStorage fallback
  const { email } = useUser();
  const { data: wlData, mutate: mutateWl } = useWatchlist();
  const migrated = useRef(false);

  // Sync quickTickers from backend watchlist when available.
  // 空の watchlist（全削除状態）もそのまま反映する。旧版は length guard があり、
  // 全削除後にリロードするとデフォルト ticker が復活してしまっていた。
  useEffect(() => {
    if (!wlData?.watchlists?.length) return;
    const defaultWl = wlData.watchlists.find(w => w.is_default) ?? wlData.watchlists[0];
    setQuickTickers(defaultWl?.tickers ?? []);
  }, [wlData]);

  // One-time migration: localStorage → backend on first auth
  useEffect(() => {
    if (!email || migrated.current) return;
    if (wlData && wlData.watchlists.length === 0) {
      const saved = localStorage.getItem('quickTickers');
      if (saved) {
        try {
          const local: unknown = JSON.parse(saved);
          if (Array.isArray(local) && local.every(v => typeof v === 'string') && local.length > 0) {
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
      if (paramTab && ['entry', 'exit_analysis', 'history', 'system'].includes(paramTab)) {
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
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.every(v => typeof v === 'string')) {
          setQuickTickers(parsed);
        }
      } catch { /* ignore */ }
    }
  }, [email]);

  // Load JP tickers from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('jpQuickTickers');
    if (saved) {
      try {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.every(v =>
          typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).ticker === 'string' && typeof (v as Record<string, unknown>).name === 'string'
        )) {
          setJpTickers(parsed as Array<{ ticker: string; name: string }>);
        }
      } catch { /* ignore */ }
    }
  }, []);

  // Exit分析・過去シグナルタブ選択時に自動フェッチ
  useEffect(() => {
    if ((activeTab === 'exit_analysis' || activeTab === 'history') && !signalHistory && !historyLoading && ticker) {
      handleFetchSignalHistory();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, ticker, exitMode]);

  const addQuickTicker = useCallback(async (t: string) => {
    const tick = t.trim().toUpperCase();
    if (!tick) return;
    if (quickTickers.includes(tick)) return;
    const newList = [...quickTickers, tick];
    setQuickTickers(newList);
    setNewTickerInput('');
    setShowAddTicker(false);
    if (email) {
      try {
        await addWatchlistTicker(tick);
        mutateWl();
      } catch (err) {
        console.error('addWatchlistTicker failed:', err);
        // API 失敗時はバックエンド側の真実に戻す
        mutateWl();
      }
    } else {
      localStorage.setItem('quickTickers', JSON.stringify(newList));
    }
  }, [quickTickers, email, mutateWl]);

  const removeQuickTicker = useCallback(async (t: string) => {
    const newList = quickTickers.filter(x => x !== t);
    setQuickTickers(newList);
    if (email) {
      try {
        await removeWatchlistTicker(t);
        mutateWl();
      } catch (err) {
        console.error('removeWatchlistTicker failed:', err);
        mutateWl();
      }
    } else {
      localStorage.setItem('quickTickers', JSON.stringify(newList));
    }
  }, [quickTickers, email, mutateWl]);

  const addJpTicker = useCallback((code: string, name: string) => {
    const tick = code.trim();
    if (!tick) return;
    if (jpTickers.some(t => t.ticker === tick)) return;
    const newList = [...jpTickers, { ticker: tick, name: name.trim() || tick }];
    setJpTickers(newList);
    setNewJpTickerInput('');
    setNewJpNameInput('');
    setShowAddJpTicker(false);
    localStorage.setItem('jpQuickTickers', JSON.stringify(newList));
  }, [jpTickers]);

  const removeJpTicker = useCallback((tick: string) => {
    const newList = jpTickers.filter(t => t.ticker !== tick);
    setJpTickers(newList);
    localStorage.setItem('jpQuickTickers', JSON.stringify(newList));
  }, [jpTickers]);

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

  const handleFetchSignalHistory = async () => {
    if (!ticker) return;
    setHistoryLoading(true);
    try {
      const res = await getSignalHistory(ticker, '1y', mode, exitMode);
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
      case 'BULL': return 'text-[var(--signal-safe-500)]';
      case 'BEAR': return 'text-[var(--signal-danger-500)]';
      case 'RECOVERY': return 'text-[var(--brand-700)]';
      case 'WEAKENING': return 'text-[var(--signal-caution-500)]';
      default: return 'text-neutral-500';
    }
  };

  const getRegimeBadge = (r: string) => {
    switch (r) {
      case 'BULL': return 'bg-[var(--signal-safe-100)] text-[var(--signal-safe-500)] border-[var(--signal-safe-300)]';
      case 'BEAR': return 'bg-[var(--signal-danger-100)] text-[var(--signal-danger-500)] border-[var(--signal-danger-300)]';
      case 'RECOVERY': return 'bg-[var(--brand-100)] text-[var(--brand-700)] border-[var(--brand-200)]';
      case 'WEAKENING': return 'bg-[var(--signal-caution-100)] text-[var(--signal-caution-500)] border-[var(--signal-caution-300)]';
      default: return 'bg-neutral-50 text-neutral-500 border-neutral-200';
    }
  };

  const chartData = history.map((d, i) => {
    const ema8 = calculateEMA(history.slice(0, i + 1).map(h => h.close), 8);
    const ema21 = calculateEMA(history.slice(0, i + 1).map(h => h.close), 21);
    return { date: d.date, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume, ema8, ema21 };
  });

  return (
    <div className="space-y-4 pb-10">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 plumb-animate-in">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-6 rounded-full bg-[var(--brand-500)]" />
            <h1 className="text-2xl font-bold tracking-tight">銘柄分析</h1>
          </div>
          <p className="text-xs text-muted-foreground pl-3.5">エントリー判定・Exit分析・シグナル履歴</p>
        </div>
        {/* 運用モードは balanced 固定。UI は非表示 */}
      </div>

      {/* ── Search Section ── */}
      <div className="rounded-xl border border-neutral-200 bg-card">
        <div className="p-5">
          <div className="flex gap-2 items-center flex-wrap">
            <div className="relative">
              <input
                type="text"
                placeholder="ティッカー (例: NVDA, 7203)"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                list="stock-list"
                className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm w-40 focus:outline-none focus:border-[var(--brand-500)] focus:ring-1 focus:ring-[var(--brand-500)]/30 transition-colors placeholder:text-neutral-400 text-foreground"
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
              className="px-5 py-2 rounded-md text-xs font-bold transition-colors disabled:opacity-50 bg-[var(--brand-500)] text-white hover:bg-[var(--brand-700)]"
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
                  const allTickers = [...quickTickers, ...jpTickers.map(t => t.ticker)];
                  const res = await getBatchSignals(allTickers, mode);
                  setBatchResults(res);
                } catch (err) {
                  setError(err instanceof Error ? err.message : '一括分析に失敗しました');
                } finally {
                  setBatchLoading(false);
                }
              }}
              disabled={batchLoading || loading}
              className="px-4 py-2 rounded-md text-xs font-bold transition-colors disabled:opacity-50 border border-neutral-200 bg-white text-neutral-700 hover:border-[var(--brand-400)] hover:text-[var(--brand-700)]"
            >
              {batchLoading ? '分析中...' : '一括分析'}
            </button>

            {/* Watchlist — 分析ボタンと同じ行 */}
            <div className="w-px h-5 bg-neutral-200 mx-1" />
            <div className="flex gap-1 flex-wrap items-center">
            {quickTickers.map((t) => (
              <span
                key={t}
                className="group relative flex items-center gap-1 px-2 py-1 rounded border border-neutral-200 bg-white text-[11px] font-mono font-semibold text-neutral-700 hover:border-[var(--brand-400)] hover:text-[var(--brand-700)] transition-colors cursor-pointer"
              >
                <TickerIcon ticker={t} size={16} />
                <span onClick={() => handleAnalyze(t)}>{t}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeQuickTicker(t); }}
                  className="hidden group-hover:inline text-[var(--signal-danger-500)] font-bold text-[10px] ml-0.5"
                >
                  ×
                </button>
              </span>
            ))}
            {jpTickers.map((t) => (
              <span
                key={t.ticker}
                className="group relative flex items-center gap-1 px-2 py-1 rounded border border-neutral-200 bg-white text-[11px] font-mono font-semibold text-neutral-700 hover:border-[var(--signal-danger-300)] hover:text-[var(--signal-danger-500)] transition-colors cursor-pointer"
              >
                <span onClick={() => handleAnalyze(t.ticker)}>{t.ticker}</span>
                <span className="text-[9px] text-neutral-500 font-sans" onClick={() => handleAnalyze(t.ticker)}>{t.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeJpTicker(t.ticker); }}
                  className="hidden group-hover:inline text-[var(--signal-danger-500)] font-bold text-[10px] ml-0.5"
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
                  className="rounded border border-neutral-200 bg-white px-2 py-1 text-[11px] w-14 focus:outline-none focus:border-[var(--brand-500)] focus:ring-1 focus:ring-[var(--brand-500)]/30 text-foreground font-mono"
                  autoFocus
                />
                <button onClick={() => addQuickTicker(newTickerInput)} className="px-2 py-1 bg-[var(--brand-100)] text-[var(--brand-700)] rounded text-[11px] font-bold hover:bg-[var(--brand-200)]">OK</button>
                <button onClick={() => { setShowAddTicker(false); setNewTickerInput(''); }} className="px-2 py-1 text-neutral-500 rounded text-[11px] font-bold hover:text-[var(--signal-danger-500)]">×</button>
              </span>
            ) : showAddJpTicker ? (
              <span className="flex items-center gap-1">
                <input
                  type="text"
                  value={newJpTickerInput}
                  onChange={(e) => setNewJpTickerInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addJpTicker(newJpTickerInput, newJpNameInput)}
                  placeholder="7203"
                  className="rounded border border-neutral-200 bg-white px-2 py-1 text-[11px] w-14 focus:outline-none focus:border-[var(--signal-danger-500)] focus:ring-1 focus:ring-[var(--signal-danger-500)]/30 text-foreground font-mono"
                  autoFocus
                />
                <input
                  type="text"
                  value={newJpNameInput}
                  onChange={(e) => setNewJpNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addJpTicker(newJpTickerInput, newJpNameInput)}
                  placeholder="名前"
                  className="rounded border border-neutral-200 bg-white px-2 py-1 text-[11px] w-16 focus:outline-none focus:border-[var(--signal-danger-500)] focus:ring-1 focus:ring-[var(--signal-danger-500)]/30 text-foreground"
                />
                <button onClick={() => addJpTicker(newJpTickerInput, newJpNameInput)} className="px-2 py-1 bg-[var(--signal-danger-100)] text-[var(--signal-danger-500)] rounded text-[11px] font-bold hover:bg-[var(--signal-danger-300)]">OK</button>
                <button onClick={() => { setShowAddJpTicker(false); setNewJpTickerInput(''); setNewJpNameInput(''); }} className="px-2 py-1 text-neutral-500 rounded text-[11px] font-bold hover:text-[var(--signal-danger-500)]">×</button>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <button
                  onClick={() => setShowAddTicker(true)}
                  className="px-2 py-1 border border-dashed border-neutral-300 rounded text-neutral-500 text-[11px] font-semibold hover:border-[var(--brand-400)] hover:text-[var(--brand-700)] transition-colors"
                >
                  + US
                </button>
                <button
                  onClick={() => setShowAddJpTicker(true)}
                  className="px-2 py-1 border border-dashed border-neutral-300 rounded text-neutral-500 text-[11px] font-semibold hover:border-[var(--signal-danger-300)] hover:text-[var(--signal-danger-500)] transition-colors"
                >
                  + JP
                </button>
              </span>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="plumb-animate-in flex items-center justify-between px-5 py-3 border border-[var(--signal-danger-300)] bg-[var(--signal-danger-100)] rounded-xl">
          <span className="text-[var(--signal-danger-500)] text-sm">{error}</span>
          <button onClick={() => setError(null)} className="p-1 rounded hover:bg-[var(--signal-danger-300)]/30 text-[var(--signal-danger-500)] transition-colors" title="閉じる">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && !batchLoading && <SignalsLoadingSkeleton />}
      {batchLoading && <BatchLoadingSkeleton />}

      {/* ── Market Regime Bar (Batch) ── */}
      {regime && !loading && batchResults && (
        <div className="rounded-xl border border-neutral-200 bg-card px-5 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-neutral-500">Regime</span>
            <span className={`text-lg font-bold ${getRegimeColor(regime.regime)}`}>{regime.regime}</span>
            <span className="text-sm text-neutral-500">{regime.description}</span>
          </div>
          <div className="flex gap-5">
            <div className="text-center">
              <div className="text-[10px] text-neutral-500 uppercase font-medium">SPY</div>
              <div className="text-sm font-semibold font-mono text-foreground">${regime.benchmark_price.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-neutral-500 uppercase font-medium">200 EMA</div>
              <div className="text-sm font-semibold font-mono text-foreground">${regime.benchmark_ema_long.toFixed(2)}</div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-neutral-500 uppercase font-medium">21傾き</div>
              <div className={`text-sm font-semibold font-mono ${regime.ema_short_slope >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>
                {regime.ema_short_slope >= 0 ? '+' : ''}{regime.ema_short_slope.toFixed(3)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Batch Results ── */}
      {batchResults && !batchLoading && (
        <div className="space-y-4 plumb-animate-in">
          {/* Summary */}
          <div className="rounded-xl border border-neutral-200 bg-card px-5 py-3 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-foreground">一括分析結果</span>
              <span className="text-sm text-neutral-500">{batchResults.total_analyzed}銘柄</span>
            </div>
            <StatusChip label={`エントリー可能: ${batchResults.entry_ready_count}`} color="green" />
          </div>

          {/* Card Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {batchResults.results.map((r) => {
              const rsColors: Record<string, string> = {
                UP: 'text-[var(--signal-safe-500)]',
                FLAT: 'text-[var(--signal-caution-500)]',
                DOWN: 'text-[var(--signal-danger-500)]',
              };
              const rsLabels: Record<string, string> = { UP: '上昇', FLAT: '横ばい', DOWN: '下落' };
              const rsTrend = r.relative_strength?.trend || 'FLAT';
              return (
                <div
                  key={r.ticker}
                  onClick={() => { setBatchResults(null); handleAnalyze(r.ticker); }}
                  className={`rounded-xl border bg-card p-5 cursor-pointer transition-all hover:border-[var(--brand-400)] hover:shadow-[0_0_0_3px_var(--brand-100)] ${
                    r.error
                      ? 'border-[var(--signal-danger-300)]'
                      : r.entry_allowed
                        ? 'border-neutral-200 border-l-2 border-l-[var(--signal-safe-500)]'
                        : 'border-neutral-200'
                  }`}
                >
                  {r.error ? (
                    <>
                      <div className="flex items-center gap-2">
                        <TickerIcon ticker={r.ticker} size={28} />
                        <span className="text-lg font-bold text-foreground">{r.ticker}</span>
                      </div>
                      <div className="text-xs text-[var(--signal-danger-500)] mt-2">Error</div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <TickerIcon ticker={r.ticker} size={28} />
                          <div>
                            <span className="text-lg font-bold text-foreground">{r.ticker}</span>
                            {r.name && <span className="ml-1.5 text-[10px] text-neutral-500">{r.name}</span>}
                          </div>
                        </div>
                        <span className="text-sm font-semibold font-mono text-foreground">{/^\d/.test(r.ticker) ? '¥' : '$'}{r.price?.toFixed(2)}</span>
                      </div>
                      <div className="mb-2 flex items-center gap-2 flex-wrap">
                        <StatusChip label={r.entry_allowed ? '買いシグナル' : 'エントリーなし'} color={r.entry_allowed ? 'green' : 'blue'} />
                        {r.exit_verdict && (
                          <StatusChip
                            label={r.exit_verdict}
                            color={r.exit_verdict_color === 'red' ? 'red' : r.exit_verdict_color === 'orange' ? 'orange' : r.exit_verdict_color === 'emerald' ? 'green' : 'blue'}
                          />
                        )}
                        {r.position_size_pct > 0 && (
                          <span className="text-[10px] text-neutral-500">サイズ: {r.position_size_pct}%</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-xs text-neutral-500">
                        <span>統合判定: <span className={`font-semibold ${r.combined_ready ? 'text-[var(--signal-safe-500)]' : 'text-neutral-400'}`}>{r.combined_ready ? '達成' : '未達'}</span></span>
                        <span>RS: <span className={`font-semibold ${rsColors[rsTrend]}`}>{rsLabels[rsTrend]}</span></span>
                        {r.exit_atr_floor != null && (
                          <span>損切ライン: <span className="font-mono font-semibold text-[var(--signal-danger-500)]">
                            {/^\d/.test(r.ticker) ? '¥' : '$'}{r.exit_atr_floor.toFixed(2)}
                          </span></span>
                        )}
                        {r.exit_verdict_reason && (
                          <span className="col-span-2 text-[10px]">{r.exit_verdict_reason}</span>
                        )}
                        {r.exit_entry_date && (
                          <span>買付: <span className="font-mono text-foreground">{r.exit_entry_date}</span></span>
                        )}
                        {r.exit_unrealized_pct != null && (
                          <span>含み: <span className={`font-mono font-semibold ${r.exit_unrealized_pct >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>
                            {r.exit_unrealized_pct >= 0 ? '+' : ''}{r.exit_unrealized_pct.toFixed(1)}%
                          </span> ({r.exit_holding_days}日)</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Empty State ガイド (初期画面) ── */}
      {!signal && !loading && !ticker && (
        <div className="rounded-xl border-2 border-dashed border-[var(--brand-200)] bg-[var(--brand-100)]/30 p-8 md:p-12 text-center plumb-animate-in">
          <div className="max-w-md mx-auto">
            <div className="w-14 h-14 rounded-full bg-[var(--brand-100)] flex items-center justify-center mx-auto mb-5">
              <svg className="w-7 h-7 text-[var(--brand-500)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">銘柄を分析してみましょう</h2>
            <p className="text-sm text-neutral-600 mb-6">
              ティッカー (例: <span className="font-mono font-semibold text-foreground">NVDA</span>, <span className="font-mono font-semibold text-foreground">AAPL</span>, <span className="font-mono font-semibold text-foreground">7203</span>) を上の入力欄に入力して
              <strong className="text-foreground"> 分析 </strong>ボタンを押してください。
            </p>
            <div className="space-y-3 text-left">
              <div className="flex gap-3 items-start">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--brand-100)] text-[var(--brand-700)] font-bold text-xs flex items-center justify-center border border-[var(--brand-200)]">1</span>
                <div>
                  <span className="text-sm font-bold text-foreground">分析ボタンを押す</span>
                  <p className="text-xs text-neutral-500">買いシグナルの有無、チャート、エントリー条件が表示されます</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--brand-100)] text-[var(--brand-700)] font-bold text-xs flex items-center justify-center border border-[var(--brand-200)]">2</span>
                <div>
                  <span className="text-sm font-bold text-foreground">決済分析タブを開く</span>
                  <p className="text-xs text-neutral-500">過去のポジションの判定結果が確認できます</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--brand-100)] text-[var(--brand-700)] font-bold text-xs flex items-center justify-center border border-[var(--brand-200)]">3</span>
                <div>
                  <span className="text-sm font-bold text-foreground">システム解説タブを見る</span>
                  <p className="text-xs text-neutral-500">売買ルール、画面の色の見方、バックテスト結果を確認できます</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Signal Result ── */}
      {signal && !loading && (
        <div className="space-y-4 plumb-animate-in">
          {/* Hero Card */}
          <div className="rounded-xl border border-neutral-200 bg-card p-5 md:p-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <TickerIcon ticker={signal.ticker} size={72} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-extrabold tracking-tight text-foreground">{signal.ticker}</span>
                    {/^\d/.test(signal.ticker) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--signal-danger-100)] text-[var(--signal-danger-500)] border border-[var(--signal-danger-300)] font-mono">JP</span>
                    )}
                  </div>
                  {(() => {
                    const name = signal.name ?? stocks.find(s => s.ticker === signal.ticker)?.name;
                    return name ? <div className="text-sm text-neutral-500 truncate max-w-[260px]">{name}</div> : null;
                  })()}
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className="text-xl font-bold font-mono text-foreground">{/^\d/.test(signal.ticker) ? '¥' : '$'}{signal.price.toFixed(2)}</span>
                    <span className={`text-sm font-semibold ${signal.price_change_pct >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>
                      {signal.price_change_pct >= 0 ? '+' : ''}{signal.price_change_pct.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <span className={`inline-flex items-center px-3 py-1.5 rounded-md text-xs font-bold border ${
                  signal.relative_strength.trend === 'UP' ? 'bg-[var(--signal-safe-100)] text-[var(--signal-safe-500)] border-[var(--signal-safe-300)]'
                  : signal.relative_strength.trend === 'DOWN' ? 'bg-[var(--signal-danger-100)] text-[var(--signal-danger-500)] border-[var(--signal-danger-300)]'
                  : 'bg-neutral-50 text-neutral-500 border-neutral-200'
                }`}>
                  RS: {signal.relative_strength.trend}
                </span>
                <span className={`inline-flex items-center px-3 py-1.5 rounded-md text-xs font-bold border ${getRegimeBadge(signal.regime)}`}>
                  市場: {signal.regime}
                </span>
              </div>
            </div>
          </div>

          {/* ── Chart Section ── */}
          <div className="rounded-xl border border-neutral-200 bg-card p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Chart Type */}
                <div className="inline-flex items-center rounded-md border border-neutral-200 bg-white overflow-hidden">
                  {([
                    { v: 'line' as ChartType, label: 'ライン' },
                    { v: 'candlestick' as ChartType, label: 'ローソク足' },
                  ]).map((opt, i) => {
                    const isActive = chartType === opt.v;
                    return (
                      <button
                        key={opt.v}
                        onClick={() => setChartType(opt.v)}
                        className={`px-3.5 py-1.5 text-[11px] font-bold tracking-wider transition-colors ${
                          i > 0 ? 'border-l border-neutral-200' : ''
                        } ${
                          isActive
                            ? 'bg-[var(--brand-100)] text-[var(--brand-700)]'
                            : 'text-neutral-700 hover:bg-neutral-50'
                        }`}
                      >{opt.label}</button>
                    );
                  })}
                </div>
                {/* Chart Options */}
                <div className="inline-flex items-center rounded-md border border-neutral-200 bg-white overflow-hidden">
                  {(Object.keys(chartOptionLabels) as ChartOption[]).map((opt, i) => {
                    const isActive = chartOptions.has(opt);
                    return (
                      <button
                        key={opt}
                        onClick={() => toggleChartOption(opt)}
                        title={chartOptionLabels[opt].title}
                        className={`px-3 py-1.5 text-[11px] font-bold tracking-wider transition-colors ${
                          i > 0 ? 'border-l border-neutral-200' : ''
                        } ${
                          isActive
                            ? 'bg-[var(--brand-100)] text-[var(--brand-700)]'
                            : 'text-neutral-700 hover:bg-neutral-50'
                        }`}
                      >
                        {chartOptionLabels[opt].label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Period */}
              <div className="inline-flex items-center rounded-md border border-neutral-200 bg-white overflow-hidden">
                {periods.map((p, i) => {
                  const isActive = period === p.value;
                  return (
                    <button
                      key={p.value}
                      onClick={() => handlePeriodChange(p.value)}
                      className={`px-3 py-1.5 text-[11px] font-bold tracking-wider transition-colors ${
                        i > 0 ? 'border-l border-neutral-200' : ''
                      } ${
                        isActive
                          ? 'bg-[var(--brand-100)] text-[var(--brand-700)]'
                          : 'text-neutral-700 hover:bg-neutral-50'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-[450px] rounded-lg overflow-hidden">
              {chartType === 'candlestick' ? (
                <CandlestickChart
                  data={chartData}
                  ticker={ticker}
                  showEMA={chartOptions.has('ema')}
                  showBOS={chartOptions.has('bos')}
                  showCHoCH={chartOptions.has('choch')}
                  showFVG={chartOptions.has('fvg')}
                  showOB={chartOptions.has('ob')}
                  showOTE={chartOptions.has('ote')}
                  showPD={chartOptions.has('pd')}
                  bosMarkers={chartMarkers?.bos || []}
                  chochMarkers={chartMarkers?.choch || []}
                  fvgMarkers={chartMarkers?.fvg || []}
                  obMarkers={chartMarkers?.order_blocks || []}
                  oteMarkers={chartMarkers?.ote_zones || []}
                  pdZone={chartMarkers?.premium_discount || null}
                  initialVisibleCount={chartData.length}
                />
              ) : (
                <LineChartCanvas
                  data={chartData}
                  ticker={ticker}
                  showEMA={chartOptions.has('ema')}
                  initialVisibleCount={chartData.length}
                />
              )}
            </div>

            {/* Chart Legend — チャート内部の hex は維持 (CandlestickChart 内部色と一致させる必要) */}
            <div className="flex gap-4 mt-3 justify-center text-xs text-neutral-500 flex-wrap">
              {chartType === 'candlestick' && (
                <>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#26a69a]" /> 陽線</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#ef5350]" /> 陰線</span>
                </>
              )}
              {chartType === 'candlestick' && chartOptions.has('bos') && (
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[var(--signal-caution-300)]" /> BOS</span>
              )}
              {chartType === 'candlestick' && chartOptions.has('choch') && (
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[var(--brand-700)]" /> CHoCH</span>
              )}
              {chartType === 'candlestick' && chartOptions.has('fvg') && (
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-[var(--brand-100)] border border-[var(--brand-200)] rounded-sm" /> FVG</span>
              )}
              {chartType === 'candlestick' && chartOptions.has('ob') && (
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-[var(--brand-100)] border border-[var(--brand-400)] rounded-sm" /> OB</span>
              )}
              {chartType === 'candlestick' && chartOptions.has('ote') && (
                <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-[var(--brand-100)] border border-[var(--brand-500)] rounded-sm" /> OTE</span>
              )}
              {chartType === 'candlestick' && chartOptions.has('pd') && (
                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[var(--signal-danger-300)]" /> P/D</span>
              )}
            </div>
          </div>

          {/* ── Analysis Tabs ── */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)} className="plumb-tabs">
            <TabsList variant="line" className="rounded-lg border border-neutral-200 bg-card px-1 py-0.5 w-full justify-start">
              <TabsTrigger value="entry" className="text-[11px] font-mono uppercase tracking-wider"><Crosshair className="w-3.5 h-3.5 mr-1.5" />エントリー判定</TabsTrigger>
              <TabsTrigger value="exit_analysis" className="text-[11px] font-mono uppercase tracking-wider"><ShieldAlert className="w-3.5 h-3.5 mr-1.5" />Exit分析</TabsTrigger>

              <TabsTrigger value="history" className="text-[11px] font-mono uppercase tracking-wider"><History className="w-3.5 h-3.5 mr-1.5" />過去のポジション</TabsTrigger>
              <TabsTrigger value="system" className="text-[11px] font-mono uppercase tracking-wider"><BookOpen className="w-3.5 h-3.5 mr-1.5" />システム解説</TabsTrigger>
            </TabsList>

            {/* ── Tab: Entry ── */}
            <TabsContent value="entry">
              <div className="rounded-xl border border-neutral-200 bg-card p-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-base font-bold text-foreground">エントリー判定パネル</span>
                  <span className="text-sm text-neutral-500">統合エントリーシステム</span>
                  {/* モード chip 非表示: balanced 固定 */}
                </div>
                <p className="text-xs text-neutral-500 mb-5">前日の終値確定後に判定 → 買いシグナルが出たら翌営業日の寄付で購入</p>

                {/* Regime Info — signal がある時はシグナルのベンチマークを使用 */}
                {(signal || regime) && (() => {
                  const regimeLabel = signal?.regime ?? regime?.regime ?? '';
                  const bmTicker = signal?.benchmark_ticker ?? regime?.benchmark_ticker ?? 'SPY';
                  const bmPrice = signal?.benchmark_price ?? regime?.benchmark_price ?? 0;
                  const bmEma = signal?.benchmark_ema_long ?? regime?.benchmark_ema_long ?? 0;
                  const slope = signal?.ema_short_slope ?? regime?.ema_short_slope ?? 0;
                  const bmIsJP = bmTicker === '^N225' || bmTicker === 'N225';
                  const bmName = bmIsJP ? '日経225' : bmTicker;
                  const bmCcy = bmIsJP ? '¥' : '$';
                  return (
                    <div className="flex items-center gap-4 mb-5 px-4 py-3 rounded-md border border-neutral-200 bg-neutral-50 text-sm flex-wrap">
                      <Metric label="市場" value="">
                        <span className={`text-sm font-bold ${getRegimeColor(regimeLabel)}`}>{regimeLabel}</span>
                      </Metric>
                      <span className="w-px h-4 bg-neutral-200" />
                      <span className="text-neutral-500">{bmName}: <span className="text-foreground font-mono font-semibold">{bmCcy}{bmPrice.toFixed(2)}</span></span>
                      <span className="text-neutral-500">200EMA: <span className="text-foreground font-mono font-semibold">{bmCcy}{bmEma.toFixed(2)}</span></span>
                      <span className="text-neutral-500">傾き: <span className={`font-mono font-semibold ${slope >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>{slope >= 0 ? '+' : ''}{slope.toFixed(3)}</span></span>
                    </div>
                  );
                })()}

                {/* Verdict Hero */}
                <div className={`relative text-center py-8 rounded-xl mb-5 border ${
                  signal.entry_allowed
                    ? 'border-[var(--signal-safe-300)] bg-[var(--signal-safe-100)]'
                    : 'border-neutral-200 bg-neutral-50'
                }`}>
                  <div className={`text-4xl font-extrabold tracking-[0.2em] ${
                    signal.entry_allowed ? 'text-[var(--signal-safe-500)]' : 'text-neutral-400'
                  }`}>
                    {signal.entry_allowed ? '買い' : '見送り'}
                  </div>
                  <div className="text-sm text-neutral-500 mt-2">
                    {signal.entry_allowed
                      ? `ポジションサイズ: ${signal.position_size_pct}%`
                      : signal.mode_note || '条件未達成'}
                  </div>
                  {/* エントリー記録ボタン */}
                  {signal.entry_allowed && (() => {
                    const alreadyHeld = holdingsData?.holdings?.some(
                      (h: { ticker: string; shares: number }) => h.ticker.toUpperCase() === signal.ticker.toUpperCase() && h.shares > 0
                    );
                    if (alreadyHeld) {
                      const held = holdingsData?.holdings?.find(
                        (h: { ticker: string; shares: number }) => h.ticker.toUpperCase() === signal.ticker.toUpperCase() && h.shares > 0
                      );
                      return (
                        <div className="mt-4 flex items-center gap-3">
                          <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--signal-safe-100)] text-[var(--signal-safe-700)] text-sm font-semibold border border-[var(--signal-safe-300)]">
                            ✓ 保有中
                            {held && (
                              <span className="font-normal text-xs text-[var(--signal-safe-600)] ml-1">
                                (${held.avg_price?.toFixed(2)} / {held.entry_date?.slice(0, 10) || ''})
                              </span>
                            )}
                          </span>
                          {held && (
                            <button
                              onClick={async () => {
                                if (!held.id) return;
                                if (!window.confirm(`${signal.ticker} のエントリー記録を取り消しますか？`)) return;
                                try {
                                  await deleteHolding(held.id);
                                  const tradesRes = await getTrades({ ticker: signal.ticker, action: 'BUY', limit: 1 });
                                  if (tradesRes?.trades?.[0]) {
                                    await deleteTrade(tradesRes.trades[0].id!);
                                  }
                                  mutateHoldings();
                                } catch (e) {
                                  console.error('Cancel entry failed:', e);
                                }
                              }}
                              className="text-xs text-neutral-400 hover:text-[var(--signal-danger-500)] transition-colors"
                            >
                              ✕ 取り消し
                            </button>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div className="mt-4">
                        <button
                          disabled={entryRecording}
                          onClick={async () => {
                            setEntryRecording(true);
                            try {
                              const today = new Date().toISOString().slice(0, 10);
                              await createHolding({
                                ticker: signal.ticker,
                                shares: 1,
                                avg_price: signal.price,
                                entry_date: today,
                                regime_at_entry: signal.regime || undefined,
                                rs_at_entry: signal.relative_strength?.trend || undefined,
                              });
                              await createTrade({
                                ticker: signal.ticker,
                                action: 'BUY',
                                shares: 1,
                                price: signal.price,
                                trade_date: today,
                                regime: signal.regime || undefined,
                                rs_trend: signal.relative_strength?.trend || undefined,
                                reason: 'signal entry',
                              });
                              mutateHoldings();
                            } catch (e) {
                              console.error('Entry record failed:', e);
                            } finally {
                              setEntryRecording(false);
                            }
                          }}
                          className="px-6 py-2.5 rounded-lg bg-[var(--signal-safe-500)] text-white text-sm font-bold hover:bg-[var(--signal-safe-600)] transition-colors disabled:opacity-50"
                        >
                          {entryRecording ? '記録中...' : 'エントリーした'}
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {/* Toggle Details */}
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 border-t border-neutral-100 text-xs text-neutral-500 hover:text-[var(--brand-700)] transition-colors"
                >
                  <span>{showDetails ? '詳細を閉じる' : '詳細を見る'}</span>
                  <svg className={`w-3 h-3 transition-transform duration-200 ${showDetails ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {/* Details */}
                {showDetails && (
                  <div className="mt-4 space-y-4 plumb-animate-in">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <ConditionCard label="統合判定" value={signal.combined_ready ? '達成' : '未達'} isPositive={signal.combined_ready} sub="転換 + EMA収束" />
                      <ConditionCard label="弱気転換" value={signal.conditions.bearish_choch?.found ? '検出' : '未検出'} isPositive={signal.conditions.bearish_choch?.found || false} sub={signal.conditions.bearish_choch?.date?.slice(0, 10) || ''} />
                      <ConditionCard label="強気転換" value={signal.conditions.bullish_choch?.found ? '検出' : '未検出'} isPositive={signal.conditions.bullish_choch?.found || false} sub={signal.conditions.bullish_choch?.date?.slice(0, 10) || ''} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <ConditionCard label="EMA収束" value={`${signal.conditions.ema_convergence?.value?.toFixed(2) || 'N/A'}%`} isPositive={signal.conditions.ema_convergence?.converged || false} sub={`閾値: ${signal.conditions.ema_convergence?.threshold}%`} />
                      <ConditionCard label="相対強度（RS）" value={signal.relative_strength.trend} isPositive={signal.relative_strength.trend !== 'DOWN'} sub={`${signal.relative_strength.change_pct >= 0 ? '+' : ''}${signal.relative_strength.change_pct.toFixed(2)}%`} />
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── Tab: Exit Analysis ── */}
            <TabsContent value="exit_analysis">
              <div className="rounded-xl border border-neutral-200 bg-card p-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-base font-bold text-foreground">決済分析パネル</span>
                  <span className="text-sm text-neutral-500">4層決済システム</span>
                  {/* Exit モードは standard (ハイブリッド) 固定。UI 非表示 */}
                  <div className="ml-auto">
                    <button
                      onClick={handleFetchSignalHistory}
                      disabled={historyLoading}
                      className="px-4 py-1.5 rounded-md text-[11px] font-bold tracking-wider transition-colors disabled:opacity-50 bg-[var(--brand-500)] text-white hover:bg-[var(--brand-700)]"
                    >
                      {historyLoading ? '取得中...' : '更新'}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-neutral-500 mb-5">前日の終値確定後に判定 → 売却シグナルが出たら翌営業日の寄付で売却</p>

                  {(() => {
                    const trades = signalHistory?.trade_results ?? [];
                    const allStatuses = signalHistory?.live_exit_statuses ?? [];
                    const actives = allStatuses.filter(s => !s.trade_completed);
                    const exitedPositions = allStatuses.filter(s => s.trade_completed);
                    const ccy = /^\d/.test(signal?.ticker || '') ? '¥' : '$';
                    const isBuyNow = signal?.entry_allowed === true;

                    const exitReasonJP: Record<string, string> = {
                      'ATR_Floor': '① 損切ライン',
                      'ATR_Floor(partial)': '① 損切ライン (残り)',
                      'Mirror_Partial': '② 弱気転換 (半分売却)',
                      'Mirror_Full': '② 弱気転換 (全売却)',
                      'Trail_Stop': '③ 利確ストップ',
                      'Trail_Stop(partial)': '③ 利確ストップ (残り)',
                      'Time_Stop': '④ 保有期限',
                      'Time_Stop(partial)': '④ 保有期限 (残り)',
                    };


                    // アクティブポジションの判定
                    const latestActive = actives.length > 0 ? actives[actives.length - 1] : null;
                    type Verdict = { action: string; color: 'red' | 'orange' | 'emerald'; sellPct: number; reason: string };
                    const getActiveVerdict = (s: NonNullable<typeof latestActive>): Verdict => {
                      if (s.atr_floor_triggered) return { action: '全売却', color: 'red', sellPct: 100, reason: `終値が損切ライン ${ccy}${s.atr_floor_price.toFixed(2)} を割った` };
                      if (s.bearish_choch_detected && s.ema_death_cross) return { action: '全売却', color: 'red', sellPct: 100, reason: '弱気転換 + EMA デスクロス確定 — 残り 50% も売却' };
                      if (s.bearish_choch_detected) return { action: '50% 売却', color: 'orange', sellPct: 50, reason: '弱気転換検出 — まず半分売却、EMA デスクロスで残りも' };
                      if (s.nearest_exit_reason === 'Time_Stop') return { action: '全売却', color: 'orange', sellPct: 100, reason: '保有期限 (252 日) に到達' };
                      if (s.trail_active && s.trail_stop_price) {
                        const distancePct = ((signal.price - s.trail_stop_price) / s.trail_stop_price) * 100;
                        return { action: '保有継続', color: 'emerald', sellPct: 0, reason: `利確ストップ追従中 — 終値が ${ccy}${s.trail_stop_price.toFixed(2)} を割ると全売却 (現在まで +${distancePct.toFixed(1)}% の余裕)` };
                      }
                      return { action: '保有継続', color: 'emerald', sellPct: 0, reason: '全条件クリア — 売却シグナルなし' };
                    };

                    // 全ポジションの判定を計算
                    const activeVerdicts = actives.map(s => ({ status: s, verdict: getActiveVerdict(s) }));
                    // 要アクション（売却シグナル発動中）のポジション
                    const urgentPositions = activeVerdicts.filter(v => v.verdict.sellPct > 0);
                    // 緊急度順: red > orange > emerald
                    const colorPriority = { red: 0, orange: 1, emerald: 2 };
                    const mostUrgent = activeVerdicts.length > 0
                      ? activeVerdicts.reduce((a, b) => colorPriority[a.verdict.color] < colorPriority[b.verdict.color] ? a : b)
                      : null;

                    // Hero状態: 最も緊急なポジション > BUY判定中 > NO POSITION
                    const heroVerdict = mostUrgent ? mostUrgent.verdict : null;
                    const heroPosition = mostUrgent ? mostUrgent.status : latestActive;
                    const heroState = heroVerdict ? heroVerdict.color : isBuyNow ? 'blue' as const : exitedPositions.length > 0 ? 'orange' as const : 'zinc' as const;
                    const verdictStyles = {
                      red:     { text: 'text-[var(--signal-danger-500)]',  bg: 'bg-[var(--signal-danger-100)]',  border: 'border-[var(--signal-danger-300)]' },
                      orange:  { text: 'text-[var(--signal-caution-500)]', bg: 'bg-[var(--signal-caution-100)]', border: 'border-[var(--signal-caution-300)]' },
                      emerald: { text: 'text-[var(--signal-safe-500)]',    bg: 'bg-[var(--signal-safe-100)]',    border: 'border-[var(--signal-safe-300)]' },
                      blue:    { text: 'text-[var(--brand-700)]',          bg: 'bg-[var(--brand-100)]',          border: 'border-[var(--brand-200)]' },
                      zinc:    { text: 'text-neutral-500',                  bg: 'bg-neutral-50',                  border: 'border-neutral-200' },
                    };
                    const vs = verdictStyles[heroState];

                    return (
                      <>
                        {/* ── Hero Verdict (1 件以下のときだけ表示) ── */}
                        {actives.length <= 1 && (
                        <div className={`text-center py-8 rounded-xl mb-4 border ${vs.bg} ${vs.border}`}>
                          {heroVerdict ? (
                            <>
                              <div className={`text-3xl sm:text-4xl font-extrabold tracking-[0.15em] ${vs.text}`}>
                                {heroVerdict.action}
                              </div>
                              <div className="mt-2 text-sm text-neutral-600">{heroVerdict.reason}</div>
                              {heroVerdict.sellPct > 0 && (
                                <div className={`mt-2 text-lg font-bold font-mono ${vs.text}`}>売却比率: {heroVerdict.sellPct}%</div>
                              )}
                              <div className="mt-3 flex items-center justify-center gap-4 text-xs text-neutral-600 flex-wrap">
                                <span>買値 <span className="font-mono font-semibold text-foreground">{ccy}{heroPosition!.entry_price.toFixed(2)}</span> ({heroPosition!.entry_date})</span>
                                <span className="w-px h-3 bg-neutral-300" />
                                <span>現在 <span className="font-mono font-semibold text-foreground">{ccy}{signal.price.toFixed(2)}</span></span>
                                {(() => {
                                  const matchTrade = trades.find(t => t.entry_date === heroPosition!.entry_date);
                                  return matchTrade ? (
                                    <>
                                      <span className="w-px h-3 bg-neutral-300" />
                                      <span className={vs.text}>売値 {ccy}{matchTrade.exit_price.toFixed(2)} ({matchTrade.exit_date})</span>
                                    </>
                                  ) : null;
                                })()}
                                <span className="w-px h-3 bg-neutral-300" />
                                <span>{heroPosition!.holding_days}日保有</span>
                                <span className="w-px h-3 bg-neutral-300" />
                                <span className={`font-mono font-semibold ${heroPosition!.unrealized_pct >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>
                                  {heroPosition!.unrealized_pct >= 0 ? '+' : ''}{heroPosition!.unrealized_pct.toFixed(1)}%
                                </span>
                              </div>
                              {urgentPositions.length > 1 && (
                                <div className="mt-2 text-[10px] text-neutral-500">
                                  他 {urgentPositions.length - 1} ポジションでも売却シグナル発動中 ↓
                                </div>
                              )}
                            </>
                          ) : isBuyNow ? (
                            <>
                              <div className={`text-3xl sm:text-4xl font-extrabold tracking-[0.15em] ${vs.text}`}>決済判定待ち</div>
                              <div className="mt-2 text-sm text-neutral-600">現在買いシグナル発生中 — 買い付け後に決済監視開始</div>
                              <div className="mt-3 flex items-center justify-center gap-4 text-xs text-neutral-600 flex-wrap">
                                <span>現在価格: <span className="font-mono font-semibold text-foreground">{ccy}{signal.price.toFixed(2)}</span></span>
                                <span className="w-px h-3 bg-neutral-300" />
                                <span>サイズ: <span className="font-mono font-semibold text-foreground">{signal.position_size_pct}%</span></span>
                                <span className="w-px h-3 bg-neutral-300" />
                                <span>レジーム: <span className={`font-semibold ${getRegimeColor(signal.regime)}`}>{signal.regime}</span></span>
                              </div>
                            </>
                          ) : exitedPositions.length > 0 ? (
                            (() => {
                              const lastTrade = trades.length > 0 ? trades[trades.length - 1] : null;
                              const lastTradeReason = lastTrade ? (exitReasonJP[lastTrade.exit_reason] || lastTrade.exit_reason) : null;
                              const lastTradeWin = lastTrade ? lastTrade.return_pct >= 0 : false;
                              return (
                                <>
                                  <div className="text-3xl sm:text-4xl font-extrabold tracking-[0.15em] text-[var(--signal-caution-500)]">決済済</div>
                                  {lastTrade && (
                                    <div className="mt-2 text-sm text-neutral-600">{lastTradeReason}</div>
                                  )}
                                  {lastTrade && (
                                    <div className="mt-3 flex items-center justify-center gap-4 text-xs text-neutral-600 flex-wrap">
                                      <span>買値 <span className="font-mono font-semibold text-foreground">{ccy}{lastTrade.entry_price.toFixed(2)}</span> ({lastTrade.entry_date})</span>
                                      <span className="w-px h-3 bg-neutral-300" />
                                      <span className="text-[var(--signal-caution-500)]">売値 {ccy}{lastTrade.exit_price.toFixed(2)} ({lastTrade.exit_date})</span>
                                      <span className="w-px h-3 bg-neutral-300" />
                                      <span className={`font-mono font-semibold ${lastTradeWin ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>
                                        {lastTradeWin ? '+' : ''}{lastTrade.return_pct.toFixed(1)}%
                                      </span>
                                      <span className="w-px h-3 bg-neutral-300" />
                                      <span>{lastTrade.holding_days}日保有</span>
                                    </div>
                                  )}
                                </>
                              );
                            })()
                          ) : (
                            <>
                              <div className={`text-3xl sm:text-4xl font-extrabold tracking-[0.15em] ${vs.text}`}>ポジションなし</div>
                              <div className="mt-2 text-sm text-neutral-600">
                                {trades.length > 0 ? '買いシグナル待ち — 下に取引履歴あり' : '買いシグナル待ち'}
                              </div>
                            </>
                          )}
                        </div>
                        )}

                        {/* ── 案 B: 決済トリガー状況 (1 件のときだけ表示) ── */}
                        {actives.length === 1 && latestActive && (() => {
                          const atrTriggered = latestActive.atr_floor_triggered;
                          const atrDistancePct = ((signal.price - latestActive.atr_floor_price) / latestActive.atr_floor_price) * 100;

                          const fullExit = latestActive.bearish_choch_detected && latestActive.ema_death_cross;
                          const partial = latestActive.bearish_choch_detected;

                          const trailOn = latestActive.trail_active;

                          return (
                            <div className="mb-4">
                              <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-neutral-500 mb-2">
                                決済トリガー状況
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                {/* 損切 (ATR_Floor) */}
                                <div className={`rounded-lg border px-3.5 py-3 ${
                                  atrTriggered
                                    ? 'border-[var(--signal-danger-300)] bg-[var(--signal-danger-100)]'
                                    : 'border-neutral-200 bg-card'
                                }`}>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[10px] uppercase tracking-wider font-bold text-neutral-700">損切ライン</span>
                                    <span className={`w-2 h-2 rounded-full ${atrTriggered ? 'bg-[var(--signal-danger-500)]' : 'bg-neutral-300'}`} />
                                  </div>
                                  <div className={`text-sm font-extrabold ${atrTriggered ? 'text-[var(--signal-danger-500)]' : 'text-neutral-500'}`}>
                                    {atrTriggered ? '発動' : '未発動'}
                                  </div>
                                  <div className="mt-1 text-xs font-mono font-semibold text-foreground">{ccy}{latestActive.atr_floor_price.toFixed(2)}</div>
                                  <div className="text-[10px] text-neutral-500 mt-0.5">
                                    現在比 <span className={`font-mono font-semibold ${atrDistancePct >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>{atrDistancePct >= 0 ? '+' : ''}{atrDistancePct.toFixed(1)}%</span>
                                  </div>
                                </div>
                                {/* 反転 (Mirror / CHoCH) */}
                                <div className={`rounded-lg border px-3.5 py-3 ${
                                  fullExit ? 'border-[var(--signal-danger-300)] bg-[var(--signal-danger-100)]'
                                  : partial ? 'border-[var(--signal-caution-300)] bg-[var(--signal-caution-100)]'
                                  : 'border-neutral-200 bg-card'
                                }`}>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[10px] uppercase tracking-wider font-bold text-neutral-700">弱気転換</span>
                                    <span className={`w-2 h-2 rounded-full ${
                                      fullExit ? 'bg-[var(--signal-danger-500)]'
                                      : partial ? 'bg-[var(--signal-caution-500)]'
                                      : 'bg-neutral-300'
                                    }`} />
                                  </div>
                                  <div className={`text-sm font-extrabold ${
                                    fullExit ? 'text-[var(--signal-danger-500)]'
                                    : partial ? 'text-[var(--signal-caution-500)]'
                                    : 'text-neutral-500'
                                  }`}>
                                    {fullExit ? '全決済' : partial ? '50% 売却済' : '未検出'}
                                  </div>
                                  <div className="mt-1 text-xs font-mono font-semibold text-foreground">
                                    {partial && latestActive.choch_exit_date ? latestActive.choch_exit_date : '—'}
                                  </div>
                                  <div className="text-[10px] text-neutral-500 mt-0.5">
                                    {fullExit ? 'EMA デスクロス確定' : partial ? '残り 50% は EMA 待ち' : 'CHoCH を監視中'}
                                  </div>
                                </div>
                                {/* 利確 (Trail Stop) */}
                                <div className={`rounded-lg border px-3.5 py-3 ${
                                  trailOn ? 'border-[var(--brand-200)] bg-[var(--brand-100)]' : 'border-neutral-200 bg-card'
                                }`}>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[10px] uppercase tracking-wider font-bold text-neutral-700">利確ストップ</span>
                                    <span className={`w-2 h-2 rounded-full ${trailOn ? 'bg-[var(--brand-700)]' : 'bg-neutral-300'}`} />
                                  </div>
                                  <div className={`text-sm font-extrabold ${trailOn ? 'text-[var(--brand-700)]' : 'text-neutral-500'}`}>
                                    {trailOn ? '追従中' : '待機'}
                                  </div>
                                  <div className="mt-1 text-xs font-mono font-semibold text-foreground">
                                    {trailOn && latestActive.trail_stop_price ? `${ccy}${latestActive.trail_stop_price.toFixed(2)}` : '—'}
                                  </div>
                                  <div className="text-[10px] text-neutral-500 mt-0.5">
                                    {trailOn ? '終値が割ると全売却' : 'EMA21 × 1.05 で発動'}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* ── 現在BUY中: 今買ったらのシミュレーション ── */}
                        {isBuyNow && !latestActive && (
                          <div className="rounded-xl border border-neutral-200 bg-card p-4 mb-4">
                            <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium mb-2">今買った場合の決済監視ポイント</div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                                <div className="text-[10px] uppercase tracking-wider font-medium text-neutral-500 mb-1">損切ライン</div>
                                <div className="text-xs text-neutral-600">買値 - ATR×3.0</div>
                                <div className="text-[10px] text-neutral-500 mt-1">終値がこの価格を割ると全額損切り</div>
                              </div>
                              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                                <div className="text-[10px] uppercase tracking-wider font-medium text-neutral-500 mb-1">反転検出</div>
                                <div className="text-xs text-neutral-600">弱気転換 → 50%売却</div>
                                <div className="text-[10px] text-neutral-500 mt-1">+ EMAデスクロスで残り50%も売却</div>
                              </div>
                              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                                <div className="text-[10px] uppercase tracking-wider font-medium text-neutral-500 mb-1">利確ストップ（追従型）</div>
                                <div className="text-xs text-neutral-600">高値に追従 — 下落時に自動利確</div>
                                <div className="text-[10px] text-neutral-500 mt-1">EMA21の1.05倍超えで有効化</div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* ── PatB 統計（過去1年） ── */}
                        {signalHistory?.stats?.patb_trades && signalHistory.stats.patb_trades > 0 && (
                          <div className="mb-5">
                            <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
                              過去1年の決済実績（{signalHistory.stats.patb_trades}取引）
                            </div>
                            <div className="flex items-center gap-5 px-5 py-3.5 rounded-md border border-neutral-200 bg-neutral-50 text-base flex-wrap">
                              <span className="text-neutral-500">勝率: <span className="text-foreground font-mono font-bold">{signalHistory.stats.patb_win_rate}%</span></span>
                              <span className="w-px h-5 bg-neutral-300" />
                              <span className="text-neutral-500">PF: <span className="text-foreground font-mono font-bold">{signalHistory.stats.patb_pf ?? '∞'}</span></span>
                              <span className="w-px h-5 bg-neutral-300" />
                              <span className="text-neutral-500">平均損益: <span className={`font-mono font-bold ${(signalHistory.stats.patb_avg_pnl ?? 0) >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>{(signalHistory.stats.patb_avg_pnl ?? 0) >= 0 ? '+' : ''}{signalHistory.stats.patb_avg_pnl}%</span></span>
                              <span className="w-px h-5 bg-neutral-300" />
                              <span className="text-neutral-500">平均保有: <span className="text-foreground font-mono font-bold">{signalHistory.stats.patb_avg_hold_days}日</span></span>
                            </div>
                          </div>
                        )}

                        {/* ── 売却シグナル発動中のポジション(アラート、1 件モード時のみ) ── */}
                        {actives.length <= 1 && urgentPositions.length > 0 && (
                          <div className="mb-5">
                            <div className="text-xs uppercase tracking-wider text-neutral-500 font-semibold mb-2">
                              売却シグナル発動中（{urgentPositions.length}件）
                            </div>
                            <div className="space-y-2.5">
                              {urgentPositions.map((u, i) => {
                                const s = u.status;
                                const v = u.verdict;
                                const alertBg = v.color === 'red'
                                  ? 'bg-[var(--signal-danger-100)] border-[var(--signal-danger-300)]'
                                  : 'bg-[var(--signal-caution-100)] border-[var(--signal-caution-300)]';
                                const alertText = v.color === 'red' ? 'text-[var(--signal-danger-500)]' : 'text-[var(--signal-caution-500)]';
                                return (
                                  <div key={`urgent-${i}`} className={`rounded-lg border px-5 py-4 ${alertBg}`}>
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                      <div className="flex items-center gap-3 flex-wrap">
                                        <span className={`text-sm font-bold ${alertText}`}>{v.action}</span>
                                        <span className="text-sm text-neutral-600">{v.reason}</span>
                                      </div>
                                      <span className={`font-mono font-bold text-base ${s.unrealized_pct >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>
                                        {s.unrealized_pct >= 0 ? '+' : ''}{s.unrealized_pct.toFixed(1)}%
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-3 mt-2 text-sm text-neutral-600 flex-wrap">
                                      <span>買値 {ccy}{s.entry_price.toFixed(2)} ({s.entry_date})</span>
                                      <span className="w-px h-4 bg-neutral-300" />
                                      <span>{s.holding_days}日保有</span>
                                      {v.sellPct > 0 && (
                                        <>
                                          <span className="w-px h-4 bg-neutral-300" />
                                          <span className={`font-bold ${alertText}`}>売却比率: {v.sellPct}%</span>
                                        </>
                                      )}
                                      <span className="w-px h-4 bg-neutral-300" />
                                      <span>損切ライン: {ccy}{s.atr_floor_price.toFixed(2)}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* ── ポジション一覧 (Power BI 風グリッド、2 件以上のときに表示) ── */}
                        {actives.length >= 2 && (() => {
                          const sellCount = activeVerdicts.filter(v => v.verdict.sellPct > 0).length;
                          // 緊急度: red(0) > orange(1) > emerald(2) の順、同緊急度内は新しい (entry_date 降順) を上に
                          const sortedVerdicts = [...activeVerdicts].sort((a, b) => {
                            const pa = colorPriority[a.verdict.color];
                            const pb = colorPriority[b.verdict.color];
                            if (pa !== pb) return pa - pb;
                            return b.status.entry_date.localeCompare(a.status.entry_date);
                          });
                          return (
                            <div className="mb-5">
                              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                                <div className="text-xs uppercase tracking-wider text-neutral-500 font-semibold">
                                  {signal.ticker} のシグナル一覧 ({actives.length} 件)
                                </div>
                                <div className="text-xs text-neutral-600">
                                  {sellCount > 0 ? (
                                    <>
                                      <span className="font-bold text-[var(--signal-caution-500)]">{sellCount} 件</span> 売却シグナル発動 ·
                                      <span className="ml-1">{actives.length - sellCount} 件 保有継続</span>
                                    </>
                                  ) : (
                                    <span><span className="font-bold text-[var(--signal-safe-500)]">全 {actives.length} 件</span> 保有継続</span>
                                  )}
                                </div>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {sortedVerdicts.map(({ status: s, verdict: v }, i) => {
                                  const tileBorder = v.color === 'red' ? 'border-[var(--signal-danger-300)]'
                                    : v.color === 'orange' ? 'border-[var(--signal-caution-300)]'
                                    : 'border-neutral-200';
                                  const verdictBg = v.color === 'red' ? 'bg-[var(--signal-danger-100)] text-[var(--signal-danger-500)]'
                                    : v.color === 'orange' ? 'bg-[var(--signal-caution-100)] text-[var(--signal-caution-500)]'
                                    : 'bg-[var(--signal-safe-100)] text-[var(--signal-safe-500)]';
                                  const fullExitT = s.bearish_choch_detected && s.ema_death_cross;
                                  const partialT = s.bearish_choch_detected;
                                  return (
                                    <div key={`grid-${i}`} className={`rounded-xl border-2 bg-card p-4 ${tileBorder}`}>
                                      {/* ヘッダー: 買付情報 + 含み損益 */}
                                      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                                        <div className="flex flex-col">
                                          <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">買付</span>
                                          <span className="font-mono font-semibold text-foreground">{s.entry_date}</span>
                                          <span className="font-mono text-xs text-neutral-600">買値 {ccy}{s.entry_price.toFixed(2)} · {s.holding_days}日保有</span>
                                        </div>
                                        <div className="flex flex-col items-end">
                                          <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">含み損益</span>
                                          <span className={`font-mono text-xl font-extrabold ${s.unrealized_pct >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>
                                            {s.unrealized_pct >= 0 ? '+' : ''}{s.unrealized_pct.toFixed(1)}%
                                          </span>
                                        </div>
                                      </div>
                                      {/* Verdict バッジ + 売却指示 */}
                                      <div className={`rounded-lg px-3 py-2.5 mb-3 ${verdictBg}`}>
                                        <div className="flex items-center justify-between flex-wrap gap-1">
                                          <span className="font-bold text-sm">{v.action}</span>
                                          {v.sellPct > 0 && (
                                            <span className="text-[10px] uppercase tracking-wider font-bold">翌営業日の寄付 · 売却 {v.sellPct}%</span>
                                          )}
                                        </div>
                                        <div className="text-xs mt-0.5 opacity-90">{v.reason}</div>
                                      </div>
                                      {/* 3 chip: 損切 / 反転 / 利確 */}
                                      <div className="grid grid-cols-3 gap-2 text-[10px]">
                                        <div className={`rounded border px-2 py-1.5 ${s.atr_floor_triggered ? 'border-[var(--signal-danger-300)] bg-[var(--signal-danger-100)]' : 'border-neutral-200 bg-card'}`}>
                                          <div className="flex items-center justify-between mb-0.5">
                                            <span className="uppercase tracking-wider font-bold text-neutral-700">損切</span>
                                            <span className={`w-1.5 h-1.5 rounded-full ${s.atr_floor_triggered ? 'bg-[var(--signal-danger-500)]' : 'bg-neutral-300'}`} />
                                          </div>
                                          <div className={`font-bold text-xs ${s.atr_floor_triggered ? 'text-[var(--signal-danger-500)]' : 'text-neutral-500'}`}>
                                            {s.atr_floor_triggered ? '発動' : '未発動'}
                                          </div>
                                          <div className="font-mono text-foreground mt-0.5">{ccy}{s.atr_floor_price.toFixed(2)}</div>
                                        </div>
                                        <div className={`rounded border px-2 py-1.5 ${
                                          fullExitT ? 'border-[var(--signal-danger-300)] bg-[var(--signal-danger-100)]'
                                          : partialT ? 'border-[var(--signal-caution-300)] bg-[var(--signal-caution-100)]'
                                          : 'border-neutral-200 bg-card'
                                        }`}>
                                          <div className="flex items-center justify-between mb-0.5">
                                            <span className="uppercase tracking-wider font-bold text-neutral-700">反転</span>
                                            <span className={`w-1.5 h-1.5 rounded-full ${
                                              fullExitT ? 'bg-[var(--signal-danger-500)]'
                                              : partialT ? 'bg-[var(--signal-caution-500)]'
                                              : 'bg-neutral-300'
                                            }`} />
                                          </div>
                                          <div className={`font-bold text-xs ${
                                            fullExitT ? 'text-[var(--signal-danger-500)]'
                                            : partialT ? 'text-[var(--signal-caution-500)]'
                                            : 'text-neutral-500'
                                          }`}>
                                            {fullExitT ? '全決済' : partialT ? '50% 売却済' : '未検出'}
                                          </div>
                                          <div className="font-mono text-foreground mt-0.5">{partialT && s.choch_exit_date ? s.choch_exit_date : '—'}</div>
                                        </div>
                                        <div className={`rounded border px-2 py-1.5 ${s.trail_active ? 'border-[var(--brand-200)] bg-[var(--brand-100)]' : 'border-neutral-200 bg-card'}`}>
                                          <div className="flex items-center justify-between mb-0.5">
                                            <span className="uppercase tracking-wider font-bold text-neutral-700">利確</span>
                                            <span className={`w-1.5 h-1.5 rounded-full ${s.trail_active ? 'bg-[var(--brand-700)]' : 'bg-neutral-300'}`} />
                                          </div>
                                          <div className={`font-bold text-xs ${s.trail_active ? 'text-[var(--brand-700)]' : 'text-neutral-500'}`}>
                                            {s.trail_active ? '追従中' : '待機'}
                                          </div>
                                          <div className="font-mono text-foreground mt-0.5">{s.trail_active && s.trail_stop_price ? `${ccy}${s.trail_stop_price.toFixed(2)}` : '—'}</div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {/* ── トレード履歴（最新5件） ── */}
                        {trades.length > 0 && (() => {
                          const isPartialReason = (r: string) => r.includes('partial') || r.includes('Partial');
                          const exitLabel = (r: string) => {
                            const base = r.replace('(partial)', '').replace('_Partial', '_Full').trim();
                            const map: Record<string, string> = { 'ATR_Floor': '① 損切ライン', 'Mirror_Full': '② 弱気転換', 'Trail_Stop': '③ 利確ストップ', 'Time_Stop': '④ 保有期限' };
                            return map[base] || r;
                          };
                          // entry_date でグルーピング
                          const grouped = new Map<string, typeof trades>();
                          trades.forEach(t => { const a = grouped.get(t.entry_date) || []; a.push(t); grouped.set(t.entry_date, a); });
                          const posRows = Array.from(grouped.values()).map(group => {
                            const sorted = [...group].sort((a, b) => a.exit_date.localeCompare(b.exit_date));
                            const partial = sorted.find(t => isPartialReason(t.exit_reason));
                            const full = sorted.find(t => !isPartialReason(t.exit_reason));
                            const final_ = full || partial!;
                            const blended = partial && full ? partial.return_pct * 0.5 + full.return_pct * 0.5 : final_.return_pct;
                            return { entry: final_, partial, full, blended, final: final_ };
                          }).sort((a, b) => b.final.exit_date.localeCompare(a.final.exit_date)).slice(0, 5);

                          const fmtD = (d: string) => d.slice(5).replace('-', '/');
                          return (
                            <div className="space-y-3">
                              <div className="text-xs uppercase tracking-wider text-neutral-500 font-semibold">取引履歴（直近{posRows.length}件）</div>
                              {posRows.map((p, i) => {
                                const isWin = p.blended >= 0;
                                return (
                                  <div key={`trade-${i}`} className={`rounded-xl border-2 bg-card overflow-hidden ${isWin ? 'border-[var(--signal-safe-300)]' : 'border-[var(--signal-danger-300)]'}`}>
                                    <div className="flex">
                                      <div className={`flex flex-col items-center justify-center px-5 py-4 min-w-[90px] ${isWin ? 'bg-[var(--signal-safe-100)]' : 'bg-[var(--signal-danger-100)]'}`}>
                                        <span className={`text-xl font-extrabold font-mono ${isWin ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>
                                          {isWin ? '+' : ''}{p.blended.toFixed(1)}%
                                        </span>
                                        <span className={`text-[10px] font-bold mt-1 ${isWin ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>
                                          {isWin ? '利確' : '損切'}
                                        </span>
                                        <span className="text-[10px] text-neutral-400 mt-1">{p.final.holding_days}日保有</span>
                                      </div>
                                      <div className="flex-1 px-4 py-3">
                                        <div className="relative pl-4 space-y-2.5">
                                          <div className="absolute left-[5px] top-[6px] bottom-[6px] w-px bg-neutral-200" />
                                          <div className="relative flex items-baseline gap-2">
                                            <div className="absolute -left-4 top-[5px] w-2 h-2 rounded-full bg-neutral-400 ring-2 ring-white" />
                                            <span className="text-[11px] text-neutral-400 w-12 shrink-0">買付</span>
                                            <span className="text-xs font-mono text-neutral-600">{fmtD(p.final.entry_date)}</span>
                                            <span className="text-xs font-mono text-neutral-500">{ccy}{p.final.entry_price.toFixed(2)}</span>
                                          </div>
                                          {p.partial && (
                                            <div className="relative flex items-baseline gap-2">
                                              <div className="absolute -left-4 top-[5px] w-2 h-2 rounded-full bg-[var(--signal-caution-400)] ring-2 ring-white" />
                                              <span className="text-[11px] text-[var(--signal-caution-500)] font-medium w-12 shrink-0">50%売却</span>
                                              <span className="text-xs font-mono text-neutral-600">{fmtD(p.partial.exit_date)}</span>
                                              <span className="text-xs font-mono text-neutral-500">{ccy}{p.partial.exit_price.toFixed(2)}</span>
                                              <span className={`text-xs font-bold font-mono ${p.partial.return_pct >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>
                                                {p.partial.return_pct >= 0 ? '+' : ''}{p.partial.return_pct.toFixed(1)}%
                                              </span>
                                              <span className="text-[10px] text-neutral-400">{exitLabel(p.partial.exit_reason)}</span>
                                            </div>
                                          )}
                                          <div className="relative flex items-baseline gap-2">
                                            <div className={`absolute -left-4 top-[5px] w-2 h-2 rounded-full ring-2 ring-white ${isWin ? 'bg-[var(--signal-safe-500)]' : 'bg-[var(--signal-danger-500)]'}`} />
                                            <span className={`text-[11px] font-medium w-12 shrink-0 ${isWin ? 'text-[var(--signal-safe-600)]' : 'text-[var(--signal-danger-600)]'}`}>
                                              {p.partial ? '残50%' : '全決済'}
                                            </span>
                                            <span className="text-xs font-mono text-neutral-600">{fmtD(p.final.exit_date)}</span>
                                            <span className="text-xs font-mono text-neutral-500">{ccy}{p.final.exit_price.toFixed(2)}</span>
                                            <span className={`text-xs font-bold font-mono ${p.final.return_pct >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>
                                              {p.final.return_pct >= 0 ? '+' : ''}{p.final.return_pct.toFixed(1)}%
                                            </span>
                                            <span className="text-[10px] text-neutral-400">{exitLabel(p.final.exit_reason)}</span>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {/* ── Empty state ── */}
                        {!signalHistory && !historyLoading && !isBuyNow && (
                          <div className="text-center py-6 text-neutral-500 text-sm">データを取得中...</div>
                        )}
                      </>
                    );
                  })()}
              </div>
            </TabsContent>

            {/* ── Tab: History ── */}
            <TabsContent value="history">
              <div className="rounded-xl border border-neutral-200 bg-card p-6">
                <div className="flex items-center gap-3 mb-5">
                  <span className="text-base font-bold text-foreground">過去のポジション（1 年間）</span>
                  {signalHistory && (
                    <span className="text-sm text-neutral-500">({new Set(signalHistory.trade_results?.map(t => t.entry_date) ?? []).size + (signalHistory.live_exit_statuses?.filter(s => !s.trade_completed)?.length ?? 0)} 件)</span>
                  )}
                  <button
                    onClick={handleFetchSignalHistory}
                    disabled={historyLoading}
                    className="ml-auto px-4 py-1.5 rounded-md text-sm font-bold transition-colors disabled:opacity-50 bg-[var(--brand-500)] text-white hover:bg-[var(--brand-700)]"
                  >
                    {historyLoading ? '取得中...' : '分析実行'}
                  </button>
                </div>

                {signalHistory && (() => {
                  const trades = signalHistory.trade_results ?? [];
                  const allStatuses = signalHistory.live_exit_statuses ?? [];
                  const activePositions = allStatuses.filter(s => !s.trade_completed);
                  const ccy2 = /^\d/.test(signal?.ticker || '') ? '¥' : '$';
                  const reasonLabel = (r: string) => {
                    const base = r.replace('(partial)', '').replace('_Partial', '_Full').trim();
                    const map: Record<string, string> = {
                      'ATR_Floor': '① 損切ライン', 'Mirror_Full': '② 弱気転換',
                      'Trail_Stop': '③ 利確ストップ', 'Time_Stop': '④ 保有期限',
                    };
                    return map[base] || r;
                  };
                  const isPartial = (r: string) => r.includes('partial') || r.includes('Partial');

                  // entry_date でグルーピング (partial + full を 1 ポジションにまとめる)
                  type PositionRow = {
                    entryDate: string; entryPrice: number;
                    finalExitDate: string | null; finalExitPrice: number | null;
                    finalReturnPct: number; blendedReturnPct: number;
                    holdingDays: number;
                    fullReason: string; isActive: boolean;
                    halfSell: { date: string; price: number; pct: number; reason: string } | null;
                  };
                  const tradesByEntry = new Map<string, typeof trades>();
                  trades.forEach(t => {
                    const arr = tradesByEntry.get(t.entry_date) || [];
                    arr.push(t);
                    tradesByEntry.set(t.entry_date, arr);
                  });

                  const closedRows: PositionRow[] = [];
                  tradesByEntry.forEach((group) => {
                    const sorted = [...group].sort((a, b) => a.exit_date.localeCompare(b.exit_date));
                    const partialTrade = sorted.find(t => isPartial(t.exit_reason));
                    const fullTrade = sorted.find(t => !isPartial(t.exit_reason));
                    const finalTrade = fullTrade || partialTrade!;
                    const halfReasonBase = partialTrade ? partialTrade.exit_reason.replace('(partial)', '').replace('_Partial', '_Full').trim() : '';
                    const blended = partialTrade && fullTrade
                      ? partialTrade.return_pct * 0.5 + fullTrade.return_pct * 0.5
                      : finalTrade.return_pct;

                    closedRows.push({
                      entryDate: finalTrade.entry_date, entryPrice: finalTrade.entry_price,
                      finalExitDate: finalTrade.exit_date, finalExitPrice: finalTrade.exit_price,
                      finalReturnPct: finalTrade.return_pct, blendedReturnPct: blended,
                      holdingDays: finalTrade.holding_days,
                      fullReason: fullTrade ? reasonLabel(fullTrade.exit_reason) : reasonLabel(halfReasonBase),
                      isActive: false,
                      halfSell: partialTrade
                        ? { date: partialTrade.exit_date, price: partialTrade.exit_price, pct: partialTrade.return_pct, reason: reasonLabel(halfReasonBase) }
                        : null,
                    });
                  });

                  const rows: PositionRow[] = [
                    ...closedRows,
                    ...activePositions.map(s => ({
                      entryDate: s.entry_date, entryPrice: s.entry_price,
                      finalExitDate: null as string | null, finalExitPrice: signal?.price ?? null,
                      finalReturnPct: s.unrealized_pct, blendedReturnPct: s.unrealized_pct,
                      holdingDays: s.holding_days,
                      fullReason: s.trail_active ? '追従中' : '監視中',
                      isActive: true,
                      halfSell: s.partial_exit_done ? { date: s.choch_exit_date ?? '—', price: 0, pct: 0, reason: '② 弱気転換' } : null,
                    })),
                  ].sort((a, b) => b.entryDate.localeCompare(a.entryDate));

                  const winCount = closedRows.filter(r => r.blendedReturnPct >= 0).length;
                  const totalCount = closedRows.length;

                  return (
                    <div className="space-y-4 plumb-animate-in">
                      {/* サマリー */}
                      <div className="flex items-center gap-4 flex-wrap text-sm">
                        <span className="text-neutral-500">全 <strong className="text-foreground">{rows.length}</strong> ポジション</span>
                        {totalCount > 0 && (
                          <>
                            <span className="w-px h-4 bg-neutral-300" />
                            <span className="text-neutral-500">勝率 <strong className={winCount / totalCount >= 0.5 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}>{(winCount / totalCount * 100).toFixed(0)}%</strong> ({winCount}勝 {totalCount - winCount}敗)</span>
                          </>
                        )}
                        {activePositions.length > 0 && (
                          <>
                            <span className="w-px h-4 bg-neutral-300" />
                            <span className="text-neutral-500">保有中 <strong className="text-[var(--brand-700)]">{activePositions.length}</strong></span>
                          </>
                        )}
                      </div>

                      {/* ポジション一覧 */}
                      {rows.length > 0 ? (
                        <div className="space-y-2">
                          {rows.map((r, i) => {
                            const isWin = r.blendedReturnPct >= 0;
                            const borderColor = r.isActive ? 'border-[var(--brand-200)]'
                              : isWin ? 'border-[var(--signal-safe-300)]'
                              : 'border-[var(--signal-danger-300)]';
                            const leftBg = r.isActive ? 'bg-[var(--brand-100)]'
                              : isWin ? 'bg-[var(--signal-safe-100)]'
                              : 'bg-[var(--signal-danger-100)]';
                            const pctColor = r.isActive ? 'text-[var(--brand-700)]'
                              : isWin ? 'text-[var(--signal-safe-500)]'
                              : 'text-[var(--signal-danger-500)]';
                            const fmtDate = (d: string) => d.slice(5).replace('-', '/');
                            return (
                              <div key={`pos-${i}`} className={`rounded-xl border-2 ${borderColor} bg-card overflow-hidden`}>
                                <div className="flex">
                                  {/* 左: 損益% */}
                                  <div className={`flex flex-col items-center justify-center px-5 py-4 min-w-[90px] ${leftBg}`}>
                                    <span className={`text-xl font-extrabold font-mono ${pctColor}`}>
                                      {isWin ? '+' : ''}{r.blendedReturnPct.toFixed(1)}%
                                    </span>
                                    <span className={`text-[10px] font-bold mt-1 ${pctColor}`}>
                                      {r.isActive ? '含み損益' : '実現損益'}
                                    </span>
                                    <span className="text-[10px] text-neutral-400 mt-1">{r.holdingDays}日保有</span>
                                  </div>
                                  {/* 右: 決済タイムライン */}
                                  <div className="flex-1 px-4 py-3">
                                    <div className="relative pl-4 space-y-2.5">
                                      {/* 縦線 */}
                                      <div className="absolute left-[5px] top-[6px] bottom-[6px] w-px bg-neutral-200" />

                                      {/* 買付 */}
                                      <div className="relative flex items-baseline gap-2">
                                        <div className="absolute -left-4 top-[5px] w-2 h-2 rounded-full bg-neutral-400 ring-2 ring-white" />
                                        <span className="text-[11px] text-neutral-400 w-12 shrink-0">買付</span>
                                        <span className="text-xs font-mono text-neutral-600">{fmtDate(r.entryDate)}</span>
                                        <span className="text-xs font-mono text-neutral-500">{ccy2}{r.entryPrice.toFixed(2)}</span>
                                      </div>

                                      {/* 50% 売却 (partial) */}
                                      {r.halfSell && r.halfSell.date !== '—' && (
                                        <div className="relative flex items-baseline gap-2">
                                          <div className="absolute -left-4 top-[5px] w-2 h-2 rounded-full bg-[var(--signal-caution-400)] ring-2 ring-white" />
                                          <span className="text-[11px] text-[var(--signal-caution-500)] font-medium w-12 shrink-0">50%売却</span>
                                          <span className="text-xs font-mono text-neutral-600">{fmtDate(r.halfSell.date)}</span>
                                          <span className="text-xs font-mono text-neutral-500">{ccy2}{r.halfSell.price.toFixed(2)}</span>
                                          <span className={`text-xs font-bold font-mono ${r.halfSell.pct >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>
                                            {r.halfSell.pct >= 0 ? '+' : ''}{r.halfSell.pct.toFixed(1)}%
                                          </span>
                                          <span className="text-[10px] text-neutral-400">{r.halfSell.reason}</span>
                                        </div>
                                      )}
                                      {r.halfSell && r.halfSell.date === '—' && (
                                        <div className="relative flex items-baseline gap-2">
                                          <div className="absolute -left-4 top-[5px] w-2 h-2 rounded-full bg-[var(--signal-caution-400)] ring-2 ring-white" />
                                          <span className="text-[11px] text-[var(--signal-caution-500)] font-medium">50% 売却済</span>
                                        </div>
                                      )}

                                      {/* 全決済 / 保有中 */}
                                      <div className="relative flex items-baseline gap-2">
                                        <div className={`absolute -left-4 top-[5px] w-2 h-2 rounded-full ring-2 ring-white ${r.isActive ? 'bg-[var(--brand-500)]' : isWin ? 'bg-[var(--signal-safe-500)]' : 'bg-[var(--signal-danger-500)]'}`} />
                                        <span className={`text-[11px] font-medium w-12 shrink-0 ${r.isActive ? 'text-[var(--brand-700)]' : isWin ? 'text-[var(--signal-safe-600)]' : 'text-[var(--signal-danger-600)]'}`}>
                                          {r.isActive ? '保有中' : r.halfSell ? '残50%' : '全決済'}
                                        </span>
                                        {r.finalExitDate && (
                                          <span className="text-xs font-mono text-neutral-600">{fmtDate(r.finalExitDate)}</span>
                                        )}
                                        {r.finalExitPrice != null && (
                                          <span className="text-xs font-mono text-neutral-500">{ccy2}{r.finalExitPrice.toFixed(2)}</span>
                                        )}
                                        {!r.isActive && (
                                          <span className={`text-xs font-bold font-mono ${r.finalReturnPct >= 0 ? 'text-[var(--signal-safe-500)]' : 'text-[var(--signal-danger-500)]'}`}>
                                            {r.finalReturnPct >= 0 ? '+' : ''}{r.finalReturnPct.toFixed(1)}%
                                          </span>
                                        )}
                                        <span className="text-[10px] text-neutral-400">{r.fullReason}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-center py-10 text-neutral-500 text-sm">
                          過去 1 年間にポジションは検出されませんでした
                        </div>
                      )}
                    </div>
                  );
                })()}

                {!signalHistory && !historyLoading && (
                  <div className="text-center py-10 text-neutral-500 text-sm">
                    「分析実行」をクリックして過去のポジションを取得してください
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── Tab: System ── */}
            <TabsContent value="system">
              <div className="space-y-4 plumb-animate-in">
                {/* ── 使い方ガイド ── */}
                <div className="rounded-lg border border-[var(--brand-200)] bg-[var(--brand-100)]/50 p-4">
                  <h4 className="text-sm font-bold text-[var(--brand-700)] mb-2">はじめに</h4>
                  <p className="text-xs leading-relaxed text-neutral-700">
                    銘柄を分析したら、<strong className="text-foreground">「決済分析」タブ</strong> を開いて
                    <strong className="text-[var(--brand-700)]"> 更新 </strong>ボタンを押してください。
                    過去のシグナル履歴と現在のポジション状況が取得されます。
                  </p>
                </div>

                {/* ── 概要 ── */}
                <DocSection title="このシステムは何をするか" defaultOpen>
                  <p className="text-sm leading-relaxed text-neutral-700">
                    機械的なルールに従って <strong className="text-foreground">買い時</strong> と <strong className="text-foreground">売り時</strong> を判定します。
                    感情で売買せず、ルールどおりに実行することで、長期的に勝ちやすくする狙いです。
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-neutral-700">
                    判定はすべて <strong className="text-foreground">前日の終値が確定したあと</strong> に行い、
                    シグナルが出たら <strong className="text-foreground">翌営業日の寄付</strong> で売買します。
                  </p>
                </DocSection>

                {/* ── 買い時の判定 ── */}
                <DocSection title="買い時の判定">
                  <p className="text-sm text-neutral-700 mb-4">
                    下の <strong className="text-foreground">3 つの条件がすべて揃ったとき</strong> に「買いシグナル」が出ます。
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-lg border border-neutral-200 bg-card p-4">
                      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-1">条件 1</div>
                      <h4 className="text-sm font-bold text-foreground mb-2">下落トレンドの底打ち</h4>
                      <p className="text-xs leading-relaxed text-neutral-600">価格の動きから「下落の流れが終わった」サインを検出します。</p>
                    </div>
                    <div className="rounded-lg border border-neutral-200 bg-card p-4">
                      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-1">条件 2</div>
                      <h4 className="text-sm font-bold text-foreground mb-2">上昇トレンドへの転換</h4>
                      <p className="text-xs leading-relaxed text-neutral-600">底打ち後に、価格が上向きに反転したサインを確認します。</p>
                    </div>
                    <div className="rounded-lg border border-neutral-200 bg-card p-4">
                      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-1">条件 3</div>
                      <h4 className="text-sm font-bold text-foreground mb-2">移動平均線の収束</h4>
                      <p className="text-xs leading-relaxed text-neutral-600">短期と中期の移動平均線が近づき、エントリーに最適なタイミングであることを確認します。</p>
                    </div>
                  </div>
                </DocSection>

                {/* ── 売り時の判定 (4 つのルール) ── */}
                <DocSection title="売り時の判定 (4 つのルール)">
                  <p className="text-sm text-neutral-700 mb-4">
                    買ったあとは <strong className="text-foreground">4 つのルールを毎日チェック</strong> し、
                    どれか 1 つでも条件を満たせば売却シグナルを出します。
                  </p>
                  <div className="space-y-3">
                    {/* ルール 1: 損切 */}
                    <div className="rounded-lg border border-neutral-200 bg-card p-4">
                      <div className="flex items-start gap-3 flex-wrap">
                        <div className="rounded-md border border-[var(--signal-danger-300)] bg-[var(--signal-danger-100)] px-2.5 py-1.5 min-w-[88px]">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[9px] uppercase tracking-wider font-bold text-neutral-700">損切</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--signal-danger-500)]" />
                          </div>
                          <div className="text-[11px] font-bold text-[var(--signal-danger-500)]">発動</div>
                        </div>
                        <div className="flex-1 min-w-[200px]">
                          <h4 className="text-sm font-bold text-foreground mb-1">① 損切ライン (損失を最小限に)</h4>
                          <p className="text-xs leading-relaxed text-neutral-600">
                            価格が一定ライン以下まで下がったら <strong className="text-[var(--signal-danger-500)]">全額売却</strong>。
                            想定外の下落から資金を守る防衛ラインです。
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* ルール 2: 反転 */}
                    <div className="rounded-lg border border-neutral-200 bg-card p-4">
                      <div className="flex items-start gap-3 flex-wrap">
                        <div className="rounded-md border border-[var(--signal-caution-300)] bg-[var(--signal-caution-100)] px-2.5 py-1.5 min-w-[88px]">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[9px] uppercase tracking-wider font-bold text-neutral-700">反転</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--signal-caution-500)]" />
                          </div>
                          <div className="text-[11px] font-bold text-[var(--signal-caution-500)]">50% 売却済</div>
                        </div>
                        <div className="flex-1 min-w-[200px]">
                          <h4 className="text-sm font-bold text-foreground mb-1">② 弱気転換 (トレンドの転換を察知)</h4>
                          <p className="text-xs leading-relaxed text-neutral-600">
                            上昇トレンドが弱まる兆候が出たら、まず <strong className="text-[var(--signal-caution-500)]">半分だけ売却</strong>。
                            さらに転換が確定したら <strong className="text-[var(--signal-danger-500)]">残り 50% も売却</strong>。
                            「全部売って失敗」を避けつつ、利益を守ります。
                          </p>
                          <p className="text-xs leading-relaxed text-neutral-500 mt-1.5">
                            ※ 半分売却した後の残り 50% は、①③④ のいずれかのルールで別途決済されます。
                            「過去のポジション」タブでは「② 弱気転換 → ③ 利確ストップ」のように、どのルールの組み合わせで売られたかが表示されます。
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* ルール 3: 利確 */}
                    <div className="rounded-lg border border-neutral-200 bg-card p-4">
                      <div className="flex items-start gap-3 flex-wrap">
                        <div className="rounded-md border border-[var(--brand-200)] bg-[var(--brand-100)] px-2.5 py-1.5 min-w-[88px]">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[9px] uppercase tracking-wider font-bold text-neutral-700">利確</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--brand-700)]" />
                          </div>
                          <div className="text-[11px] font-bold text-[var(--brand-700)]">追従中</div>
                        </div>
                        <div className="flex-1 min-w-[200px]">
                          <h4 className="text-sm font-bold text-foreground mb-1">③ 利確ストップ (利益を伸ばしつつ確保)</h4>
                          <p className="text-xs leading-relaxed text-neutral-600">
                            含み益が一定以上まで伸びると <strong className="text-[var(--brand-700)]">追従モード</strong> に入り、
                            高値が更新されるたびに売却ラインが自動で切り上がります。
                            高値から一定割合下落したら <strong className="text-[var(--signal-danger-500)]">全額売却</strong>。
                            利益を伸ばしながら確保する仕組みです。
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* ルール 4: 期限 */}
                    <div className="rounded-lg border border-neutral-200 bg-card p-4">
                      <div className="flex items-start gap-3 flex-wrap">
                        <div className="rounded-md border border-neutral-200 bg-card px-2.5 py-1.5 min-w-[88px]">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[9px] uppercase tracking-wider font-bold text-neutral-700">期限</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" />
                          </div>
                          <div className="text-[11px] font-bold text-neutral-500">監視中</div>
                        </div>
                        <div className="flex-1 min-w-[200px]">
                          <h4 className="text-sm font-bold text-foreground mb-1">④ 保有期限 (長期保有のリスク回避)</h4>
                          <p className="text-xs leading-relaxed text-neutral-600">
                            買付からおよそ 1 年が経過したら、自動的に <strong className="text-foreground">全額売却</strong>。
                            シグナルが出ないまま長期間保有するリスクを避けます。
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </DocSection>

                {/* ── 画面の色の見方 ── */}
                <DocSection title="画面の色の見方">
                  <p className="text-sm text-neutral-700 mb-4">
                    画面では <strong className="text-foreground">2 種類の色</strong> が使われています。役割が違うので注意してください。
                  </p>

                  <div className="space-y-5">
                    {/* (1) 状態 chip の色 */}
                    <div>
                      <h4 className="text-sm font-bold text-foreground mb-2">① 状態表示の色 — 「今どうなっているか」</h4>
                      <p className="text-xs text-neutral-600 mb-3">
                        損切 / 反転 / 利確 などの状態表示についている色は、<strong>そのルールが今どんな状態か</strong> を示します。
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="rounded-lg border border-neutral-200 bg-card px-3 py-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="w-2 h-2 rounded-full bg-neutral-300" />
                            <span className="text-xs font-bold text-neutral-500">未発動</span>
                          </div>
                          <div className="text-[10px] text-neutral-500">何も起きていない</div>
                        </div>
                        <div className="rounded-lg border border-[var(--brand-200)] bg-[var(--brand-100)] px-3 py-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="w-2 h-2 rounded-full bg-[var(--brand-700)]" />
                            <span className="text-xs font-bold text-[var(--brand-700)]">追従中</span>
                          </div>
                          <div className="text-[10px] text-neutral-500">利益確保フェーズ</div>
                        </div>
                        <div className="rounded-lg border border-[var(--signal-caution-300)] bg-[var(--signal-caution-100)] px-3 py-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="w-2 h-2 rounded-full bg-[var(--signal-caution-500)]" />
                            <span className="text-xs font-bold text-[var(--signal-caution-500)]">部分発動</span>
                          </div>
                          <div className="text-[10px] text-neutral-500">半分売却済</div>
                        </div>
                        <div className="rounded-lg border border-[var(--signal-danger-300)] bg-[var(--signal-danger-100)] px-3 py-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="w-2 h-2 rounded-full bg-[var(--signal-danger-500)]" />
                            <span className="text-xs font-bold text-[var(--signal-danger-500)]">発動</span>
                          </div>
                          <div className="text-[10px] text-neutral-500">条件にヒット</div>
                        </div>
                      </div>
                      <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
                        ※ <strong className="text-[var(--brand-700)]">青の追従中</strong> は「利益が伸びている良い状態」で、<strong>売却シグナルではありません</strong>。
                      </p>
                    </div>

                    {/* (2) Verdict バッジの色 */}
                    <div>
                      <h4 className="text-sm font-bold text-foreground mb-2">② アクション表示の色 — 「何をすべきか」</h4>
                      <p className="text-xs text-neutral-600 mb-3">
                        ポジションごとの大きいアクション表示は <strong>今日やるべきこと</strong> を示します。これを見て売買を判断します。
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="rounded-lg px-3 py-2.5 bg-[var(--signal-safe-100)] text-[var(--signal-safe-500)]">
                          <div className="text-sm font-bold mb-0.5">保有継続</div>
                          <div className="text-[10px] opacity-90">何もしない</div>
                        </div>
                        <div className="rounded-lg px-3 py-2.5 bg-[var(--signal-caution-100)] text-[var(--signal-caution-500)]">
                          <div className="text-sm font-bold mb-0.5">50% 売却</div>
                          <div className="text-[10px] opacity-90">翌営業日の寄付で半分売る</div>
                        </div>
                        <div className="rounded-lg px-3 py-2.5 bg-[var(--signal-danger-100)] text-[var(--signal-danger-500)]">
                          <div className="text-sm font-bold mb-0.5">全売却</div>
                          <div className="text-[10px] opacity-90">翌営業日の寄付で全部売る</div>
                        </div>
                      </div>
                    </div>

                    {/* 重要な注意 */}
                    <div className="rounded-lg border border-[var(--brand-200)] bg-[var(--brand-100)]/50 p-3">
                      <div className="text-[10px] uppercase tracking-wider font-bold text-[var(--brand-700)] mb-1">注意</div>
                      <p className="text-xs leading-relaxed text-neutral-700">
                        状態表示が <strong className="text-[var(--brand-700)]">青色 (追従中)</strong> でも、アクション表示が <strong className="text-[var(--signal-safe-500)]">緑色 (保有継続)</strong> なら売る必要はありません。
                        状態表示は「ルールの状態」、アクション表示は「あなたが取るべき行動」と覚えてください。
                      </p>
                    </div>
                  </div>
                </DocSection>

                {/* ── バックテスト結果 ── */}
                <DocSection title="バックテスト結果 (過去 10 年)">
                  <p className="text-sm text-neutral-700 mb-4">
                    生存バイアスを最小化した <strong className="text-foreground">3 つの市場</strong> での実績です。
                    過去 10 年間に各指数の構成銘柄だった全銘柄を対象に、機械的にルール通り売買した場合の結果を集計しています。
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* S&P 500 */}
                    <div className="rounded-lg border border-neutral-200 bg-card p-4">
                      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-1">米国大型株</div>
                      <h4 className="text-sm font-bold text-foreground mb-3">S&P 500</h4>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-neutral-500">勝率</span><span className="font-mono font-bold text-[var(--signal-safe-500)]">69.6%</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">平均リターン</span><span className="font-mono font-bold text-foreground">+3.70%</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">PF</span><span className="font-mono font-bold text-foreground">4.76</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">トレード数</span><span className="font-mono text-neutral-600">42,622</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">対象銘柄</span><span className="font-mono text-neutral-600">591 / 698</span></div>
                      </div>
                    </div>
                    {/* NASDAQ 100 */}
                    <div className="rounded-lg border border-neutral-200 bg-card p-4">
                      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-1">米国ハイテク</div>
                      <h4 className="text-sm font-bold text-foreground mb-3">NASDAQ 100</h4>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-neutral-500">勝率</span><span className="font-mono font-bold text-[var(--signal-safe-500)]">70.9%</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">平均リターン</span><span className="font-mono font-bold text-foreground">+4.13%</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">PF</span><span className="font-mono font-bold text-foreground">5.10</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">トレード数</span><span className="font-mono text-neutral-600">8,266</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">対象銘柄</span><span className="font-mono text-neutral-600">156 / 194</span></div>
                      </div>
                    </div>
                    {/* Nikkei 225 */}
                    <div className="rounded-lg border border-neutral-200 bg-card p-4">
                      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold mb-1">日本株</div>
                      <h4 className="text-sm font-bold text-foreground mb-3">Nikkei 225</h4>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-neutral-500">勝率</span><span className="font-mono font-bold text-[var(--signal-safe-500)]">72.8%</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">平均リターン</span><span className="font-mono font-bold text-foreground">+4.28%</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">PF</span><span className="font-mono font-bold text-foreground">6.06</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">トレード数</span><span className="font-mono text-neutral-600">19,519</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">対象銘柄</span><span className="font-mono text-neutral-600">223 / 223</span></div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-1.5 text-xs leading-relaxed text-neutral-600">
                    <p><strong className="text-foreground">勝率</strong>: 全トレードのうち利益が出た割合 (高いほど良い)</p>
                    <p><strong className="text-foreground">平均リターン</strong>: 1 トレードあたりの平均損益率 (高いほど良い)</p>
                    <p><strong className="text-foreground">PF (Profit Factor)</strong>: 勝ちトレードの合計 ÷ 負けトレードの合計 (1 を超えていれば黒字、高いほど良い)</p>
                    <p className="pt-1.5 border-t border-neutral-200"><strong className="text-foreground">期間</strong>: 2016-04-08 〜 2026-04-08 (10 年間)</p>
                    <p>過去の実績は将来の成果を保証するものではありません。</p>
                  </div>
                </DocSection>

                {/* ── 売買の流れ ── */}
                <DocSection title="売買の流れ">
                  <ol className="space-y-2.5 text-sm text-neutral-700">
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--brand-100)] text-[var(--brand-700)] font-bold text-xs flex items-center justify-center">1</span>
                      <span><strong className="text-foreground">前日の終値が確定</strong> したあと、システムが各銘柄の状態を判定します。</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--brand-100)] text-[var(--brand-700)] font-bold text-xs flex items-center justify-center">2</span>
                      <span>買いシグナルや売却シグナルが出たら、画面に <strong className="text-foreground">アクション表示</strong> が出ます。</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--brand-100)] text-[var(--brand-700)] font-bold text-xs flex items-center justify-center">3</span>
                      <span><strong className="text-foreground">翌営業日の寄付</strong> でバッジの内容どおりに売買します。</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--brand-100)] text-[var(--brand-700)] font-bold text-xs flex items-center justify-center">4</span>
                      <span>保有中は毎日、4 つの売却ルールがチェックされ続けます。</span>
                    </li>
                  </ol>
                </DocSection>

                {/* ── 過去のポジションの見方 ── */}
                <DocSection title="過去のポジションの見方">
                  <p className="text-sm text-neutral-700 mb-4">
                    「過去のポジション」タブでは、過去 1 年間の売買結果がカード形式で表示されます。
                  </p>

                  <div className="space-y-4">
                    {/* カードの構造説明 */}
                    <div>
                      <h4 className="text-sm font-bold text-foreground mb-2">カードの読み方</h4>
                      <div className="rounded-lg border border-neutral-200 bg-card p-4 space-y-3">
                        <div className="flex gap-4">
                          <div className="rounded-lg bg-[var(--signal-safe-100)] px-4 py-3 min-w-[80px] flex flex-col items-center justify-center shrink-0">
                            <span className="text-lg font-extrabold font-mono text-[var(--signal-safe-500)]">+15.0%</span>
                            <span className="text-[10px] font-bold text-[var(--signal-safe-500)]">実現損益</span>
                          </div>
                          <div className="flex-1 text-xs space-y-2 text-neutral-600">
                            <p><strong className="text-foreground">左側 — 実現損益</strong>: ポジション全体の最終損益です。50% 売却がある場合は、前半と後半をそれぞれ 50% ずつ加重平均した値になります。</p>
                            <p><strong className="text-foreground">右側 — 決済タイムライン</strong>: 買付から決済までの流れが時系列で表示されます。各ステップの損益% は買付価格からの変動率です。</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 50%売却の流れ */}
                    <div>
                      <h4 className="text-sm font-bold text-foreground mb-2">50% 売却がある場合の流れ</h4>
                      <p className="text-xs text-neutral-600 mb-3">
                        ② 弱気転換ルールが発動すると、まず保有の半分を売却します。残り半分は ①③④ のいずれかのルールで後日決済されます。
                      </p>
                      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                        <div className="relative pl-5 space-y-3">
                          <div className="absolute left-[7px] top-[6px] bottom-[6px] w-px bg-neutral-300" />
                          <div className="relative flex items-baseline gap-3">
                            <div className="absolute -left-5 top-[5px] w-2.5 h-2.5 rounded-full bg-neutral-400 ring-2 ring-neutral-50" />
                            <span className="text-[11px] text-neutral-400 w-14 shrink-0 font-medium">買付</span>
                            <span className="text-xs text-neutral-600">シグナルに従って購入 (100%)</span>
                          </div>
                          <div className="relative flex items-baseline gap-3">
                            <div className="absolute -left-5 top-[5px] w-2.5 h-2.5 rounded-full bg-[var(--signal-caution-400)] ring-2 ring-neutral-50" />
                            <span className="text-[11px] text-[var(--signal-caution-500)] w-14 shrink-0 font-medium">50%売却</span>
                            <span className="text-xs text-neutral-600">弱気転換を検出 → 半分だけ売却して利益を確保</span>
                          </div>
                          <div className="relative flex items-baseline gap-3">
                            <div className="absolute -left-5 top-[5px] w-2.5 h-2.5 rounded-full bg-[var(--signal-safe-500)] ring-2 ring-neutral-50" />
                            <span className="text-[11px] text-[var(--signal-safe-600)] w-14 shrink-0 font-medium">残50%</span>
                            <span className="text-xs text-neutral-600">残り半分が ③ 利確ストップ等で決済される</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 損益の計算例 */}
                    <div>
                      <h4 className="text-sm font-bold text-foreground mb-2">実現損益の計算</h4>
                      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-xs space-y-2 text-neutral-600">
                        <p>例: $100 で買付 → 50% 売却で $110 (+10%) → 残50% を $120 で決済 (+20%)</p>
                        <p className="font-mono text-foreground font-bold">実現損益 = (+10% × 0.5) + (+20% × 0.5) = <span className="text-[var(--signal-safe-500)]">+15.0%</span></p>
                        <p className="text-neutral-500 pt-1 border-t border-neutral-200">50% 売却がない通常の決済では、そのまま 1 件の損益が表示されます。</p>
                      </div>
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

function SignalsLoadingSkeleton() {
  return (
    <div className="space-y-4 plumb-animate-in">
      {/* Chart skeleton */}
      <GlassCard>
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-6 w-32" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
            </div>
          </div>
          <Skeleton className="h-[450px] w-full rounded-lg" />
        </div>
      </GlassCard>
      {/* Tabs skeleton */}
      <GlassCard>
        <div className="p-5">
          <div className="flex gap-2 mb-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-28 rounded-md" />
            ))}
          </div>
          <div className="space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

function BatchLoadingSkeleton() {
  return (
    <div className="space-y-4 plumb-animate-in">
      <GlassCard>
        <div className="px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-6 w-24" />
          </div>
          <div className="flex gap-5">
            <Skeleton className="h-10 w-16" />
            <Skeleton className="h-10 w-16" />
          </div>
        </div>
      </GlassCard>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <GlassCard key={i}>
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-5 w-20" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-16 rounded" />
                <Skeleton className="h-6 w-16 rounded" />
              </div>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}

function ConditionCard({ label, value, isPositive, sub }: {
  label: string; value: string; isPositive: boolean; sub?: string;
}) {
  return (
    <div className={`rounded-xl border p-5 text-center ${
      isPositive
        ? 'border-[var(--signal-safe-300)] bg-[var(--signal-safe-100)]'
        : 'border-neutral-200 bg-neutral-50'
    }`}>
      <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2 font-medium">{label}</div>
      <div className={`text-xl font-bold ${isPositive ? 'text-[var(--signal-safe-500)]' : 'text-neutral-400'}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-neutral-500 mt-1.5 font-mono">{sub}</div>}
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
