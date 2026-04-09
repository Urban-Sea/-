'use client';

import Link from 'next/link';
import { useUser } from '@/components/providers/UserProvider';

/**
 * ランディングページの CTA ボタン。
 * 認証状態に応じて「無料ではじめる / アカウント作成」↔「ダッシュボードを開く / ダッシュボードへ」を出し分ける。
 *
 * isLoading 中は未認証版を表示 (SSR と一致させてハイドレーションミスマッチを避ける)。
 * 認証判明後に文言が一瞬切り替わる可能性はあるが、ランディング再訪時の軽微なフラッシュとして許容。
 */
export function LandingCTA({ variant }: { variant: 'hero' | 'final' }) {
  const { isAuthenticated } = useUser();

  if (variant === 'hero') {
    const href = isAuthenticated ? '/dashboard' : '/login/';
    const label = isAuthenticated ? 'ダッシュボードを開く →' : '無料ではじめる →';
    return (
      <div className="mt-12 flex flex-wrap gap-4">
        <Link
          href={href}
          className="inline-flex items-center rounded-full bg-brand-primary px-8 py-4 text-base font-semibold text-white shadow-md hover:opacity-90 transition-opacity"
        >
          {label}
        </Link>
        <Link
          href="#features"
          className="inline-flex items-center rounded-full border border-slate-300 px-8 py-4 text-base font-semibold text-slate-800 hover:bg-white"
        >
          機能を見る
        </Link>
      </div>
    );
  }

  // variant === 'final'
  const href = isAuthenticated ? '/dashboard' : '/login/';
  const label = isAuthenticated ? 'ダッシュボードへ →' : 'アカウント作成 →';
  return (
    <Link
      href={href}
      className="mt-14 inline-flex items-center rounded-full bg-white px-12 py-5 text-base md:text-lg font-semibold text-slate-900 hover:bg-slate-100 shadow-xl"
    >
      {label}
    </Link>
  );
}
