'use client';

import { SWRConfig } from 'swr';
import { getAuthEmail } from './auth-store';
import { getMfaToken } from './mfa-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

async function swrFetcher<T>(endpoint: string): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const email = getAuthEmail();
  const mfaToken = getMfaToken();
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(email ? { 'X-User-Email': email } : {}),
      ...(mfaToken ? { 'X-MFA-Token': mfaToken } : {}),
    },
  });

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
      }}
    >
      {children}
    </SWRConfig>
  );
}
