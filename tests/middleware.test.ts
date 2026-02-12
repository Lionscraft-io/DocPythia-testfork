/**
 * Middleware Tests
 * Tests for instance and admin auth middleware

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { hashPassword } from '../server/auth/password.js';

// Mock dependencies
vi.mock('../server/config/instance-loader.js', () => ({
  loadInstanceConfig: vi.fn(),
  InstanceConfigLoader: {
    getAvailableInstances: vi.fn(),
    getAvailableInstancesAsync: vi.fn(),
    has: vi.fn(),
    get: vi.fn(),
    load: vi.fn(),
    loadAsync: vi.fn(),
  },
}));

vi.mock('../server/db/instance-db.js', () => ({
  getInstanceDb: vi.fn(),
}));

import { InstanceConfigLoader } from '../server/config/instance-loader.js';
import { getInstanceDb } from '../server/db/instance-db.js';
import {
  instanceMiddleware,
  requireInstance,
  getInstanceInfo,
} from '../server/middleware/instance.js';
import { multiInstanceAdminAuth } from '../server/middleware/multi-instance-admin-auth.js';

// Helper to create mock request/response/next
function createMockReqResNext() {
  const req: Partial<Request> = {
    params: {},
    headers: {},
    url: '/test',
    path: '/test',
  };
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next: NextFunction = vi.fn();

  return { req: req as Request, res: res as Response, next };
}

describe('Instance Middleware', () => {
  const mockConfig = {
    project: { name: 'Test Project' },
    branding: { logo: 'logo.png' },
    features: { enabled: true },
    widget: { enabled: true },
  };

  const mockDb = { $connect: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISABLE_ADMIN_AUTH;
  });

  describe('instanceMiddleware', () => {
    it('should skip when no instance in params', async () => {
      const { req, res, next } = createMockReqResNext();

      await instanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalledWith('route');
    });

    it('should skip for unrecognized instance', async () => {
      const { req, res, next } = createMockReqResNext();
      req.params = { instance: 'unknown' };
      vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue([
        'projecta',
        'projectb',
      ]);

      await instanceMiddleware(req, res, next);

      expect(next).toHaveBeenCalledWith('route');
    });

    it('should attach instance context for recognized instance', async () => {
      const { req, res, next } = createMockReqResNext();
      req.params = { instance: 'test' };

      vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue(['test']);
      vi.mocked(InstanceConfigLoader.has).mockReturnValue(true);
      vi.mocked(InstanceConfigLoader.get).mockReturnValue(mockConfig as any);
      vi.mocked(getInstanceDb).mockReturnValue(mockDb as any);

      await instanceMiddleware(req, res, next);

      expect((req as any).instance.id).toBe('test');
      expect((req as any).instance.config).toBe(mockConfig);
      expect((req as any).instance.db).toBe(mockDb);
      expect(next).toHaveBeenCalled();
    });

    it('should load config if not cached', async () => {
      const { req, res, next } = createMockReqResNext();
      req.params = { instance: 'uncached' };

      vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue(['uncached']);
      vi.mocked(InstanceConfigLoader.has).mockReturnValue(false);
      vi.mocked(InstanceConfigLoader.loadAsync).mockResolvedValue(mockConfig as any);
      vi.mocked(getInstanceDb).mockReturnValue(mockDb as any);

      await instanceMiddleware(req, res, next);

      expect(InstanceConfigLoader.loadAsync).toHaveBeenCalledWith('uncached');
      expect(next).toHaveBeenCalled();
    });

    it('should handle config load error', async () => {
      const { req, res, next } = createMockReqResNext();
      req.params = { instance: 'broken' };

      vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue(['broken']);
      vi.mocked(InstanceConfigLoader.has).mockReturnValue(false);
      vi.mocked(InstanceConfigLoader.loadAsync).mockRejectedValue(new Error('Config not found'));

      await instanceMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Instance not found',
        message: 'Configuration not found for instance "broken"',
        availableInstances: ['broken'],
      });
    });
  });

  describe('requireInstance', () => {
    it('should call next when instance is present', () => {
      const { req, res, next } = createMockReqResNext();
      (req as any).instance = { id: 'test', config: mockConfig, db: mockDb };

      requireInstance(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 400 when instance is missing', () => {
      const { req, res, next } = createMockReqResNext();

      requireInstance(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'No instance context',
        message: 'This endpoint requires instance context. Ensure instanceMiddleware is applied.',
      });
    });
  });

  describe('getInstanceInfo', () => {
    it('should return instance info when present', () => {
      const { req, res } = createMockReqResNext();
      (req as any).instance = { id: 'test', config: mockConfig, db: mockDb };

      getInstanceInfo(req, res);

      expect(res.json).toHaveBeenCalledWith({
        instanceId: 'test',
        project: mockConfig.project,
        branding: mockConfig.branding,
        features: mockConfig.features,
        widget: mockConfig.widget,
      });
    });

    it('should return 400 when no instance', () => {
      const { req, res } = createMockReqResNext();

      getInstanceInfo(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});

describe('Multi-Instance Admin Auth Middleware', () => {
  const testPassword = 'adminPassword123';
  let testPasswordHash: string;
  let mockConfig: { admin: { passwordHash: string } };
  let wrongPasswordHash: string;
  let wrongConfig: { admin: { passwordHash: string } };

  beforeAll(async () => {
    // Pre-compute hashes once for all tests
    testPasswordHash = await hashPassword(testPassword);
    wrongPasswordHash = await hashPassword('wrong');
    mockConfig = {
      admin: {
        passwordHash: testPasswordHash,
      },
    };
    wrongConfig = {
      admin: { passwordHash: wrongPasswordHash },
    };
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISABLE_ADMIN_AUTH;
  });

  it('should skip auth when DISABLE_ADMIN_AUTH is true', async () => {
    process.env.DISABLE_ADMIN_AUTH = 'true';
    const { req, res, next } = createMockReqResNext();

    await multiInstanceAdminAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 401 when no authorization header', async () => {
    const { req, res, next } = createMockReqResNext();

    await multiInstanceAdminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized: Missing or invalid token',
    });
  });

  it('should return 401 when authorization header is not Bearer', async () => {
    const { req, res, next } = createMockReqResNext();
    req.headers = { authorization: 'Basic token123' };

    await multiInstanceAdminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should authenticate valid token', async () => {
    const { req, res, next } = createMockReqResNext();
    req.headers = { authorization: `Bearer ${testPassword}` };

    vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue(['test']);
    vi.mocked(InstanceConfigLoader.has).mockReturnValue(true);
    vi.mocked(InstanceConfigLoader.get).mockReturnValue(mockConfig as any);

    await multiInstanceAdminAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as any).adminInstance).toBe('test');
  });

  it('should return 403 for invalid token', async () => {
    const { req, res, next } = createMockReqResNext();
    req.headers = { authorization: 'Bearer wrongPassword' };

    vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue(['test']);
    vi.mocked(InstanceConfigLoader.has).mockReturnValue(true);
    vi.mocked(InstanceConfigLoader.get).mockReturnValue(mockConfig as any);

    await multiInstanceAdminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Forbidden: Invalid admin token',
    });
  });

  it('should try all instances until match found', async () => {
    const { req, res, next } = createMockReqResNext();
    req.headers = { authorization: `Bearer ${testPassword}` };

    vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue([
      'wrong1',
      'correct',
    ]);
    vi.mocked(InstanceConfigLoader.has).mockReturnValue(true);
    vi.mocked(InstanceConfigLoader.get).mockImplementation((id: string) => {
      if (id === 'correct') return mockConfig as any;
      return wrongConfig as any;
    });

    await multiInstanceAdminAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as any).adminInstance).toBe('correct');
  });

  it('should load config if not cached', async () => {
    const { req, res, next } = createMockReqResNext();
    req.headers = { authorization: `Bearer ${testPassword}` };

    vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue(['test']);
    vi.mocked(InstanceConfigLoader.has).mockReturnValue(false);
    vi.mocked(InstanceConfigLoader.loadAsync).mockResolvedValue(mockConfig as any);

    await multiInstanceAdminAuth(req, res, next);

    expect(InstanceConfigLoader.loadAsync).toHaveBeenCalledWith('test');
    expect(next).toHaveBeenCalled();
  });

  it('should continue to next instance on config error', async () => {
    const { req, res, next } = createMockReqResNext();
    req.headers = { authorization: `Bearer ${testPassword}` };

    vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue([
      'broken',
      'working',
    ]);
    vi.mocked(InstanceConfigLoader.has).mockReturnValue(false);
    vi.mocked(InstanceConfigLoader.loadAsync).mockImplementation((id: string) => {
      if (id === 'broken') throw new Error('Config error');
      return mockConfig as any;
    });

    await multiInstanceAdminAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as any).adminInstance).toBe('working');
  });
});
