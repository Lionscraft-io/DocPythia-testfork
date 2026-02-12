/**
 * Auth Routes Unit Tests
 * Tests for authentication API endpoints with session-based auth

 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

// Mock dependencies
vi.mock('../server/auth/multi-instance-auth.js', () => ({
  authenticateAnyInstance: vi.fn(),
  authenticateInstance: vi.fn(),
}));

vi.mock('../server/config/instance-loader.js', () => ({
  InstanceConfigLoader: {
    getAvailableInstances: vi.fn(),
    getAvailableInstancesAsync: vi.fn(),
  },
}));

vi.mock('../server/auth/session.js', () => ({
  setSessionCookies: vi.fn(),
  clearSessionCookies: vi.fn(),
  generateCsrfToken: vi.fn(() => 'mock-csrf-token'),
  getSessionFromRequest: vi.fn(),
  COOKIE_NAMES: {
    accessToken: 'docpythia_access_token',
    refreshToken: 'docpythia_refresh_token',
    csrfToken: 'docpythia_csrf_token',
  },
}));

vi.mock('../server/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Import mocked modules
import {
  authenticateAnyInstance,
  authenticateInstance,
} from '../server/auth/multi-instance-auth.js';
import { InstanceConfigLoader } from '../server/config/instance-loader.js';
import {
  setSessionCookies,
  clearSessionCookies,
  getSessionFromRequest,
} from '../server/auth/session.js';
import authRouter from '../server/routes/auth-routes.js';

const mockedAuthenticateAnyInstance = vi.mocked(authenticateAnyInstance);
const mockedAuthenticateInstance = vi.mocked(authenticateInstance);
const mockedGetAvailableInstances = vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync);
const mockedSetSessionCookies = vi.mocked(setSessionCookies);
const mockedClearSessionCookies = vi.mocked(clearSessionCookies);
const mockedGetSessionFromRequest = vi.mocked(getSessionFromRequest);

describe('Auth Routes', () => {
  let app: Express;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.DISABLE_ADMIN_AUTH;

    // Create fresh Express app for each test
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRouter);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('POST /api/auth/login', () => {
    it('should return 400 if password is missing', async () => {
      const response = await request(app).post('/api/auth/login').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: 'Password is required',
      });
    });

    it('should return success when auth is disabled', async () => {
      process.env.DISABLE_ADMIN_AUTH = 'true';
      mockedGetAvailableInstances.mockResolvedValue(['projecta', 'test']);

      const response = await request(app)
        .post('/api/auth/login')
        .send({ password: 'any-password' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        instanceId: 'projecta',
        csrfToken: 'mock-csrf-token',
        message: 'Authentication disabled (development mode)',
      });
      expect(mockedSetSessionCookies).toHaveBeenCalled();
    });

    it('should return success for valid password with csrf token', async () => {
      mockedAuthenticateAnyInstance.mockResolvedValue({
        success: true,
        instanceId: 'projecta',
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({ password: 'correct-password' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        instanceId: 'projecta',
        csrfToken: 'mock-csrf-token',
        redirectUrl: '/projecta/admin',
      });
      expect(mockedAuthenticateAnyInstance).toHaveBeenCalledWith('correct-password');
      expect(mockedSetSessionCookies).toHaveBeenCalled();
    });

    it('should return 401 for invalid password', async () => {
      mockedAuthenticateAnyInstance.mockResolvedValue({
        success: false,
        error: 'Invalid password',
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({ password: 'wrong-password' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        success: false,
        error: 'Invalid password',
      });
    });

    it('should return 401 with default error when no error message provided', async () => {
      mockedAuthenticateAnyInstance.mockResolvedValue({
        success: false,
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({ password: 'wrong-password' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        success: false,
        error: 'Invalid password',
      });
    });

    it('should return 500 on authentication error', async () => {
      mockedAuthenticateAnyInstance.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/auth/login')
        .send({ password: 'test-password' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Internal server error',
      });
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should clear session cookies on logout', async () => {
      const response = await request(app).post('/api/auth/logout');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        message: 'Logged out successfully',
      });
      expect(mockedClearSessionCookies).toHaveBeenCalled();
    });
  });

  describe('GET /api/auth/session', () => {
    it('should return authenticated true when session exists', async () => {
      mockedGetSessionFromRequest.mockReturnValue({
        instanceId: 'projecta',
        username: 'admin',
        issuedAt: Date.now(),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
      });

      const response = await request(app).get('/api/auth/session');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        authenticated: true,
        instanceId: 'projecta',
        username: 'admin',
      });
    });

    it('should return authenticated false when no session', async () => {
      mockedGetSessionFromRequest.mockReturnValue(null);

      const response = await request(app).get('/api/auth/session');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        authenticated: false,
      });
    });
  });

  describe('POST /api/auth/refresh-csrf', () => {
    it('should return 401 when not authenticated', async () => {
      mockedGetSessionFromRequest.mockReturnValue(null);

      const response = await request(app).post('/api/auth/refresh-csrf');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        success: false,
        error: 'Not authenticated',
      });
    });

    it('should return new csrf token when authenticated', async () => {
      mockedGetSessionFromRequest.mockReturnValue({
        instanceId: 'projecta',
        issuedAt: Date.now(),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
      });

      const response = await request(app).post('/api/auth/refresh-csrf');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        csrfToken: 'mock-csrf-token',
      });
    });
  });

  describe('GET /api/auth/instances', () => {
    it('should return available instances', async () => {
      mockedGetAvailableInstances.mockResolvedValue(['projecta', 'test', 'demo']);

      const response = await request(app).get('/api/auth/instances');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        instances: ['projecta', 'test', 'demo'],
      });
    });

    it('should return empty array when no instances', async () => {
      mockedGetAvailableInstances.mockResolvedValue([]);

      const response = await request(app).get('/api/auth/instances');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        instances: [],
      });
    });

    it('should return 500 on error', async () => {
      mockedGetAvailableInstances.mockRejectedValue(new Error('Config error'));

      const response = await request(app).get('/api/auth/instances');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Failed to get instances',
      });
    });
  });

  describe('POST /api/auth/verify', () => {
    it('should return 400 if password is missing', async () => {
      const response = await request(app).post('/api/auth/verify').send({ instanceId: 'projecta' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: 'Password and instanceId are required',
      });
    });

    it('should return 400 if instanceId is missing', async () => {
      const response = await request(app)
        .post('/api/auth/verify')
        .send({ password: 'test-password' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        success: false,
        error: 'Password and instanceId are required',
      });
    });

    it('should return success when auth is disabled', async () => {
      process.env.DISABLE_ADMIN_AUTH = 'true';

      const response = await request(app)
        .post('/api/auth/verify')
        .send({ password: 'any-password', instanceId: 'projecta' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockedAuthenticateInstance).not.toHaveBeenCalled();
    });

    it('should return success for valid credentials', async () => {
      mockedAuthenticateInstance.mockReturnValue(true);

      const response = await request(app)
        .post('/api/auth/verify')
        .send({ password: 'correct-password', instanceId: 'projecta' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(mockedAuthenticateInstance).toHaveBeenCalledWith('correct-password', 'projecta');
    });

    it('should return 401 for invalid credentials', async () => {
      mockedAuthenticateInstance.mockReturnValue(false);

      const response = await request(app)
        .post('/api/auth/verify')
        .send({ password: 'wrong-password', instanceId: 'projecta' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        success: false,
        error: 'Invalid credentials',
      });
    });

    it('should return 500 on verification error', async () => {
      mockedAuthenticateInstance.mockImplementation(() => {
        throw new Error('Verification error');
      });

      const response = await request(app)
        .post('/api/auth/verify')
        .send({ password: 'test-password', instanceId: 'projecta' });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        success: false,
        error: 'Internal server error',
      });
    });
  });
});
