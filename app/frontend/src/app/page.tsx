import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import { Activity, Briefcase, LineChart, AlertTriangle } from "lucide-react";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { FAQ } from "@/components/landing/FAQ";
import { AudienceFeatures } from "@/components/landing/AudienceFeatures";
import { ValidatedPerformance } from "@/components/landing/ValidatedPerformance";
import { HashScroll } from "@/components/landing/HashScroll";
import { LandingCTA } from "@/components/landing/LandingCTA";

type IconType = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

export const metadata: Metadata = {
  title: "Open Regime — 規律ある投資へ",
};

const PILLARS = [
  {
    num: "01",
    title: "上昇方向への構造変化を、検出する。",
    body: "Bullish CHoCH (Change of Character) と Higher Low の確認、EMA 8/21 の収束で「上昇への転換」を機械的に判定します。",
  },
  {
    num: "02",
    title: "下落の前兆を、価格より先に捉える。",
    body: "“Structure fails before price collapses” —— 構造は価格より先に壊れる。Bearish CHoCH の検知で、価格が崩れる前に出口を準備します。",
  },
  {
    num: "03",
    title: "感情ではなく、ルールで動く。",
    body: "Entry も Exit もすべて数式と閾値で定義。「今回だけ例外」が存在しないので、誰がいつ使っても同じ判定が出ます。",
  },
];

// 3 つのコア機能
const FEATURES: {
  href: string;
  icon: IconType;
  mono: string;
  title: string;
  desc: string;
  kind: "liquidity" | "employment" | "signals";
}[] = [
  {
    href: "/liquidity",
    icon: Activity,
    mono: "Liquidity",
    title: "マクロ流動性",
    desc: "米国市場全体の “お金の流れ” を 3 層構造で可視化。リスクを取るべき相場かを判断します。",
    kind: "liquidity",
  },
  {
    href: "/employment",
    icon: Briefcase,
    mono: "Economy",
    title: "景気サイクル",
    desc: "雇用・消費・構造の 3 軸を 100 点満点のスコアに統合。景気局面を 5 段階で判定します。",
    kind: "employment",
  },
  {
    href: "/signals",
    icon: LineChart,
    mono: "Signals",
    title: "銘柄分析",
    desc: "価格構造の転換とトレンドの強さから、買い場と売り場を機械的に判定。米国株・日本株対応。",
    kind: "signals",
  },
];

const DISCLAIMERS = [
  {
    title: "投資助言ではありません。",
    body: "本ツールは金融商品取引法に基づく投資助言業の登録を受けておらず、投資助言・代理業に該当するサービスは一切提供しておりません。表示されるスコア、シグナル、推奨アクションは全て統計的分析に基づく参考情報であり、特定の金融商品の売買を推奨するものではありません。",
  },
  {
    title: "最終判断は、ご自身で。",
    body: "投資に関する最終的な判断は、ご自身の責任において行ってください。本ツールの利用により生じた損失について、開発者は一切の責任を負いません。",
  },
  {
    title: "データには、遅れがあります。",
    body: "使用するデータの多くは遅行指標です。経済指標は数週間〜数ヶ月遅れて発表されるため、リアルタイムの市場状況を完全に反映していない場合があります。",
  },
  {
    title: "過去は、未来を保証しません。",
    body: "本システムは過去のデータパターンに基づいて構築されています。前例のない市場イベントに対しては適切に機能しない可能性があります。常に複数の情報源を参照し、ご自身の判断を行ってください。",
  },
];

export default function HomePage() {
  return (
    <div data-theme="landing" className="light min-h-screen">
      <main>
        <HashScroll />
        {/* Hero */}
        <section className="relative bg-white border-b border-slate-200">
          <div className="mx-auto max-w-6xl px-6 py-24 md:py-32 grid md:grid-cols-12 gap-12 items-center">
            <div className="md:col-span-7">
              <h1 className="text-6xl md:text-7xl lg:text-8xl font-semibold leading-[1.05] tracking-tight text-slate-900">
                Support
                <br />
                Every
                <br />
                <span
                  style={{
                    backgroundImage: "linear-gradient(90deg, #0017C1, #3460FB 55%, #a78bfa)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  Market.
                </span>
              </h1>
              <p className="mt-12 text-xl md:text-2xl font-bold text-slate-900 leading-snug">
                投資判断に、再現性を。
              </p>
              <p className="mt-4 text-base md:text-lg text-slate-600 leading-relaxed max-w-2xl">
                裁量を排した判定ロジックで、迷いのない投資判断を支援する分析エンジン。
                <br />
                数日〜数か月のスイングトレード向け。
              </p>
              <LandingCTA variant="hero" />
            </div>
            <div className="md:col-span-5 relative">
              <HeroMock />
            </div>
          </div>
        </section>

        {/* What is Open Regime */}
        <section className="py-24 border-b border-slate-200">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-sm font-bold uppercase tracking-[0.22em] text-slate-500 font-mono mb-4">
              WHAT IS OPEN REGIME
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
              このシステムについて
            </h2>
            <div className="mt-8 space-y-5 text-lg text-slate-600 leading-relaxed">
              <p>
                Open Regime は、マクロ経済から個別銘柄まで、
                投資判断に必要な視点をひとつのダッシュボードに集約します。
              </p>
              <p>
                <strong className="text-slate-900">流動性</strong>、
                <strong className="text-slate-900">景気サイクル</strong>、
                <strong className="text-slate-900">銘柄テクニカル</strong>の 3 つを統合し、
                「今、リスクを取るべきか、守るべきか」を機械的に判断できるよう設計されています。
              </p>
            </div>
          </div>
        </section>

        <ValidatedPerformance />

        {/* Core Features — 3 タブを画像カードで誘導 */}
        <section id="features" className="py-28 bg-slate-50 border-b border-slate-200">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-16">
              <div className="text-sm font-bold text-brand-primary-700 uppercase tracking-[0.22em] font-mono">
                CORE FEATURES
              </div>
              <h2 className="mt-3 text-4xl md:text-5xl font-bold tracking-tight text-slate-900">
                3 つの分析画面
              </h2>
              <p className="mt-4 text-slate-600 max-w-xl mx-auto">
                マクロからミクロまで、目的別に最適化されたダッシュボード。
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <Link
                    key={f.href}
                    href={f.href}
                    className="group rounded-3xl overflow-hidden bg-white border border-slate-200 hover:border-brand-primary/40 hover:shadow-xl transition-all"
                  >
                    <FeatureMock kind={f.kind} icon={Icon} />
                    <div className="p-7">
                      <div className="text-[13px] font-bold text-brand-primary-700 uppercase tracking-[0.18em] font-mono">
                        {f.mono}
                      </div>
                      <h3 className="mt-2 text-2xl font-bold text-slate-900">{f.title}</h3>
                      <p className="mt-3 text-sm text-slate-600 leading-relaxed">{f.desc}</p>
                      <div className="mt-5 inline-flex items-center text-sm font-semibold text-brand-primary group-hover:gap-2 gap-1 transition-all">
                        画面を見る <span>→</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <AudienceFeatures />

        {/* Pillars */}
        <section id="pillars" className="border-y border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="text-sm font-bold text-brand-primary-700 uppercase tracking-[0.22em] mb-4 font-mono">
              OUR PHILOSOPHY
            </div>
            <h2 className="text-2xl md:text-4xl font-semibold tracking-tight text-slate-900 leading-[1.35]">
              <span className="md:whitespace-nowrap">株の構造が上昇方向に変化したときに買い、</span>
              <br />
              <span
                style={{
                  backgroundImage: "linear-gradient(90deg, #0017C1, #3460FB 60%, #a78bfa)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                下落方向になる前に売る。
              </span>
            </h2>
            <p className="mt-6 text-base text-slate-500 md:whitespace-nowrap">
              Open Regime のすべてのロジックは、この一文を機械的に実行するために設計されています。
            </p>
            <div className="mt-12 space-y-5">
              {PILLARS.map((p) => (
                <div
                  key={p.num}
                  className="grid md:grid-cols-12 gap-6 items-center rounded-2xl bg-white border border-slate-200 px-8 md:px-10 py-6 hover:border-brand-primary/30 transition-colors"
                >
                  <div className="md:col-span-2 text-3xl font-bold text-brand-primary/30">{p.num}</div>
                  <div className="md:col-span-10">
                    <h3 className="text-xl md:text-2xl font-semibold text-slate-900">{p.title}</h3>
                    <p className="mt-2 text-slate-600 leading-relaxed text-base">{p.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Disclaimer — 元の 4 項目 (青基調・控えめ) */}
        <section className="py-24 border-b border-slate-200">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-sm font-bold text-brand-primary-700 uppercase tracking-[0.22em] font-mono mb-4">
              Disclaimer
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold text-slate-900 tracking-tight">
              ご利用前に、知っておいてほしいこと。
            </h2>
            <div className="mt-12 grid sm:grid-cols-2 gap-5">
              {DISCLAIMERS.map((d) => (
                <div
                  key={d.title}
                  className="rounded-2xl border border-slate-200 bg-slate-50/50 p-7"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-brand-primary" />
                    <p className="text-base font-bold text-slate-900">{d.title}</p>
                  </div>
                  <p className="mt-3 text-sm text-slate-600 leading-relaxed">{d.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <FAQ variant="A" />
      </main>

      {/* CTA — ページ全幅 黒背景 */}
      <section className="relative w-full bg-black overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(52,96,251,0.25), rgba(0,0,0,0) 70%)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(167,139,250,0.6), transparent)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-6 py-32 md:py-44 text-center">
          <div className="text-sm font-bold text-brand-accent uppercase tracking-[0.3em] font-mono mb-8">
            Get Started
          </div>
          <h2 className="text-5xl md:text-7xl font-semibold text-white tracking-tight leading-[1.05]">
            はじめましょう。
          </h2>
          <LandingCTA variant="final" />
        </div>
      </section>

      <LandingFooter variant="dark" />
    </div>
  );
}

/* ───────── SVG Mocks ───────── */

function HeroMock() {
  return (
    <div className="relative">
      {/* メインカード */}
      <div className="relative rounded-2xl border border-slate-200 bg-white shadow-[0_30px_80px_-30px_rgba(15,23,42,0.25)] overflow-hidden">
        {/* ウィンドウバー */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
          <span className="ml-3 text-[10px] font-mono text-slate-400">open-regime.com / dashboard</span>
        </div>
        <div className="p-5 space-y-4">
          {/* KPI 行 */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { k: "REGIME", v: "EXPANSION", c: "#3460FB" },
              { k: "SIGNAL", v: "BUY · 14", c: "#3460FB" },
              { k: "RISK", v: "18 / 100", c: "#10b981" },
            ].map((kpi) => (
              <div key={kpi.k} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                <div className="text-[9px] font-mono font-bold text-slate-400 tracking-wider">{kpi.k}</div>
                <div className="mt-1 text-sm font-bold" style={{ color: kpi.c }}>
                  {kpi.v}
                </div>
              </div>
            ))}
          </div>
          {/* メインチャート */}
          <div className="rounded-lg border border-slate-100 bg-gradient-to-b from-white to-slate-50/40 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-mono font-bold text-slate-500">LIQUIDITY · L1</div>
              <div className="text-[10px] font-bold text-emerald-600">+2.4%</div>
            </div>
            <svg viewBox="0 0 320 100" className="w-full h-24">
              <defs>
                <linearGradient id="hm-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#3460FB" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#3460FB" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* グリッド */}
              {[20, 40, 60, 80].map((y) => (
                <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="2 4" strokeWidth="0.5" />
              ))}
              <path
                d="M0,75 L25,68 L50,72 L75,55 L100,60 L125,45 L150,50 L175,38 L200,42 L225,28 L250,35 L275,20 L300,28 L320,15 L320,100 L0,100 Z"
                fill="url(#hm-area)"
              />
              <path
                d="M0,75 L25,68 L50,72 L75,55 L100,60 L125,45 L150,50 L175,38 L200,42 L225,28 L250,35 L275,20 L300,28 L320,15"
                fill="none"
                stroke="#3460FB"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="320" cy="15" r="3" fill="#3460FB" />
              <circle cx="320" cy="15" r="6" fill="#3460FB" fillOpacity="0.2" />
            </svg>
          </div>
          {/* 下段ミニカード */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-100 p-3">
              <div className="text-[9px] font-mono font-bold text-slate-400">EMPLOYMENT</div>
              <div className="mt-1 flex items-end gap-1 h-8">
                {[40, 55, 45, 60, 50, 65, 70].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm"
                    style={{
                      height: `${h}%`,
                      background: i === 6 ? "#0017C1" : "#C5D7FB",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-slate-100 p-3">
              <div className="text-[9px] font-mono font-bold text-slate-400">EXIT LAYERS</div>
              <div className="mt-2 flex gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="flex-1 h-2 rounded-full"
                    style={{
                      background: i <= 4 ? "#3460FB" : "#e2e8f0",
                    }}
                  />
                ))}
              </div>
              <div className="mt-2 text-[10px] text-slate-500">4 / 5 active</div>
            </div>
          </div>
        </div>
      </div>

      {/* 浮遊するサイドバッジ */}
      <div className="absolute -top-4 -right-4 hidden md:flex items-center gap-2 rounded-full bg-white border border-slate-200 shadow-lg px-4 py-2">
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-xs font-semibold text-slate-700">LIVE</span>
      </div>
      <div className="absolute -bottom-5 -left-5 hidden md:block rounded-2xl bg-white border border-slate-200 shadow-lg px-4 py-3">
        <div className="text-[9px] font-mono font-bold text-slate-400">SIGNAL</div>
        <div className="text-sm font-bold text-brand-primary">14 BUY</div>
      </div>
    </div>
  );
}

function FeatureMock({ kind, icon: Icon }: { kind: "liquidity" | "employment" | "signals"; icon: IconType }) {
  return (
    <div className="relative h-48 bg-gradient-to-br from-[#F5F8FF] via-white to-[#EEF2FF] overflow-hidden border-b border-slate-100">
      <div className="absolute top-4 left-4 z-10 inline-flex items-center justify-center h-10 w-10 rounded-xl bg-white shadow-sm border border-slate-100">
        <Icon className="h-5 w-5 text-brand-primary" />
      </div>
      {kind === "liquidity" && <LiquidityChart />}
      {kind === "employment" && <EmploymentChart />}
      {kind === "signals" && <SignalsChart />}
    </div>
  );
}

function LiquidityChart() {
  return (
    <>
      <div className="absolute top-4 right-4 z-10 rounded-md bg-white border border-slate-100 px-2 py-1 text-[9px] font-mono font-bold text-emerald-600 shadow-sm">
        EXPANSION
      </div>
      <svg viewBox="0 0 320 200" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient id="liq-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#3460FB" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#3460FB" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0,160 L30,150 L60,155 L90,130 L120,140 L150,110 L180,120 L210,85 L240,95 L270,60 L300,70 L320,45 L320,200 L0,200 Z"
          fill="url(#liq-area)"
        />
        <path
          d="M0,160 L30,150 L60,155 L90,130 L120,140 L150,110 L180,120 L210,85 L240,95 L270,60 L300,70 L320,45"
          fill="none"
          stroke="#3460FB"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </>
  );
}

function EmploymentChart() {
  // シンプルな棒グラフ (左下から右上への上昇トレンド)
  const bars = [30, 45, 38, 52, 45, 60, 55, 70, 62, 78, 72, 88];
  return (
    <>
      <div className="absolute top-4 right-4 z-10 rounded-md bg-white border border-slate-100 px-2 py-1 text-[9px] font-mono font-bold text-emerald-600 shadow-sm">
        SCORE 32
      </div>
      <svg viewBox="0 0 320 200" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient id="emp-bar" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#3460FB" />
            <stop offset="100%" stopColor="#7096F8" />
          </linearGradient>
        </defs>
        {bars.map((v, i) => {
          const w = 18;
          const gap = 8;
          const x = 20 + i * (w + gap);
          const h = (v / 100) * 150;
          const y = 180 - h;
          return <rect key={i} x={x} y={y} width={w} height={h} rx="2" fill="url(#emp-bar)" />;
        })}
        {/* 平均線 */}
        <line x1="0" x2="320" y1="100" y2="100" stroke="#a78bfa" strokeWidth="1.5" strokeDasharray="4 4" />
      </svg>
    </>
  );
}

function SignalsChart() {
  // ローソク足風
  const candles = [
    { o: 60, c: 50, h: 45, l: 65, up: true },
    { o: 50, c: 55, h: 42, l: 60, up: false },
    { o: 55, c: 45, h: 40, l: 60, up: true },
    { o: 45, c: 35, h: 30, l: 50, up: true },
    { o: 35, c: 40, h: 30, l: 45, up: false },
    { o: 40, c: 30, h: 25, l: 45, up: true },
    { o: 30, c: 25, h: 18, l: 35, up: true },
    { o: 25, c: 30, h: 22, l: 35, up: false },
    { o: 30, c: 18, h: 15, l: 35, up: true },
    { o: 18, c: 12, h: 8, l: 22, up: true },
  ];
  return (
    <>
      <div className="absolute top-4 right-4 z-10 rounded-md bg-brand-primary px-2 py-1 text-[9px] font-mono font-bold text-white shadow-sm">
        BUY · 14
      </div>
      <svg viewBox="0 0 320 200" className="absolute inset-0 w-full h-full">
        <g transform="translate(0 75)">
        {/* EMA ライン */}
        <path
          d="M10,140 L40,130 L70,128 L100,118 L130,108 L160,95 L190,82 L220,68 L250,52 L290,35"
          fill="none"
          stroke="#a78bfa"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
        {candles.map((c, i) => {
          const x = 20 + i * 30;
          const top = Math.min(c.o, c.c);
          const bot = Math.max(c.o, c.c);
          const color = c.up ? "#10b981" : "#ef4444";
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={c.h} y2={c.l} stroke={color} strokeWidth="1.5" />
              <rect x={x - 6} y={top} width="12" height={Math.max(bot - top, 2)} fill={color} rx="1" />
            </g>
          );
        })}
        </g>
      </svg>
    </>
  );
}
