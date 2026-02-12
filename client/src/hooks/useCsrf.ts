/**
 * CSRF Token Utilities
 *
 * Manages CSRF tokens for secure mutating requests.
 * The CSRF token is stored in a cookie (readable by JS) and must be
 * sent in the X-CSRF-Token header for POST/PUT/PATCH/DELETE requests.
 */

const CSRF_COOKIE_NAME = 'docpythia_csrf_token';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

/**
 * Store CSRF token in memory (backup for when cookie is not accessible)
 */
let csrfTokenCache: string | null = null;

export function setCsrfTokenCache(token: string): void {
  csrfTokenCache = token;
}

/**
 * Get CSRF token from cookie or cache
 */
function getCsrfTokenFromCookie(): string | null {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === CSRF_COOKIE_NAME) {
      return decodeURIComponent(value);
    }
  }
  return null;
}

function getEffectiveCsrfToken(): string | null {
  return getCsrfTokenFromCookie() || csrfTokenCache;
}

/**
 * Get CSRF headers for mutating requests
 */
export function getCsrfHeaders(): Record<string, string> {
  const token = getEffectiveCsrfToken();
  if (token) {
    return { [CSRF_HEADER_NAME]: token };
  }
  return {};
}

/**
 * Check if a request method requires CSRF protection
 */
export function requiresCsrf(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}
