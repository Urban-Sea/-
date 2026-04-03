/**
 * 401 → signOut → /login/ の無限ループ防止フラグ。
 * 1回リダイレクトしたら、ページ遷移でメモリがリセットされるまで再リダイレクトをブロックする。
 */
let _isRedirecting = false;

export function isRedirecting(): boolean {
  return _isRedirecting;
}

export function markRedirecting(): void {
  _isRedirecting = true;
}
