'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import CandlestickChart from '@/components/charts/CandlestickChart';
import LineChartCanvas from '@/components/charts/LineChartCanvas';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Crosshair, Package, History, BookOpen, ShieldAlert } from 'lucide-react';
import { getSignal, getStockHistory, getExitAnalysis, getSignalHistory, getChartMarkers, getBatchSignals, useStocks, useRegime, useWatchlist, addWatchlistTicker, removeWatchlistTicker } from '@/lib/api';
import { AuthGuard } from '@/components/providers/AuthGuard';
import { Skeleton } from '@/components/ui/skeleton';
import { GlassCard, StatusChip, Metric, DocSection, DocTable } from '@/components/shared/glass';
import { TickerIcon } from '@/components/shared/TickerIcon';
import { useUser } from '@/components/providers/UserProvider';
import type { SignalResponse, StockHistoryData, ExitAnalysisResponse, SignalHistoryResponse, ChartMarkersResponse, BatchResponse } from '@/types';

type Mode = 'balanced' | 'aggressive' | 'conservative';
type ExitMode = 'standard' | 'stable';
type Tab = 'entry' | 'exit_analysis' | 'holding' | 'history' | 'system';
type Period = '1d' | '5d' | '1mo' | '3mo' | '6mo' | 'ytd' | '1y' | '5y' | 'max';
type ChartType = 'line' | 'candlestick';
type ChartOption = 'ema' | 'fvg' | 'bos' | 'choch' | 'ob' | 'ote' | 'pd';

const modeLabels: Record<Mode, { label: string; desc: string }> = {
  balanced: { label: '標準', desc: 'RS下落時はエントリー禁止。最もバランスが良い。' },
  aggressive: { label: '積極型', desc: 'RS無視で全エントリー。機会重視。' },
  conservative: { label: '慎重型', desc: 'RS下落時は50%サイズ。リスク抑制。' },
};

const exitModeLabels: Record<ExitMode, { label: string; desc: string }> = {
  standard: { label: 'ハイブリッド', desc: '含み益30%超でトレイル緩和。PF 8.59 / 勝率73%' },
  stable: { label: '安定', desc: 'タイトなトレイルで利益確保。PF 6.59 / 勝率73%' },
};

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
  const [mode, setMode] = useState<Mode>('balanced');
  const [exitMode, setExitMode] = useState<ExitMode>('standard');
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
      try { await addWatchlistTicker(tick); mutateWl(); } catch { /* ignore */ }
    } else {
      localStorage.setItem('quickTickers', JSON.stringify(newList));
    }
  }, [quickTickers, email, mutateWl]);

  const removeQuickTicker = useCallback(async (t: string) => {
    const newList = quickTickers.filter(x => x !== t);
    setQuickTickers(newList);
    if (email) {
      try { await removeWatchlistTicker(t); mutateWl(); } catch { /* ignore */ }
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

  const isJP = /^\d/.test(ticker);
  const ccy = isJP ? '¥' : '$';

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
            <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-blue-500 to-cyan-500" />
            <h1 className="text-2xl font-bold tracking-tight">銘柄分析</h1>
          </div>
          <p className="text-xs text-muted-foreground pl-3.5">エントリー判定・Exit分析・シグナル履歴</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground uppercase tracking-[0.2em] font-medium">運用モード</span>
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

      {/* ── Search Section ── */}
      <GlassCard stagger={1}>
        <div className="p-5 space-y-4">
          {/* Row 1: Input + Actions */}
          <div className="flex gap-2 items-center flex-wrap">
            <div className="relative">
              <input
                type="text"
                placeholder="ティッカー (例: NVDA, 7203)"
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

          {/* Row 3: JP Quick Tickers */}
          <div className="flex gap-1.5 flex-wrap items-center pt-2 border-t border-border/50">
            <span className="text-xs text-red-400/70 uppercase tracking-wider mr-1 font-medium">JP</span>
            {jpTickers.map((t) => (
              <span
                key={t.ticker}
                className="group relative flex items-center gap-1.5 px-2.5 py-1.5 plumb-glass rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:border-red-500/30 transition-all cursor-pointer"
              >
                <span className="font-mono" onClick={() => handleAnalyze(t.ticker)}>{t.ticker}</span>
                <span className="ml-0.5 text-[10px] text-muted-foreground" onClick={() => handleAnalyze(t.ticker)}>{t.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeJpTicker(t.ticker); }}
                  className="hidden group-hover:inline text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 font-bold text-xs ml-0.5"
                >
                  ×
                </button>
              </span>
            ))}
            {showAddJpTicker ? (
              <span className="flex items-center gap-1">
                <input
                  type="text"
                  value={newJpTickerInput}
                  onChange={(e) => setNewJpTickerInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addJpTicker(newJpTickerInput, newJpNameInput)}
                  placeholder="7203"
                  className="plumb-glass rounded px-2.5 py-1.5 text-xs w-16 focus:outline-none focus:ring-1 focus:ring-red-500/50 text-foreground font-mono"
                  autoFocus
                />
                <input
                  type="text"
                  value={newJpNameInput}
                  onChange={(e) => setNewJpNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addJpTicker(newJpTickerInput, newJpNameInput)}
                  placeholder="名前"
                  className="plumb-glass rounded px-2.5 py-1.5 text-xs w-20 focus:outline-none focus:ring-1 focus:ring-red-500/50 text-foreground"
                />
                <button onClick={() => addJpTicker(newJpTickerInput, newJpNameInput)} className="px-2.5 py-1.5 bg-red-500/20 text-red-700 dark:text-red-400 rounded text-xs font-bold hover:bg-red-500/30">OK</button>
                <button onClick={() => { setShowAddJpTicker(false); setNewJpTickerInput(''); setNewJpNameInput(''); }} className="px-2.5 py-1.5 border border-red-500/30 text-red-500 dark:text-red-400 rounded text-xs font-bold hover:bg-red-500/10">×</button>
              </span>
            ) : (
              <button
                onClick={() => setShowAddJpTicker(true)}
                className="px-2.5 py-1.5 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-500 dark:text-zinc-600 text-xs font-semibold hover:border-red-500/30 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              >
                + 追加
              </button>
            )}
          </div>
        </div>
      </GlassCard>

      {/* ── Error ── */}
      {error && (
        <GlassCard>
          <div className="plumb-animate-in flex items-center justify-between px-5 py-3 border border-red-500/30 bg-red-500/5 rounded-xl">
            <span className="text-red-400 text-sm">{error}</span>
            <button onClick={() => setError(null)} className="p-1 rounded hover:bg-red-500/10 text-red-400 transition-colors" title="閉じる">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </GlassCard>
      )}

      {/* ── Loading ── */}
      {loading && !batchLoading && <SignalsLoadingSkeleton />}
      {batchLoading && <BatchLoadingSkeleton />}

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
        <div className="space-y-4 plumb-animate-in">
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
                  className={`plumb-glass plumb-glass-hover rounded-xl p-5 cursor-pointer plumb-animate-in plumb-stagger-${Math.min(idx + 1, 8)} ${
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
                          <div>
                            <span className="text-lg font-bold text-foreground">{r.ticker}</span>
                            {r.name && <span className="ml-1.5 text-[10px] text-muted-foreground">{r.name}</span>}
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
                          <span className="text-[10px] text-muted-foreground">サイズ: {r.position_size_pct}%</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-xs text-muted-foreground">
                        <span>統合判定: <span className={`font-semibold ${r.combined_ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 dark:text-zinc-600'}`}>{r.combined_ready ? '達成' : '未達'}</span></span>
                        <span>RS: <span className={`font-semibold ${rsColors[rsTrend]}`}>{rsLabels[rsTrend]}</span></span>
                        {r.exit_atr_floor != null && (
                          <span>損切ライン: <span className="font-mono font-semibold text-red-500 dark:text-red-400">
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
                          <span>含み: <span className={`font-mono font-semibold ${r.exit_unrealized_pct >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
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

      {/* ── Signal Result ── */}
      {signal && !loading && (
        <div className="space-y-4 plumb-animate-in">
          {/* Hero Card */}
          <GlassCard stagger={1}>
            <div className="p-5 md:p-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <TickerIcon ticker={signal.ticker} size={72} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-extrabold tracking-tight text-foreground">{signal.ticker}</span>
                      {/^\d/.test(signal.ticker) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-500/20 font-mono">JP</span>
                      )}
                    </div>
                    {(() => {
                      const name = signal.name ?? stocks.find(s => s.ticker === signal.ticker)?.name;
                      return name ? <div className="text-sm text-muted-foreground truncate max-w-[260px]">{name}</div> : null;
                    })()}
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-xl font-bold font-mono text-foreground">{/^\d/.test(signal.ticker) ? '¥' : '$'}{signal.price.toFixed(2)}</span>
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
          </GlassCard>

          {/* ── Chart Section ── */}
          <GlassCard stagger={2}>
            <div className="p-5">
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
                            : opt === 'ob' ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-400'
                            : opt === 'ote' ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400'
                            : opt === 'pd' ? 'bg-rose-500/20 text-rose-700 dark:text-rose-400'
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
                <div className="flex gap-0.5 flex-wrap plumb-glass rounded-lg p-1">
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
                  />
                ) : (
                  <LineChartCanvas
                    data={chartData}
                    ticker={ticker}
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
                {chartType === 'candlestick' && chartOptions.has('ob') && (
                  <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-cyan-400/30 border border-cyan-400/50 rounded-sm" /> OB</span>
                )}
                {chartType === 'candlestick' && chartOptions.has('ote') && (
                  <span className="flex items-center gap-1.5"><span className="w-3 h-2 bg-blue-400/30 border border-blue-400/50 rounded-sm" /> OTE</span>
                )}
                {chartType === 'candlestick' && chartOptions.has('pd') && (
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-rose-400" /> P/D</span>
                )}
              </div>
            </div>
          </GlassCard>

          {/* ── Analysis Tabs ── */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)} className="plumb-tabs">
            <TabsList variant="line" className="plumb-glass rounded-lg px-1 py-0.5 w-full justify-start border-none">
              <TabsTrigger value="entry" className="text-[11px] font-mono uppercase tracking-wider"><Crosshair className="w-3.5 h-3.5 mr-1.5" />エントリー判定</TabsTrigger>
              <TabsTrigger value="exit_analysis" className="text-[11px] font-mono uppercase tracking-wider"><ShieldAlert className="w-3.5 h-3.5 mr-1.5" />Exit分析</TabsTrigger>
              <TabsTrigger value="holding" className="text-[11px] font-mono uppercase tracking-wider"><Package className="w-3.5 h-3.5 mr-1.5" />保有分析</TabsTrigger>
              <TabsTrigger value="history" className="text-[11px] font-mono uppercase tracking-wider"><History className="w-3.5 h-3.5 mr-1.5" />過去シグナル</TabsTrigger>
              <TabsTrigger value="system" className="text-[11px] font-mono uppercase tracking-wider"><BookOpen className="w-3.5 h-3.5 mr-1.5" />システム解説</TabsTrigger>
            </TabsList>

            {/* ── Tab: Entry ── */}
            <TabsContent value="entry">
              <GlassCard stagger={1}>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-base font-bold text-foreground">エントリー判定パネル</span>
                    <span className="text-sm text-muted-foreground">統合エントリーシステム</span>
                    <StatusChip label={modeLabels[mode].label} color="blue" />
                  </div>
                  <p className="text-xs text-muted-foreground mb-5">前日の終値確定後に判定 → 買いシグナルが出たら翌営業日の寄付で購入</p>

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
                      <div className="flex items-center gap-4 mb-5 px-4 py-3 plumb-glass rounded-lg text-sm flex-wrap">
                        <Metric label="市場" value="">
                          <span className={`text-sm font-bold ${getRegimeColor(regimeLabel)}`}>{regimeLabel}</span>
                        </Metric>
                        <span className="w-px h-4 bg-border" />
                        <span className="text-muted-foreground">{bmName}: <span className="text-foreground font-mono font-semibold">{bmCcy}{bmPrice.toFixed(2)}</span></span>
                        <span className="text-muted-foreground">200EMA: <span className="text-foreground font-mono font-semibold">{bmCcy}{bmEma.toFixed(2)}</span></span>
                        <span className="text-muted-foreground">傾き: <span className={`font-mono font-semibold ${slope >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{slope >= 0 ? '+' : ''}{slope.toFixed(3)}</span></span>
                      </div>
                    );
                  })()}

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
                        {signal.entry_allowed ? '買い' : '見送り'}
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
              </GlassCard>
            </TabsContent>

            {/* ── Tab: Exit Analysis ── */}
            <TabsContent value="exit_analysis">
              <GlassCard stagger={1}>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-base font-bold text-foreground">決済分析パネル</span>
                    <span className="text-sm text-muted-foreground">4層決済システム</span>
                    <div className="ml-auto flex items-center gap-2">
                      {(Object.entries(exitModeLabels) as [ExitMode, { label: string; desc: string }][]).map(([key, val]) => (
                        <button
                          key={key}
                          onClick={() => { setExitMode(key); setSignalHistory(null); }}
                          className={`px-3 py-1 rounded-lg text-xs font-medium transition-all border ${exitMode === key ? 'bg-foreground/10 text-foreground border-foreground/30' : 'plumb-glass text-muted-foreground hover:text-foreground border-border hover:border-foreground/20'}`}
                          title={val.desc}
                        >
                          {val.label}
                        </button>
                      ))}
                      <button
                        onClick={handleFetchSignalHistory}
                        disabled={historyLoading}
                        className="px-3 py-1 rounded-lg text-xs font-medium transition-all disabled:opacity-50 plumb-glass text-muted-foreground hover:text-foreground border border-border hover:border-foreground/20"
                      >
                        {historyLoading ? '取得中...' : '更新'}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-5">前日の終値確定後に判定 → 売却シグナルが出たら翌営業日の寄付で売却</p>

                  {(() => {
                    const trades = signalHistory?.trade_results ?? [];
                    const allStatuses = signalHistory?.live_exit_statuses ?? [];
                    const actives = allStatuses.filter(s => !s.trade_completed);
                    const exitedPositions = allStatuses.filter(s => s.trade_completed);
                    const ccy = /^\d/.test(signal?.ticker || '') ? '¥' : '$';
                    const isBuyNow = signal?.entry_allowed === true;

                    const exitReasonJP: Record<string, string> = {
                      'ATR_Floor': '損切り（損切ライン割れ）',
                      'ATR_Floor(partial)': '損切り（50%決済後）',
                      'Mirror_Partial': '反転売却（転換→EMAデスクロス）',
                      'Mirror_Full': '反転全決済',
                      'Trail_Stop': '利確（利確ストップ）',
                      'Trail_Stop(partial)': '利確（50%決済後・追従）',
                      'Time_Stop': '保有期限到達（252日）',
                      'Time_Stop(partial)': '期限到達（50%決済込み）',
                    };

                    // Exit理由ごとの売却比率
                    const exitSellPct: Record<string, string> = {
                      'ATR_Floor': '100%', 'Mirror_Full': '100%', 'Trail_Stop': '100%', 'Time_Stop': '100%',
                      'ATR_Floor(partial)': '残50%', 'Mirror_Partial': '残50%', 'Trail_Stop(partial)': '残50%', 'Time_Stop(partial)': '残50%',
                    };

                    // アクティブポジションの判定
                    const latestActive = actives.length > 0 ? actives[actives.length - 1] : null;
                    type Verdict = { action: string; color: 'red' | 'orange' | 'emerald'; sellPct: number; reason: string };
                    const getActiveVerdict = (s: NonNullable<typeof latestActive>): Verdict => {
                      if (s.atr_floor_triggered) return { action: '全売却', color: 'red', sellPct: 100, reason: `損切ライン ${ccy}${s.atr_floor_price.toFixed(2)} 割れ` };
                      if (s.bearish_choch_detected && s.ema_death_cross) return { action: '全売却', color: 'red', sellPct: 100, reason: '反転全決済: トレンド転換 + EMAデスクロス確定' };
                      if (s.bearish_choch_detected) return { action: '50% 売却', color: 'orange', sellPct: 50, reason: '弱気転換検出 — EMAデスクロスで残りも売却' };
                      if (s.nearest_exit_reason === 'Time_Stop') return { action: '全売却', color: 'orange', sellPct: 100, reason: '保有期限（252日）到達' };
                      if (s.trail_active) return { action: '保有継続', color: 'emerald', sellPct: 0, reason: `利確ストップ稼働中 — ストップ: ${s.trail_stop_price ? `${ccy}${s.trail_stop_price.toFixed(2)}` : '計算中'}` };
                      return { action: '保有継続', color: 'emerald', sellPct: 0, reason: '全条件クリア — 安全' };
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
                      red: { text: 'text-red-500 dark:text-red-400', bg: 'bg-red-500/[0.06]', border: 'border-red-500/30', glow: '#ef4444' },
                      orange: { text: 'text-orange-500 dark:text-orange-400', bg: 'bg-orange-500/[0.06]', border: 'border-orange-500/30', glow: '#f97316' },
                      emerald: { text: 'text-emerald-500 dark:text-emerald-400', bg: 'bg-emerald-500/[0.06]', border: 'border-emerald-500/30', glow: '#10b981' },
                      blue: { text: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-500/[0.06]', border: 'border-blue-500/30', glow: '#3b82f6' },
                      zinc: { text: 'text-zinc-400 dark:text-zinc-600', bg: '', border: 'border-zinc-200 dark:border-zinc-800', glow: '' },
                    };
                    const vs = verdictStyles[heroState];

                    return (
                      <>
                        {/* ── Hero Verdict ── */}
                        <div className={`relative text-center py-8 rounded-xl mb-4 border overflow-hidden ${vs.border}`}>
                          {heroState !== 'zinc' && <div className={`absolute inset-0 ${vs.bg}`} />}
                          {heroState !== 'zinc' && (
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[100px] rounded-full blur-[60px] opacity-20" style={{ background: vs.glow }} />
                          )}
                          <div className="relative">
                            {heroVerdict ? (
                              <>
                                <div className={`text-3xl sm:text-4xl font-extrabold tracking-[0.15em] ${vs.text}`}>
                                  {heroVerdict.action}
                                </div>
                                <div className="mt-2 text-sm text-muted-foreground">{heroVerdict.reason}</div>
                                {heroVerdict.sellPct > 0 && (
                                  <div className={`mt-2 text-lg font-bold font-mono ${vs.text}`}>売却比率: {heroVerdict.sellPct}%</div>
                                )}
                                <div className="mt-3 flex items-center justify-center gap-4 text-xs text-muted-foreground flex-wrap">
                                  <span>買付: {heroPosition!.entry_date} @ {ccy}{heroPosition!.entry_price.toFixed(2)}</span>
                                  {(() => {
                                    const matchTrade = trades.find(t => t.entry_date === heroPosition!.entry_date);
                                    return matchTrade ? (
                                      <>
                                        <span className="w-px h-3 bg-border" />
                                        <span className={vs.text}>売却: {matchTrade.exit_date} @ {ccy}{matchTrade.exit_price.toFixed(2)}</span>
                                      </>
                                    ) : null;
                                  })()}
                                  <span className="w-px h-3 bg-border" />
                                  <span>{heroPosition!.holding_days}日保有</span>
                                  <span className="w-px h-3 bg-border" />
                                  <span className={`font-mono font-semibold ${heroPosition!.unrealized_pct >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                    {heroPosition!.unrealized_pct >= 0 ? '+' : ''}{heroPosition!.unrealized_pct.toFixed(1)}%
                                  </span>
                                </div>
                                {urgentPositions.length > 1 && (
                                  <div className="mt-2 text-[10px] text-muted-foreground">
                                    他 {urgentPositions.length - 1} ポジションでも売却シグナル発動中 ↓
                                  </div>
                                )}
                              </>
                            ) : isBuyNow ? (
                              <>
                                <div className={`text-3xl sm:text-4xl font-extrabold tracking-[0.15em] ${vs.text}`}>決済判定待ち</div>
                                <div className="mt-2 text-sm text-muted-foreground">現在買いシグナル発生中 — 買い付け後に決済監視開始</div>
                                <div className="mt-3 flex items-center justify-center gap-4 text-xs text-muted-foreground flex-wrap">
                                  <span>現在価格: <span className="font-mono font-semibold text-foreground">{ccy}{signal.price.toFixed(2)}</span></span>
                                  <span className="w-px h-3 bg-border" />
                                  <span>サイズ: <span className="font-mono font-semibold text-foreground">{signal.position_size_pct}%</span></span>
                                  <span className="w-px h-3 bg-border" />
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
                                    <div className={`text-3xl sm:text-4xl font-extrabold tracking-[0.15em] text-orange-500 dark:text-orange-400`}>決済済</div>
                                    {lastTrade && (
                                      <div className="mt-2 text-sm text-muted-foreground">{lastTradeReason}</div>
                                    )}
                                    {lastTrade && (
                                      <div className="mt-3 flex items-center justify-center gap-4 text-xs text-muted-foreground flex-wrap">
                                        <span>買付: {lastTrade.entry_date} @ {ccy}{lastTrade.entry_price.toFixed(2)}</span>
                                        <span className="w-px h-3 bg-border" />
                                        <span className="text-orange-500 dark:text-orange-400">売却: {lastTrade.exit_date} @ {ccy}{lastTrade.exit_price.toFixed(2)}</span>
                                        <span className="w-px h-3 bg-border" />
                                        <span className={`font-mono font-semibold ${lastTradeWin ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                          {lastTradeWin ? '+' : ''}{lastTrade.return_pct.toFixed(1)}%
                                        </span>
                                        <span className="w-px h-3 bg-border" />
                                        <span>{lastTrade.holding_days}日保有</span>
                                      </div>
                                    )}
                                  </>
                                );
                              })()
                            ) : (
                              <>
                                <div className={`text-3xl sm:text-4xl font-extrabold tracking-[0.15em] ${vs.text}`}>ポジションなし</div>
                                <div className="mt-2 text-sm text-muted-foreground">
                                  {trades.length > 0 ? '買いシグナル待ち — 下に取引履歴あり' : '買いシグナル待ち'}
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* ── 現在BUY中: 今買ったらのシミュレーション ── */}
                        {isBuyNow && !latestActive && (
                          <div className="plumb-glass rounded-xl p-4 mb-4">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">今買った場合の決済監視ポイント</div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div className="rounded-lg px-3 py-2.5 plumb-glass">
                                <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">損切ライン</div>
                                <div className="text-xs text-muted-foreground">買値 - ATR×3.0</div>
                                <div className="text-[10px] text-muted-foreground mt-1">終値がこの価格を割ると全額損切り</div>
                              </div>
                              <div className="rounded-lg px-3 py-2.5 plumb-glass">
                                <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">反転検出</div>
                                <div className="text-xs text-muted-foreground">弱気転換 → 50%売却</div>
                                <div className="text-[10px] text-muted-foreground mt-1">+ EMAデスクロスで残り50%も売却</div>
                              </div>
                              <div className="rounded-lg px-3 py-2.5 plumb-glass">
                                <div className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-1">利確ストップ（追従型）</div>
                                <div className="text-xs text-muted-foreground">高値に追従 — 下落時に自動利確</div>
                                <div className="text-[10px] text-muted-foreground mt-1">EMA21の1.05倍超えで有効化</div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* ── PatB 統計（過去1年） ── */}
                        {signalHistory?.stats?.patb_trades && signalHistory.stats.patb_trades > 0 && (
                          <div className="mb-4">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-medium">
                              過去1年の決済実績（{signalHistory.stats.patb_trades}取引）
                            </div>
                            <div className="flex items-center gap-4 px-4 py-2.5 plumb-glass rounded-lg text-sm flex-wrap">
                              <span className="text-muted-foreground">勝率: <span className="text-foreground font-mono font-semibold">{signalHistory.stats.patb_win_rate}%</span></span>
                              <span className="w-px h-4 bg-border" />
                              <span className="text-muted-foreground">PF: <span className="text-foreground font-mono font-semibold">{signalHistory.stats.patb_pf ?? '∞'}</span></span>
                              <span className="w-px h-4 bg-border" />
                              <span className="text-muted-foreground">平均損益: <span className={`font-mono font-semibold ${(signalHistory.stats.patb_avg_pnl ?? 0) >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>{(signalHistory.stats.patb_avg_pnl ?? 0) >= 0 ? '+' : ''}{signalHistory.stats.patb_avg_pnl}%</span></span>
                              <span className="w-px h-4 bg-border" />
                              <span className="text-muted-foreground">平均保有: <span className="text-foreground font-mono font-semibold">{signalHistory.stats.patb_avg_hold_days}日</span></span>
                            </div>
                          </div>
                        )}

                        {/* ── 売却シグナル発動中のポジション（アラート） ── */}
                        {urgentPositions.length > 0 && (
                          <div className="mb-4">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                              売却シグナル発動中（{urgentPositions.length}件）
                            </div>
                            <div className="space-y-2">
                              {urgentPositions.map((u, i) => {
                                const s = u.status;
                                const v = u.verdict;
                                const alertBg = v.color === 'red' ? 'bg-red-500/10 border-red-500/25' : 'bg-orange-500/10 border-orange-500/25';
                                const alertText = v.color === 'red' ? 'text-red-400' : 'text-orange-400';
                                return (
                                  <div key={`urgent-${i}`} className={`rounded-lg border px-4 py-3 ${alertBg}`}>
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`text-xs font-bold ${alertText}`}>{v.action}</span>
                                        <span className="text-[10px] text-muted-foreground">{v.reason}</span>
                                      </div>
                                      <span className={`font-mono font-bold text-sm ${s.unrealized_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {s.unrealized_pct >= 0 ? '+' : ''}{s.unrealized_pct.toFixed(1)}%
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground flex-wrap">
                                      <span>買付 {s.entry_date} @ {ccy}{s.entry_price.toFixed(2)}</span>
                                      <span className="w-px h-3 bg-border" />
                                      <span>{s.holding_days}日保有</span>
                                      {v.sellPct > 0 && (
                                        <>
                                          <span className="w-px h-3 bg-border" />
                                          <span className={`font-semibold ${alertText}`}>売却比率: {v.sellPct}%</span>
                                        </>
                                      )}
                                      <span className="w-px h-3 bg-border" />
                                      <span>損切ライン: {ccy}{s.atr_floor_price.toFixed(2)}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* ── 最新ポジション 4層詳細（1件だけ展開） ── */}
                        {latestActive && (
                          <div className="space-y-3 mb-4">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                              最新ポジション詳細
                            </div>
                            <div className="plumb-glass rounded-xl p-4">
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-mono text-muted-foreground">買付 {latestActive.entry_date} @ {ccy}{latestActive.entry_price.toFixed(2)}</span>
                                  <StatusChip label={latestActive.entry_regime} color="blue" />
                                  <span className="text-xs text-muted-foreground">{latestActive.holding_days}日保有</span>
                                </div>
                                <span className={`text-lg font-bold font-mono ${latestActive.unrealized_pct >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                  {latestActive.unrealized_pct >= 0 ? '+' : ''}{latestActive.unrealized_pct.toFixed(1)}%
                                </span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className={`rounded-lg px-3 py-2.5 ${latestActive.atr_floor_triggered ? 'bg-red-500/10 border border-red-500/20' : 'plumb-glass'}`}>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">損切ライン</span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${latestActive.atr_floor_triggered ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                      {latestActive.atr_floor_triggered ? '発動' : '安全'}
                                    </span>
                                  </div>
                                  <div className="font-mono font-semibold text-sm text-foreground">{ccy}{latestActive.atr_floor_price.toFixed(2)}</div>
                                  <div className="text-[10px] text-muted-foreground mt-0.5">終値がこの価格を割ると全額損切り</div>
                                </div>
                                <div className={`rounded-lg px-3 py-2.5 ${latestActive.bearish_choch_detected ? 'bg-orange-500/10 border border-orange-500/20' : 'plumb-glass'}`}>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">反転検出</span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                      latestActive.bearish_choch_detected && latestActive.ema_death_cross ? 'bg-red-500/15 text-red-400' :
                                      latestActive.bearish_choch_detected ? 'bg-orange-500/15 text-orange-400' :
                                      'bg-emerald-500/10 text-emerald-400'
                                    }`}>
                                      {latestActive.bearish_choch_detected && latestActive.ema_death_cross ? '全決済' : latestActive.bearish_choch_detected ? '警戒' : '安全'}
                                    </span>
                                  </div>
                                  <div className="space-y-0.5 text-xs">
                                    <div className="flex justify-between"><span className="text-muted-foreground">転換</span><span className={latestActive.bearish_choch_detected ? 'text-orange-400 font-semibold' : 'text-muted-foreground'}>{latestActive.bearish_choch_detected ? `50%売却${latestActive.choch_exit_date ? ` (${latestActive.choch_exit_date})` : ''}` : '—'}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">EMA交差</span><span className={latestActive.ema_death_cross ? 'text-red-400 font-semibold' : 'text-muted-foreground'}>{latestActive.ema_death_cross ? '発生→残り50%売却' : '—'}</span></div>
                                  </div>
                                </div>
                                <div className={`rounded-lg px-3 py-2.5 ${latestActive.trail_active ? 'bg-purple-500/10 border border-purple-500/20' : 'plumb-glass'}`}>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">利確ストップ</span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${latestActive.trail_active ? 'bg-purple-500/15 text-purple-400' : 'plumb-glass text-muted-foreground'}`}>
                                      {latestActive.trail_active ? '稼働中' : '待機'}
                                    </span>
                                  </div>
                                  {latestActive.trail_active ? (
                                    <div className="space-y-0.5 text-xs">
                                      <div className="flex justify-between"><span className="text-muted-foreground">ストップ</span><span className="font-mono font-semibold text-foreground">{latestActive.trail_stop_price ? `${ccy}${latestActive.trail_stop_price.toFixed(2)}` : '—'}</span></div>
                                      <div className="flex justify-between"><span className="text-muted-foreground">最高値</span><span className="font-mono font-semibold text-foreground">{ccy}{latestActive.highest_price.toFixed(2)}</span></div>
                                      <div className="text-[10px] text-muted-foreground mt-0.5">高値に追従 — 下落時に自動利確</div>
                                    </div>
                                  ) : (
                                    <div className="text-xs text-muted-foreground">高値に追従する利確ストップ<br/>EMA21の1.05倍超えで有効化</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* ── 他のポジション（コンパクト一覧） ── */}
                        {actives.length > 1 && (
                          <div className="mb-4">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                              過去のポジション（{actives.length - 1}件）
                            </div>
                            <div className="plumb-glass rounded-lg divide-y divide-border/50">
                              {actives.slice(0, -1).reverse().map((s, i) => {
                                const v = getActiveVerdict(s);
                                const chipColor = v.color === 'red' ? 'bg-red-500/15 text-red-400'
                                  : v.color === 'orange' ? 'bg-orange-500/15 text-orange-400'
                                  : 'bg-emerald-500/10 text-emerald-400';
                                return (
                                  <div key={`older-${i}`} className="flex items-center justify-between px-4 py-2.5 text-xs">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${chipColor}`}>{v.action}</span>
                                      <span className="font-mono text-muted-foreground">{s.entry_date} @ {ccy}{s.entry_price.toFixed(2)}</span>
                                      <span className="text-muted-foreground">{s.holding_days}日</span>
                                    </div>
                                    <span className={`font-mono font-semibold ${s.unrealized_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                      {s.unrealized_pct >= 0 ? '+' : ''}{s.unrealized_pct.toFixed(1)}%
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* ── トレード履歴（最新5件） ── */}
                        {trades.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">取引履歴（直近{Math.min(trades.length, 5)}件）</div>
                            {trades.slice(-5).reverse().map((t, i) => {
                              const isWin = t.return_pct >= 0;
                              const reason = exitReasonJP[t.exit_reason] || t.exit_reason;
                              const sellPct = exitSellPct[t.exit_reason] || '100%';
                              // 同じエントリーの live_exit_status を探して「保有し続けてたら」を計算
                              const liveStatus = exitedPositions.find(s => s.entry_date === t.entry_date);
                              const savedPct = liveStatus ? t.return_pct - liveStatus.unrealized_pct : null;
                              return (
                                <div key={`trade-${i}`} className="plumb-glass rounded-lg px-4 py-3">
                                  <div className="flex items-center gap-3 text-xs flex-wrap">
                                    <StatusChip label={isWin ? '利確' : '損切'} color={isWin ? 'green' : 'red'} />
                                    <span className={`font-mono font-bold ${isWin ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                      {isWin ? '+' : ''}{t.return_pct.toFixed(1)}%
                                    </span>
                                    <span className="w-px h-3 bg-border" />
                                    <span className="text-muted-foreground">{reason}</span>
                                    <span className="w-px h-3 bg-border" />
                                    <span className="text-muted-foreground">{sellPct}売却</span>
                                    <span className="w-px h-3 bg-border" />
                                    <span className="text-muted-foreground">{t.holding_days}日保有</span>
                                  </div>
                                  <div className="flex items-center gap-3 text-[11px] mt-1.5 flex-wrap">
                                    <span className="text-muted-foreground">買 <span className="font-mono text-foreground">{t.entry_date}</span> @ <span className="font-mono text-foreground">{ccy}{t.entry_price.toFixed(2)}</span></span>
                                    <span className="text-muted-foreground">→</span>
                                    <span className="text-muted-foreground">売 <span className={`font-mono font-semibold ${isWin ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>{t.exit_date}</span> @ <span className="font-mono text-foreground">{ccy}{t.exit_price.toFixed(2)}</span></span>
                                  </div>
                                  {savedPct !== null && savedPct > 0 && (
                                    <div className="mt-1.5 text-[10px] text-emerald-500 dark:text-emerald-400">
                                      決済効果: 保有し続けたら{liveStatus!.unrealized_pct >= 0 ? '+' : ''}{liveStatus!.unrealized_pct.toFixed(1)}% → 実際は{t.return_pct >= 0 ? '+' : ''}{t.return_pct.toFixed(1)}%（{savedPct.toFixed(1)}%分の損失を回避）
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* ── Empty state ── */}
                        {!signalHistory && !historyLoading && !isBuyNow && (
                          <div className="text-center py-6 text-muted-foreground text-sm">データを取得中...</div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </GlassCard>
            </TabsContent>

            {/* ── Tab: Holding ── */}
            <TabsContent value="holding">
              <GlassCard stagger={1}>
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-base font-bold text-foreground">保有分析パネル</span>
                    <StatusChip label="4層決済システム" color="purple" />
                  </div>
                  <p className="text-xs text-muted-foreground mb-5">前日の終値確定後に判定 → 売却シグナルが出たら翌営業日の寄付で売却</p>

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
                      <span className="text-xs text-muted-foreground">現在価格: <span className="font-mono font-semibold text-foreground">{ccy}{signal.price.toFixed(2)}</span></span>
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
                                {exitAnalysis.should_exit ? '売却' : '保有継続'}
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
                              <div className="text-sm font-semibold font-mono text-foreground">{ccy}{exitAnalysis.entry_price.toFixed(2)}</div>
                            </div>
                            <div className="text-center">
                              <div className="text-xs text-muted-foreground uppercase font-medium">現在価格</div>
                              <div className="text-sm font-semibold font-mono text-foreground">{ccy}{exitAnalysis.current_price.toFixed(2)}</div>
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
                        <div className="plumb-glass rounded-xl p-5">
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3 font-medium">EMAステータス</div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {[
                              { label: 'EMA 8', val: exitAnalysis.ema_status?.ema_8, above: exitAnalysis.ema_status?.above_ema_8 },
                              { label: 'EMA 13', val: exitAnalysis.ema_status?.ema_13, above: exitAnalysis.ema_status?.above_ema_13 },
                              { label: 'EMA 21', val: exitAnalysis.ema_status?.ema_21, above: exitAnalysis.ema_status?.above_ema_21 },
                            ].map((e) => (
                              <div key={e.label} className="text-center">
                                <div className="text-xs text-muted-foreground font-medium">{e.label}</div>
                                <div className="text-sm font-semibold font-mono mt-0.5 text-foreground">{ccy}{(e.val ?? 0).toFixed(2)}</div>
                                <div className={`text-xs font-bold mt-0.5 ${e.above ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                  {e.above ? '上' : '下'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="plumb-glass rounded-xl p-5">
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3 font-medium">ストップライン</div>
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-xs text-muted-foreground font-medium">構造ストップ</div>
                              <div className="text-lg font-bold text-red-600 dark:text-red-400 font-mono">{ccy}{(exitAnalysis.structure_stop ?? 0).toFixed(2)}</div>
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
                      <div className="plumb-glass rounded-xl p-5">
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
                        <div className="plumb-glass rounded-xl p-5">
                          <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3 font-medium">利確ターゲット</div>
                          <div className="flex gap-3 flex-wrap">
                            {exitAnalysis.targets.map((t, i) => (
                              <div key={i} className={`plumb-glass rounded-lg px-4 py-3 text-center min-w-[100px] plumb-animate-in plumb-stagger-${Math.min(i + 1, 8)}`}>
                                <div className="text-xs text-muted-foreground uppercase font-medium">{t.type}</div>
                                <div className="text-base font-bold font-mono mt-0.5 text-foreground">{ccy}{t.price.toFixed(2)}</div>
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
                                      <span className="text-xs text-muted-foreground">反転全決済 <strong className="text-red-600 dark:text-red-400">{exitByCat['MIRROR_FULL']}</strong><span className="text-[10px] text-muted-foreground ml-1">(100%)</span></span>
                                    </div>
                                  )}
                                  {exitByCat['MIRROR_WARN'] && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                                      <span className="text-xs text-muted-foreground">反転警戒 <strong className="text-orange-600 dark:text-orange-400">{exitByCat['MIRROR_WARN']}</strong><span className="text-[10px] text-muted-foreground ml-1">(50%)</span></span>
                                    </div>
                                  )}
                                  {exitByCat['TRAIL'] && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                                      <span className="text-xs text-muted-foreground">利確ストップ <strong className="text-purple-600 dark:text-purple-400">{exitByCat['TRAIL']}</strong><span className="text-[10px] text-muted-foreground ml-1">(100%)</span></span>
                                    </div>
                                  )}
                                  {exitByCat['BEAR_CHOCH'] && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="w-2.5 h-2.5 rounded-full bg-pink-400" />
                                      <span className="text-xs text-muted-foreground">弱気転換 <strong className="text-pink-600 dark:text-pink-400">{exitByCat['BEAR_CHOCH']}</strong><span className="text-[10px] text-muted-foreground ml-1">(警告)</span></span>
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
                                    'MIRROR_FULL': { dot: 'bg-red-500 border-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]', badge: 'red', label: '反転全決済' },
                                    'MIRROR_WARN': { dot: 'bg-orange-500 border-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]', badge: 'orange', label: '反転警戒' },
                                    'TRAIL': { dot: 'bg-purple-500 border-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]', badge: 'purple', label: '利確ストップ' },
                                    'BEAR_CHOCH': { dot: 'bg-pink-400 border-pink-400 shadow-[0_0_8px_rgba(244,114,182,0.4)]', badge: 'red', label: '弱気転換' },
                                  };
                                  return exitColors[s.exit_type || ''] || { dot: 'bg-red-500 border-red-500', badge: 'red', label: '売却' };
                                }
                                default:
                                  return { dot: 'bg-zinc-500 border-zinc-500', badge: 'blue', label: s.type };
                              }
                            };
                            const style = getTypeStyle();
                            const dateRange = s.days > 1 ? `${s.date} ~ ${s.end_date}` : s.date;
                            const priceRange = s.days > 1 && s.end_price ? `${ccy}${s.price.toFixed(2)} → ${ccy}${s.end_price.toFixed(2)}` : `${ccy}${s.price.toFixed(2)}`;
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
                                <span className="text-sm font-semibold font-mono text-foreground">{ccy}{s.price.toFixed(2)}</span>
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
              <div className="space-y-4 plumb-animate-in">
                <DocSection title="統合エントリーシステム 概要" defaultOpen>
                  <p>
                    統合エントリーシステムは、トレンド転換、EMA収束、相対強度（RS）の3条件を統合し、
                    バックテスト検証済みのパラメータで売買タイミングを判定するシステムです。
                  </p>
                </DocSection>

                <DocSection title="エントリー条件">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="plumb-glass rounded-lg p-5">
                      <h4 className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mb-2">1. 弱気転換</h4>
                      <p className="text-xs leading-relaxed text-muted-foreground">直近10個の転換点から弱気トレンド転換を検出。下落トレンドの開始を確認。</p>
                    </div>
                    <div className="plumb-glass rounded-lg p-5">
                      <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 mb-2">2. 強気転換</h4>
                      <p className="text-xs leading-relaxed text-muted-foreground">弱気転換後の強気転換を検出。上昇トレンドへの反転を確認。</p>
                    </div>
                    <div className="plumb-glass rounded-lg p-5">
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

                <DocSection title="4層決済システム">
                  <DocTable
                    headers={['層', '名称', 'アクション']}
                    rows={[
                      ['1', '損切ライン', '終値がATR×3.0下を割ると全額損切り'],
                      ['2', '反転検出', '弱気転換で50%売却 → EMAデスクロスで残り売却'],
                      ['3', '利確ストップ（追従型）', '高値に追従 — 下落時に自動利確'],
                      ['4', '保有期限', '252営業日で強制決済'],
                    ]}
                  />
                </DocSection>

                <DocSection title="バックテスト結果（23銘柄 / 4年間）">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="plumb-glass rounded-lg p-5 text-center">
                      <div className="text-xs text-muted-foreground uppercase mb-1 font-medium">標準</div>
                      <div className="text-base font-bold text-blue-600 dark:text-blue-400">+7.54%</div>
                      <div className="text-xs text-muted-foreground">PF 3.61</div>
                    </div>
                    <div className="plumb-glass rounded-lg p-5 text-center">
                      <div className="text-xs text-muted-foreground uppercase mb-1 font-medium">積極型</div>
                      <div className="text-base font-bold text-orange-600 dark:text-orange-400">+6.63%</div>
                      <div className="text-xs text-muted-foreground">PF 3.15</div>
                    </div>
                    <div className="plumb-glass rounded-lg p-5 text-center">
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
    <div className="plumb-gradient-border rounded-xl">
      <div className="plumb-glass rounded-xl p-5 text-center">
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
