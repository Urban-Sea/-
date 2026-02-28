'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useUser } from '@/components/providers/UserProvider';
import { useMe, updateMe, useAdminUsers, updateUserPlan } from '@/lib/api';
import { GlassCard } from '@/components/shared/glass';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const PLANS = ['free', 'pro_trial', 'pro', 'demo'] as const;

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free: { label: 'Free', color: 'bg-zinc-500/20 text-zinc-400' },
  pro_trial: { label: 'Pro（無料トライアル）', color: 'bg-emerald-500/20 text-emerald-400' },
  pro: { label: 'Pro', color: 'bg-blue-500/20 text-blue-400' },
  demo: { label: 'Demo', color: 'bg-amber-500/20 text-amber-400' },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatDateShort(iso: string): string {
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

export default function AccountPage() {
  const { email } = useUser();
  const { data: me, mutate } = useMe();
  const { theme, setTheme } = useTheme();

  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isAdmin = me?.is_admin === true;

  // me が読み込まれたら displayName を初期化
  useEffect(() => {
    if (me?.display_name != null) {
      setDisplayName(me.display_name);
    }
  }, [me?.display_name]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateMe({ display_name: displayName.trim() || null });
      await mutate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // エラー時はサイレント
    } finally {
      setSaving(false);
    }
  };

  const plan = me?.plan || 'free';
  const planInfo = PLAN_LABELS[plan] || PLAN_LABELS.free;

  return (
    <div className="max-w-2xl mx-auto px-4 space-y-6">
      {/* Header */}
      <div className="plumb-animate-in">
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-3 h-3" /> ダッシュボードに戻る
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-blue-500 to-purple-500" />
          <h1 className="text-2xl font-bold tracking-tight">アカウント</h1>
        </div>
      </div>

      {/* Account Info */}
      <GlassCard stagger={1}>
        <div className="p-5 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">アカウント情報</h2>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-border flex items-center justify-center text-sm font-bold">
              {email ? email.charAt(0).toUpperCase() : '?'}
            </div>
            <div>
              <p className="text-sm font-medium">{email || '未認証'}</p>
              <p className="text-xs text-muted-foreground">Cloudflare Access 認証</p>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Profile */}
      <GlassCard stagger={2}>
        <div className="p-5 space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">プロフィール</h2>

          {/* Display Name */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">表示名</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="表示名を入力"
                maxLength={50}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || displayName === (me?.display_name || '')}
                className="min-w-[60px]"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : saved ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  '保存'
                )}
              </Button>
            </div>
          </div>

          {/* Plan */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">プラン</span>
            <span className={cn('text-xs font-medium px-2.5 py-0.5 rounded-full', planInfo.color)}>
              {planInfo.label}
            </span>
          </div>

          {/* Created At */}
          {me?.created_at && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">登録日</span>
              <span className="text-xs text-foreground">{formatDate(me.created_at)}</span>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Theme */}
      <GlassCard stagger={3}>
        <div className="p-5 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">表示テーマ</h2>
          <div className="flex gap-3">
            {(['dark', 'light'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={cn(
                  'flex-1 rounded-lg border p-3 text-center text-sm font-medium transition-all',
                  theme === t
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                )}
              >
                {t === 'dark' ? 'ダーク' : 'ライト'}
              </button>
            ))}
          </div>
        </div>
      </GlassCard>

      {/* Guide reset */}
      <GlassCard stagger={4}>
        <div className="p-5 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">ガイド</h2>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">初回ガイドを再表示する</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                localStorage.removeItem('onboarding_done');
                window.location.href = '/';
              }}
            >
              ガイドを表示
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* Admin Section — 管理者のみ表示 */}
      {isAdmin && <AdminSection />}

      {/* Logout */}
      <div className="pb-8 plumb-animate-in plumb-stagger-6">
        <Button variant="destructive" className="w-full" asChild>
          <a href="/cdn-cgi/access/logout">ログアウト</a>
        </Button>
      </div>
    </div>
  );
}

/** 管理者専用: ユーザー管理セクション */
function AdminSection() {
  const { data, isLoading, mutate } = useAdminUsers();
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handlePlanChange = async (userId: string, newPlan: string) => {
    setUpdatingId(userId);
    try {
      await updateUserPlan(userId, { plan: newPlan });
      await mutate();
    } catch {
      // silent
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <GlassCard stagger={5}>
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            ユーザー管理
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
                {data?.users.map(user => (
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
                      {formatDateShort(user.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </GlassCard>
  );
}
