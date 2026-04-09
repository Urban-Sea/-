/**
 * 一時 visual review 用プレビュー (認証なし)
 * 実装後の Today's Verdict バナー + 解釈併記を確認するためだけの一時ファイル.
 * Visual review が終わったら削除する.
 */
'use client';

import { DashboardTab } from '@/components/dashboard/DashboardTab';
import {
  MOCK_PLUMBING,
  MOCK_ECONOMIC,
  MOCK_EVENTS,
  MOCK_POLICY,
} from '@/lib/dashboard-mocks';

export default function DashboardPreviewPage() {
  return (
    <div className="space-y-6 px-6 py-6 max-w-[1800px] mx-auto">
      <div className="plumb-animate-in">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-blue-500 to-emerald-500" />
          <h1 className="text-2xl font-bold tracking-tight">統合分析ダッシュボード (preview)</h1>
        </div>
        <p className="text-xs text-muted-foreground pl-3.5">
          Today&apos;s Verdict バナー実装後の visual review 用 (一時ファイル)
        </p>
      </div>
      <DashboardTab
        plumbing={MOCK_PLUMBING}
        economic={MOCK_ECONOMIC}
        events={MOCK_EVENTS}
        policy={MOCK_POLICY}
      />
    </div>
  );
}
