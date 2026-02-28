'use client';

import { useState } from 'react';
import { useAdminUsers, updateUserPlan } from '@/lib/api';
import { GlassCard } from '@/components/shared/glass';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, Shield } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const PLANS = ['free', 'pro_trial', 'pro', 'demo'] as const;

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free: { label: 'Free', color: 'bg-zinc-500/20 text-zinc-400' },
  pro_trial: { label: 'Pro Trial', color: 'bg-emerald-500/20 text-emerald-400' },
  pro: { label: 'Pro', color: 'bg-blue-500/20 text-blue-400' },
  demo: { label: 'Demo', color: 'bg-amber-500/20 text-amber-400' },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function AdminPage() {
  const { data, error, isLoading, mutate } = useAdminUsers();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handlePlanChange = async (userId: string, newPlan: string) => {
    setUpdatingId(userId);
    try {
      await updateUserPlan(userId, { plan: newPlan });
      await mutate();
    } catch {
      // エラーはサイレント
    } finally {
      setUpdatingId(null);
    }
  };

  // 403 = 権限なし
  if (error) {
    const is403 = error.message?.includes('403');
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center space-y-4">
        <Shield className="w-12 h-12 mx-auto text-muted-foreground" />
        <h1 className="text-xl font-bold">
          {is403 ? '権限がありません' : 'エラーが発生しました'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {is403
            ? 'このページは管理者のみアクセスできます。'
            : error.message}
        </p>
        <Link href="/">
          <Button variant="outline" size="sm">ダッシュボードに戻る</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 space-y-6">
      {/* Header */}
      <div className="plumb-animate-in">
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-3 h-3" /> ダッシュボードに戻る
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-red-500 to-orange-500" />
          <h1 className="text-2xl font-bold tracking-tight">ユーザー管理</h1>
        </div>
      </div>

      {/* Users Table */}
      <GlassCard stagger={1}>
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              登録ユーザー
            </h2>
            {data && (
              <span className="text-xs text-muted-foreground">{data.total} 件</span>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">メール</th>
                    <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">表示名</th>
                    <th className="pb-2 pr-4 text-xs font-medium text-muted-foreground">プラン</th>
                    <th className="pb-2 text-xs font-medium text-muted-foreground">登録日</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.users.map(user => {
                    return (
                      <tr key={user.id} className="border-b border-border/50 last:border-0">
                        <td className="py-3 pr-4 text-xs font-mono truncate max-w-[200px]">
                          {user.email}
                        </td>
                        <td className="py-3 pr-4 text-xs text-muted-foreground">
                          {user.display_name || '-'}
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <select
                              value={user.plan}
                              onChange={e => handlePlanChange(user.id, e.target.value)}
                              disabled={updatingId === user.id}
                              className={cn(
                                'text-xs font-medium px-2 py-1 rounded border border-border bg-background cursor-pointer',
                                'focus:outline-none focus:ring-1 focus:ring-ring',
                                updatingId === user.id && 'opacity-50',
                              )}
                            >
                              {PLANS.map(p => (
                                <option key={p} value={p}>
                                  {PLAN_LABELS[p].label}
                                </option>
                              ))}
                            </select>
                            {updatingId === user.id && (
                              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                            )}
                          </div>
                        </td>
                        <td className="py-3 text-xs text-muted-foreground">
                          {formatDate(user.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
