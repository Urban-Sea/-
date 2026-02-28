'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');

    if (code) {
      // PKCE flow: exchange code for session
      supabase.auth.exchangeCodeForSession(code).then(({ error: err }) => {
        if (err) {
          setError(err.message);
        } else {
          router.replace('/dashboard/');
        }
      });
    } else {
      // Hash fragment flow (handled by detectSessionInUrl)
      // Give Supabase client a moment to process the hash
      const timer = setTimeout(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) {
            router.replace('/dashboard/');
          } else {
            setError('認証に失敗しました。もう一度お試しください。');
          }
        });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [router, searchParams]);

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

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-pulse text-muted-foreground text-sm">認証処理中...</div>
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
