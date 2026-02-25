'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLatestMarketState, useRegime, useLiquidityOverview } from '@/lib/api';

function LoadingCard() {
  return (
    <Card className="animate-pulse">
      <CardHeader>
        <div className="h-4 bg-muted rounded w-1/3"></div>
      </CardHeader>
      <CardContent>
        <div className="h-8 bg-muted rounded w-1/2"></div>
      </CardContent>
    </Card>
  );
}

function getRegimeColor(regime: string) {
  switch (regime) {
    case 'BULL':
      return 'bg-green-500/20 text-green-400 border-green-500/50';
    case 'BEAR':
      return 'bg-red-500/20 text-red-400 border-red-500/50';
    case 'RECOVERY':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
    case 'WEAKENING':
      return 'bg-orange-500/20 text-orange-400 border-orange-500/50';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
  }
}

function getStressColor(stress: number | undefined) {
  if (stress === undefined) return 'text-muted-foreground';
  if (stress < 30) return 'text-green-400';
  if (stress < 60) return 'text-orange-400';
  return 'text-red-400';
}

function getAlertColor(level: string) {
  switch (level) {
    case 'Low':
      return 'bg-green-500/20 text-green-400';
    case 'Medium':
      return 'bg-orange-500/20 text-orange-400';
    case 'High':
      return 'bg-red-500/20 text-red-400';
    default:
      return 'bg-gray-500/20 text-gray-400';
  }
}

function ErrorCard({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">データの取得に失敗しました</p>
      </CardContent>
    </Card>
  );
}

function MarketStateCard() {
  const { data: state, error, isLoading } = useLatestMarketState();

  if (isLoading) return <LoadingCard />;
  if (error || !state) return <ErrorCard title="マーケット状態" />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">マーケット状態</CardTitle>
        <span className="text-sm text-muted-foreground">{state.date}</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-sm text-muted-foreground mb-1">SPY</div>
            <Badge className={getRegimeColor(state.spy_regime || '')}>
              {state.spy_regime || 'N/A'}
            </Badge>
          </div>
          <div className="text-center">
            <div className="text-sm text-muted-foreground mb-1">QQQ</div>
            <Badge className={getRegimeColor(state.qqq_regime || '')}>
              {state.qqq_regime || 'N/A'}
            </Badge>
          </div>
          <div className="text-center">
            <div className="text-sm text-muted-foreground mb-1">BTC</div>
            <Badge className={getRegimeColor(state.btc_regime || '')}>
              {state.btc_regime || 'N/A'}
            </Badge>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <div className="text-sm text-muted-foreground mb-2">ストレスレベル</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex justify-between">
              <span className="text-sm">Layer 1:</span>
              <span className={`text-sm font-medium ${getStressColor(state.stress_levels?.layer1)}`}>
                {state.stress_levels?.layer1?.toFixed(1) ?? 'N/A'}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm">Layer 2:</span>
              <span className={`text-sm font-medium ${getStressColor(state.stress_levels?.layer2)}`}>
                {state.stress_levels?.layer2?.toFixed(1) ?? 'N/A'}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm">Layer 3:</span>
              <span className={`text-sm font-medium ${getStressColor(state.stress_levels?.layer3)}`}>
                {state.stress_levels?.layer3?.toFixed(1) ?? 'N/A'}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm">Layer 4:</span>
              <span className={`text-sm font-medium ${getStressColor(state.stress_levels?.layer4)}`}>
                {state.stress_levels?.layer4?.toFixed(1) ?? 'N/A'}%
              </span>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-border flex justify-between">
            <span className="font-medium">総合:</span>
            <span className={`font-bold text-lg ${getStressColor(state.stress_levels?.overall)}`}>
              {state.stress_levels?.overall?.toFixed(1) ?? 'N/A'}%
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RegimeCard() {
  const { data: regime, error, isLoading } = useRegime();

  if (isLoading) return <LoadingCard />;
  if (error || !regime) return <ErrorCard title="Market Regime" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Market Regime</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center">
          <Badge className={`text-2xl px-6 py-2 ${getRegimeColor(regime.regime)}`}>
            {regime.regime}
          </Badge>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">ベンチマーク:</span>
            <span>{regime.benchmark_ticker}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">現在価格:</span>
            <span>${regime.benchmark_price.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">200 EMA:</span>
            <span>${regime.benchmark_ema_long.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">200 EMA上:</span>
            <Badge variant={regime.above_long_ema ? 'default' : 'destructive'}>
              {regime.above_long_ema ? 'YES' : 'NO'}
            </Badge>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">{regime.description}</p>
          <p className="text-sm mt-2 font-medium text-primary">{regime.entry_recommendation}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function LiquidityCard() {
  const { data: liquidity, error, isLoading } = useLiquidityOverview();

  if (isLoading) return <LoadingCard />;
  if (error || !liquidity) return <ErrorCard title="流動性概要" />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">流動性概要</CardTitle>
        <Badge className={getAlertColor(liquidity.liquidity_stress)}>
          {liquidity.liquidity_stress}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {liquidity.market_indicators && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-muted-foreground">VIX</div>
              <div className="text-xl font-bold">
                {liquidity.market_indicators.vix?.toFixed(2) ?? 'N/A'}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">DXY</div>
              <div className="text-xl font-bold">
                {liquidity.market_indicators.dxy?.toFixed(2) ?? 'N/A'}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">S&P 500</div>
              <div className="text-xl font-bold">
                {liquidity.market_indicators.sp500?.toFixed(0) ?? 'N/A'}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">NASDAQ</div>
              <div className="text-xl font-bold">
                {liquidity.market_indicators.nasdaq?.toFixed(0) ?? 'N/A'}
              </div>
            </div>
          </div>
        )}

        {liquidity.stress_factors.length > 0 && (
          <div className="border-t border-border pt-4">
            <div className="text-sm text-muted-foreground mb-2">ストレス要因</div>
            <ul className="space-y-1">
              {liquidity.stress_factors.map((factor, i) => (
                <li key={i} className="text-sm text-orange-400">• {factor}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">統合ダッシュボード</h1>
        <p className="text-muted-foreground">マーケット状態の概要</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <MarketStateCard />
        <RegimeCard />
        <LiquidityCard />
      </div>
    </div>
  );
}
