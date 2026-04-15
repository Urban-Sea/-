import type { Metadata } from "next";
import Link from "next/link";
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
  title: "案 D: ミニマル — Dashboard preview",
};

export default function DashboardDPage() {
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
  const currentAdvice = MATRIX_DATA[currentRow][currentCol];
  const adviceColor = statusClasses(MATRIX_COLORS[currentRow][currentCol]);

  const l1 = MOCK_PLUMBING.layers.layer1!.stress_score;
  const l2a = MOCK_PLUMBING.layers.layer2a!.stress_score;
  const l2b = MOCK_PLUMBING.layers.layer2b!.stress_score;

  return (
    <div data-theme="landing" className="light min-h-screen bg-white">
      <VariantSwitcher current="d" />

      <main>
        {/* ========== HERO: 巨大インサイト ========== */}
        <section className="min-h-[80vh] flex items-center">
          <div className="mx-auto max-w-5xl px-6 w-full">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-[0.3em] font-mono mb-8">
              2026.04.09
            </div>

            <h1 className={`text-6xl md:text-8xl lg:text-9xl font-semibold tracking-tight leading-[0.95] ${ic.text}`}>
              {insight.main}.
            </h1>

            <p className="mt-12 text-xl md:text-2xl text-slate-500 max-w-2xl leading-relaxed">
              {insight.sub}.
            </p>

            <div className="mt-16 flex flex-wrap gap-12 items-baseline">
              <MetricBig label="LIQUIDITY" value={MOCK_PLUMBING.market_state!.label} color={sc} />
              <MetricBig label="ECONOMY" value={MOCK_ECONOMIC.phase.label} color={pc} />
              <MetricBig label="ACTION" value={currentAdvice} color={adviceColor} />
            </div>
          </div>
        </section>

        {/* ========== セパレータ ========== */}
        <div className="mx-auto max-w-5xl px-6">
          <div className="border-t border-slate-100" />
        </div>

        {/* ========== 詳細: 流動性 ========== */}
        <section className="py-32">
          <div className="mx-auto max-w-5xl px-6">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-[0.3em] font-mono mb-12">
              01 — LIQUIDITY
            </div>

            <div className="grid md:grid-cols-3 gap-12">
              <NumberBlock label="L1 政策" score={l1} sub="FRB BS" />
              <NumberBlock label="L2A 銀行" score={l2a} sub="KRE/SRF" />
              <NumberBlock label="L2B 市場" score={l2b} sub="MARGIN" />
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-5xl px-6">
          <div className="border-t border-slate-100" />
        </div>

        {/* ========== 詳細: 景気 ========== */}
        <section className="py-32">
          <div className="mx-auto max-w-5xl px-6">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-[0.3em] font-mono mb-12">
              02 — ECONOMY
            </div>

            <div className="flex items-baseline gap-4 mb-16">
              <div className={`text-9xl font-bold tabular-nums leading-none ${pc.text}`}>
                {MOCK_ECONOMIC.total_score}
              </div>
              <div className="text-3xl text-slate-300">/ 100</div>
            </div>

            <div className="grid md:grid-cols-3 gap-12">
              {MOCK_ECONOMIC.categories.map((cat) => (
                <NumberBlock
                  key={cat.name}
                  label={cat.name}
                  score={cat.score}
                  max={cat.max_score}
                  sub={`${Math.round((cat.score / cat.max_score) * 100)}%`}
                />
              ))}
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-5xl px-6">
          <div className="border-t border-slate-100" />
        </div>

        {/* ========== マトリクス heat map ========== */}
        <section className="py-32">
          <div className="mx-auto max-w-5xl px-6">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-[0.3em] font-mono mb-12">
              03 — POSITION
            </div>

            <div className="grid md:grid-cols-12 gap-12 items-start">
              <div className="md:col-span-5">
                <div className="text-sm text-slate-400 font-mono mb-2">
                  {STATE_LABELS[currentRow]} × {PHASE_LABELS[currentCol]}
                </div>
                <div className={`text-5xl md:text-6xl font-semibold tracking-tight leading-tight ${adviceColor.text}`}>
                  {currentAdvice}
                </div>
              </div>

              {/* heat map */}
              <div className="md:col-span-7">
                <div className="grid grid-cols-5 gap-1.5">
                  {MATRIX_DATA.map((row, ri) =>
                    row.map((advice, ci) => {
                      const isActive = ri === currentRow && ci === currentCol;
                      const cellColor = statusClasses(MATRIX_COLORS[ri][ci]);
                      return (
                        <div
                          key={`${ri}-${ci}`}
                          className={`aspect-square rounded ${cellColor.dot} ${
                            isActive ? 'ring-2 ring-slate-900 ring-offset-2 scale-110' : 'opacity-30'
                          } transition-all`}
                          title={advice}
                        />
                      );
                    })
                  )}
                </div>
                <div className="mt-3 flex justify-between text-[10px] font-mono text-slate-300 uppercase tracking-wider">
                  <span>← 拡大</span>
                  <span>危機 →</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-5xl px-6">
          <div className="border-t border-slate-100" />
        </div>

        {/* ========== インサイト リスト ========== */}
        <section className="py-32">
          <div className="mx-auto max-w-5xl px-6">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-[0.3em] font-mono mb-12">
              04 — INSIGHTS · {cards.length}
            </div>

            <div className="space-y-6">
              {cards.map((c, i) => {
                const cc = statusClasses(c.color);
                return (
                  <div key={i} className="flex items-start gap-6 border-t border-slate-100 pt-6">
                    <div className="text-xs font-mono font-bold text-slate-300 tabular-nums w-8 shrink-0 mt-1">
                      0{i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${cc.dot}`} />
                        <h3 className={`text-lg font-semibold ${cc.text}`}>{c.title}</h3>
                      </div>
                      <p className="mt-1 text-sm text-slate-500 leading-relaxed">{c.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-5xl px-6">
          <div className="border-t border-slate-100" />
        </div>

        {/* ========== Nav ========== */}
        <section className="py-32">
          <div className="mx-auto max-w-5xl px-6">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-[0.3em] font-mono mb-12">
              05 — EXPLORE
            </div>
            <div className="space-y-3">
              {[
                { href: '/liquidity', label: '米国金融流動性' },
                { href: '/employment', label: '米国景気リスク' },
                { href: '/signals', label: '銘柄分析' },
                { href: '/holdings', label: 'ポートフォリオ' },
              ].map((p) => (
                <Link
                  key={p.href}
                  href={p.href}
                  className="block py-3 border-t border-slate-100 text-2xl font-semibold tracking-tight text-slate-900 hover:text-brand-primary transition-colors group"
                >
                  <span className="inline-block group-hover:translate-x-2 transition-transform">
                    {p.label} →
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <div className="h-32" />
      </main>
    </div>
  );
}

/* ───────── Sub components ───────── */

function VariantSwitcher({ current }: { current: 'a' | 'b' | 'c' | 'd' | 'e' }) {
  return (
    <div className="sticky top-16 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200">
      <div className="mx-auto max-w-5xl px-6 py-3 flex flex-wrap items-center gap-2">
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

function MetricBig({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: ReturnType<typeof statusClasses>;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300 font-mono mb-2">
        {label}
      </div>
      <div className={`text-2xl md:text-3xl font-semibold ${color.text}`}>{value}</div>
    </div>
  );
}

function NumberBlock({
  label,
  score,
  max = 100,
  sub,
}: {
  label: string;
  score: number;
  max?: number;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono mb-3">
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-7xl font-bold text-slate-900 tabular-nums leading-none">{score}</span>
        <span className="text-xl text-slate-300">/ {max}</span>
      </div>
      {sub && <div className="mt-3 text-xs text-slate-400 font-mono uppercase tracking-wider">{sub}</div>}
    </div>
  );
}
