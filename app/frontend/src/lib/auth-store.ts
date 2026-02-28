/**
 * Module-level store for the Supabase access token.
 * Set by UserProvider on mount and on token refresh.
 * Read by fetchAPI / swrFetcher to attach Authorization: Bearer header.
 */

let _accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}
