'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchMfaStatus, checkMfaSession } from '@/lib/api';
import { getMfaToken } from '@/lib/mfa-store';
import { MfaSetup } from './MfaSetup';
import { MfaChallenge } from './MfaChallenge';
import { Loader2 } from 'lucide-react';

type MfaState = 'loading' | 'setup' | 'challenge' | 'authenticated';

interface MfaGateProps {
  children: React.ReactNode;
}

export function MfaGate({ children }: MfaGateProps) {
  const [state, setState] = useState<MfaState>('loading');

  const checkAuth = useCallback(async () => {
    try {
      // 1. MFA 設定状態を確認
      const status = await fetchMfaStatus();

      if (!status.mfa_setup || !status.mfa_enabled) {
        // MFA 未設定 → セットアップ画面へ
        setState('setup');
        return;
      }

      // 2. MFA 有効 → セッショントークンを確認
      const token = getMfaToken();
      if (!token) {
        setState('challenge');
        return;
      }

      // 3. トークンの有効性をサーバーで確認
      const session = await checkMfaSession();
      if (session.valid) {
        setState('authenticated');
      } else {
        setState('challenge');
      }
    } catch {
      // API エラー → MFA 未設定とみなして通過（初回導入時の互換性）
      setState('authenticated');
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state === 'setup') {
    return <MfaSetup onComplete={() => setState('authenticated')} />;
  }

  if (state === 'challenge') {
    return <MfaChallenge onSuccess={() => setState('authenticated')} />;
  }

  return <>{children}</>;
}
