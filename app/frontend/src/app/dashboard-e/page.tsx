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
  title: "案 E: 旧スタイル light化 — Dashboard preview",
};

export default function DashboardEPage() {
  const stateCode = MOCK_PLUMBING.market_state!.code;
  const phaseCode = MOCK_ECONOMIC.phase.code;
  const insight = getIntegratedInsight(stateCode, phaseCode);
  const ic = statusClasses(insight.color);
  const stateColor = MOCK_PLUMBING.market_state!.color as 'green' | 'cyan' | 'yellow' | 'orange' | 'red';
  const phaseColor = MOCK_ECONOMIC.phase.color as 'green' | 'cyan' | 'yellow' | 'orange' | 'red';
  const cards = getInsightCards();
  const currentRow = stateToRow(stateCode);
  const currentCol = phaseToCol(phaseCode);

  const l1 = MOCK_PLUMBING.layers.layer1!.stress_score;
  const l2a = MOCK_PLUMBING.layers.layer2a!.stress_score;
  const l2b = MOCK_PLUMBING.layers.layer2b!.stress_score;

  return (
    <div data-theme="landing" className="light min-h-screen bg-slate-50">
      <VariantSwitcher current="e" />

      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 space-y-5">
        {/* ========== Page header (旧 dashboard と同じ構造) ========== */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-brand-primary to-emerald-500" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">統合分析ダッシュボード</h1>
          </div>
          <p className="text-xs text-slate-500 pl-3.5">流動性・景気リスクの統合モニタリング</p>
        </div>

        {/* ========== Section 1: IntegratedHero (旧の glow + dual badges) ========== */}
        <div className={`relative rounded-2xl border ${ic.border} overflow-hidden bg-white shadow-sm`}>
          <div className={`absolute inset-0 ${ic.bg}`} />
          <div
            aria-hidden
            className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] rounded-full blur-[100px] opacity-40"
            style={{ background: glowColor(insight.color) }}
          />
          <div className="relative p-6 md:p-8">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div className="space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400 font-mono">
                  INTEGRATED ANALYSIS
                </p>
                <h2 className={`text-2xl md:text-3xl font-bold tracking-tight ${ic.text}`}>
                  {insight.main}
                </h2>
                <p className="text-sm text-slate-600 max-w-lg leading-relaxed">{insight.sub}</p>
              </div>
              <div className="flex flex-col gap-3 shrink-0">
                <BadgeRow eyebrow="流動性" label={MOCK_PLUMBING.market_state!.label} color={stateColor} />
                <BadgeRow eyebrow="景気" label={MOCK_ECONOMIC.phase.label} color={phaseColor} />
              </div>
            </div>
          </div>
        </div>

        {/* ========== Section 2: Dual System Cards (旧と同じ構造) ========== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* === Plumbing Card === */}
          <div className="relative rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-brand-primary/50 to-transparent" />
            <div className="p-5 pb-3">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-primary-700 font-mono">
                    PLUMBING SYSTEM
                  </p>
                  <h3 className="text-base font-bold text-slate-900">米国金融流動性モニター</h3>
                  <p className="text-xs text-slate-500">金融市場の流動性の健全性を監視</p>
                </div>
                <Pill color={stateColor} label={MOCK_PLUMBING.market_state!.label} />
              </div>
            </div>

            {/* 3 ScoreRings (旧と同じ) */}
            <div className="px-5 pb-3">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'L1 政策', score: l1 },
                  { label: 'L2A 銀行', score: l2a },
                  { label: 'L2B 市場', score: l2b },
                ].map((layer) => (
                  <div key={layer.label} className="text-center space-y-1.5">
                    <ScoreRing score={Math.round(layer.score)} size={64} strokeWidth={5} />
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 font-mono">
                      {layer.label}
                    </p>
                    <GaugeBar score={layer.score} />
                  </div>
                ))}
              </div>
            </div>

            {/* Events */}
            <div className="px-5 pb-3 border-t border-slate-100 pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono mb-2">
                検出イベント
              </p>
              <div className="space-y-1.5">
                {[
                  { label: 'IG クレジットスプレッド拡大', sev: 'WARNING' as const },
                  { label: 'FRB QT 継続', sev: 'ALERT' as const },
                ].map((ev, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        ev.sev === 'ALERT' ? 'bg-orange-500' : 'bg-yellow-500'
                      }`}
                    />
                    <span className="text-xs text-slate-600 flex-1">{ev.label}</span>
                    <span className="text-[9px] font-mono font-bold text-slate-400 px-1.5 py-0.5 rounded border border-slate-200">
                      {ev.sev}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-5 pb-4 pt-2">
              <Link href="/liquidity" className="text-xs font-semibold text-brand-primary hover:underline">
                詳細を見る →
              </Link>
            </div>
          </div>

          {/* === Economic Card === */}
          <div className="relative rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-emerald-500/50 to-transparent" />
            <div className="p-5 pb-3">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700 font-mono">
                    ECONOMIC ALERT
                  </p>
                  <h3 className="text-base font-bold text-slate-900">米国景気リスク評価モニター</h3>
                  <p className="text-xs text-slate-500">雇用・消費・構造の 3 軸で景気を評価</p>
                </div>
                <Pill color={phaseColor} label={MOCK_ECONOMIC.phase.label} />
              </div>
            </div>

            {/* Total ring + 3 category rings (旧と同じレイアウト) */}
            <div className="px-5 pb-3">
              <div className="flex items-center justify-center gap-6">
                <div className="text-center space-y-1">
                  <ScoreRing score={MOCK_ECONOMIC.total_score} size={84} strokeWidth={6} />
                  <p className="text-[10px] font-bold text-slate-500 font-mono uppercase tracking-wider">総合</p>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {MOCK_ECONOMIC.categories.map((cat) => {
                    const pct = Math.round((cat.score / cat.max_score) * 100);
                    return (
                      <div key={cat.name} className="text-center space-y-1">
                        <ScoreRing score={pct} size={52} strokeWidth={4} />
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">
                          {cat.name}
                        </p>
                        <p className="text-[10px] text-slate-400 font-mono">
                          {cat.score}/{cat.max_score}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Alert factors */}
            <div className="px-5 pb-3 border-t border-slate-100 pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono mb-2">
                アラートファクター
              </p>
              <div className="space-y-1.5">
                {MOCK_ECONOMIC.alert_factors.slice(0, 3).map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span className="text-xs text-slate-600">{f}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="px-5 pb-4 pt-2">
              <Link href="/employment" className="text-xs font-semibold text-emerald-700 hover:underline">
                詳細を見る →
              </Link>
            </div>
          </div>
        </div>

        {/* ========== Section 3: State × Phase Matrix (旧と同じ) ========== */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 font-mono">
                  STATE × PHASE MATRIX
                </p>
                <h3 className="text-base font-bold mt-1 text-slate-900">投資判断マトリクス</h3>
              </div>
              <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
                行 流動性 / 列 景気
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-2 text-slate-400 font-mono text-[10px] w-28 uppercase tracking-wider">
                      流動性 ↓
                    </th>
                    {PHASE_LABELS.map((p, i) => (
                      <th
                        key={i}
                        className={`text-center py-2 px-1 font-mono text-[10px] uppercase tracking-wider ${
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
                        className={`py-2 px-2 font-mono text-[10px] ${
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
                              className={`rounded-lg px-2 py-2 text-center text-[10px] font-medium transition-all ${cellColor.soft} ${cellColor.text} ${
                                isActive
                                  ? 'ring-2 ring-brand-primary shadow-[0_0_18px_rgba(52,96,251,0.4)] scale-105 font-bold'
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

            <p className="text-[10px] text-slate-400 mt-3 text-center font-mono">
              青枠 = 現在のポジション｜行 = 金融流動性の状態｜列 = 景気フェーズ
            </p>
          </div>
        </div>

        {/* ========== Section 4: Insight cards (旧と同じ 3 列グリッド) ========== */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 font-mono px-1">
            INSIGHTS
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {cards.map((c, i) => {
              const cc = statusClasses(c.color);
              return (
                <div key={i} className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${cc.dot}`} />
                    <h4 className={`text-sm font-bold ${cc.text}`}>{c.title}</h4>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{c.description}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ========== Section 5: Navigation cards (旧と同じ 4 列グリッド) ========== */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 font-mono px-1">
            NAVIGATION
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <NavCard href="/liquidity" icon={<Droplets className="h-4 w-4" />} title="米国金融流動性モニター" sub="FRB・銀行・市場レバレッジの 3 層ストレスを分析" tone="brand" />
            <NavCard href="/employment" icon={<ShieldAlert className="h-4 w-4" />} title="米国景気リスク評価モニター" sub="雇用・消費者・構造の 3 軸で景気リスクを評価" tone="emerald" />
            <NavCard href="/signals" icon={<LineChart className="h-4 w-4" />} title="銘柄分析" sub="エントリー判定・Exit 分析・シグナル履歴" tone="purple" />
            <NavCard href="/holdings" icon={<Briefcase className="h-4 w-4" />} title="ポートフォリオ" sub="保有管理・取引記録・統計" tone="amber" />
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
      <div className="mx-auto max-w-7xl px-6 py-3 flex flex-wrap items-center gap-2">
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

function BadgeRow({
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
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider w-10">{eyebrow}</span>
      <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${c.bg} ${c.border}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
        <span className={`text-xs font-bold ${c.text}`}>{label}</span>
      </div>
    </div>
  );
}

function Pill({
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
      <span className={`text-[11px] font-bold ${c.text}`}>{label}</span>
    </div>
  );
}

/** SVG ScoreRing — slate background + score-color foreground (旧 ScoreRing の light化) */
function ScoreRing({ score, size = 64, strokeWidth = 5 }: { score: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const color = score >= 60 ? '#f97316' : score >= 31 ? '#eab308' : '#10b981';
  const center = size / 2;
  const fontSize = size >= 80 ? 22 : size >= 60 ? 16 : 13;

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
        <span className="font-bold tabular-nums" style={{ color, fontSize }}>
          {score}
        </span>
      </div>
    </div>
  );
}

function GaugeBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const color = score >= 60 ? 'bg-orange-500' : score >= 31 ? 'bg-yellow-500' : 'bg-emerald-500';
  return (
    <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function NavCard({
  href,
  icon,
  title,
  sub,
  tone,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  sub: string;
  tone: 'brand' | 'emerald' | 'purple' | 'amber';
}) {
  const toneMap = {
    brand: { bg: 'bg-brand-primary/10', text: 'text-brand-primary-700' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-700' },
    purple: { bg: 'bg-purple-500/10', text: 'text-purple-700' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-700' },
  };
  const t = toneMap[tone];
  return (
    <Link
      href={href}
      className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 hover:border-slate-300 hover:shadow transition-all group block"
    >
      <div className="flex items-center gap-2.5">
        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${t.bg} ${t.text}`}>
          {icon}
        </div>
        <h4 className={`text-sm font-bold ${t.text} group-hover:underline`}>{title}</h4>
      </div>
      <p className="mt-2 text-xs text-slate-500 leading-relaxed">{sub}</p>
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
