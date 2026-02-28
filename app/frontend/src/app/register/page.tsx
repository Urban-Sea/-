'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Loader2, CheckCircle2, Eye, EyeOff, Check, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/components/providers/UserProvider';
import { GlassCard } from '@/components/shared/glass';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* ── Password requirements ── */
const requirements = [
  { key: 'length', label: '8文字以上', test: (p: string) => p.length >= 8 },
  { key: 'upper', label: '大文字(A-Z)', test: (p: string) => /[A-Z]/.test(p) },
  { key: 'lower', label: '小文字(a-z)', test: (p: string) => /[a-z]/.test(p) },
  { key: 'number', label: '数字(0-9)', test: (p: string) => /\d/.test(p) },
  { key: 'special', label: '記号(!@#$...)', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

/* ── Password input with eye toggle ── */
function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required
        autoComplete={autoComplete}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace('/dashboard/');
    }
  }, [authLoading, isAuthenticated, router]);

  const checks = useMemo(
    () => requirements.map((r) => ({ ...r, pass: r.test(password) })),
    [password],
  );
  const allPassed = checks.every((c) => c.pass);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!allPassed) {
      setError('パスワードが要件を満たしていません');
      return;
    }
    if (password !== confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }
    if (!agreed) {
      setError('利用規約とプライバシーポリシーに同意してください');
      return;
    }

    setLoading(true);

    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback/`,
      },
    });

    if (err) {
      // 日本語化
      const msg =
        err.message === 'User already registered'
          ? 'このメールアドレスは既に登録されています'
          : err.message === 'Signup requires a valid password'
            ? 'パスワードが無効です'
            : err.message;
      setError(msg);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  const handleGoogleRegister = async () => {
    if (!agreed) {
      setError('利用規約とプライバシーポリシーに同意してください');
      return;
    }
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback/`,
      },
    });
    if (err) setError(err.message);
  };

  if (authLoading || isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-muted-foreground text-sm">読み込み中...</div>
      </div>
    );
  }

  // 登録成功 → メール確認待ち
  if (success) {
    return (
      <div className="flex items-center justify-center min-h-[80vh] px-4">
        <div className="w-full max-w-sm space-y-5">
          <div className="text-center space-y-2">
            <Image src="/icon.png" alt="" width={48} height={48} className="mx-auto rounded-lg" unoptimized />
            <h1 className="text-2xl font-bold">Open Regime</h1>
          </div>
          <GlassCard>
            <div className="p-6 text-center space-y-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
              <h2 className="text-lg font-semibold">確認メールを送信しました</h2>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{email}</span> に確認メールを送信しました。
                メール内のリンクをクリックしてアカウントを有効化してください。
              </p>
              <div className="pt-2">
                <Link href="/login/" className="text-sm text-blue-500 hover:underline">
                  ログインページに戻る
                </Link>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-4">
      <div className="w-full max-w-sm space-y-5">
        {/* Logo */}
        <div className="text-center space-y-2">
          <Image src="/icon.png" alt="" width={48} height={48} className="mx-auto rounded-lg" unoptimized />
          <h1 className="text-2xl font-bold">Open Regime</h1>
          <p className="text-sm text-muted-foreground">アカウントを作成</p>
        </div>

        {/* Google OAuth */}
        <GlassCard>
          <div className="p-5">
            <Button variant="outline" className="w-full" onClick={handleGoogleRegister}>
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Google で登録
            </Button>
          </div>
        </GlassCard>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">または</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Email/Password */}
        <GlassCard>
          <form onSubmit={handleRegister} className="p-5 space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
            )}
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
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">パスワード</label>
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder="パスワードを入力"
                autoComplete="new-password"
              />
              {/* Requirements checklist */}
              {password.length > 0 && (
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 pt-1">
                  {checks.map((c) => (
                    <div key={c.key} className="flex items-center gap-1.5">
                      {c.pass ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <X className="w-3 h-3 text-muted-foreground/40" />
                      )}
                      <span className={`text-[11px] ${c.pass ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/60'}`}>
                        {c.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">パスワード（確認）</label>
              <PasswordInput
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="もう一度入力"
                autoComplete="new-password"
              />
              {confirmPassword.length > 0 && password !== confirmPassword && (
                <p className="text-[11px] text-destructive flex items-center gap-1">
                  <X className="w-3 h-3" /> パスワードが一致しません
                </p>
              )}
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-1 rounded border-border"
              />
              <span className="text-xs text-muted-foreground">
                <Link href="/terms/" className="text-blue-500 hover:underline" target="_blank">利用規約</Link>
                と
                <Link href="/privacy/" className="text-blue-500 hover:underline" target="_blank">プライバシーポリシー</Link>
                に同意する
              </span>
            </label>
            <Button type="submit" className="w-full" disabled={loading || !agreed || !allPassed}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'アカウントを作成'}
            </Button>
          </form>
        </GlassCard>

        <p className="text-center text-sm text-muted-foreground">
          すでにアカウントをお持ちの方{' '}
          <Link href="/login/" className="text-blue-500 hover:underline">
            ログイン
          </Link>
        </p>
      </div>
    </div>
  );
}
