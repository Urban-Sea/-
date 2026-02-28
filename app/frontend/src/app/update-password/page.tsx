'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { GlassCard } from '@/components/shared/glass';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // implicit flow: ハッシュフラグメントのトークンを処理
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        // M8: ハッシュフラグメントからトークンを除去
        if (window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        setReady(true);
      }
    });

    // 既にセッションがある場合（auth/callback 経由）
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('パスワードは8文字以上で入力してください。');
      return;
    }
    if (password !== confirm) {
      setError('パスワードが一致しません。');
      return;
    }

    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });

    if (err) {
      setError(err.message);
    } else {
      setSuccess(true);
      setTimeout(() => router.replace('/'), 2000);
    }
    setLoading(false);
  };

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-4">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center space-y-2">
          <Image src="/icon.png" alt="" width={48} height={48} className="mx-auto rounded-lg" unoptimized />
          <h1 className="text-2xl font-bold">Open Regime</h1>
          <p className="text-sm text-muted-foreground">新しいパスワードを設定</p>
        </div>

        {success ? (
          <GlassCard>
            <div className="p-6 text-center space-y-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
              <h2 className="text-lg font-semibold">パスワードを更新しました</h2>
              <p className="text-sm text-muted-foreground">ホームページにリダイレクトします...</p>
            </div>
          </GlassCard>
        ) : (
          <GlassCard>
            <form onSubmit={handleUpdate} className="p-5 space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
              )}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">新しいパスワード</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8文字以上"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">パスワード確認</label>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="もう一度入力"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'パスワードを更新'}
              </Button>
            </form>
          </GlassCard>
        )}
      </div>
    </div>
  );
}
