/**
 * Session Management
 *
 * Secure session handling with JWT tokens and httpOnly cookies.
 * Implements CSRF protection and token refresh.
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Response, Request } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Session');

// Session configuration
const JWT_SECRET =
  process.env.JWT_SECRET || process.env.ADMIN_TOKEN || crypto.randomBytes(32).toString('hex');
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');
const ACCESS_TOKEN_EXPIRY = '15m'; // Short-lived access token
const REFRESH_TOKEN_EXPIRY = '7d'; // Longer-lived refresh token
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

// Cookie names
export const COOKIE_NAMES = {
  accessToken: 'docpythia_access_token',
  refreshToken: 'docpythia_refresh_token',
  csrfToken: 'docpythia_csrf_token',
} as const;

/**
 * Session payload stored in JWT
 */
export interface SessionPayload {
  instanceId: string;
  username?: string;
  issuedAt: number;
}

/**
 * Decoded session from JWT
 */
export interface DecodedSession extends SessionPayload {
  iat: number;
  exp: number;
}

/**
 * Generate a CSRF token
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create access token
 */
export function createAccessToken(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

/**
 * Create refresh token
 */
export function createRefreshToken(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

/**
 * Verify access token
 */
export function verifyAccessToken(token: string): DecodedSession | null {
  try {
    return jwt.verify(token, JWT_SECRET) as DecodedSession;
  } catch {
    return null;
  }
}

/**
 * Verify refresh token
 */
export function verifyRefreshToken(token: string): DecodedSession | null {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET) as DecodedSession;
  } catch {
    return null;
  }
}

/**
 * Cookie options for secure session cookies
 */
function getCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
}

/**
 * Set session cookies on response
 */
export function setSessionCookies(res: Response, session: SessionPayload, csrfToken: string): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = getCookieOptions(isProduction);

  const accessToken = createAccessToken(session);
  const refreshToken = createRefreshToken(session);

  // Set httpOnly cookies for tokens
  res.cookie(COOKIE_NAMES.accessToken, accessToken, cookieOptions);
  res.cookie(COOKIE_NAMES.refreshToken, refreshToken, cookieOptions);

  // CSRF token is NOT httpOnly so JavaScript can read it
  res.cookie(COOKIE_NAMES.csrfToken, csrfToken, {
    ...cookieOptions,
    httpOnly: false, // Must be readable by JavaScript
  });

  logger.debug(`Session cookies set for instance: ${session.instanceId}`);
}

/**
 * Clear session cookies
 */
export function clearSessionCookies(res: Response): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
  };

  res.clearCookie(COOKIE_NAMES.accessToken, cookieOptions);
  res.clearCookie(COOKIE_NAMES.refreshToken, cookieOptions);
  res.clearCookie(COOKIE_NAMES.csrfToken, { ...cookieOptions, httpOnly: false });

  logger.debug('Session cookies cleared');
}

/**
 * Get session from request cookies
 */
export function getSessionFromRequest(req: Request): DecodedSession | null {
  const accessToken = req.cookies?.[COOKIE_NAMES.accessToken];

  if (!accessToken) {
    return null;
  }

  return verifyAccessToken(accessToken);
}

/**
 * Get refresh token from request
 */
export function getRefreshTokenFromRequest(req: Request): string | null {
  return req.cookies?.[COOKIE_NAMES.refreshToken] || null;
}

/**
 * Verify CSRF token from request
 */
export function verifyCsrfToken(req: Request): boolean {
  const cookieToken = req.cookies?.[COOKIE_NAMES.csrfToken];
  const headerToken = req.headers['x-csrf-token'] as string;

  if (!cookieToken || !headerToken) {
    return false;
  }

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
  } catch {
    return false;
  }
}

/**
 * Refresh session tokens if refresh token is valid
 */
export function refreshSession(
  req: Request,
  res: Response
): { success: boolean; session?: SessionPayload } {
  const refreshToken = getRefreshTokenFromRequest(req);

  if (!refreshToken) {
    return { success: false };
  }

  const decoded = verifyRefreshToken(refreshToken);

  if (!decoded) {
    return { success: false };
  }

  // Create new session
  const session: SessionPayload = {
    instanceId: decoded.instanceId,
    username: decoded.username,
    issuedAt: Date.now(),
  };

  const csrfToken = generateCsrfToken();
  setSessionCookies(res, session, csrfToken);

  return { success: true, session };
}

/**
 * Check if request is authenticated (has valid session)
 */
export function isAuthenticated(req: Request): boolean {
  return getSessionFromRequest(req) !== null;
}

/**
 * Get instance ID from authenticated request
 */
export function getInstanceFromRequest(req: Request): string | null {
  const session = getSessionFromRequest(req);
  return session?.instanceId || null;
}
