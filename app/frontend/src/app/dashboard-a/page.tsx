import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, LineChart, Droplets, ShieldAlert } from "lucide-react";
import {
  MOCK_PLUMBING,
  MOCK_ECONOMIC,
  VARIANT_LINKS,
  STATE_LABELS,
  PHASE_LABELS,
  MATRIX_DATA,
  MATRIX_COLORS,
  stateToRow,
  phaseToCol,
  getIntegratedInsight,
  getInsightCards,
  statusClasses,
} from "@/lib/dashboard-mocks";

export const metadata: Metadata = {
  title: "案 A: マガジン — Dashboard preview",
};

export default function DashboardAPage() {
  const stateCode = MOCK_PLUMBING.market_state!.code;
  const phaseCode = MOCK_ECONOMIC.phase.code;
  const insight = getIntegratedInsight(stateCode, phaseCode);
  const ic = statusClasses(insight.color);
  const stateColor = MOCK_PLUMBING.market_state!.color as 'green' | 'cyan' | 'yellow' | 'orange' | 'red';
  const phaseColor = MOCK_ECONOMIC.phase.color as 'green' | 'cyan' | 'yellow' | 'orange' | 'red';
  const sc = statusClasses(stateColor);
  const pc = statusClasses(phaseColor);
  const cards = getInsightCards();
  const currentRow = stateToRow(stateCode);
  const currentCol = phaseToCol(phaseCode);

  const l1 = MOCK_PLUMBING.layers.layer1!.stress_score;
  const l2a = MOCK_PLUMBING.layers.layer2a!.stress_score;
  const l2b = MOCK_PLUMBING.layers.layer2b!.stress_score;

  return (
    <div data-theme="landing" className="light min-h-screen">
      <VariantSwitcher current="a" />

      <main>
        {/* ========== HERO ========== */}
        <section className={`relative border-b border-slate-200 ${ic.bg}`}>
          <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
            <div className="text-sm font-bold uppercase tracking-[0.22em] text-slate-500 font-mono mb-6">
              INTEGRATED ANALYSIS · 2026-04-09
            </div>
            <h1 className={`text-4xl md:text-6xl font-semibold leading-[1.1] tracking-tight ${ic.text} max-w-4xl`}>
              {insight.main}
            </h1>
            <p className="mt-6 text-lg md:text-xl text-slate-600 max-w-2xl leading-relaxed">
              {insight.sub}
            </p>

            <div className="mt-12 flex flex-wrap gap-6">
              <BadgeBlock
                eyebrow="LIQUIDITY · STATE"
                label={MOCK_PLUMBING.market_state!.label}
                colorClass={`${sc.text} ${sc.border} ${sc.bg}`}
                dotClass={sc.dot}
              />
              <BadgeBlock
                eyebrow="ECONOMY · PHASE"
                label={MOCK_ECONOMIC.phase.label}
                colorClass={`${pc.text} ${pc.border} ${pc.bg}`}
                dotClass={pc.dot}
              />
            </div>
          </div>
        </section>

        {/* ========== LIQUIDITY SECTION ========== */}
        <section className="py-24 border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-sm font-bold text-brand-primary-700 uppercase tracking-[0.22em] font-mono mb-4">
              SECTION 01 · LIQUIDITY
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
              米国金融流動性モニター
            </h2>
            <p className="mt-4 text-base text-slate-600 max-w-2xl leading-relaxed">
              FRB のバランスシート, 銀行セクター, 市場レバレッジの 3 層から
              金融市場の流動性ストレスを評価します.
            </p>

            <div className="mt-12 grid md:grid-cols-3 gap-6">
              <BigMetric label="L1 政策流動性" eyebrow="FRB BALANCE SHEET" score={l1} note="QT 進行中" />
              <BigMetric label="L2A 銀行システム" eyebrow="BANKING SECTOR" score={l2a} note="健全" />
              <BigMetric label="L2B 市場レバレッジ" eyebrow="MARGIN DEBT" score={l2b} note="やや高め" />
            </div>

            <div className="mt-8">
              <Link
                href="/liquidity"
                className="inline-flex items-center text-sm font-semibold text-brand-primary hover:gap-3 gap-2 transition-all"
              >
                詳細レポートへ <span>→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* ========== ECONOMIC SECTION ========== */}
        <section className="py-24 border-b border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-sm font-bold text-brand-primary-700 uppercase tracking-[0.22em] font-mono mb-4">
              SECTION 02 · ECONOMY
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
              米国景気リスク評価モニター
            </h2>
            <p className="mt-4 text-base text-slate-600 max-w-2xl leading-relaxed">
              雇用・消費・構造の 3 軸を 100 点満点で評価. スコアが高いほど景気悪化リスクが高い.
            </p>

            <div className="mt-12 grid md:grid-cols-12 gap-6">
              <div className="md:col-span-5 rounded-2xl border border-slate-200 bg-white p-8">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono mb-4">
                  TOTAL SCORE
                </div>
                <div className="flex items-baseline gap-2">
                  <div className="text-7xl font-bold text-slate-900 tabular-nums leading-none">
                    {MOCK_ECONOMIC.total_score}
                  </div>
                  <div className="text-2xl text-slate-400 font-semibold">/100</div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${pc.dot}`} />
                  <span className={`text-sm font-semibold ${pc.text}`}>{MOCK_ECONOMIC.phase.label}</span>
                </div>
                <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                  {MOCK_ECONOMIC.phase.description}
                </p>
              </div>

              <div className="md:col-span-7 grid grid-cols-1 gap-3">
                {MOCK_ECONOMIC.categories.map((cat) => {
                  const pct = Math.round((cat.score / cat.max_score) * 100);
                  return (
                    <div key={cat.name} className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="flex items-baseline justify-between mb-2">
                        <div>
                          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
                            CATEGORY
                          </div>
                          <div className="text-base font-semibold text-slate-900">{cat.name}</div>
                        </div>
                        <div className="text-right">
                          <span className="text-3xl font-bold text-slate-900 tabular-nums">{cat.score}</span>
                          <span className="text-sm text-slate-400 ml-1">/{cat.max_score}</span>
                        </div>
                      </div>
                      <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-brand-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {MOCK_ECONOMIC.alert_factors.length > 0 && (
              <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
                <div className="text-xs font-bold text-amber-700 uppercase tracking-wider font-mono mb-3">
                  ALERT FACTORS
                </div>
                <ul className="space-y-2">
                  {MOCK_ECONOMIC.alert_factors.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-8">
              <Link
                href="/employment"
                className="inline-flex items-center text-sm font-semibold text-brand-primary hover:gap-3 gap-2 transition-all"
              >
                詳細レポートへ <span>→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* ========== MATRIX SECTION ========== */}
        <section className="py-24 border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-sm font-bold text-brand-primary-700 uppercase tracking-[0.22em] font-mono mb-4">
              SECTION 03 · POSITION
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
              投資判断マトリクス
            </h2>
            <p className="mt-4 text-base text-slate-600 max-w-2xl leading-relaxed">
              流動性 State (行) × 景気 Phase (列) の交点が, 現在の推奨ポジションです.
            </p>

            <div className="mt-12 rounded-3xl border border-slate-200 bg-slate-50 p-6 md:p-10 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="text-left py-3 px-2 text-slate-400 font-mono uppercase tracking-wider w-32">流動性 ↓</th>
                    {PHASE_LABELS.map((p, i) => (
                      <th
                        key={i}
                        className={`text-center py-3 px-2 font-mono uppercase tracking-wider ${
                          i === currentCol ? 'text-brand-primary font-bold' : 'text-slate-400'
                        }`}
                      >
                        {p}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STATE_LABELS.map((s, row) => (
                    <tr key={row}>
                      <td
                        className={`py-2 px-2 font-mono ${
                          row === currentRow ? 'text-brand-primary font-bold' : 'text-slate-500'
                        }`}
                      >
                        {s}
                      </td>
                      {MATRIX_DATA[row].map((advice, col) => {
                        const isActive = row === currentRow && col === currentCol;
                        const cellColor = statusClasses(MATRIX_COLORS[row][col]);
                        return (
                          <td key={col} className="py-1.5 px-1">
                            <div
                              className={`rounded-xl px-2 py-3 text-center text-[11px] font-semibold ${cellColor.soft} ${cellColor.text} ${
                                isActive ? 'ring-2 ring-brand-primary shadow-md scale-105 font-bold' : ''
                              }`}
                            >
                              {advice}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-slate-500 text-center font-mono">
              青枠 = 現在のポジション
            </p>
          </div>
        </section>

        {/* ========== INSIGHTS SECTION ========== */}
        <section className="py-24 border-b border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-sm font-bold text-brand-primary-700 uppercase tracking-[0.22em] font-mono mb-4">
              SECTION 04 · INSIGHTS
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
              いま注目すべきこと
            </h2>

            <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {cards.map((c, i) => {
                const cc = statusClasses(c.color);
                return (
                  <div key={i} className="rounded-2xl border border-slate-200 bg-white p-6">
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`h-2 w-2 rounded-full ${cc.dot}`} />
                      <h3 className={`text-sm font-bold ${cc.text}`}>{c.title}</h3>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{c.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ========== NAV CARDS (landing core features 風) ========== */}
        <section className="py-24 bg-white">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-16">
              <div className="text-sm font-bold text-brand-primary-700 uppercase tracking-[0.22em] font-mono">
                EXPLORE
              </div>
              <h2 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
                詳細分析画面
              </h2>
            </div>
            <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-5">
              <NavCard href="/liquidity" icon={<Droplets className="h-5 w-5" />} title="米国金融流動性" sub="3 層ストレス分析" />
              <NavCard href="/employment" icon={<ShieldAlert className="h-5 w-5" />} title="米国景気リスク" sub="100 点満点スコア" />
              <NavCard href="/signals" icon={<LineChart className="h-5 w-5" />} title="銘柄分析" sub="エントリー判定" />
              <NavCard href="/holdings" icon={<Briefcase className="h-5 w-5" />} title="ポートフォリオ" sub="保有・取引管理" />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

/* ───────── Sub components ───────── */

function VariantSwitcher({ current }: { current: 'a' | 'b' | 'c' | 'd' | 'e' }) {
  return (
    <div className="sticky top-16 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200">
      <div className="mx-auto max-w-6xl px-6 py-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono mr-2">
          PREVIEW
        </span>
        {VARIANT_LINKS.map((v) => (
          <Link
            key={v.key}
            href={v.href}
            className={`text-xs font-semibold rounded-full px-3 py-1.5 transition-colors ${
              v.key === current
                ? 'bg-brand-primary text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {v.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function BadgeBlock({
  eyebrow,
  label,
  colorClass,
  dotClass,
}: {
  eyebrow: string;
  label: string;
  colorClass: string;
  dotClass: string;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 font-mono mb-2">
        {eyebrow}
      </div>
      <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 ${colorClass}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        <span className="text-sm font-semibold">{label}</span>
      </div>
    </div>
  );
}

function BigMetric({
  label,
  eyebrow,
  score,
  note,
}: {
  label: string;
  eyebrow: string;
  score: number;
  note: string;
}) {
  // 0-30 安全 / 31-60 中立 / 61-100 警戒
  const color: 'green' | 'yellow' | 'orange' = score >= 60 ? 'orange' : score >= 31 ? 'yellow' : 'green';
  const c = statusClasses(color);
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-7">
      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
        {eyebrow}
      </div>
      <div className="mt-2 text-base font-semibold text-slate-900">{label}</div>
      <div className="mt-6 flex items-baseline gap-2">
        <div className="text-6xl font-bold text-slate-900 tabular-nums leading-none">{score}</div>
        <div className="text-sm text-slate-400">/100</div>
      </div>
      <div className="mt-4 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${c.dot}`} style={{ width: `${score}%` }} />
      </div>
      <div className={`mt-4 inline-flex items-center gap-1.5 text-xs font-semibold ${c.text}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
        {note}
      </div>
    </div>
  );
}

function NavCard({
  href,
  icon,
  title,
  sub,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-3xl border border-slate-200 bg-white p-6 hover:border-brand-primary/40 hover:shadow-lg transition-all"
    >
      <div className="inline-flex items-center justify-center h-10 w-10 rounded-xl bg-brand-primary/5 text-brand-primary mb-4">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-900 group-hover:text-brand-primary transition-colors">
        {title}
      </h3>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </Link>
  );
}
