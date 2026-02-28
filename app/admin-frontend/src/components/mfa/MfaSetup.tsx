'use client';

import { useState } from 'react';
import { startMfaSetup, verifyMfaSetup } from '@/lib/api';
import { setMfaToken } from '@/lib/mfa-store';
import { GlassCard } from '@/components/shared/glass';
import { Button } from '@/components/ui/button';
import { Loader2, Shield, Copy, Check } from 'lucide-react';

interface MfaSetupProps {
  onComplete: () => void;
}

export function MfaSetup({ onComplete }: MfaSetupProps) {
  const [step, setStep] = useState<'init' | 'scan' | 'verify'>('init');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleStartSetup = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await startMfaSetup();
      setQrCode(res.qr_code);
      setSecret(res.secret);
      setStep('scan');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'セットアップに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleCopySecret = async () => {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVerify = async () => {
    if (code.length !== 6) return;
    setLoading(true);
    setError('');
    try {
      const res = await verifyMfaSetup(code);
      setMfaToken(res.token, res.expires_at);
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : '認証コードが正しくありません');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  // 初期画面: セットアップ開始
  if (step === 'init') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4">
        <GlassCard>
          <div className="px-8 py-6 text-center space-y-4 max-w-sm">
            <Shield className="w-12 h-12 mx-auto text-amber-500" />
            <h2 className="text-lg font-bold">二要素認証のセットアップ</h2>
            <p className="text-sm text-muted-foreground">
              Google Authenticator 等の TOTP アプリで、管理画面のセキュリティを強化します。
            </p>
            <Button onClick={handleStartSetup} disabled={loading} className="w-full">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              セットアップを開始
            </Button>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        </GlassCard>
      </div>
    );
  }

  // QR スキャン画面
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4">
      <GlassCard>
        <div className="px-8 py-6 text-center space-y-4 max-w-sm">
          <Shield className="w-8 h-8 mx-auto text-amber-500" />
          <h2 className="text-lg font-bold">QR コードをスキャン</h2>
          <p className="text-xs text-muted-foreground">
            Authenticator アプリで下の QR コードをスキャンしてください。
          </p>

          {/* QR Code */}
          {qrCode && (
            <div className="flex justify-center">
              <img src={qrCode} alt="TOTP QR Code" className="w-48 h-48 rounded-lg bg-white p-2" />
            </div>
          )}

          {/* Manual secret */}
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground">手動入力用シークレット:</p>
            <div className="flex items-center gap-1 justify-center">
              <code className="text-xs font-mono bg-muted px-2 py-1 rounded select-all break-all">
                {secret}
              </code>
              <button
                onClick={handleCopySecret}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>

          {/* Verify code */}
          <div className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground">
              アプリに表示された6桁コードを入力:
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
              確認して有効化
            </Button>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
