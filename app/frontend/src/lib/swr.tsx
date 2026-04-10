'use client';

import { SWRConfig } from 'swr';
import { isRedirecting, markRedirecting } from './auth-store';
import { refreshToken, ApiError } from './api';
import { Sentry } from './sentry';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

async function swrFetcher<T>(endpoint: string): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  let response = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });

  if (response.status === 401) {
    const refreshed = await refreshToken();
    if (refreshed) {
      response = await fetch(url, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (response.status === 401) {
      // 開発環境では auth bypass しているので redirect ループを避けるためエラーだけ throw
      if (typeof window !== 'undefined' && !isRedirecting() && process.env.NODE_ENV !== 'development') {
        markRedirecting();
        fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).catch(() => {});
        window.location.href = '/login/';
      }
      throw new ApiError(401, 'Session expired');
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
    throw new ApiError(response.status, `API Error ${response.status}: ${detail}`);
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
          if (!(error instanceof ApiError && [401, 403, 404].includes(error.status))) {
            Sentry.captureException(error, { tags: { swr_key: key } });
          }
        },
        onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
          if (error instanceof ApiError && [401, 403, 404].includes(error.status)) return;
          if (retryCount >= 3) return;
          setTimeout(() => revalidate({ retryCount }), 2 ** retryCount * 1000);
        },
      }}
    >
      {children}
    </SWRConfig>
  );
}
