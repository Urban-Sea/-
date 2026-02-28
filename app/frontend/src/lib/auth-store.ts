/**
 * Module-level store for the Supabase access token.
 * Set by UserProvider on mount and on token refresh.
 * Read by fetchAPI / swrFetcher to attach Authorization: Bearer header.
 */

let _accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  _accessToken = token;
  // ログイン成功時（token が設定された）にリダイレクトガードをリセット
  if (token) {
    _isRedirecting = false;
  }
}

export function getAccessToken(): string | null {
  return _accessToken;
}

/**
 * 401 → signOut → /login/ の無限ループ防止フラグ。
 * 1回リダイレクトしたら、次のログインまで再リダイレクトをブロックする。
 */
let _isRedirecting = false;

export function isRedirecting(): boolean {
  return _isRedirecting;
}

export function markRedirecting(): void {
  _isRedirecting = true;
}
