'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/components/providers/UserProvider';

export default function AuthCallbackPage() {
  const router = useRouter();
  const { refreshUser } = useUser();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // api-go GoogleCallback が Cookie 設定済みでここにリダイレクトしてくる
    refreshUser()
      .then(() => {
        router.replace('/');
      })
      .catch(() => {
        setError('認証に失敗しました。もう一度お試しください。');
      });
  }, [refreshUser, router]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <p className="text-destructive text-sm">{error}</p>
          <a href="/login/" className="text-sm text-blue-500 hover:underline">
            ログインに戻る
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="animate-pulse text-muted-foreground text-sm">認証処理中...</div>
    </div>
  );
}
