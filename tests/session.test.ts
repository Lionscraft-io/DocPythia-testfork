/**
 * Session Management Unit Tests
 * Tests for JWT session handling, CSRF protection, and cookie management

 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

// Mock the logger
vi.mock('../server/utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocks
import {
  generateCsrfToken,
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  setSessionCookies,
  clearSessionCookies,
  getSessionFromRequest,
  getRefreshTokenFromRequest,
  verifyCsrfToken,
  refreshSession,
  isAuthenticated,
  getInstanceFromRequest,
  COOKIE_NAMES,
  type SessionPayload,
} from '../server/auth/session.js';

describe('Session Management', () => {
  const testPayload: SessionPayload = {
    instanceId: 'test-instance',
    username: 'testuser',
    issuedAt: Date.now(),
  };

  describe('COOKIE_NAMES', () => {
    it('should export correct cookie names', () => {
      expect(COOKIE_NAMES.accessToken).toBe('docpythia_access_token');
      expect(COOKIE_NAMES.refreshToken).toBe('docpythia_refresh_token');
      expect(COOKIE_NAMES.csrfToken).toBe('docpythia_csrf_token');
    });
  });

  describe('generateCsrfToken', () => {
    it('should generate a 64-character hex string', () => {
      const token = generateCsrfToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate unique tokens each time', () => {
      const token1 = generateCsrfToken();
      const token2 = generateCsrfToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('createAccessToken', () => {
    it('should create a valid JWT access token', () => {
      const token = createAccessToken(testPayload);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should include payload data in token', () => {
      const token = createAccessToken(testPayload);
      const decoded = jwt.decode(token) as any;
      expect(decoded.instanceId).toBe(testPayload.instanceId);
      expect(decoded.username).toBe(testPayload.username);
    });

    it('should set expiration on token', () => {
      const token = createAccessToken(testPayload);
      const decoded = jwt.decode(token) as any;
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
      // Token should expire within 15 minutes (900 seconds)
      expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(900);
    });
  });

  describe('createRefreshToken', () => {
    it('should create a valid JWT refresh token', () => {
      const token = createRefreshToken(testPayload);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should set longer expiration than access token', () => {
      const accessToken = createAccessToken(testPayload);
      const refreshToken = createRefreshToken(testPayload);

      const accessDecoded = jwt.decode(accessToken) as any;
      const refreshDecoded = jwt.decode(refreshToken) as any;

      // Refresh token should have longer expiry
      expect(refreshDecoded.exp - refreshDecoded.iat).toBeGreaterThan(
        accessDecoded.exp - accessDecoded.iat
      );
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify a valid access token', () => {
      const token = createAccessToken(testPayload);
      const decoded = verifyAccessToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded?.instanceId).toBe(testPayload.instanceId);
      expect(decoded?.username).toBe(testPayload.username);
    });

    it('should return null for invalid token', () => {
      const result = verifyAccessToken('invalid-token');
      expect(result).toBeNull();
    });

    it('should return null for empty token', () => {
      const result = verifyAccessToken('');
      expect(result).toBeNull();
    });

    it('should return null for tampered token', () => {
      const token = createAccessToken(testPayload);
      const tamperedToken = token.slice(0, -5) + 'xxxxx';
      const result = verifyAccessToken(tamperedToken);
      expect(result).toBeNull();
    });

    it('should return null for refresh token (wrong secret)', () => {
      const refreshToken = createRefreshToken(testPayload);
      const result = verifyAccessToken(refreshToken);
      expect(result).toBeNull();
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify a valid refresh token', () => {
      const token = createRefreshToken(testPayload);
      const decoded = verifyRefreshToken(token);

      expect(decoded).not.toBeNull();
      expect(decoded?.instanceId).toBe(testPayload.instanceId);
    });

    it('should return null for invalid token', () => {
      const result = verifyRefreshToken('invalid-token');
      expect(result).toBeNull();
    });

    it('should return null for access token (wrong secret)', () => {
      const accessToken = createAccessToken(testPayload);
      const result = verifyRefreshToken(accessToken);
      expect(result).toBeNull();
    });
  });

  describe('setSessionCookies', () => {
    let mockRes: Partial<Response>;
    let cookiesSent: Record<string, { value: string; options: any }>;

    beforeEach(() => {
      cookiesSent = {};
      mockRes = {
        cookie: vi.fn((name: string, value: string, options: any) => {
          cookiesSent[name] = { value, options };
          return mockRes as Response;
        }),
      };
    });

    it('should set all three cookies', () => {
      const csrfToken = generateCsrfToken();
      setSessionCookies(mockRes as Response, testPayload, csrfToken);

      expect(mockRes.cookie).toHaveBeenCalledTimes(3);
      expect(cookiesSent[COOKIE_NAMES.accessToken]).toBeDefined();
      expect(cookiesSent[COOKIE_NAMES.refreshToken]).toBeDefined();
      expect(cookiesSent[COOKIE_NAMES.csrfToken]).toBeDefined();
    });

    it('should set httpOnly for access and refresh tokens', () => {
      setSessionCookies(mockRes as Response, testPayload, 'csrf-token');

      expect(cookiesSent[COOKIE_NAMES.accessToken].options.httpOnly).toBe(true);
      expect(cookiesSent[COOKIE_NAMES.refreshToken].options.httpOnly).toBe(true);
    });

    it('should NOT set httpOnly for CSRF token', () => {
      setSessionCookies(mockRes as Response, testPayload, 'csrf-token');

      expect(cookiesSent[COOKIE_NAMES.csrfToken].options.httpOnly).toBe(false);
    });

    it('should set sameSite to lax', () => {
      setSessionCookies(mockRes as Response, testPayload, 'csrf-token');

      expect(cookiesSent[COOKIE_NAMES.accessToken].options.sameSite).toBe('lax');
    });

    it('should set correct maxAge (7 days)', () => {
      setSessionCookies(mockRes as Response, testPayload, 'csrf-token');

      const expectedMaxAge = 7 * 24 * 60 * 60 * 1000;
      expect(cookiesSent[COOKIE_NAMES.accessToken].options.maxAge).toBe(expectedMaxAge);
    });

    it('should set valid JWT tokens', () => {
      setSessionCookies(mockRes as Response, testPayload, 'csrf-token');

      const accessToken = cookiesSent[COOKIE_NAMES.accessToken].value;
      const refreshToken = cookiesSent[COOKIE_NAMES.refreshToken].value;

      expect(verifyAccessToken(accessToken)).not.toBeNull();
      expect(verifyRefreshToken(refreshToken)).not.toBeNull();
    });
  });

  describe('clearSessionCookies', () => {
    let mockRes: Partial<Response>;
    let clearedCookies: string[];

    beforeEach(() => {
      clearedCookies = [];
      mockRes = {
        clearCookie: vi.fn((name: string) => {
          clearedCookies.push(name);
          return mockRes as Response;
        }),
      };
    });

    it('should clear all three cookies', () => {
      clearSessionCookies(mockRes as Response);

      expect(mockRes.clearCookie).toHaveBeenCalledTimes(3);
      expect(clearedCookies).toContain(COOKIE_NAMES.accessToken);
      expect(clearedCookies).toContain(COOKIE_NAMES.refreshToken);
      expect(clearedCookies).toContain(COOKIE_NAMES.csrfToken);
    });
  });

  describe('getSessionFromRequest', () => {
    it('should return decoded session when valid access token exists', () => {
      const token = createAccessToken(testPayload);
      const mockReq = {
        cookies: {
          [COOKIE_NAMES.accessToken]: token,
        },
      } as unknown as Request;

      const session = getSessionFromRequest(mockReq);

      expect(session).not.toBeNull();
      expect(session?.instanceId).toBe(testPayload.instanceId);
    });

    it('should return null when no cookies exist', () => {
      const mockReq = {
        cookies: undefined,
      } as unknown as Request;

      const session = getSessionFromRequest(mockReq);
      expect(session).toBeNull();
    });

    it('should return null when access token cookie is missing', () => {
      const mockReq = {
        cookies: {},
      } as unknown as Request;

      const session = getSessionFromRequest(mockReq);
      expect(session).toBeNull();
    });

    it('should return null when access token is invalid', () => {
      const mockReq = {
        cookies: {
          [COOKIE_NAMES.accessToken]: 'invalid-token',
        },
      } as unknown as Request;

      const session = getSessionFromRequest(mockReq);
      expect(session).toBeNull();
    });
  });

  describe('getRefreshTokenFromRequest', () => {
    it('should return refresh token when it exists', () => {
      const mockReq = {
        cookies: {
          [COOKIE_NAMES.refreshToken]: 'refresh-token-value',
        },
      } as unknown as Request;

      const token = getRefreshTokenFromRequest(mockReq);
      expect(token).toBe('refresh-token-value');
    });

    it('should return null when refresh token is missing', () => {
      const mockReq = {
        cookies: {},
      } as unknown as Request;

      const token = getRefreshTokenFromRequest(mockReq);
      expect(token).toBeNull();
    });

    it('should return null when cookies are undefined', () => {
      const mockReq = {
        cookies: undefined,
      } as unknown as Request;

      const token = getRefreshTokenFromRequest(mockReq);
      expect(token).toBeNull();
    });
  });

  describe('verifyCsrfToken', () => {
    const csrfToken = 'a'.repeat(64);

    it('should return true when tokens match', () => {
      const mockReq = {
        cookies: {
          [COOKIE_NAMES.csrfToken]: csrfToken,
        },
        headers: {
          'x-csrf-token': csrfToken,
        },
      } as unknown as Request;

      expect(verifyCsrfToken(mockReq)).toBe(true);
    });

    it('should return false when tokens do not match', () => {
      const mockReq = {
        cookies: {
          [COOKIE_NAMES.csrfToken]: csrfToken,
        },
        headers: {
          'x-csrf-token': 'b'.repeat(64),
        },
      } as unknown as Request;

      expect(verifyCsrfToken(mockReq)).toBe(false);
    });

    it('should return false when cookie token is missing', () => {
      const mockReq = {
        cookies: {},
        headers: {
          'x-csrf-token': csrfToken,
        },
      } as unknown as Request;

      expect(verifyCsrfToken(mockReq)).toBe(false);
    });

    it('should return false when header token is missing', () => {
      const mockReq = {
        cookies: {
          [COOKIE_NAMES.csrfToken]: csrfToken,
        },
        headers: {},
      } as unknown as Request;

      expect(verifyCsrfToken(mockReq)).toBe(false);
    });

    it('should return false when tokens have different lengths', () => {
      const mockReq = {
        cookies: {
          [COOKIE_NAMES.csrfToken]: csrfToken,
        },
        headers: {
          'x-csrf-token': 'short',
        },
      } as unknown as Request;

      expect(verifyCsrfToken(mockReq)).toBe(false);
    });

    it('should return false when both tokens are missing', () => {
      const mockReq = {
        cookies: {},
        headers: {},
      } as unknown as Request;

      expect(verifyCsrfToken(mockReq)).toBe(false);
    });
  });

  describe('refreshSession', () => {
    let mockRes: Partial<Response>;
    let cookiesSent: Record<string, any>;

    beforeEach(() => {
      cookiesSent = {};
      mockRes = {
        cookie: vi.fn((name: string, value: string, options: any) => {
          cookiesSent[name] = { value, options };
          return mockRes as Response;
        }),
      };
    });

    it('should refresh session when valid refresh token exists', () => {
      const refreshToken = createRefreshToken(testPayload);
      const mockReq = {
        cookies: {
          [COOKIE_NAMES.refreshToken]: refreshToken,
        },
      } as unknown as Request;

      const result = refreshSession(mockReq, mockRes as Response);

      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session?.instanceId).toBe(testPayload.instanceId);
    });

    it('should set new cookies when refresh succeeds', () => {
      const refreshToken = createRefreshToken(testPayload);
      const mockReq = {
        cookies: {
          [COOKIE_NAMES.refreshToken]: refreshToken,
        },
      } as unknown as Request;

      refreshSession(mockReq, mockRes as Response);

      expect(mockRes.cookie).toHaveBeenCalled();
      expect(cookiesSent[COOKIE_NAMES.accessToken]).toBeDefined();
    });

    it('should return failure when refresh token is missing', () => {
      const mockReq = {
        cookies: {},
      } as unknown as Request;

      const result = refreshSession(mockReq, mockRes as Response);

      expect(result.success).toBe(false);
      expect(result.session).toBeUndefined();
    });

    it('should return failure when refresh token is invalid', () => {
      const mockReq = {
        cookies: {
          [COOKIE_NAMES.refreshToken]: 'invalid-token',
        },
      } as unknown as Request;

      const result = refreshSession(mockReq, mockRes as Response);

      expect(result.success).toBe(false);
      expect(result.session).toBeUndefined();
    });
  });

  describe('isAuthenticated', () => {
    it('should return true when valid session exists', () => {
      const token = createAccessToken(testPayload);
      const mockReq = {
        cookies: {
          [COOKIE_NAMES.accessToken]: token,
        },
      } as unknown as Request;

      expect(isAuthenticated(mockReq)).toBe(true);
    });

    it('should return false when no session exists', () => {
      const mockReq = {
        cookies: {},
      } as unknown as Request;

      expect(isAuthenticated(mockReq)).toBe(false);
    });

    it('should return false when session is invalid', () => {
      const mockReq = {
        cookies: {
          [COOKIE_NAMES.accessToken]: 'invalid',
        },
      } as unknown as Request;

      expect(isAuthenticated(mockReq)).toBe(false);
    });
  });

  describe('getInstanceFromRequest', () => {
    it('should return instanceId when valid session exists', () => {
      const token = createAccessToken(testPayload);
      const mockReq = {
        cookies: {
          [COOKIE_NAMES.accessToken]: token,
        },
      } as unknown as Request;

      expect(getInstanceFromRequest(mockReq)).toBe(testPayload.instanceId);
    });

    it('should return null when no session exists', () => {
      const mockReq = {
        cookies: {},
      } as unknown as Request;

      expect(getInstanceFromRequest(mockReq)).toBeNull();
    });
  });

  describe('Production mode cookie options', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should set secure=true in production', () => {
      process.env.NODE_ENV = 'production';

      const cookiesSent: Record<string, any> = {};
      const mockRes = {
        cookie: vi.fn((name: string, value: string, options: any) => {
          cookiesSent[name] = { value, options };
          return mockRes as Response;
        }),
      } as unknown as Response;

      setSessionCookies(mockRes, testPayload, 'csrf-token');

      expect(cookiesSent[COOKIE_NAMES.accessToken].options.secure).toBe(true);
    });

    it('should set secure=false in development', () => {
      process.env.NODE_ENV = 'development';

      const cookiesSent: Record<string, any> = {};
      const mockRes = {
        cookie: vi.fn((name: string, value: string, options: any) => {
          cookiesSent[name] = { value, options };
          return mockRes as Response;
        }),
      } as unknown as Response;

      setSessionCookies(mockRes, testPayload, 'csrf-token');

      expect(cookiesSent[COOKIE_NAMES.accessToken].options.secure).toBe(false);
    });
  });
});
