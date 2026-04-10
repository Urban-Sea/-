'use client';

import { SWRConfig } from 'swr';
import { getMfaToken } from './mfa-store';
import { refreshToken, ApiError } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

async function swrFetcher<T>(endpoint: string): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const mfaToken = getMfaToken();
  let response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(mfaToken ? { 'X-MFA-Token': mfaToken } : {}),
    },
  });

  if (response.status === 401) {
    const refreshed = await refreshToken();
    if (refreshed) {
      response = await fetch(url, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(getMfaToken() ? { 'X-MFA-Token': getMfaToken()! } : {}),
        },
      });
    }
    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).catch(() => {});
        window.location.href = '/api/auth/google';
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
