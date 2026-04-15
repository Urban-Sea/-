import type { Metadata } from "next";
import Link from "next/link";
import { Droplets, ShieldAlert, LineChart, Briefcase } from "lucide-react";
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
  title: "案 C: ストーリー — Dashboard preview",
};

export default function DashboardCPage() {
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
    <div data-theme="landing" className="light min-h-screen">
      <VariantSwitcher current="c" />

      <main>
        {/* ========== Q1: 今リスクを取るべき? ========== */}
        <section className="py-24 md:py-32">
          <div className="mx-auto max-w-3xl px-6">
            <div className="text-sm font-bold text-slate-400 uppercase tracking-[0.22em] font-mono mb-3">
              QUESTION 01
            </div>
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-slate-900 leading-tight">
              今, リスクを取るべきか?
            </h1>

            <div className="mt-12 border-l-4 border-brand-primary pl-6">
              <div className="text-xs font-bold text-brand-primary uppercase tracking-wider font-mono mb-2">
                A. ANSWER
              </div>
              <p className={`text-3xl md:text-4xl font-semibold tracking-tight leading-snug ${ic.text}`}>
                {insight.main}.
              </p>
              <p className="mt-4 text-lg text-slate-600 leading-relaxed">
                {insight.sub}.
              </p>
            </div>
          </div>
        </section>

        {/* ========== Q2: なぜ流動性が ========== */}
        <section className="py-24 border-t border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-3xl px-6">
            <div className="text-sm font-bold text-slate-400 uppercase tracking-[0.22em] font-mono mb-3">
              QUESTION 02
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 leading-tight">
              なぜ流動性は{MOCK_PLUMBING.market_state!.label}と判定?
            </h2>

            <p className="mt-6 text-base text-slate-600 leading-relaxed">
              米国金融市場の流動性は <strong className="text-slate-900">3 つのレイヤー</strong>で評価しています.
              現在の各層の状態は次の通りです.
            </p>

            <div className="mt-10 space-y-5">
              <ReasonRow
                num="L1"
                title="政策流動性 (FRB バランスシート)"
                score={l1}
                detail="FRB が QT を継続中. 準備預金が緩やかに減少し, 政策流動性が縮小しています."
                verdict="WARNING"
              />
              <ReasonRow
                num="L2A"
                title="銀行システム"
                score={l2a}
                detail="銀行セクターの準備預金, KRE, SRF 利用は健全. ストレスは検出されていません."
                verdict="HEALTHY"
              />
              <ReasonRow
                num="L2B"
                title="市場レバレッジ (マージンデット)"
                score={l2b}
                detail="マージンデットの 2 年変化率がやや高め. 過熱感ではないが注視が必要."
                verdict="ELEVATED"
              />
            </div>

            <div className={`mt-10 rounded-2xl border p-6 ${sc.bg} ${sc.border}`}>
              <div className="text-xs font-bold uppercase tracking-wider font-mono mb-2 text-slate-500">
                CONCLUSION
              </div>
              <p className={`text-lg font-semibold ${sc.text}`}>
                → 流動性は「{MOCK_PLUMBING.market_state!.label}」状態です.
              </p>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                {MOCK_PLUMBING.market_state!.comment}
              </p>
            </div>
          </div>
        </section>

        {/* ========== Q3: なぜ景気が ========== */}
        <section className="py-24 border-t border-slate-200">
          <div className="mx-auto max-w-3xl px-6">
            <div className="text-sm font-bold text-slate-400 uppercase tracking-[0.22em] font-mono mb-3">
              QUESTION 03
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 leading-tight">
              なぜ景気は{MOCK_ECONOMIC.phase.label}と判定?
            </h2>

            <p className="mt-6 text-base text-slate-600 leading-relaxed">
              景気は <strong className="text-slate-900">100 点満点</strong>のスコアで評価しています.
              スコアが高いほど景気悪化リスクが高いことを意味します. 現在のスコアは:
            </p>

            <div className="mt-10 flex items-baseline gap-3">
              <div className={`text-7xl font-bold tabular-nums leading-none ${pc.text}`}>
                {MOCK_ECONOMIC.total_score}
              </div>
              <div className="text-2xl text-slate-400">/100</div>
              <div className={`ml-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 ${pc.bg} ${pc.border}`}>
                <span className={`h-2 w-2 rounded-full ${pc.dot}`} />
                <span className={`text-sm font-bold ${pc.text}`}>{MOCK_ECONOMIC.phase.label}</span>
              </div>
            </div>

            <div className="mt-10 space-y-4">
              {MOCK_ECONOMIC.categories.map((cat) => {
                const pct = Math.round((cat.score / cat.max_score) * 100);
                return (
                  <div key={cat.name} className="border-t border-slate-200 pt-4">
                    <div className="flex items-baseline justify-between mb-2">
                      <div className="text-base font-semibold text-slate-900">{cat.name}</div>
                      <div className="text-sm font-mono text-slate-500">
                        <span className="text-xl font-bold text-slate-900">{cat.score}</span>
                        <span className="text-slate-400"> / {cat.max_score}</span>
                      </div>
                    </div>
                    <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-brand-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-10 border-l-4 border-amber-400 pl-6">
              <div className="text-xs font-bold text-amber-700 uppercase tracking-wider font-mono mb-2">
                ALERT FACTORS
              </div>
              <ul className="space-y-2">
                {MOCK_ECONOMIC.alert_factors.map((f, i) => (
                  <li key={i} className="text-base text-slate-700 leading-relaxed">
                    — {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ========== Q4: じゃあ何をすべき ========== */}
        <section className="py-24 border-t border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-3xl px-6">
            <div className="text-sm font-bold text-slate-400 uppercase tracking-[0.22em] font-mono mb-3">
              QUESTION 04
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 leading-tight">
              じゃあ, 今は何をすべき?
            </h2>

            <p className="mt-6 text-base text-slate-600 leading-relaxed">
              <strong className="text-slate-900">{STATE_LABELS[currentRow]}</strong>(流動性) ×{' '}
              <strong className="text-slate-900">{PHASE_LABELS[currentCol]}</strong>(景気) の交点が,
              今日の推奨アクションです.
            </p>

            <div className={`mt-10 rounded-3xl border-2 p-10 text-center ${adviceColor.bg} ${adviceColor.border}`}>
              <div className="text-xs font-bold uppercase tracking-wider font-mono text-slate-500 mb-3">
                RECOMMENDED ACTION
              </div>
              <div className={`text-5xl md:text-6xl font-bold tracking-tight ${adviceColor.text}`}>
                {currentAdvice}
              </div>
            </div>

            {/* マトリクス・周辺セルだけ表示 */}
            <div className="mt-10">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono mb-4">
                CONTEXT · 周辺の状態
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-6">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left py-2 px-2 text-slate-300 font-mono uppercase tracking-wider w-28"></th>
                      {PHASE_LABELS.map((p, i) => (
                        <th
                          key={i}
                          className={`text-center py-2 px-1 font-mono uppercase tracking-wider ${
                            i === currentCol ? 'text-brand-primary font-bold' : 'text-slate-300'
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
                          className={`py-1.5 px-2 font-mono ${
                            row === currentRow ? 'text-brand-primary font-bold' : 'text-slate-300'
                          }`}
                        >
                          {s}
                        </td>
                        {MATRIX_DATA[row].map((advice, col) => {
                          const isActive = row === currentRow && col === currentCol;
                          const cellColor = statusClasses(MATRIX_COLORS[row][col]);
                          // 現在位置の周辺だけ強調, それ以外は薄く
                          const dim = !isActive;
                          return (
                            <td key={col} className="py-1 px-1">
                              <div
                                className={`rounded-lg px-1.5 py-1.5 text-center text-[10px] font-medium ${
                                  isActive
                                    ? `${cellColor.soft} ${cellColor.text} ring-2 ring-brand-primary scale-105 font-bold`
                                    : dim
                                      ? 'text-slate-300 bg-slate-50/30'
                                      : ''
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
            </div>
          </div>
        </section>

        {/* ========== Q5: 他に注意 ========== */}
        <section className="py-24 border-t border-slate-200">
          <div className="mx-auto max-w-3xl px-6">
            <div className="text-sm font-bold text-slate-400 uppercase tracking-[0.22em] font-mono mb-3">
              QUESTION 05
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 leading-tight">
              他に注意すべきことは?
            </h2>
            <p className="mt-6 text-base text-slate-600 leading-relaxed">
              現在検出されているシグナルは {cards.length} 件です.
            </p>

            <div className="mt-10 space-y-4">
              {cards.map((c, i) => {
                const cc = statusClasses(c.color);
                return (
                  <div key={i} className="border-t border-slate-200 pt-4">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${cc.dot}`} />
                      <h3 className={`text-base font-semibold ${cc.text}`}>{c.title}</h3>
                    </div>
                    <p className="mt-2 text-sm text-slate-600 leading-relaxed pl-4">{c.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ========== CTA / NAV ========== */}
        <section className="py-24 border-t border-slate-200 bg-slate-900">
          <div className="mx-auto max-w-3xl px-6 text-center">
            <div className="text-sm font-bold text-brand-accent uppercase tracking-[0.3em] font-mono mb-6">
              EXPLORE FURTHER
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-white">
              さらに詳しく見る
            </h2>
            <div className="mt-10 grid sm:grid-cols-2 gap-4">
              <DarkNavCard href="/liquidity" icon={<Droplets className="h-5 w-5" />} title="米国金融流動性" />
              <DarkNavCard href="/employment" icon={<ShieldAlert className="h-5 w-5" />} title="米国景気リスク" />
              <DarkNavCard href="/signals" icon={<LineChart className="h-5 w-5" />} title="銘柄分析" />
              <DarkNavCard href="/holdings" icon={<Briefcase className="h-5 w-5" />} title="ポートフォリオ" />
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

function ReasonRow({
  num,
  title,
  score,
  detail,
  verdict,
}: {
  num: string;
  title: string;
  score: number;
  detail: string;
  verdict: 'HEALTHY' | 'ELEVATED' | 'WARNING' | 'CRITICAL';
}) {
  const verdictColor: Record<string, 'green' | 'yellow' | 'orange' | 'red'> = {
    HEALTHY: 'green',
    ELEVATED: 'yellow',
    WARNING: 'orange',
    CRITICAL: 'red',
  };
  const c = statusClasses(verdictColor[verdict]);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-start gap-5">
        <div className="text-sm font-bold text-slate-400 font-mono tabular-nums w-10 shrink-0">
          {num}
        </div>
        <div className="flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-slate-900 tabular-nums">{score}</span>
              <span className="text-xs text-slate-400">/100</span>
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">{detail}</p>
          <div className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${c.bg} ${c.border} border`}>
            <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
            <span className={`text-[10px] font-bold uppercase tracking-wider ${c.text} font-mono`}>
              {verdict}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DarkNavCard({
  href,
  icon,
  title,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-5 hover:border-brand-accent/50 hover:bg-white/10 transition-all flex items-center gap-3 text-left"
    >
      <span className="text-brand-accent">{icon}</span>
      <span className="text-base font-semibold text-white flex-1">{title}</span>
      <span className="text-white/40 group-hover:text-brand-accent transition-colors">→</span>
    </Link>
  );
}
