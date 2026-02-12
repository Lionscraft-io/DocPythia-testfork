/**
 * Multi-Instance Authentication Tests
 * Tests for instance-based authentication

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { hashPassword } from '../server/auth/password.js';

// Mock the InstanceConfigLoader
vi.mock('../server/config/instance-loader.js', () => ({
  InstanceConfigLoader: {
    getAvailableInstances: vi.fn(),
    getAvailableInstancesAsync: vi.fn(),
    has: vi.fn(),
    get: vi.fn(),
    load: vi.fn(),
    loadAsync: vi.fn(),
  },
}));

import { InstanceConfigLoader } from '../server/config/instance-loader.js';
import {
  authenticateAnyInstance,
  authenticateInstance,
} from '../server/auth/multi-instance-auth.js';

describe('Multi-Instance Authentication', () => {
  const testPassword = 'testPassword123';
  let testPasswordHash: string;
  let mockConfig: { admin: { passwordHash: string } };
  let wrongPasswordHash: string;
  let wrongConfig: { admin: { passwordHash: string } };

  beforeAll(async () => {
    // Pre-compute hashes once for all tests
    testPasswordHash = await hashPassword(testPassword);
    wrongPasswordHash = await hashPassword('wrongPassword');
    mockConfig = {
      admin: {
        passwordHash: testPasswordHash,
      },
    };
    wrongConfig = {
      admin: {
        passwordHash: wrongPasswordHash,
      },
    };
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authenticateAnyInstance', () => {
    it('should return error when no instances are configured', async () => {
      vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue([]);

      const result = await authenticateAnyInstance(testPassword);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No instances configured');
    });

    it('should authenticate against matching instance', async () => {
      vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue([
        'projecta',
        'projectb',
      ]);
      vi.mocked(InstanceConfigLoader.has).mockReturnValue(true);
      vi.mocked(InstanceConfigLoader.get).mockReturnValue(mockConfig as any);

      const result = await authenticateAnyInstance(testPassword);

      expect(result.success).toBe(true);
      expect(result.instanceId).toBe('projecta');
    });

    it('should try all instances until match found', async () => {
      vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue([
        'wrong1',
        'wrong2',
        'correct',
      ]);
      vi.mocked(InstanceConfigLoader.has).mockReturnValue(true);
      vi.mocked(InstanceConfigLoader.get).mockImplementation((id: string) => {
        if (id === 'correct') return mockConfig as any;
        return wrongConfig as any;
      });

      const result = await authenticateAnyInstance(testPassword);

      expect(result.success).toBe(true);
      expect(result.instanceId).toBe('correct');
    });

    it('should return error when no instance matches', async () => {
      vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue([
        'instance1',
        'instance2',
      ]);
      vi.mocked(InstanceConfigLoader.has).mockReturnValue(true);
      vi.mocked(InstanceConfigLoader.get).mockReturnValue(wrongConfig as any);

      const result = await authenticateAnyInstance(testPassword);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid password');
    });

    it('should load config if not cached', async () => {
      vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue(['uncached']);
      vi.mocked(InstanceConfigLoader.has).mockReturnValue(false);
      vi.mocked(InstanceConfigLoader.loadAsync).mockResolvedValue(mockConfig as any);

      const result = await authenticateAnyInstance(testPassword);

      expect(InstanceConfigLoader.loadAsync).toHaveBeenCalledWith('uncached');
      expect(result.success).toBe(true);
    });

    it('should continue to next instance on config load error', async () => {
      vi.mocked(InstanceConfigLoader.getAvailableInstancesAsync).mockResolvedValue([
        'broken',
        'working',
      ]);
      vi.mocked(InstanceConfigLoader.has).mockReturnValue(false);
      vi.mocked(InstanceConfigLoader.loadAsync).mockImplementation((id: string) => {
        if (id === 'broken') throw new Error('Config not found');
        return mockConfig as any;
      });

      const result = await authenticateAnyInstance(testPassword);

      expect(result.success).toBe(true);
      expect(result.instanceId).toBe('working');
    });
  });

  describe('authenticateInstance', () => {
    it('should return true for valid password', async () => {
      vi.mocked(InstanceConfigLoader.has).mockReturnValue(true);
      vi.mocked(InstanceConfigLoader.get).mockReturnValue(mockConfig as any);

      const result = await authenticateInstance(testPassword, 'test');

      expect(result).toBe(true);
    });

    it('should return false for invalid password', async () => {
      vi.mocked(InstanceConfigLoader.has).mockReturnValue(true);
      vi.mocked(InstanceConfigLoader.get).mockReturnValue(mockConfig as any);

      const result = await authenticateInstance('wrongPassword', 'test');

      expect(result).toBe(false);
    });

    it('should load config if not cached', async () => {
      vi.mocked(InstanceConfigLoader.has).mockReturnValue(false);
      vi.mocked(InstanceConfigLoader.loadAsync).mockResolvedValue(mockConfig as any);

      const result = await authenticateInstance(testPassword, 'test');

      expect(InstanceConfigLoader.loadAsync).toHaveBeenCalledWith('test');
      expect(result).toBe(true);
    });

    it('should return false on config error', async () => {
      vi.mocked(InstanceConfigLoader.has).mockReturnValue(false);
      vi.mocked(InstanceConfigLoader.loadAsync).mockImplementation(() => {
        throw new Error('Config not found');
      });

      const result = await authenticateInstance(testPassword, 'nonexistent');

      expect(result).toBe(false);
    });
  });
});
