'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface UserContextType {
  email: string | null;
  initial: string;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  email: null,
  initial: '?',
  isLoading: true,
  signOut: async () => {},
});

export function useUser() {
  return useContext(UserContext);
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/auth/me`, { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('Not authenticated');
        return res.json();
      })
      .then(data => {
        setEmail(data.email || null);
      })
      .catch(() => {
        setEmail(null);
        window.location.href = '/api/auth/google';
      })
      .finally(() => setIsLoading(false));
  }, []);

  const initial = email ? email.charAt(0).toUpperCase() : '?';

  const signOut = async () => {
    await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).catch(() => {});
    window.location.href = '/api/auth/google';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-muted-foreground text-sm">認証中...</div>
      </div>
    );
  }

  return (
    <UserContext.Provider value={{ email, initial, isLoading, signOut }}>
      {children}
    </UserContext.Provider>
  );
}
