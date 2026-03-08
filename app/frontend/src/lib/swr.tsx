'use client';

import { SWRConfig } from 'swr';
import { getAccessToken, setAccessToken, isRedirecting, markRedirecting } from './auth-store';
import { supabase } from './supabase';
import { Sentry } from './sentry';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.open-regime.com';

async function swrFetcher<T>(endpoint: string): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const token = getAccessToken();
  let response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  // B1: 401 → トークンリフレッシュして再試行
  if (response.status === 401) {
    const { data } = await supabase.auth.refreshSession();
    if (data.session?.access_token) {
      setAccessToken(data.session.access_token);
      response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session.access_token}`,
        },
      });
    }
    // リフレッシュ失敗 or 再試行でも 401 → サインアウトしてログインページへ
    if (response.status === 401) {
      if (typeof window !== 'undefined' && !isRedirecting()) {
        markRedirecting();
        await supabase.auth.signOut();
        setAccessToken(null);
        window.location.href = '/login/';
      }
      throw new Error('Session expired');
    }
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || body.message || JSON.stringify(body);
    } catch {
      // ignore parse error
    }
    throw new Error(`API Error ${response.status}: ${detail}`);
  }

  return response.json();
}

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: swrFetcher,
        revalidateOnFocus: false,
        dedupingInterval: 2000,
        errorRetryCount: 2,
        onError: (error: Error, key: string) => {
          // 4xx はノイズなので Sentry に送らない（5xx・ネットワークエラーのみ）
          if (!error.message?.match(/40[134]/)) {
            Sentry.captureException(error, { tags: { swr_key: key } });
          }
        },
        onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
          // 401/403/404 はリトライしない
          if (error.message?.includes('401') || error.message?.includes('403') || error.message?.includes('404')) {
            return;
          }
          // 最大3回まで指数バックオフでリトライ
          if (retryCount >= 3) return;
          setTimeout(() => revalidate({ retryCount }), 2 ** retryCount * 1000);
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
