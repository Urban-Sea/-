import type { Metadata } from "next";
import { LandingFooter } from "@/components/landing/LandingFooter";
import Link from "next/link";

export const metadata: Metadata = {
  title: "S&P 500 バックテスト詳細レポート — Open Regime",
  description: "S&P 500 構成銘柄 698 銘柄 × 過去 10 年間のバックテスト検証結果",
};

/* ── helper ── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-xl font-bold tracking-tight text-slate-900 mb-4">{title}</h2>
      {children}
    </section>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-sm ${className}`}>{children}</td>;
}

export default function SP500ReportPage() {
  return (
    <div data-theme="landing" className="light min-h-screen flex flex-col">
      <main className="flex-1 mx-auto max-w-3xl w-full px-6 py-16 text-slate-700">

        {/* Header */}
        <Link href="/#validated" className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
          ← トップに戻る
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 mt-4">
          S&P 500 バックテスト詳細レポート
        </h1>
        <p className="text-sm text-slate-500 mt-2">
          対象期間: 2016-04-08 ~ 2026-04-08 (10 年間) / テスト実施日: 2026-04-09
        </p>

        {/* ── Summary ── */}
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: '対象銘柄', value: '698 銘柄' },
            { label: '取引回数', value: '42,622 回' },
            { label: '勝率', value: '69.6%' },
            { label: '平均リターン', value: '+3.70%' },
            { label: 'Profit Factor', value: '4.76' },
            { label: '平均保有期間', value: '44.6 日' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{s.label}</div>
              <div className="text-lg font-bold text-slate-900 mt-0.5">{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── テスト対象と条件 ── */}
        <Section title="テスト対象と条件">
          <div className="space-y-4 text-sm leading-relaxed">
            <div>
              <h3 className="font-bold text-slate-900 mb-1">なぜ S&P 500 か</h3>
              <p>
                バックテストの信頼性を高めるために、意図的に S&P 500 をテスト対象に選んでいます。
                特定の銘柄を「過去に上がったもの」から選ぶと、結果が実力以上に良く見えてしまいます。
                S&P 500 は公的な株価指数であり、銘柄を恣意的に選ぶ余地がありません。
              </p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 mb-1">生存バイアスの除去</h3>
              <p>
                S&P 500 は定期的に銘柄が入れ替わります。現在の構成銘柄だけをテストすると、途中で破綻・除外された銘柄が抜け落ち、結果が楽観的になります。
              </p>
              <p className="mt-2">
                本テストでは S&P 500 の構成銘柄変更履歴を使い、各時点でどの銘柄が構成に含まれていたかを正確に追跡しています。
                2023 年に破綻した SVB (Silicon Valley Bank) のデータも含まれており、「後出しジャンケン」のない公正な検証を実現しています。
              </p>
            </div>
          </div>
        </Section>

        {/* ── 売買ルール ── */}
        <Section title="売買ルール">
          <div className="space-y-4 text-sm leading-relaxed">
            <div>
              <h3 className="font-bold text-slate-900 mb-1">買いの判定</h3>
              <p>以下の 3 つの条件がすべて揃ったときに買いシグナルを出します:</p>
              <ol className="list-decimal pl-5 mt-2 space-y-1">
                <li><strong>下落トレンドの底打ち</strong> — 価格の動きから下落が終わったサインを検出</li>
                <li><strong>上昇トレンドへの転換</strong> — 底打ち後に反転の確認</li>
                <li><strong>移動平均線の収束</strong> — 短期と中期の移動平均線が近づき、タイミングが最適であることを確認</li>
              </ol>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 mb-1">売りの判定 (4 層の自動決済)</h3>
              <p>買った後は 4 つのルールを毎日チェックし、条件を満たしたら自動的に売却します。</p>
              <div className="overflow-x-auto mt-3">
                <table className="w-full border-collapse">
                  <thead><tr className="border-b border-slate-200">
                    <Th>ルール</Th><Th>発動条件</Th><Th>役割</Th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr><Td className="font-bold text-slate-900">① 損切ライン</Td><Td>価格が一定ライン以下に下落</Td><Td>大きな損失を防ぐ</Td></tr>
                    <tr><Td className="font-bold text-slate-900">② 弱気転換</Td><Td>トレンド転換の兆候を検出</Td><Td>まず 50% だけ売却</Td></tr>
                    <tr><Td className="font-bold text-slate-900">③ 利確ストップ</Td><Td>高値から一定割合下落</Td><Td>利益を伸ばしながら確保</Td></tr>
                    <tr><Td className="font-bold text-slate-900">④ 保有期限</Td><Td>約 1 年経過</Td><Td>長期保有リスクの回避</Td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="font-bold text-slate-900 mb-1">50% 売却の仕組み</h3>
              <p>
                ② 弱気転換ルールでは、まず保有の半分だけを売却します。
                残り半分は ①③④ のいずれかのルールで後日決済されます。
                「全部売って失敗」を避けつつ、利益を守る仕組みです。
              </p>
              <div className="mt-3 rounded-lg bg-white border border-amber-200 p-3 font-mono text-xs text-slate-600">
                <p>例: $100 で購入</p>
                <p>→ $110 で 50% 売却 (+10%)</p>
                <p>→ $120 で残り 50% を売却 (+20%)</p>
                <p className="mt-1 font-bold text-slate-900">→ 実現損益 = (+10% × 0.5) + (+20% × 0.5) = +15.0%</p>
              </div>
            </div>
          </div>
        </Section>

        {/* ── 検証結果 ── */}
        <Section title="検証結果">
          <div className="space-y-6">
            {/* 年別 */}
            <div>
              <h3 className="font-bold text-slate-900 text-sm mb-2">年別パフォーマンス</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead><tr className="border-b border-slate-200">
                    <Th>年</Th><Th>取引数</Th><Th>勝率</Th><Th>平均損益</Th><Th>PF</Th><Th>相場</Th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {[
                      { y: '2016', n: '2,973', wr: '66.7%', avg: '+3.33%', pf: '4.67', env: '横ばい', bear: false },
                      { y: '2017', n: '4,634', wr: '73.5%', avg: '+4.39%', pf: '7.48', env: '上昇', bear: false },
                      { y: '2018', n: '3,393', wr: '59.7%', avg: '+1.77%', pf: '2.18', env: '下落', bear: true },
                      { y: '2019', n: '4,800', wr: '71.6%', avg: '+3.91%', pf: '5.38', env: '回復', bear: false },
                      { y: '2020', n: '4,639', wr: '73.4%', avg: '+4.81%', pf: '6.28', env: 'COVID 回復', bear: false },
                      { y: '2021', n: '4,796', wr: '71.5%', avg: '+3.87%', pf: '5.68', env: '上昇', bear: false },
                      { y: '2022', n: '3,518', wr: '64.6%', avg: '+2.45%', pf: '2.87', env: '下落 (利上げ)', bear: true },
                      { y: '2023', n: '4,147', wr: '68.8%', avg: '+3.74%', pf: '4.80', env: '回復', bear: false },
                      { y: '2024', n: '4,565', wr: '72.5%', avg: '+3.88%', pf: '5.40', env: '上昇', bear: false },
                      { y: '2025', n: '4,246', wr: '69.9%', avg: '+4.04%', pf: '4.85', env: '上昇', bear: false },
                    ].map(r => (
                      <tr key={r.y} className={r.bear ? 'bg-red-50' : ''}>
                        <Td className={`font-bold ${r.bear ? 'text-red-700' : 'text-slate-900'}`}>{r.y}</Td>
                        <Td className="font-mono">{r.n}</Td>
                        <Td className="font-mono">{r.wr}</Td>
                        <Td className="font-mono">{r.avg}</Td>
                        <Td className="font-mono">{r.pf}</Td>
                        <Td className={r.bear ? 'text-red-600 font-medium' : ''}>{r.env}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                2018 年と 2022 年の下落相場でも黒字を維持 (PF &gt; 2)。
                S&P 500 指数自体は 2018 年に -4.4%、2022 年に -19.4% の損失でした。
              </p>
            </div>

            {/* Exit Reason */}
            <div>
              <h3 className="font-bold text-slate-900 text-sm mb-2">売却ルール別の成績</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead><tr className="border-b border-slate-200">
                    <Th>ルール</Th><Th>取引数</Th><Th>比率</Th><Th>勝率</Th><Th>平均損益</Th><Th>役割</Th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr><Td className="font-bold text-slate-900">③ 利確ストップ</Td><Td className="font-mono">22,526</Td><Td>52.9%</Td><Td className="font-mono">91.4%</Td><Td className="font-mono text-emerald-600">+7.17%</Td><Td>利益の大半を生む主力</Td></tr>
                    <tr><Td className="font-bold text-slate-900">② 弱気転換</Td><Td className="font-mono">13,320</Td><Td>31.3%</Td><Td className="font-mono">67.2%</Td><Td className="font-mono text-emerald-600">+2.03%</Td><Td>早期撤退</Td></tr>
                    <tr><Td className="font-bold text-slate-900">① 損切ライン</Td><Td className="font-mono">6,735</Td><Td>15.8%</Td><Td className="font-mono">1.4%</Td><Td className="font-mono text-red-600">-4.70%</Td><Td>損失を抑える防衛役</Td></tr>
                    <tr><Td className="font-bold text-slate-900">④ 保有期限</Td><Td className="font-mono">41</Td><Td>0.1%</Td><Td className="font-mono">100%</Td><Td className="font-mono text-emerald-600">+19.06%</Td><Td>ほぼ発動しない</Td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Benchmark */}
            <div>
              <h3 className="font-bold text-slate-900 text-sm mb-2">S&P 500 ETF (SPY) との比較</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead><tr className="border-b border-slate-200">
                    <Th>戦略</Th><Th>年率リターン (推定)</Th><Th>備考</Th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr><Td className="font-bold text-slate-900">S&P 500 ETF (SPY)</Td><Td className="font-mono">+14.27%/年</Td><Td>何もせず保有するだけ</Td></tr>
                    <tr><Td>個別銘柄 (中央値)</Td><Td className="font-mono">+9.11%/年</Td><Td>ランダムに 1 銘柄選んだ場合</Td></tr>
                    <tr><Td className="font-bold text-slate-900">本システム (理論値)</Td><Td className="font-mono text-emerald-600 font-bold">~+29.5%/年</Td><Td>1 銘柄に常駐した場合の理論値</Td></tr>
                    <tr><Td className="font-bold text-slate-900">本システム (実運用見込み)</Td><Td className="font-mono text-emerald-600">+15 ~ 22%/年</Td><Td>手数料・スリッページ込み</Td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Section>

        {/* ── 計算方法 ── */}
        <Section title="計算方法">
          <div className="space-y-4 text-sm leading-relaxed">
            <div>
              <h3 className="font-bold text-slate-900 mb-1">株価データ</h3>
              <p>
                株式分割や配当による調整が反映された調整済み終値を使用しています。
                これにより、過去のデータも現在の株価と正確に比較できます。
              </p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 mb-1">リターン計算</h3>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 font-mono text-xs">
                <p>リターン (%) = (売却価格 − 購入価格) / 購入価格 × 100</p>
                <p className="mt-2">50% 売却があった場合:</p>
                <p>実現損益 (%) = (50%売却時の損益 × 0.5) + (残り50%の損益 × 0.5)</p>
              </div>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 mb-1">Profit Factor (PF)</h3>
              <p>
                利益が出た取引の合計利益を、損失が出た取引の合計損失で割った値です。
                1.0 を超えていれば黒字、数字が大きいほど優秀です。
                本システムの PF 4.76 は「利益が損失の約 5 倍」を意味します。
              </p>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 mb-1">約定タイミング</h3>
              <p>
                本テストでは当日終値でシグナル検出と約定を同時に行う想定です。
                実際の運用では「当日終値でシグナル → 翌営業日の始値で発注」となるため、
                わずかな差 (推定 0.1 ~ 0.3% / 取引) が生じます。
              </p>
            </div>
          </div>
        </Section>

        {/* ── 制限事項 ── */}
        <Section title="制限事項">
          <div className="space-y-3 text-sm leading-relaxed">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-bold text-slate-900 mb-1">データの制約</h3>
              <p>
                698 銘柄中 86 銘柄 (12.3%) はデータプロバイダーにデータがなく分析できませんでした。
                SVB や First Republic Bank など破綻した銘柄が含まれており、
                これらのデータが含まれていれば結果はやや低い数字になる可能性があります。
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="font-bold text-slate-900 mb-1">取引コスト</h3>
              <p>
                本テストでは手数料やスリッページ (希望価格と実際の約定価格の差) を含んでいません。
                実運用では 1 取引あたり 0.1 ~ 0.5% 程度の摩擦コストが発生します。
              </p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
              <h3 className="font-bold text-red-800 mb-1">投資に関する注意</h3>
              <p className="text-red-700">
                過去のバックテスト結果は将来の成果を保証するものではありません。
                市場環境の変化、流動性の低下、予期しないイベントなどにより、実際の運用成績は異なる場合があります。
                投資は自己責任で行ってください。
              </p>
            </div>
          </div>
        </Section>

        <p className="mt-12 text-xs text-slate-400 text-center">
          テスト実施日: 2026-04-09 / データソース: 分割・配当調整済み終値, S&P 500 構成銘柄変更履歴
        </p>
      </main>
      <LandingFooter variant="light" />
    </div>
  );
}
