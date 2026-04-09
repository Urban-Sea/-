'use client';

import { useState } from 'react';

type Universe = 'sp500' | 'nasdaq100' | 'nikkei225';

type Result = {
  key: Universe;
  label: string;
  period: string;
  universeSize: string;
  trades: string;
  winRate: string;
  pf: string;
  avgReturn: string;
  avgHoldDays: string;
  benchmark: string;
  benchmarkValue: string;
  bearYears: string;
  highlight: string;
  reportHref: string;
};

const RESULTS: Result[] = [
  {
    key: 'sp500',
    label: 'S&P 500',
    period: '2016-04-08 ~ 2026-04-08 (10年)',
    universeSize: '698 銘柄 (10 年間の在籍合計)',
    trades: '42,622',
    winRate: '69.6%',
    pf: '4.76',
    avgReturn: '+3.70%',
    avgHoldDays: '44.6 日',
    benchmark: 'S&P 500 ETF',
    benchmarkValue: '年率 +14.27%',
    bearYears: '2018年, 2022年',
    highlight: 'Bear 市場でも黒字維持',
    reportHref: '/reports/sp500',
  },
  {
    key: 'nasdaq100',
    label: 'NASDAQ 100',
    period: '2016-04-08 ~ 2026-04-08 (10年)',
    universeSize: '194 銘柄 (10 年間の在籍合計)',
    trades: '8,266',
    winRate: '70.9%',
    pf: '5.10',
    avgReturn: '+4.13%',
    avgHoldDays: '38.0 日',
    benchmark: 'NASDAQ 100 ETF',
    benchmarkValue: '年率 +19.22%',
    bearYears: '2018年, 2022年',
    highlight: 'Bear 市場でも黒字維持',
    reportHref: '/reports/nasdaq100',
  },
  {
    key: 'nikkei225',
    label: '日経 225',
    period: '2016-04-08 ~ 2026-04-08 (10年)',
    universeSize: '265 銘柄 (10 年間の在籍合計)',
    trades: '18,777',
    winRate: '72.1%',
    pf: '5.79',
    avgReturn: '+4.13%',
    avgHoldDays: '36.3 日',
    benchmark: '日経 225 ETF',
    benchmarkValue: '年率 +14.96%',
    bearYears: '2018年, 2022年',
    highlight: '3 指数中で最良の精度',
    reportHref: '/reports/nikkei225',
  },
];

export function ValidatedPerformance() {
  const [active, setActive] = useState<Universe>('sp500');
  const r = RESULTS.find((x) => x.key === active)!;

  return (
    <section id="validated" className="py-24 border-b border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-6xl px-6">
        {/* eyebrow + 見出し */}
        <div className="text-center">
          <div className="text-sm font-bold text-[var(--lp-primary-700)] uppercase tracking-[0.22em] font-mono">
            Validated Performance
          </div>
          <h2 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
            過去 10 年で、何度も検証されたロジック。
          </h2>
          <p className="mt-4 text-base text-slate-600 max-w-2xl mx-auto leading-relaxed">
            主要指数の全銘柄を対象に、銘柄分析エンジンを過去 10 年で検証しました。
          </p>
        </div>

        {/* タブ */}
        <div className="mt-12 flex justify-center">
          <div className="inline-flex items-center rounded-full border border-slate-200 bg-white p-1 shadow-sm">
            {RESULTS.map((opt) => {
              const selected = active === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setActive(opt.key)}
                  className={[
                    'rounded-full px-6 py-2.5 text-sm font-semibold transition-colors',
                    selected
                      ? 'bg-[var(--lp-primary)] text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900',
                  ].join(' ')}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 数字カード */}
        <div className="mt-10 rounded-3xl bg-white border border-slate-200 p-8 md:p-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
            <div>
              <div className="text-2xl md:text-3xl font-bold text-slate-900">{r.label}</div>
              <div className="mt-1 text-sm text-slate-500 font-mono">{r.period}</div>
            </div>
            <div className="inline-flex items-center gap-2 self-start rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-semibold text-emerald-700">{r.highlight}</span>
            </div>
          </div>

          {/* 主要メトリクス 4 つ */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <Metric value={r.trades} label="取引回数" />
            <Metric value={r.winRate} label="勝率" />
            <Metric value={r.pf} label="損益比 (PF)" />
            <Metric value={r.avgReturn} label="1 取引あたり平均" />
          </div>

          {/* 詳細行 */}
          <div className="mt-10 pt-8 border-t border-slate-100 grid sm:grid-cols-2 md:grid-cols-4 gap-6 text-sm">
            <DetailRow label="検証対象" value={r.universeSize} />
            <DetailRow label="平均保有日数" value={r.avgHoldDays} />
            <DetailRow label="比較対象" value={`${r.benchmark} (${r.benchmarkValue})`} />
            <DetailRow label="Bear 市場でも黒字" value={r.bearYears} />
          </div>

          {/* 詳細レポートリンク */}
          <div className="mt-10 flex flex-wrap items-start justify-between gap-4">
            <div className="text-xs text-slate-500 leading-relaxed max-w-xl space-y-2">
              <p>
                検証方法: 過去 10 年間の指数構成銘柄を取得し、当時に在籍していた銘柄だけを対象に判定。
                倒産・除外された銘柄も含めることで、結果の楽観バイアスを排除しています。
              </p>
              <p>
                ※ 数値は per-trade (1 取引単位) の集計です。実運用ではポジション数の制約や手数料・スリッページにより、
                ポートフォリオ全体の実績は控えめになる可能性があります。
              </p>
            </div>
            <a
              href={r.reportHref}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--lp-primary)] hover:gap-3 transition-all shrink-0"
            >
              詳細レポートを読む →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-3xl md:text-4xl font-bold text-[var(--lp-primary-700)] tabular-nums">
        {value}
      </div>
      <div className="mt-1 text-xs text-slate-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}
