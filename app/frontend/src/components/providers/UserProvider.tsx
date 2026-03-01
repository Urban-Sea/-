'use client';

import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { setAccessToken } from '@/lib/auth-store';
import type { Session, User } from '@supabase/supabase-js';

interface UserContextType {
  user: User | null;
  session: Session | null;
  email: string | null;
  initial: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  signOut: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  user: null,
  session: null,
  email: null,
  initial: '?',
  isLoading: true,
  isAuthenticated: false,
  signOut: async () => {},
});

export function useUser() {
  return useContext(UserContext);
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ログイン時に /api/me を1回叩いて public.users にレコードを確保する
  const ensuredRef = useRef(false);
  const ensureUser = (token: string) => {
    if (ensuredRef.current) return;
    ensuredRef.current = true;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
    fetch(`${apiUrl}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {}); // fire-and-forget
  };

  useEffect(() => {
    // 1. Get initial session from localStorage
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setAccessToken(s?.access_token ?? null);
      if (s?.access_token) ensureUser(s.access_token);
      setIsLoading(false);
    });

    // 2. Listen for auth state changes (sign in, sign out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        setSession(s);
        setAccessToken(s?.access_token ?? null);
        if (s?.access_token) ensureUser(s.access_token);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const user = session?.user ?? null;
  const email = user?.email ?? null;
  const initial = email ? email.charAt(0).toUpperCase() : '?';
  const isAuthenticated = !!session;

  const signOut = async () => {
    await supabase.auth.signOut();
    setAccessToken(null);
    window.location.href = '/login/';
  };

  // Block rendering until auth session is resolved.
  // This prevents SWR hooks from firing before token is available.
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-muted-foreground text-sm">認証中...</div>
      </div>
    );
  }

  return (
    <UserContext.Provider value={{ user, session, email, initial, isLoading, isAuthenticated, signOut }}>
      {children}
    </UserContext.Provider>
  );
}
