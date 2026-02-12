/**
 * Instance Database Manager Tests
 * Tests for the multi-instance database connection manager

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock PrismaClient
const mockPrismaClient = vi.hoisted(() => ({
  $disconnect: vi.fn().mockResolvedValue(undefined),
  $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class MockPrismaClient {
    $disconnect = mockPrismaClient.$disconnect;
    $queryRaw = mockPrismaClient.$queryRaw;
    datasources: any;
    log: any;
    constructor(options?: any) {
      this.datasources = options?.datasources;
      this.log = options?.log;
    }
  },
}));

// Mock instance config
const mockInstanceConfig = vi.hoisted(() => ({
  database: {
    name: 'test-database',
  },
}));

vi.mock('../server/config/instance-loader', () => ({
  getInstanceConfig: vi.fn().mockReturnValue(mockInstanceConfig),
}));

// Store original env
const originalEnv = { ...process.env };

describe('InstanceDatabaseManager', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/maindb';

    // Reset the module to clear static state
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getClient', () => {
    it('should create a new PrismaClient for an instance', async () => {
      const { InstanceDatabaseManager } = await import('../server/db/instance-db');

      // Clear any cached clients
      (InstanceDatabaseManager as any).clients = new Map();

      const client = InstanceDatabaseManager.getClient('test-instance');

      expect(client).toBeDefined();
      expect(client.$disconnect).toBeDefined();
    });

    it('should return cached client on subsequent calls', async () => {
      const { InstanceDatabaseManager } = await import('../server/db/instance-db');

      // Clear any cached clients
      (InstanceDatabaseManager as any).clients = new Map();

      const client1 = InstanceDatabaseManager.getClient('test-instance');
      const client2 = InstanceDatabaseManager.getClient('test-instance');

      expect(client1).toBe(client2);
    });

    it('should create separate clients for different instances', async () => {
      const { InstanceDatabaseManager } = await import('../server/db/instance-db');

      // Clear any cached clients
      (InstanceDatabaseManager as any).clients = new Map();

      const client1 = InstanceDatabaseManager.getClient('instance-1');
      const client2 = InstanceDatabaseManager.getClient('instance-2');

      expect(client1).not.toBe(client2);
    });
  });

  describe('buildDatabaseUrl', () => {
    it('should build database URL with new database name', async () => {
      const { InstanceDatabaseManager } = await import('../server/db/instance-db');

      const baseUrl = 'postgresql://user:pass@localhost:5432/maindb';
      const newDbName = 'newdb';

      const result = (InstanceDatabaseManager as any).buildDatabaseUrl(baseUrl, newDbName);

      expect(result).toContain('newdb');
      expect(result).not.toContain('maindb');
    });

    it('should throw error for invalid URL', async () => {
      const { InstanceDatabaseManager } = await import('../server/db/instance-db');

      expect(() => {
        (InstanceDatabaseManager as any).buildDatabaseUrl('invalid-url', 'newdb');
      }).toThrow('Invalid DATABASE_URL format');
    });

    it('should handle URLs with query parameters', async () => {
      const { InstanceDatabaseManager } = await import('../server/db/instance-db');

      const baseUrl = 'postgresql://user:pass@localhost:5432/maindb?schema=public';
      const newDbName = 'newdb';

      const result = (InstanceDatabaseManager as any).buildDatabaseUrl(baseUrl, newDbName);

      expect(result).toContain('newdb');
      expect(result).toContain('schema=public');
    });
  });

  describe('disconnect', () => {
    it('should disconnect client and remove from cache', async () => {
      const { InstanceDatabaseManager } = await import('../server/db/instance-db');

      // Clear any cached clients
      (InstanceDatabaseManager as any).clients = new Map();

      // Create a client first
      InstanceDatabaseManager.getClient('test-instance');

      // Disconnect
      await InstanceDatabaseManager.disconnect('test-instance');

      expect(mockPrismaClient.$disconnect).toHaveBeenCalled();

      // Verify removed from cache
      const clients = (InstanceDatabaseManager as any).clients;
      expect(clients.has('test-instance')).toBe(false);
    });

    it('should handle disconnecting non-existent client', async () => {
      const { InstanceDatabaseManager } = await import('../server/db/instance-db');

      // Clear any cached clients
      (InstanceDatabaseManager as any).clients = new Map();

      // Should not throw
      await InstanceDatabaseManager.disconnect('non-existent');

      expect(mockPrismaClient.$disconnect).not.toHaveBeenCalled();
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all cached clients', async () => {
      const { InstanceDatabaseManager } = await import('../server/db/instance-db');

      // Clear any cached clients
      (InstanceDatabaseManager as any).clients = new Map();

      // Create multiple clients
      InstanceDatabaseManager.getClient('instance-1');
      InstanceDatabaseManager.getClient('instance-2');

      await InstanceDatabaseManager.disconnectAll();

      expect(mockPrismaClient.$disconnect).toHaveBeenCalledTimes(2);

      // Verify all removed from cache
      const clients = (InstanceDatabaseManager as any).clients;
      expect(clients.size).toBe(0);
    });

    it('should handle empty client map', async () => {
      const { InstanceDatabaseManager } = await import('../server/db/instance-db');

      // Clear any cached clients
      (InstanceDatabaseManager as any).clients = new Map();

      // Should not throw
      await InstanceDatabaseManager.disconnectAll();

      expect(mockPrismaClient.$disconnect).not.toHaveBeenCalled();
    });
  });

  describe('checkConnection', () => {
    it('should return true for successful connection', async () => {
      mockPrismaClient.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const { InstanceDatabaseManager } = await import('../server/db/instance-db');

      // Clear any cached clients
      (InstanceDatabaseManager as any).clients = new Map();

      const result = await InstanceDatabaseManager.checkConnection('test-instance');

      expect(result).toBe(true);
    });

    it('should return false for failed connection', async () => {
      mockPrismaClient.$queryRaw.mockRejectedValue(new Error('Connection failed'));

      const { InstanceDatabaseManager } = await import('../server/db/instance-db');

      // Clear any cached clients
      (InstanceDatabaseManager as any).clients = new Map();

      const result = await InstanceDatabaseManager.checkConnection('test-instance');

      expect(result).toBe(false);
    });
  });

  describe('getInstanceDb convenience function', () => {
    it('should return client from manager', async () => {
      const { getInstanceDb, InstanceDatabaseManager } = await import('../server/db/instance-db');

      // Clear any cached clients
      (InstanceDatabaseManager as any).clients = new Map();

      const client = getInstanceDb('test-instance');

      expect(client).toBeDefined();
      expect(client.$disconnect).toBeDefined();
    });
  });
});
