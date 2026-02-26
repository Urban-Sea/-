'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

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
        setEmail(data.email || null);
      })
      .catch(() => {
        setEmail(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const initial = email ? email.charAt(0).toUpperCase() : '?';

  return (
    <UserContext.Provider value={{ email, initial, isLoading }}>
      {children}
    </UserContext.Provider>
  );
}
