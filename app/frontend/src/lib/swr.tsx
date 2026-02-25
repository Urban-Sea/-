'use client';

import { SWRConfig } from 'swr';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://empathetic-hope-production.up.railway.app';

async function swrFetcher<T>(endpoint: string): Promise<T> {
  const url = `${API_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
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
