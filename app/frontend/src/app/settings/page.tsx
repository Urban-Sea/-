'use client';

import { useTheme } from 'next-themes';
import { useUser } from '@/components/providers/UserProvider';
import { GlassCard } from '@/components/shared/glass';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const { email } = useUser();
  const { theme, setTheme } = useTheme();

  return (
    <div className="max-w-2xl mx-auto px-4 space-y-6">
      {/* Header */}
      <div className="plumb-animate-in">
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-3 h-3" /> ダッシュボードに戻る
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-blue-500 to-purple-500" />
          <h1 className="text-2xl font-bold tracking-tight">設定</h1>
        </div>
      </div>

      {/* Account */}
      <GlassCard stagger={1}>
        <div className="p-5 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">アカウント</h2>
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

      {/* Theme */}
      <GlassCard stagger={2}>
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

      {/* Notification (future) */}
      <GlassCard stagger={3}>
        <div className="p-5 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">通知設定</h2>
          <p className="text-xs text-muted-foreground">将来のアップデートで通知設定が追加される予定です。</p>
        </div>
      </GlassCard>

      {/* Watchlist (future) */}
      <GlassCard stagger={4}>
        <div className="p-5 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">ウォッチリスト管理</h2>
          <p className="text-xs text-muted-foreground">将来のアップデートでウォッチリスト管理が追加される予定です。</p>
        </div>
      </GlassCard>

      {/* Guide reset */}
      <GlassCard stagger={5}>
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

      {/* Logout */}
      <div className="pb-8 plumb-animate-in plumb-stagger-6">
        <Button variant="destructive" className="w-full" asChild>
          <a href="/cdn-cgi/access/logout">ログアウト</a>
        </Button>
      </div>
    </div>
  );
}
