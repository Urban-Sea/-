/**
 * Module-level store for the authenticated user's email.
 * Set by UserProvider on mount; read by fetchAPI / swrFetcher to attach
 * the CF-Access-Authenticated-User-Email header to every API call.
 */

let _email: string | null = null;

export function setAuthEmail(email: string | null) {
  _email = email;
}

export function getAuthEmail(): string | null {
  return _email;
}
