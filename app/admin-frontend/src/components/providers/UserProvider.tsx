'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { setAuthEmail } from '@/lib/auth-store';

interface UserContextType {
  email: string | null;
  initial: string;
  isLoading: boolean;
}

const UserContext = createContext<UserContextType>({
  email: null,
  initial: '?',
  isLoading: true,
});

export function useUser() {
  return useContext(UserContext);
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/cdn-cgi/access/get-identity')
      .then(res => {
        if (!res.ok) throw new Error('Not authenticated');
        return res.json();
      })
      .then(data => {
        const userEmail = data.email || null;
        setAuthEmail(userEmail);
        setEmail(userEmail);
      })
      .catch(() => {
        setAuthEmail(null);
        setEmail(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const initial = email ? email.charAt(0).toUpperCase() : '?';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-muted-foreground text-sm">認証中...</div>
      </div>
    );
  }

  return (
    <UserContext.Provider value={{ email, initial, isLoading }}>
      {children}
    </UserContext.Provider>
  );
}
