'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Implicit flow: tokens arrive in the URL hash fragment.
    // Supabase client's `detectSessionInUrl` processes the hash automatically
    // when it initialises. We just need to wait for the session to be ready.
    //
    // Also handle legacy PKCE `?code=` param as fallback.
    const code = searchParams.get('code');

    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error: err }) => {
        if (err) {
          setError(err.message);
        } else {
          router.replace('/');
        }
      });
      return;
    }

    // For implicit flow & email confirmation redirects,
    // listen for the auth state change that fires once the hash is processed.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        // M8: ハッシュフラグメントからトークンを除去（ブラウザ履歴に残さない）
        if (window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        router.replace('/');
      }
      // H8: パスワードリカバリーイベント → パスワード更新ページへ
      if (event === 'PASSWORD_RECOVERY' && session) {
        if (window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        router.replace('/update-password/');
      }
    });

    // If session already exists (hash was processed before listener attached)
    const timer = setTimeout(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          router.replace('/');
        } else if (!window.location.hash) {
          // No hash fragment and no code — nothing to process
          setError('認証に失敗しました。もう一度お試しください。');
        }
      });
    }, 1000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
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
