'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHoldings, useTrades, useTradeStats, useBatchQuotes } from '@/lib/api';
import type { HoldingRecord, TradeRecord, TradeStats, StockQuote } from '@/types';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function formatPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function HoldingsTable({
  holdings,
  quotes,
}: {
  holdings: HoldingRecord[];
  quotes: Map<string, StockQuote>;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ティッカー</TableHead>
          <TableHead className="text-right">株数</TableHead>
          <TableHead className="text-right">平均取得価格</TableHead>
          <TableHead className="text-right">現在価格</TableHead>
          <TableHead className="text-right">評価額</TableHead>
          <TableHead className="text-right">損益</TableHead>
          <TableHead>口座</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {holdings.map((holding) => {
          const quote = quotes.get(holding.ticker);
          const currentPrice = quote?.price || holding.avg_price;
          const marketValue = holding.shares * currentPrice;
          const costBasis = holding.shares * holding.avg_price;
          const pnl = marketValue - costBasis;
          const pnlPct = ((currentPrice - holding.avg_price) / holding.avg_price) * 100;

          return (
            <TableRow key={holding.id}>
              <TableCell className="font-medium">{holding.ticker}</TableCell>
              <TableCell className="text-right">{holding.shares.toFixed(2)}</TableCell>
              <TableCell className="text-right">{formatCurrency(holding.avg_price)}</TableCell>
              <TableCell className="text-right">
                {quote ? formatCurrency(currentPrice) : '-'}
              </TableCell>
              <TableCell className="text-right">{formatCurrency(marketValue)}</TableCell>
              <TableCell className={`text-right ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatCurrency(pnl)} ({formatPercent(pnlPct)})
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {holding.account_type === 'nisa' ? 'NISA' : '特定'}
                </Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function TradesTable({ trades }: { trades: TradeRecord[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>日付</TableHead>
          <TableHead>ティッカー</TableHead>
          <TableHead>アクション</TableHead>
          <TableHead className="text-right">株数</TableHead>
          <TableHead className="text-right">価格</TableHead>
          <TableHead className="text-right">損益</TableHead>
          <TableHead>理由</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((trade) => (
          <TableRow key={trade.id}>
            <TableCell>{trade.trade_date.split('T')[0]}</TableCell>
            <TableCell className="font-medium">{trade.ticker}</TableCell>
            <TableCell>
              <Badge className={trade.action === 'BUY' ? 'bg-green-500' : 'bg-red-500'}>
                {trade.action}
              </Badge>
            </TableCell>
            <TableCell className="text-right">{trade.shares.toFixed(2)}</TableCell>
            <TableCell className="text-right">{formatCurrency(trade.price)}</TableCell>
            <TableCell
              className={`text-right ${
                trade.profit_loss !== undefined
                  ? trade.profit_loss >= 0
                    ? 'text-green-400'
                    : 'text-red-400'
                  : ''
              }`}
            >
              {trade.profit_loss !== undefined
                ? `${formatCurrency(trade.profit_loss)} (${formatPercent(trade.profit_loss_pct || 0)})`
                : '-'}
            </TableCell>
            <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
              {trade.reason || '-'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StatsCard({ stats }: { stats: TradeStats }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">総取引数</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.total_trades}</div>
          <div className="text-sm text-muted-foreground">
            BUY: {stats.buy_count} / SELL: {stats.sell_count}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">総損益</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${
              stats.total_profit_loss >= 0 ? 'text-green-400' : 'text-red-400'
            }`}
          >
            {formatCurrency(stats.total_profit_loss)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">勝率</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{(stats.win_rate * 100).toFixed(1)}%</div>
          <div className="text-sm text-muted-foreground">
            Win: {stats.win_count} / Loss: {stats.loss_count}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Profit Factor</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.profit_factor.toFixed(2)}</div>
          <div className="text-sm text-muted-foreground">
            Avg Profit: {formatCurrency(stats.avg_profit)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function HoldingsPage() {
  const { data: holdingsData, error: holdingsError, isLoading: holdingsLoading } = useHoldings();
  const { data: tradesData, isLoading: tradesLoading } = useTrades({ limit: 50 });
  const { data: stats } = useTradeStats();

  const holdings = holdingsData?.holdings ?? [];
  const trades = tradesData?.trades ?? [];

  const tickers = useMemo(
    () => (holdings.length > 0 ? holdings.map((h) => h.ticker) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdingsData],
  );
  const { data: quotesData } = useBatchQuotes(tickers);

  const quotes = useMemo(() => {
    const map = new Map<string, StockQuote>();
    quotesData?.quotes.forEach((q) => map.set(q.ticker, q));
    return map;
  }, [quotesData]);

  const loading = holdingsLoading || tradesLoading;

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">保有・取引</h1>
          <p className="text-muted-foreground">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (holdingsError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">保有・取引</h1>
          <p className="text-red-400">{holdingsError instanceof Error ? holdingsError.message : 'データの取得に失敗しました'}</p>
        </div>
      </div>
    );
  }

  // Calculate totals
  const totalValue = holdings.reduce((sum: number, h: HoldingRecord) => {
    const quote = quotes.get(h.ticker);
    return sum + h.shares * (quote?.price || h.avg_price);
  }, 0);

  const totalCost = holdings.reduce((sum: number, h: HoldingRecord) => sum + h.shares * h.avg_price, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">保有・取引</h1>
        <p className="text-muted-foreground">ポートフォリオ管理</p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">評価額</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">取得原価</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalCost)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">含み損益</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatCurrency(totalPnl)} ({formatPercent(totalPnlPct)})
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="holdings">
        <TabsList>
          <TabsTrigger value="holdings">保有銘柄 ({holdings.length})</TabsTrigger>
          <TabsTrigger value="trades">取引履歴 ({trades.length})</TabsTrigger>
          <TabsTrigger value="stats">統計</TabsTrigger>
        </TabsList>

        <TabsContent value="holdings" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {holdings.length > 0 ? (
                <HoldingsTable holdings={holdings} quotes={quotes} />
              ) : (
                <p className="text-muted-foreground text-center py-8">保有銘柄がありません</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trades" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {trades.length > 0 ? (
                <TradesTable trades={trades} />
              ) : (
                <p className="text-muted-foreground text-center py-8">取引履歴がありません</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stats" className="mt-4">
          {stats ? (
            <StatsCard stats={stats} />
          ) : (
            <p className="text-muted-foreground">統計データがありません</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
