'use client';

import { useEffect } from 'react';

/**
 * B2: Cloudflare Pages デプロイ時の JS チャンク 404 エラーを検知して自動リロード。
 * デプロイで古い JS チャンクが削除されると ChunkLoadError が発生する。
 * sessionStorage で10秒以内の連続リロードを防止。
 */
export function ChunkErrorHandler() {
  useEffect(() => {
    const RELOAD_KEY = '__chunk_error_reload';
    const COOLDOWN_MS = 10_000;

    function isChunkError(message: string): boolean {
      return (
        message.includes('ChunkLoadError') ||
        message.includes('Loading chunk') ||
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes("Importing a module script failed")
      );
    }

    function tryReload() {
      const last = sessionStorage.getItem(RELOAD_KEY);
      if (last && Date.now() - Number(last) < COOLDOWN_MS) {
        return; // クールダウン中 — 無限リロード防止
      }
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      window.location.reload();
    }

    function onError(event: ErrorEvent) {
      if (isChunkError(event.message || '')) {
        event.preventDefault();
        tryReload();
      }
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const msg = event.reason?.message || String(event.reason || '');
      if (isChunkError(msg)) {
        event.preventDefault();
        tryReload();
      }
    }

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  return null;
}
