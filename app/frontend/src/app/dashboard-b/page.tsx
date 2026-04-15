import type { Metadata } from "next";
import Link from "next/link";
import { Droplets, ShieldAlert, LineChart, Briefcase, ArrowRight, AlertTriangle } from "lucide-react";
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
  title: "案 B: 1 画面ボード (refined) — Dashboard preview",
};

export default function DashboardBPage() {
  const stateCode = MOCK_PLUMBING.market_state!.code;
  const phaseCode = MOCK_ECONOMIC.phase.code;
  const insight = getIntegratedInsight(stateCode, phaseCode);
  const ic = statusClasses(insight.color);
  const stateColor = MOCK_PLUMBING.market_state!.color as 'green' | 'cyan' | 'yellow' | 'orange' | 'red';
  const phaseColor = MOCK_ECONOMIC.phase.color as 'green' | 'cyan' | 'yellow' | 'orange' | 'red';
  const cards = getInsightCards();
  const currentRow = stateToRow(stateCode);
  const currentCol = phaseToCol(phaseCode);
  const currentAdvice = MATRIX_DATA[currentRow][currentCol];
  const adviceColor = statusClasses(MATRIX_COLORS[currentRow][currentCol]);

  const l1 = MOCK_PLUMBING.layers.layer1!.stress_score;
  const l2a = MOCK_PLUMBING.layers.layer2a!.stress_score;
  const l2b = MOCK_PLUMBING.layers.layer2b!.stress_score;

  return (
    <div data-theme="landing" className="light min-h-screen bg-slate-50">
      <VariantSwitcher current="b" />

      <div className="mx-auto max-w-[1800px] px-6 py-6 space-y-4">
        {/* ========== HEADER ========== */}
        <div className="flex items-end justify-between">
          <div className="flex items-center gap-3">
            <div className="w-1 h-7 rounded-full bg-gradient-to-b from-brand-primary to-brand-accent" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 font-mono">
                INTEGRATED DASHBOARD · 2026.04.09
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                統合分析ダッシュボード
              </h1>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 font-mono">
            LAST UPDATE 17:30 JST
          </div>
        </div>

        {/* ========== HERO VERDICT CARD (full width with glow) ========== */}
        <div className={`relative rounded-2xl border ${ic.border} ${ic.bg} overflow-hidden`}>
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none opacity-60"
            style={{
              background: `radial-gradient(ellipse 70% 80% at 20% 50%, var(--lp-bg-glow), transparent 70%)`,
            }}
          />
          <div
            aria-hidden
            className="absolute -top-20 -right-20 w-64 h-64 rounded-full opacity-30 blur-3xl"
            style={{ background: glowColor(insight.color) }}
          />
          <div className="relative px-6 py-6 grid md:grid-cols-12 gap-6 items-center">
            <div className="md:col-span-7">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] font-mono mb-2">
                INTEGRATED ANALYSIS
              </div>
              <h2 className={`text-2xl md:text-3xl font-semibold tracking-tight ${ic.text}`}>
                {insight.main}
              </h2>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed max-w-lg">
                {insight.sub}
              </p>
            </div>
            <div className="md:col-span-5 grid grid-cols-2 gap-3">
              <PillarBadge eyebrow="LIQUIDITY" label={MOCK_PLUMBING.market_state!.label} color={stateColor} />
              <PillarBadge eyebrow="ECONOMY" label={MOCK_ECONOMIC.phase.label} color={phaseColor} />
              <div className={`col-span-2 rounded-xl border bg-white px-4 py-3 ${adviceColor.border}`}>
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                  ACTION
                </div>
                <div className={`mt-0.5 text-base font-bold ${adviceColor.text}`}>{currentAdvice}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ========== MIDDLE: 2 columns ========== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ===== Liquidity card ===== */}
          <div className="relative rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-brand-primary/60 via-brand-primary/20 to-transparent" />
            <div className="px-6 pt-5 pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] font-bold text-brand-primary-700 uppercase tracking-[0.2em] font-mono">
                    PLUMBING SYSTEM
                  </div>
                  <div className="mt-1 text-base font-semibold text-slate-900">米国金融流動性モニター</div>
                  <div className="mt-0.5 text-xs text-slate-500">3 層ストレス分析</div>
                </div>
                <Badge color={stateColor} label={MOCK_PLUMBING.market_state!.label} />
              </div>
            </div>

            <div className="px-6 pb-5">
              <div className="grid grid-cols-3 gap-4 mt-2">
                <RingStat label="L1 政策" sub="FRB BS" score={l1} />
                <RingStat label="L2A 銀行" sub="KRE/SRF" score={l2a} />
                <RingStat label="L2B 市場" sub="MARGIN" score={l2b} />
              </div>

              {/* Events */}
              <div className="mt-5 pt-4 border-t border-slate-100">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono mb-2">
                  EVENTS
                </div>
                <div className="space-y-1.5">
                  {[
                    { label: 'IG クレジットスプレッド拡大', sev: 'WARNING', color: 'yellow' as const },
                    { label: 'FRB QT 継続', sev: 'ALERT', color: 'orange' as const },
                  ].map((ev, i) => {
                    const c = statusClasses(ev.color);
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
                        <span className="text-xs text-slate-600 flex-1">{ev.label}</span>
                        <span className={`text-[9px] font-mono font-bold ${c.text}`}>{ev.sev}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4">
                <Link href="/liquidity" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-primary hover:gap-2 transition-all">
                  詳細を見る <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>

          {/* ===== Economic card ===== */}
          <div className="relative rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-emerald-500/60 via-emerald-500/20 to-transparent" />
            <div className="px-6 pt-5 pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-[0.2em] font-mono">
                    ECONOMIC ALERT
                  </div>
                  <div className="mt-1 text-base font-semibold text-slate-900">米国景気リスク評価モニター</div>
                  <div className="mt-0.5 text-xs text-slate-500">雇用・消費・構造の 3 軸</div>
                </div>
                <Badge color={phaseColor} label={MOCK_ECONOMIC.phase.label} />
              </div>
            </div>

            <div className="px-6 pb-5">
              <div className="flex items-center gap-6 mt-2">
                {/* Big total ring */}
                <div className="shrink-0">
                  <ScoreRing score={MOCK_ECONOMIC.total_score} size={80} strokeWidth={6} />
                  <div className="text-[10px] font-mono text-slate-400 text-center mt-1 uppercase tracking-wider">
                    TOTAL
                  </div>
                </div>

                {/* 3 category rings */}
                <div className="grid grid-cols-3 gap-4 flex-1">
                  {MOCK_ECONOMIC.categories.map((cat) => {
                    const pct = Math.round((cat.score / cat.max_score) * 100);
                    return (
                      <div key={cat.name} className="text-center">
                        <ScoreRing score={pct} size={48} strokeWidth={4} />
                        <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider mt-1">
                          {cat.name}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">{cat.score}/{cat.max_score}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Alert factors */}
              <div className="mt-5 pt-4 border-t border-slate-100">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" />
                  ALERT FACTORS
                </div>
                <div className="space-y-1.5">
                  {MOCK_ECONOMIC.alert_factors.slice(0, 2).map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" />
                      <span className="text-xs text-slate-600">{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <Link href="/employment" className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:gap-2 transition-all">
                  詳細を見る <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* ========== MATRIX (full width) ========== */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-1 h-6 rounded-full bg-gradient-to-b from-purple-500/60 to-transparent" />
              <div>
                <div className="text-[10px] font-bold text-purple-700 uppercase tracking-[0.2em] font-mono">
                  STATE × PHASE MATRIX
                </div>
                <div className="text-base font-semibold text-slate-900">投資判断マトリクス</div>
              </div>
            </div>
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${adviceColor.bg} ${adviceColor.border}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${adviceColor.dot}`} />
              <span className={`text-xs font-bold ${adviceColor.text}`}>
                NOW · {STATE_LABELS[currentRow]} × {PHASE_LABELS[currentCol]} → {currentAdvice}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  <th className="text-left py-2 px-2 text-slate-400 font-mono uppercase tracking-wider w-28">流動性 ↓</th>
                  {PHASE_LABELS.map((p, i) => (
                    <th
                      key={i}
                      className={`text-center py-2 px-1 font-mono uppercase tracking-wider ${
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
                      className={`py-1.5 px-2 font-mono ${
                        row === currentRow ? 'text-brand-primary font-bold' : 'text-slate-500'
                      }`}
                    >
                      {s}
                    </td>
                    {MATRIX_DATA[row].map((advice, col) => {
                      const isActive = row === currentRow && col === currentCol;
                      const cellColor = statusClasses(MATRIX_COLORS[row][col]);
                      return (
                        <td key={col} className="py-1 px-1">
                          <div
                            className={`rounded-lg px-1.5 py-2 text-center text-[10px] font-medium ${cellColor.soft} ${cellColor.text} ${
                              isActive ? 'ring-2 ring-brand-primary shadow-[0_0_18px_rgba(52,96,251,0.35)] scale-[1.04] font-bold' : ''
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

        {/* ========== BOTTOM: insights + nav ========== */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Insights (2/3 width) */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1 h-6 rounded-full bg-gradient-to-b from-amber-500/60 to-transparent" />
              <div>
                <div className="text-[10px] font-bold text-amber-700 uppercase tracking-[0.2em] font-mono">
                  INSIGHTS · {cards.length} 件
                </div>
                <div className="text-base font-semibold text-slate-900">いま注目すべきこと</div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {cards.map((c, i) => {
                const cc = statusClasses(c.color);
                return (
                  <div key={i} className={`rounded-xl border ${cc.border} ${cc.bg} p-3.5`}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${cc.dot}`} />
                      <div className={`text-xs font-bold ${cc.text}`}>{c.title}</div>
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-600 leading-relaxed">{c.description}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Nav (1/3 width) */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1 h-6 rounded-full bg-gradient-to-b from-cyan-500/60 to-transparent" />
              <div>
                <div className="text-[10px] font-bold text-cyan-700 uppercase tracking-[0.2em] font-mono">
                  NAVIGATION
                </div>
                <div className="text-base font-semibold text-slate-900">分析画面</div>
              </div>
            </div>
            <div className="space-y-1">
              <NavRow href="/liquidity" icon={<Droplets className="h-4 w-4" />} label="米国金融流動性" sub="3 層ストレス" />
              <NavRow href="/employment" icon={<ShieldAlert className="h-4 w-4" />} label="米国景気リスク" sub="100 点満点" />
              <NavRow href="/signals" icon={<LineChart className="h-4 w-4" />} label="銘柄分析" sub="エントリー判定" />
              <NavRow href="/holdings" icon={<Briefcase className="h-4 w-4" />} label="ポートフォリオ" sub="保有・取引" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────── Sub components ───────── */

function VariantSwitcher({ current }: { current: 'a' | 'b' | 'c' | 'd' | 'e' }) {
  return (
    <div className="sticky top-16 z-40 bg-white/90 backdrop-blur-md border-b border-slate-200">
      <div className="mx-auto max-w-[1800px] px-6 py-3 flex flex-wrap items-center gap-2">
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

function PillarBadge({
  eyebrow,
  label,
  color,
}: {
  eyebrow: string;
  label: string;
  color: 'green' | 'cyan' | 'yellow' | 'orange' | 'red';
}) {
  const c = statusClasses(color);
  return (
    <div className={`rounded-xl border bg-white px-4 py-3 ${c.border}`}>
      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider font-mono">
        {eyebrow}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
        <span className={`text-base font-bold ${c.text}`}>{label}</span>
      </div>
    </div>
  );
}

function Badge({
  label,
  color,
}: {
  label: string;
  color: 'green' | 'cyan' | 'yellow' | 'orange' | 'red';
}) {
  const c = statusClasses(color);
  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${c.bg} ${c.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      <span className={`text-[11px] font-semibold ${c.text}`}>{label}</span>
    </div>
  );
}

/** SVG ScoreRing — slate background + score-color foreground */
function ScoreRing({ score, size = 64, strokeWidth = 5 }: { score: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const color = score >= 60 ? '#f97316' : score >= 31 ? '#eab308' : '#10b981';
  const center = size / 2;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={center} cy={center} r={radius} stroke="#e2e8f0" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-base font-bold tabular-nums" style={{ color }}>
          {score}
        </span>
      </div>
    </div>
  );
}

function RingStat({ label, sub, score }: { label: string; sub: string; score: number }) {
  return (
    <div className="text-center">
      <ScoreRing score={score} size={64} strokeWidth={5} />
      <div className="mt-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">
        {label}
      </div>
      <div className="text-[9px] text-slate-400 font-mono">{sub}</div>
    </div>
  );
}

function NavRow({ href, icon, label, sub }: { href: string; icon: React.ReactNode; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition-colors group"
    >
      <span className="text-slate-400 group-hover:text-brand-primary transition-colors shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-primary transition-colors">
          {label}
        </div>
        <div className="text-[10px] text-slate-400 font-mono">{sub}</div>
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-brand-primary group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}

function glowColor(c: 'green' | 'cyan' | 'yellow' | 'orange' | 'red') {
  const map = {
    green: '#10b981',
    cyan: '#06b6d4',
    yellow: '#eab308',
    orange: '#f97316',
    red: '#ef4444',
  };
  return map[c];
}
