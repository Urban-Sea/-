'use client';

import { useEffect } from 'react';
import { Sentry } from '@/lib/sentry';

/**
 * B2: Cloudflare Pages デプロイ時の JS チャンク 404 エラーを検知して自動遷移。
 * デプロイで古い JS チャンクが削除されると ChunkLoadError が発生する。
 * 直前にクリックされたリンク先を記録し、チャンクエラー時はそのURLへフルページ遷移する。
 * sessionStorage で10秒以内の連続リロードを防止。
 */
export function ChunkErrorHandler() {
  useEffect(() => {
    const RELOAD_KEY = '__chunk_error_reload';
    const COOLDOWN_MS = 10_000;
    let lastClickedHref: string | null = null;

    function isChunkError(message: string): boolean {
      return (
        message.includes('ChunkLoadError') ||
        message.includes('Loading chunk') ||
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes("Importing a module script failed")
      );
    }

    // リンククリックを追跡（チャンクエラー時の遷移先として使用）
    function onLinkClick(event: MouseEvent) {
      const anchor = (event.target as Element)?.closest('a');
      if (anchor?.href && anchor.href.startsWith(window.location.origin)) {
        lastClickedHref = anchor.href;
        setTimeout(() => { lastClickedHref = null; }, 5000);
      }
    }

    function tryReload() {
      const last = sessionStorage.getItem(RELOAD_KEY);
      if (last && Date.now() - Number(last) < COOLDOWN_MS) {
        return; // クールダウン中 — 無限リロード防止
      }
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));

      // クリック先がわかっていればそこへフルページ遷移、なければリロード
      if (lastClickedHref && lastClickedHref !== window.location.href) {
        window.location.href = lastClickedHref;
      } else {
        window.location.reload();
      }
    }

    function onError(event: ErrorEvent) {
      if (isChunkError(event.message || '')) {
        event.preventDefault();
        Sentry.captureException(event.error || new Error(event.message), {
          tags: { chunk_error: 'true' },
        });
        tryReload();
      }
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const msg = event.reason?.message || String(event.reason || '');
      if (isChunkError(msg)) {
        event.preventDefault();
        Sentry.captureException(event.reason || new Error(msg), {
          tags: { chunk_error: 'true' },
        });
        tryReload();
      }
    }

    document.addEventListener('click', onLinkClick, true);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      document.removeEventListener('click', onLinkClick, true);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  return null;
}
