'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { Sentry } from '@/lib/sentry';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface UserInfo {
  id: string;
  email: string;
  display_name: string | null;
  plan: string;
  is_admin?: boolean;
}

interface UserContextType {
  user: UserInfo | null;
  email: string | null;
  initial: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  user: null,
  email: null,
  initial: '?',
  isLoading: true,
  isAuthenticated: false,
  signOut: async () => {},
  refreshUser: async () => {},
});

export function useUser() {
  return useContext(UserContext);
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        Sentry.setUser({ id: data.id });
      } else if (res.status === 401) {
        setUser(null);
        Sentry.setUser(null);
      }
      // 5xx / network error → user を変更しない（一時障害で認証済みユーザーがログアウトされるのを防ぐ）
    } catch {
      // network error — keep current user state
    }
  }, []);

  useEffect(() => {
    // ── 開発環境では Google 認証をスキップしてダミー user を入れる
    if (process.env.NODE_ENV === 'development') {
      setUser({ id: 'local-dev', email: 'dev@localhost', display_name: 'Local Dev', plan: 'free' });
      setIsLoading(false);
      return;
    }
    fetchMe().finally(() => setIsLoading(false));
  }, [fetchMe]);

  const email = user?.email ?? null;
  const initial = email ? email.charAt(0).toUpperCase() : '?';
  const isAuthenticated = !!user;

  const signOut = async () => {
    await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).catch(() => {});
    Sentry.setUser(null);
    window.location.href = '/login/';
  };

  const refreshUser = fetchMe;

  return (
    <UserContext.Provider value={{ user, email, initial, isLoading, isAuthenticated, signOut, refreshUser }}>
      {children}
    </UserContext.Provider>
  );
}
