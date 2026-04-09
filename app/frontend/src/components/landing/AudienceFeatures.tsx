'use client';

import { useState } from 'react';

type Level = 'beginner' | 'intermediate';

type Feature = {
  eyebrow: string;
  title: string;
  body: string;
};

const COPY: Record<Level, Feature[]> = {
  beginner: [
    {
      eyebrow: '売り時を、機械が決める',
      title: '4 段階で、利益を守る。',
      body:
        '利益が乗ったら自動で追随、相場が崩れたら部分利確、ダメな時はあらかじめ決めた損切り。「いつ売るか」を 4 種類のロジックが判定するので、感情で決めずに済みます。',
    },
    {
      eyebrow: '買い時を、3 つの条件で',
      title: '条件が揃ったときだけ、知らせる。',
      body:
        '過去の価格構造、トレンド転換、移動平均線の位置。3 つの条件がすべて揃った瞬間だけを「買い場」として通知。曖昧な場面では何も通知しません。',
    },
    {
      eyebrow: '市場全体の温度を、可視化',
      title: '今、買っていい相場か。',
      body:
        '中央銀行の資金供給、銀行の貸出、市場の借入。米国市場全体の「お金の流れ」を 3 層で見て、リスクを取っていい相場かを直感的に判断できます。',
    },
  ],
  intermediate: [
    {
      eyebrow: 'Risk Management',
      title: '4 段階で、利益を守る。',
      body:
        'ATR ベースのハード損切り、CHoCH 検知による部分利確、EMA21 を基準とした Adaptive トレール、時間ストップ。4 つの独立した出口ロジックが、含み益と元本を機械的に管理します。',
    },
    {
      eyebrow: 'Combined Entry',
      title: '3 条件、すべて揃ったときだけ。',
      body:
        'Bearish CHoCH の先行検知、Higher Low での Bullish CHoCH、EMA 8/21 の収束。3 つの条件が AND で揃った瞬間だけを買い場として抽出します。',
    },
    {
      eyebrow: 'Liquidity Layers',
      title: '流動性を、3 層で読む。',
      body:
        'FRB の資金供給 (L1)、銀行セクター (L2A)、市場レバレッジ (L2B)。米国金融市場の資金の流れを 3 層構造で可視化し、レジームを判定します。',
    },
  ],
};

export function AudienceFeatures() {
  const [level, setLevel] = useState<Level>('intermediate');
  const features = COPY[level];

  return (
    <div>
      {/* トグル */}
      <div className="flex justify-center pt-20">
        <div className="inline-flex items-center rounded-full border border-slate-200 bg-white p-1 shadow-sm">
          {(
            [
              { v: 'beginner', label: '初心者向け' },
              { v: 'intermediate', label: '中級者向け' },
            ] as const
          ).map((opt) => {
            const active = level === opt.v;
            return (
              <button
                key={opt.v}
                type="button"
                onClick={() => setLevel(opt.v)}
                className={[
                  'rounded-full px-6 py-2.5 text-sm font-semibold transition-colors',
                  active
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

      {/* FeatureDetail 3 セクション */}
      {features.map((f, i) => {
        const reverse = i === 1;
        return (
          <section key={i} className="py-20">
            <div className="mx-auto max-w-6xl px-6 grid md:grid-cols-2 gap-12 items-center">
              <div className={reverse ? 'md:order-2' : ''}>
                <div
                  className="text-[13px] font-bold uppercase tracking-[0.18em] mb-3"
                  style={{ color: 'var(--lp-primary-700)' }}
                >
                  {f.eyebrow}
                </div>
                <h3 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 leading-tight">
                  {f.title}
                </h3>
                <p className="mt-5 text-base md:text-lg leading-relaxed text-slate-600">
                  {f.body}
                </p>
              </div>
              <div className={reverse ? 'md:order-1' : ''}>
                <div className="aspect-[4/3] rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-sm font-mono text-slate-400">
                  (UI mock placeholder)
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
