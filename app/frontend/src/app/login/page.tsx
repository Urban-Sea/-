'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useUser } from '@/components/providers/UserProvider';
import { GlassCard } from '@/components/shared/glass';
import { Button } from '@/components/ui/button';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useUser();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      router.replace('/');
    }
  }, [authLoading, isAuthenticated, router]);

  const handleGoogleLogin = () => {
    window.location.href = `${API_URL}/api/auth/google`;
  };

  // URL にエラーパラメータがあれば表示
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err) setError(decodeURIComponent(err));
  }, []);

  if (authLoading || isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-muted-foreground text-sm">読み込み中...</div>
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
          <p className="text-sm text-muted-foreground">ログイン・新規登録</p>
        </div>

        {/* Google OAuth */}
        <GlassCard>
          <div className="p-5 space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}
            <Button variant="outline" className="w-full" onClick={handleGoogleLogin}>
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Google でログイン
            </Button>
          </div>
        </GlassCard>

        <p className="text-center text-xs text-muted-foreground">
          初めての方はログイン時にアカウントが自動作成されます
        </p>
      </div>
    </div>
  );
}
