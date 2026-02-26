'use client';

import Link from 'next/link';
import {
  GlassCard,
  ScoreRing,
  StatusChip,
  DocSection,
  DocTable,
} from '@/components/shared/glass';

/* ── Feature card data ── */
const features = [
  {
    mono: 'PLUMBING SYSTEM',
    title: '流動性配管モニター',
    desc: 'FRBの資金供給（L1）、銀行セクター（L2A）、市場レバレッジ（L2B）の3層で金融市場の「配管」の健全性をリアルタイム監視。',
    color: 'blue' as const,
    href: '/liquidity',
  },
  {
    mono: 'ECONOMIC ALERT',
    title: '米国景気警戒スコア',
    desc: '雇用（50点）・消費者（25点）・構造（25点）の3カテゴリで100点満点のリスクスコアを算出。5段階フェーズで景気状況を判定。',
    color: 'green' as const,
    href: '/employment',
  },
  {
    mono: 'SIGNAL ANALYSIS',
    title: '個別シグナル分析',
    desc: 'EMA・市場構造・レジーム判定を組み合わせた複合エントリーシグナル。米国株・日本株に対応。',
    color: 'purple' as const,
    href: '/signals',
  },
  {
    mono: 'PORTFOLIO MGMT',
    title: '保有・取引管理',
    desc: 'ポートフォリオの保有状況、取引履歴、損益推移を管理。セクター別・国別のアロケーション分析。',
    color: 'amber' as const,
    href: '/holdings',
  },
  {
    mono: 'DATA PIPELINE',
    title: '自動データパイプライン',
    desc: 'FRED・Yahoo Finance・NY Fedから日次バッチで自動取得。Cloudflareエッジキャッシュで低遅延配信。',
    color: 'cyan' as const,
    href: null,
  },
];

const colorBorder: Record<string, string> = {
  blue: 'border-l-blue-500/40',
  green: 'border-l-emerald-500/40',
  purple: 'border-l-purple-500/40',
  amber: 'border-l-amber-500/40',
  cyan: 'border-l-cyan-500/40',
};

/* ── Disclaimer items ── */
const disclaimers = [
  {
    title: '投資助言ではありません',
    body: '本ツールは金融商品取引法に基づく投資助言業の登録を受けておらず、投資助言・代理業に該当するサービスは一切提供しておりません。表示されるスコア、シグナル、推奨アクションは全て統計的分析に基づく参考情報であり、特定の金融商品の売買を推奨するものではありません。',
  },
  {
    title: '自己責任の原則',
    body: '投資に関する最終的な判断は、ご自身の責任において行ってください。本ツールの利用により生じた損失について、開発者は一切の責任を負いません。',
  },
  {
    title: 'データの遅行性',
    body: '使用するデータの多くは遅行指標です。経済指標は数週間〜数ヶ月遅れて発表されるため、リアルタイムの市場状況を完全に反映していない場合があります。',
  },
  {
    title: '過去のパターンの限界',
    body: '本システムは過去のデータパターンに基づいて構築されています。前例のない市場イベントに対しては適切に機能しない可能性があります。常に複数の情報源を参照し、ご自身の判断を行ってください。',
  },
];

/* ================================================================ */
/*  Page                                                            */
/* ================================================================ */

export default function AboutPage() {
  return (
    <div className="space-y-6 pb-10">
      {/* ── Hero ── */}
      <div className="relative rounded-2xl border border-blue-500/20 overflow-hidden plumb-animate-scale">
        <div className="absolute inset-0 bg-blue-500/[0.06]" />
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] rounded-full blur-[100px] opacity-20"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #a855f7)' }}
        />
        <div className="relative p-8 md:p-10 text-center space-y-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400 font-mono">
            OPEN REGIME ANALYTICS
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
            Open Regime
          </h1>
          <p className="text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
            金融市場の流動性と米国景気動向をリアルタイムで統合分析し、
            投資環境の可視化をサポートする分析ダッシュボード
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            統合ダッシュボードを見る
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </div>

      {/* ── Overview ── */}
      <GlassCard stagger={1}>
        <div className="p-5 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground font-mono">
            WHAT IS OPEN REGIME
          </p>
          <h2 className="text-lg font-bold">このシステムについて</h2>
          <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
            <p>
              Open Regime は、米国金融市場の
              <strong className="text-foreground">流動性環境</strong>と
              <strong className="text-foreground">実体経済の健全性</strong>を、
              複数の公的データソース（FRED、Yahoo Finance、NY Fed）から自動取得し、
              独自のスコアリングモデルで統合分析するダッシュボードです。
            </p>
            <p>
              「今の市場環境はリスクを取るべきか、守るべきか」という判断の参考材料を、
              データドリブンで提供することを目指しています。
            </p>
          </div>
        </div>
      </GlassCard>

      {/* ── Feature Cards ── */}
      <div className="space-y-3 plumb-animate-in plumb-stagger-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground font-mono px-1">
          CORE FEATURES
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {features.map((f) => {
            const inner = (
              <div className={`plumb-glass rounded-xl p-5 h-full border-l-2 ${colorBorder[f.color]} transition-colors`}>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground font-mono mb-1.5">
                  {f.mono}
                </p>
                <h3 className="text-sm font-bold text-foreground mb-2">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            );
            return f.href ? (
              <Link key={f.mono} href={f.href} className="group hover:brightness-110 transition-all">
                {inner}
              </Link>
            ) : (
              <div key={f.mono}>{inner}</div>
            );
          })}
        </div>
      </div>

      {/* ── Scoring Model (collapsible) ── */}
      <DocSection title="景気リスクスコアリングモデル">
        <p>
          雇用・消費者・構造の3カテゴリで100点満点のリスクスコアを算出します。
          スコアが高いほど景気後退リスクが高いことを示します。
        </p>
        <DocTable
          headers={['カテゴリ', '配点', '主な指標']}
          rows={[
            ['雇用 (Employment)', '50点', 'NFP変化率, 失業率(U3/U6), JOLTS, 週次失業保険'],
            ['消費者 (Consumer)', '25点', '実質可処分所得, 消費者信頼感, クレカ延滞率'],
            ['構造 (Structure)', '25点', 'イールドカーブ, ISM製造業PMI, 住宅着工'],
          ]}
        />
        <div className="pt-2">
          <p className="text-xs font-bold text-foreground mb-2">5段階フェーズ判定</p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip label="EXPANSION 0-20" color="green" />
            <StatusChip label="SLOWDOWN 21-40" color="blue" />
            <StatusChip label="CAUTION 41-60" color="amber" />
            <StatusChip label="CONTRACTION 61-80" color="orange" />
            <StatusChip label="CRISIS 81-100" color="red" />
          </div>
        </div>
        <div className="pt-2 flex items-center gap-4">
          <ScoreRing score={18} size={48} strokeWidth={3} />
          <div>
            <p className="text-xs font-bold text-foreground">スコア例: 18 = EXPANSION</p>
            <p className="text-xs text-muted-foreground">経済は健全に拡大中。リスクオン環境。</p>
          </div>
        </div>
      </DocSection>

      {/* ── Data Pipeline (collapsible) ── */}
      <DocSection title="データパイプライン">
        <p>公的データソースから日次で自動取得し、分析結果を即座に反映します。</p>
        <div className="flex flex-col gap-2 pt-2">
          {[
            { step: '1', label: 'データ取得', detail: 'FRED / Yahoo Finance / NY Fed から日次バッチ実行' },
            { step: '2', label: 'DB格納', detail: 'Supabase PostgreSQL に upsert（修正検知あり）' },
            { step: '3', label: 'スコア計算', detail: '流動性State + 景気リスクスコアを再計算' },
            { step: '4', label: 'エッジ配信', detail: 'Cloudflare Workers でキャッシュ → 東京PoP 低遅延配信' },
          ].map((s) => (
            <div key={s.step} className="flex items-start gap-3 plumb-glass rounded-lg p-3">
              <span className="text-xs font-bold font-mono text-blue-600 dark:text-blue-400 bg-blue-500/10 rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                {s.step}
              </span>
              <div>
                <p className="text-xs font-bold text-foreground">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </DocSection>

      {/* ── Disclaimer (always visible) ── */}
      <GlassCard stagger={4}>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-amber-500 to-red-500" />
            <h2 className="text-base font-bold text-foreground">免責事項・ご注意</h2>
          </div>
          <div className="space-y-3">
            {disclaimers.map((d) => (
              <div key={d.title} className="plumb-glass rounded-lg p-4 border-l-2 border-amber-500/40">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400 mb-1">{d.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
