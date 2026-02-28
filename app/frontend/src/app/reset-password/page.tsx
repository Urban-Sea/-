'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { GlassCard } from '@/components/shared/glass';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password/`,
    });

    if (err) {
      setError(err.message);
    } else {
      setSuccess(true);
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-4">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center space-y-2">
          <Image src="/icon.png" alt="" width={48} height={48} className="mx-auto rounded-lg" unoptimized />
          <h1 className="text-2xl font-bold">Open Regime</h1>
          <p className="text-sm text-muted-foreground">パスワードをリセット</p>
        </div>

        {success ? (
          <GlassCard>
            <div className="p-6 text-center space-y-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
              <h2 className="text-lg font-semibold">リセットメールを送信しました</h2>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{email}</span> にパスワードリセット用のリンクを送信しました。
              </p>
              <div className="pt-2">
                <Link href="/login/" className="text-sm text-blue-500 hover:underline">
                  ログインページに戻る
                </Link>
              </div>
            </div>
          </GlassCard>
        ) : (
          <GlassCard>
            <form onSubmit={handleReset} className="p-5 space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
              )}
              <p className="text-sm text-muted-foreground">
                登録したメールアドレスを入力してください。パスワードリセット用のリンクを送信します。
              </p>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">メールアドレス</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'リセットメールを送信'}
              </Button>
            </form>
          </GlassCard>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login/" className="text-blue-500 hover:underline">
            ログインに戻る
          </Link>
        </p>
      </div>
    </div>
  );
}
