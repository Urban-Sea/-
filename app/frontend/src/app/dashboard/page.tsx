'use client';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LayoutDashboard, BookOpen } from 'lucide-react';
import {
  usePlumbingSummary,
  useEmploymentRiskScore,
  useMarketEvents,
  usePolicyRegime,
  useRegime,
} from '@/lib/api';
import { AuthGuard } from '@/components/providers/AuthGuard';
import { StatusChip, DocSection, DocTable } from '@/components/shared/glass';
import { DashboardTab, LoadingSkeleton } from '@/components/dashboard/DashboardTab';

// ============================================================
// TAB 2: System Guide (beginner-friendly)
// ============================================================

function SystemGuideTab() {
  return (
    <div className="space-y-3">
      <DocSection title="このダッシュボードの使い方" defaultOpen>
        <p>このダッシュボードは、<strong>2つの独立したシステム</strong>を1画面で統合して表示しています。</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 my-3">
          <div className="plumb-glass rounded-lg p-3">
            <p className="text-xs font-bold text-blue-600 dark:text-blue-400 mb-1">米国金融流動性モニター</p>
            <p className="text-xs">金融市場の流動性（FRB資金、銀行、レバレッジ）が正常に機能しているかを監視します。短期的な市場の健全性を表します。</p>
          </div>
          <div className="plumb-glass rounded-lg p-3">
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-1">米国景気リスク評価モニター</p>
            <p className="text-xs">雇用・消費者・経済構造の3つの軸から、実体経済の健全性を評価します。中長期的な景気動向を表します。</p>
          </div>
        </div>
        <p><strong>色の意味：</strong></p>
        <div className="flex flex-wrap gap-3 my-2">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500" /> <span className="text-xs">安全 — 通常投資OK</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-yellow-500" /> <span className="text-xs">注意 — 慎重に</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-orange-500" /> <span className="text-xs">警戒 — 守り重視</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500" /> <span className="text-xs">危険 — リスク縮小</span></span>
        </div>
        <p><strong>マトリクスの読み方：</strong>行（流動性の状態）と列（景気のフェーズ）の交差点が、現在の投資環境を示します。青い枠が「今ここ」の位置です。</p>
      </DocSection>

      <DocSection title="米国金融流動性モニターとは">
        <p>金融市場でお金がスムーズに流れているかどうかを3つのレイヤーで監視しています。</p>
        <DocTable
          headers={['レイヤー', '何を見ているか', 'スコアの意味']}
          rows={[
            ['L1 政策流動性', 'FRBのバランスシート（SOMA、準備預金、RRP、TGA）', 'FRBが市場にどれだけ資金を供給しているか'],
            ['L2A 銀行システム', '銀行の準備預金、KRE（地銀ETF）、SRF利用、IG格付け', '銀行セクターの健全性'],
            ['L2B 市場流動性', 'マージンデット（信用取引残高）の2年変化率', '投資家のレバレッジ水準'],
          ]}
        />
        <p className="mt-2"><strong>流動性の状態（State）：</strong></p>
        <DocTable
          headers={['状態', '意味', '投資への影響']}
          rows={[
            ['健全相場 (HEALTHY)', '全レイヤーが正常', '積極的な投資が可能'],
            ['中立 (NEUTRAL)', '特に問題なし', '通常通りの投資'],
            ['政策引き締め (TIGHTENING)', 'FRBが金融を引き締め中', '選別投資、新規は控えめに'],
            ['信用収縮 (CONTRACTION)', '銀行・信用市場にストレス', '防御的なポジションへ'],
            ['流動性ショック (SHOCK)', '深刻な流動性危機', 'キャッシュ確保を最優先'],
          ]}
        />
      </DocSection>

      <DocSection title="米国景気リスク評価モニターとは">
        <p>実体経済の健全性を<strong>100点満点</strong>で評価するシステムです。スコアが高いほど景気悪化のリスクが高いことを意味します。</p>
        <DocTable
          headers={['カテゴリ', '配点', '主な指標']}
          rows={[
            ['雇用', '50点', '非農業部門雇用者数(NFP)、失業率、新規失業保険申請、JOLTS'],
            ['消費者', '25点', '実質個人所得、消費者信頼感、クレジットカード延滞率'],
            ['構造', '25点', '失業率トレンド、サームルール、長期失業率'],
          ]}
        />
        <p className="mt-2"><strong>景気フェーズ：</strong></p>
        <DocTable
          headers={['フェーズ', 'スコア', '意味']}
          rows={[
            ['拡大期 (EXPANSION)', '0 〜 20', '景気は好調、通常投資OK'],
            ['減速期 (SLOWDOWN)', '21 〜 40', '成長鈍化の兆候、慎重に'],
            ['警戒期 (CAUTION)', '41 〜 60', '複数指標が悪化、守り重視'],
            ['収縮期 (CONTRACTION)', '61 〜 80', '明確な景気後退、リスク縮小'],
            ['危機 (CRISIS)', '81 〜 100', '深刻な景気後退、キャッシュ最優先'],
          ]}
        />
        <p className="mt-2"><strong>サームルールとは：</strong>失業率の3ヶ月移動平均が、過去12ヶ月の最低値から0.5%以上上昇すると「発動」します。過去のリセッションで100%的中しているため、非常に重要な指標です。</p>
      </DocSection>

      <DocSection title="マトリクスの読み方">
        <p>投資判断マトリクスは、<strong>流動性State（行）</strong>と<strong>景気Phase（列）</strong>の掛け合わせで、推奨される投資姿勢を示します。</p>
        <div className="plumb-glass rounded-lg p-3 my-3 space-y-2">
          <p className="text-xs"><strong>行（縦軸）= 金融市場の状態</strong> — 短期的な流動性の健全さ。FRBの動き、銀行の健全性、レバレッジの水準を反映します。</p>
          <p className="text-xs"><strong>列（横軸）= 実体経済の状態</strong> — 中長期的な景気動向。雇用、消費、経済構造の健全性を反映します。</p>
        </div>
        <p><strong>読み方の例：</strong></p>
        <DocTable
          headers={['位置', '意味', '推奨アクション']}
          rows={[
            ['左上（健全相場 × 拡大期）', '金融も景気も良好', '積極投資OK — フルポジションで構いません'],
            ['中央（中立 × 警戒期）', '金融は問題ないが景気に陰り', '新規控え — 既存ポジションは維持、新規は慎重に'],
            ['右下（流動性ショック × 危機）', '金融も景気も深刻', 'フルキャッシュ — 全てのリスク資産を縮小'],
          ]}
        />
      </DocSection>

      <DocSection title="過去の危機とシステムの反応">
        <p>このシステムが過去の大きなイベントでどう反応したかを見てみましょう。</p>
        <div className="space-y-3 my-3">
          {[
            { year: '2008年9月', event: 'リーマン・ショック', state: '流動性ショック', phase: '危機',
              detail: '全レイヤーが危険水準を突破。景気スコアも80超に。マトリクスは「フルキャッシュ」を示していました。' },
            { year: '2020年3月', event: 'コロナ・ショック', state: '流動性ショック', phase: '警戒期→危機',
              detail: '突然の流動性枯渇により金融流動性が一気に悪化。ただしFRBの迅速な緩和により早期に回復しました。' },
            { year: '2022年', event: 'FRB利上げサイクル', state: '政策引き締め', phase: '注意期',
              detail: 'L1が徐々に上昇（FRBがQTを実施）。景気スコアは40前後で推移。マトリクスは「選別投資〜新規控え」を示していました。' },
            { year: '2023年3月', event: 'SVB破綻', state: '信用収縮', phase: '注意期',
              detail: '銀行セクター（L2A）が急上昇。ただし景気全体は大きく悪化せず、一時的なストレスでした。' },
          ].map((crisis) => (
            <div key={crisis.year} className="plumb-glass rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <StatusChip label={crisis.state} color={crisis.state.includes('ショック') ? 'red' : crisis.state.includes('収縮') ? 'orange' : 'yellow'} />
                <StatusChip label={crisis.phase} color={crisis.phase.includes('危機') ? 'red' : crisis.phase.includes('警戒') ? 'orange' : 'amber'} />
              </div>
              <p className="text-xs font-bold mt-2">{crisis.year} — {crisis.event}</p>
              <p className="text-xs text-muted-foreground mt-1">{crisis.detail}</p>
            </div>
          ))}
        </div>
        <p className="text-xs mt-2"><strong>学び：</strong>流動性の悪化は急激（日〜週単位）、景気の悪化は緩やか（月〜四半期単位）。両方が同時に悪化した場合が最も危険です。</p>
      </DocSection>

      <DocSection title="注意事項">
        <div className="space-y-2">
          <div className="plumb-glass rounded-lg p-3">
            <p className="text-xs font-bold text-amber-600 dark:text-amber-400 mb-1">遅行性について</p>
            <p className="text-xs">多くの経済指標は遅行指標です。雇用統計は1ヶ月遅れ、GDP確報値は3ヶ月遅れで発表されます。このシステムは「早期警戒」を目指していますが、完全なリアルタイムではありません。</p>
          </div>
          <div className="plumb-glass rounded-lg p-3">
            <p className="text-xs font-bold text-amber-600 dark:text-amber-400 mb-1">投資助言ではありません</p>
            <p className="text-xs">このシステムは情報提供を目的としています。投資判断はご自身の責任で行ってください。マトリクスの推奨は一般的なガイダンスであり、個別の投資状況を考慮していません。</p>
          </div>
          <div className="plumb-glass rounded-lg p-3">
            <p className="text-xs font-bold text-amber-600 dark:text-amber-400 mb-1">前例のないイベント</p>
            <p className="text-xs">過去のパターンに基づくシステムのため、全く新しいタイプの危機には対応できない可能性があります。常に複数の情報源を参照してください。</p>
          </div>
        </div>
      </DocSection>
    </div>
  );
}


// ============================================================
// Main Page
// ============================================================

export default function IntegratedDashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}

function DashboardContent() {
  const { data: plumbing, isLoading: loadP } = usePlumbingSummary();
  const { data: economic, isLoading: loadE } = useEmploymentRiskScore();
  const { data: events } = useMarketEvents();
  const { data: policy } = usePolicyRegime();
  // regime is used indirectly via plumbing.market_state
  useRegime();

  const isLoading = loadP || loadE;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="plumb-animate-in">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-blue-500 to-emerald-500" />
          <h1 className="text-2xl font-bold tracking-tight">統合分析ダッシュボード</h1>
        </div>
        <p className="text-sm text-muted-foreground pl-3.5">流動性・景気リスクの統合モニタリング</p>
      </div>

      <Tabs defaultValue="dashboard" className="plumb-tabs">
        <TabsList variant="line" className="plumb-glass rounded-lg px-1 py-0.5 w-full justify-start border-none">
          <TabsTrigger value="dashboard" className="text-xs font-mono uppercase tracking-wider"><LayoutDashboard className="w-3.5 h-3.5 mr-1.5" />ダッシュボード</TabsTrigger>
          <TabsTrigger value="guide" className="text-xs font-mono uppercase tracking-wider"><BookOpen className="w-3.5 h-3.5 mr-1.5" />システム解説</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          {isLoading || !plumbing || !economic ? (
            <LoadingSkeleton />
          ) : (
            <DashboardTab plumbing={plumbing} economic={economic} events={events} policy={policy} />
          )}
        </TabsContent>

        <TabsContent value="guide" className="mt-4">
          <SystemGuideTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
