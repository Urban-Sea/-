'use client';

import { useState } from 'react';
import { verifyMfaCode } from '@/lib/api';
import { setMfaToken } from '@/lib/mfa-store';
import { GlassCard } from '@/components/shared/glass';
import { Button } from '@/components/ui/button';
import { Loader2, Shield } from 'lucide-react';

interface MfaChallengeProps {
  onSuccess: () => void;
}

export function MfaChallenge({ onSuccess }: MfaChallengeProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleVerify = async () => {
    if (code.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      const res = await verifyMfaCode(code);
      setMfaToken(res.token, res.expires_at);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : '認証コードが正しくありません');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4">
      <GlassCard>
        <div className="px-8 py-6 text-center space-y-4 max-w-xs">
          <Shield className="w-10 h-10 mx-auto text-amber-500" />
          <h2 className="text-lg font-bold">二要素認証</h2>
          <p className="text-sm text-muted-foreground">
            Authenticator アプリの6桁コードを入力してください。
          </p>

          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => e.key === 'Enter' && handleVerify()}
            placeholder="000000"
            className="w-full text-center text-2xl font-mono tracking-[0.5em] px-4 py-2 rounded border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />

          <Button
            onClick={handleVerify}
            disabled={loading || code.length !== 6}
            className="w-full"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            認証
          </Button>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </GlassCard>
    </div>
  );
}
