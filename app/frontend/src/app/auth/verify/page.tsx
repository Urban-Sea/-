'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Mail, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { GlassCard } from '@/components/shared/glass';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function VerifyPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await supabase.auth.resend({ type: 'signup', email });
    setSent(true);
    setLoading(false);
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-4">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center space-y-2">
          <Image src="/icon.png" alt="" width={48} height={48} className="mx-auto rounded-lg" unoptimized />
          <h1 className="text-2xl font-bold">Open Regime</h1>
        </div>

        <GlassCard>
          <div className="p-6 text-center space-y-4">
            <Mail className="w-12 h-12 text-blue-500 mx-auto" />
            <h2 className="text-lg font-semibold">メールを確認してください</h2>
            <p className="text-sm text-muted-foreground">
              登録したメールアドレスに確認リンクを送信しました。
              メール内のリンクをクリックしてアカウントを有効化してください。
            </p>

            <div className="pt-4 border-t border-border space-y-3">
              <p className="text-xs text-muted-foreground">メールが届かない場合</p>
              <form onSubmit={handleResend} className="space-y-2">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="登録したメールアドレス"
                  required
                  autoComplete="email"
                />
                <Button type="submit" variant="outline" size="sm" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : sent ? '送信済み' : '確認メールを再送'}
                </Button>
              </form>
            </div>
          </div>
        </GlassCard>

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login/" className="text-blue-500 hover:underline">
            ログインページに戻る
          </Link>
        </p>
      </div>
    </div>
  );
}
