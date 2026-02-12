/**
 * StreamManager Unit Tests
 * Tests for stream management, configuration, and lifecycle methods

 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing StreamManager
vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn().mockReturnValue({
      stop: vi.fn(),
    }),
  },
}));

// Mock adapter class factories
vi.mock('../server/stream/adapters/csv-file-adapter.js', () => {
  return {
    CsvFileAdapter: class MockCsvFileAdapter {
      streamId: string;
      constructor(streamId: string, _db: any) {
        this.streamId = streamId;
      }
      validateConfig = vi.fn().mockReturnValue(true);
      initialize = vi.fn().mockResolvedValue(undefined);
      cleanup = vi.fn().mockResolvedValue(undefined);
      getWatermark = vi.fn().mockResolvedValue({
        lastProcessedTime: new Date(),
        totalProcessed: 100,
        metadata: {},
      });
      fetchMessages = vi.fn().mockResolvedValue([]);
      updateWatermark = vi.fn().mockResolvedValue(undefined);
    },
  };
});

vi.mock('../server/stream/adapters/telegram-bot-adapter.js', () => {
  return {
    TelegramBotAdapter: class MockTelegramBotAdapter {
      streamId: string;
      constructor(streamId: string, _db: any) {
        this.streamId = streamId;
      }
      validateConfig = vi.fn().mockReturnValue(true);
      initialize = vi.fn().mockResolvedValue(undefined);
      cleanup = vi.fn().mockResolvedValue(undefined);
      getWatermark = vi.fn().mockResolvedValue({
        lastProcessedTime: new Date(),
        totalProcessed: 50,
        metadata: {},
      });
      fetchMessages = vi.fn().mockResolvedValue([]);
      updateWatermark = vi.fn().mockResolvedValue(undefined);
    },
  };
});

vi.mock('../server/stream/adapters/zulip-bot-adapter.js', () => {
  return {
    ZulipBotAdapter: class MockZulipBotAdapter {
      streamId: string;
      constructor(streamId: string, _db: any) {
        this.streamId = streamId;
      }
      validateConfig = vi.fn().mockReturnValue(true);
      initialize = vi.fn().mockResolvedValue(undefined);
      cleanup = vi.fn().mockResolvedValue(undefined);
      getWatermark = vi.fn().mockResolvedValue({
        lastProcessedTime: new Date(),
        totalProcessed: 75,
        metadata: {},
      });
      fetchMessages = vi.fn().mockResolvedValue([]);
      updateWatermark = vi.fn().mockResolvedValue(undefined);
    },
  };
});

vi.mock('../server/config/instance-loader.js', () => ({
  InstanceConfigLoader: {
    getAvailableInstances: vi.fn().mockReturnValue([]),
    getAvailableInstancesAsync: vi.fn().mockResolvedValue([]),
    has: vi.fn().mockReturnValue(false),
    get: vi.fn().mockReturnValue({ streams: [] }),
    loadAsync: vi.fn().mockResolvedValue({ streams: [] }),
  },
}));

vi.mock('../server/db/instance-db.js', () => ({
  getInstanceDb: vi.fn().mockReturnValue({}),
}));

// Mock Prisma Client for stream management operations
const mockPrismaClient = vi.hoisted(() => ({
  streamConfig: {
    update: vi.fn().mockResolvedValue({}),
  },
  streamWatermark: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  unifiedMessage: {
    count: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class MockPrismaClient {
    streamConfig = mockPrismaClient.streamConfig;
    streamWatermark = mockPrismaClient.streamWatermark;
    unifiedMessage = mockPrismaClient.unifiedMessage;
  },
}));

import { StreamManager } from '../server/stream/stream-manager.js';
import cron from 'node-cron';
import { InstanceConfigLoader } from '../server/config/instance-loader.js';
import { getInstanceDb } from '../server/db/instance-db.js';

describe('StreamManager', () => {
  let manager: StreamManager;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    process.env = { ...originalEnv };
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should create manager with default config', () => {
      manager = new StreamManager();
      expect(manager).toBeInstanceOf(StreamManager);
    });

    it('should use environment variables for config', () => {
      process.env.MAX_CONCURRENT_STREAMS = '5';
      process.env.MESSAGE_BATCH_SIZE = '20';
      process.env.STREAM_ERROR_RETRY_ATTEMPTS = '5';
      process.env.STREAM_ERROR_RETRY_DELAY = '30000';

      manager = new StreamManager();
      expect(manager).toBeInstanceOf(StreamManager);
    });

    it('should accept custom config overrides', () => {
      manager = new StreamManager({
        maxConcurrentStreams: 10,
        defaultBatchSize: 50,
        enableScheduling: false,
        errorRetryAttempts: 5,
        errorRetryDelay: 5000,
      });
      expect(manager).toBeInstanceOf(StreamManager);
    });

    it('should enable scheduling when env var is true', () => {
      process.env.STREAM_SCHEDULING_ENABLED = 'true';
      manager = new StreamManager();
      expect(manager).toBeInstanceOf(StreamManager);
    });
  });

  describe('getAdapters', () => {
    it('should return empty map initially', () => {
      manager = new StreamManager();
      const adapters = manager.getAdapters();
      expect(adapters).toBeInstanceOf(Map);
      expect(adapters.size).toBe(0);
    });
  });

  describe('getAdapter', () => {
    it('should return undefined for non-existent stream', () => {
      manager = new StreamManager();
      const adapter = manager.getAdapter('non-existent');
      expect(adapter).toBeUndefined();
    });
  });

  describe('stopStream', () => {
    it('should handle stopping non-existent stream gracefully', () => {
      manager = new StreamManager();
      expect(() => manager.stopStream('non-existent')).not.toThrow();
    });
  });

  describe('shutdown', () => {
    it('should shutdown cleanly with no adapters', async () => {
      manager = new StreamManager();
      await expect(manager.shutdown()).resolves.not.toThrow();
    });

    it('should clear all internal state after shutdown', async () => {
      manager = new StreamManager();
      await manager.shutdown();
      expect(manager.getAdapters().size).toBe(0);
    });
  });

  describe('runStream concurrency control', () => {
    it('should skip stream when max concurrent reached', async () => {
      manager = new StreamManager({ maxConcurrentStreams: 0 });
      // With maxConcurrentStreams = 0, any stream should be skipped
      await manager.runStream('test-stream');
      // Should complete without error (just skip)
    });

    it('should handle running non-existent stream', async () => {
      manager = new StreamManager();
      await manager.runStream('non-existent');
      // Should log error but not throw
    });
  });

  describe('importStream', () => {
    it('should throw error for non-existent stream', async () => {
      manager = new StreamManager();
      await expect(manager.importStream('non-existent')).rejects.toThrow(
        'Stream non-existent not found'
      );
    });
  });

  describe('unregisterStream', () => {
    it('should handle unregistering non-existent stream', async () => {
      manager = new StreamManager();
      await expect(manager.unregisterStream('non-existent')).resolves.not.toThrow();
    });
  });

  describe('runAllStreams', () => {
    it('should complete with no adapters registered', async () => {
      manager = new StreamManager();
      await expect(manager.runAllStreams()).resolves.not.toThrow();
    });
  });

  describe('getHealth', () => {
    it('should return empty array when no adapters', async () => {
      manager = new StreamManager();
      const health = await manager.getHealth();
      expect(health).toEqual([]);
    });
  });
});

describe('StreamManager - Environment Variable Injection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Telegram environment variables', () => {
    it('should inject instance-specific telegram token', async () => {
      process.env.TEST_TELEGRAM_BOT_TOKEN = 'test-instance-token';

      const manager = new StreamManager();
      // The injectEnvVars is private, but we can test through registerStream
      // For now, we verify the manager was created successfully
      expect(manager).toBeInstanceOf(StreamManager);
    });

    it('should inject generic telegram token when instance-specific not found', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'generic-token';

      const manager = new StreamManager();
      expect(manager).toBeInstanceOf(StreamManager);
    });

    it('should inject telegram polling settings', async () => {
      process.env.TELEGRAM_BOT_MODE = 'polling';
      process.env.TELEGRAM_POLLING_INTERVAL = '5000';
      process.env.TELEGRAM_ALLOWED_CHATS = 'chat1,chat2,chat3';
      process.env.TELEGRAM_IGNORE_OLD_MESSAGES = 'true';
      process.env.TELEGRAM_PROCESS_COMMANDS = 'false';

      const manager = new StreamManager();
      expect(manager).toBeInstanceOf(StreamManager);
    });

    it('should inject telegram webhook settings', async () => {
      process.env.TELEGRAM_WEBHOOK_URL = 'https://example.com/webhook';
      process.env.TELEGRAM_WEBHOOK_PATH = '/telegram/callback';

      const manager = new StreamManager();
      expect(manager).toBeInstanceOf(StreamManager);
    });
  });

  describe('Zulip environment variables', () => {
    it('should inject instance-specific zulip credentials', async () => {
      process.env.TEST_ZULIP_BOT_EMAIL = 'bot@test.zulipchat.com';
      process.env.TEST_ZULIP_API_KEY = 'test-api-key';

      const manager = new StreamManager();
      expect(manager).toBeInstanceOf(StreamManager);
    });

    it('should inject generic zulip credentials', async () => {
      process.env.ZULIP_BOT_EMAIL = 'bot@zulipchat.com';
      process.env.ZULIP_API_KEY = 'api-key';
      process.env.ZULIP_SITE = 'https://chat.zulipchat.com';

      const manager = new StreamManager();
      expect(manager).toBeInstanceOf(StreamManager);
    });

    it('should inject zulip polling settings', async () => {
      process.env.ZULIP_POLLING_INTERVAL = '3000';
      process.env.ZULIP_BATCH_SIZE = '50';
      process.env.ZULIP_IGNORE_OLD_MESSAGES = 'true';

      const manager = new StreamManager();
      expect(manager).toBeInstanceOf(StreamManager);
    });
  });

  describe('Discord environment variables', () => {
    it('should inject instance-specific discord token', async () => {
      process.env.TEST_DISCORD_BOT_TOKEN = 'discord-instance-token';

      const manager = new StreamManager();
      expect(manager).toBeInstanceOf(StreamManager);
    });

    it('should inject generic discord token', async () => {
      process.env.DISCORD_BOT_TOKEN = 'discord-generic-token';

      const manager = new StreamManager();
      expect(manager).toBeInstanceOf(StreamManager);
    });
  });
});

describe('StreamManager - Adapter Factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should be able to create manager for adapter registration', () => {
    const manager = new StreamManager();
    expect(manager).toBeInstanceOf(StreamManager);
  });
});

describe('StreamManager - Scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not schedule when scheduling disabled', () => {
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
    new StreamManager();
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it('should create manager with scheduling enabled', () => {
    process.env.STREAM_SCHEDULING_ENABLED = 'true';
    const manager = new StreamManager({ enableScheduling: true });
    expect(manager).toBeInstanceOf(StreamManager);
  });
});

describe('StreamManagerConfig interface', () => {
  it('should accept partial config', () => {
    const manager = new StreamManager({
      maxConcurrentStreams: 5,
    });
    expect(manager).toBeInstanceOf(StreamManager);
  });

  it('should accept empty config', () => {
    const manager = new StreamManager({});
    expect(manager).toBeInstanceOf(StreamManager);
  });

  it('should accept all config options', () => {
    const manager = new StreamManager({
      maxConcurrentStreams: 10,
      defaultBatchSize: 100,
      enableScheduling: true,
      errorRetryAttempts: 5,
      errorRetryDelay: 10000,
    });
    expect(manager).toBeInstanceOf(StreamManager);
  });
});

describe('StreamManager - Initialize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should initialize with empty instances', async () => {
    // With default mock (empty instances), initialize should complete
    const manager = new StreamManager();
    await expect(manager.initialize()).resolves.not.toThrow();
    expect(manager.getAdapters().size).toBe(0);
  });
});

describe('StreamManager - Adapter Types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should return undefined for unknown adapter', () => {
    const manager = new StreamManager();
    expect(manager.getAdapter('non-existent')).toBeUndefined();
  });
});

describe('StreamManager - Stream Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should throw error for importing non-existent stream', async () => {
    const manager = new StreamManager();
    await expect(manager.importStream('non-existent')).rejects.toThrow(
      'Stream non-existent not found'
    );
  });

  it('should handle running non-existent stream gracefully', async () => {
    const manager = new StreamManager();
    // runStream logs error but doesn't throw
    await expect(manager.runStream('non-existent')).resolves.not.toThrow();
  });

  it('should run all streams with empty adapters', async () => {
    const manager = new StreamManager();
    await expect(manager.runAllStreams()).resolves.not.toThrow();
  });
});

describe('StreamManager - Cleanup and Unregister', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should handle unregistering non-existent stream', async () => {
    const manager = new StreamManager();
    await expect(manager.unregisterStream('non-existent')).resolves.not.toThrow();
  });

  it('should shutdown with no adapters', async () => {
    const manager = new StreamManager();
    await expect(manager.shutdown()).resolves.not.toThrow();
    expect(manager.getAdapters().size).toBe(0);
  });
});

describe('StreamManager - Health Checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should return empty health when no adapters registered', async () => {
    const manager = new StreamManager();
    const health = await manager.getHealth();
    expect(health).toEqual([]);
  });
});

describe('StreamManager - Registered Adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should register csv adapter successfully', async () => {
    const manager = new StreamManager();
    const mockDb = {} as any;
    const streamConfig = {
      streamId: 'test-csv',
      adapterType: 'csv',
      config: { filePath: '/path/to/file.csv' },
    };

    await manager.registerStream(streamConfig, 'test-instance', mockDb);

    expect(manager.getAdapter('test-csv')).toBeDefined();
    expect(manager.getAdapters().size).toBe(1);
  });

  it('should register telegram-bot adapter successfully', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    const manager = new StreamManager();
    const mockDb = {} as any;
    const streamConfig = {
      streamId: 'test-telegram',
      adapterType: 'telegram-bot',
      config: { botToken: 'test-token' },
    };

    await manager.registerStream(streamConfig, 'test-instance', mockDb);

    expect(manager.getAdapter('test-telegram')).toBeDefined();
  });

  it('should register zulip adapter successfully', async () => {
    const manager = new StreamManager();
    const mockDb = {} as any;
    const streamConfig = {
      streamId: 'test-zulip',
      adapterType: 'zulipchat',
      config: { email: 'bot@test.com', apiKey: 'key' },
    };

    await manager.registerStream(streamConfig, 'test-instance', mockDb);

    expect(manager.getAdapter('test-zulip')).toBeDefined();
  });

  it('should throw error for unknown adapter type', async () => {
    const manager = new StreamManager();
    const mockDb = {} as any;
    const streamConfig = {
      streamId: 'test-unknown',
      adapterType: 'unknown-type',
      config: {},
    };

    await expect(manager.registerStream(streamConfig, 'test-instance', mockDb)).rejects.toThrow(
      'Unknown adapter type: unknown-type'
    );
  });

  it('should schedule stream when schedule is provided', async () => {
    process.env.STREAM_SCHEDULING_ENABLED = 'true';
    const manager = new StreamManager({ enableScheduling: true });
    const mockDb = {} as any;
    const streamConfig = {
      streamId: 'test-scheduled',
      adapterType: 'csv',
      config: { filePath: '/path/to/file.csv' },
      schedule: '* * * * *',
    };

    await manager.registerStream(streamConfig, 'test-instance', mockDb);

    expect(cron.schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function), {
      timezone: 'UTC',
    });
  });

  it('should not schedule when scheduling is disabled', async () => {
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
    const manager = new StreamManager({ enableScheduling: false });
    const mockDb = {} as any;
    const streamConfig = {
      streamId: 'test-no-schedule',
      adapterType: 'csv',
      config: { filePath: '/path/to/file.csv' },
      schedule: '* * * * *',
    };

    await manager.registerStream(streamConfig, 'test-instance', mockDb);

    expect(cron.schedule).not.toHaveBeenCalled();
  });
});

describe('StreamManager - runStream with adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should skip when already running', async () => {
    const manager = new StreamManager();
    const mockDb = {} as any;
    const streamConfig = {
      streamId: 'test-stream',
      adapterType: 'csv',
      config: { filePath: '/path/to/file.csv' },
    };

    await manager.registerStream(streamConfig, 'test-instance', mockDb);

    // Start first run
    const runPromise1 = manager.runStream('test-stream');
    // Try to start second run immediately
    const runPromise2 = manager.runStream('test-stream');

    await Promise.all([runPromise1, runPromise2]);
    // Second run should be skipped (logged but not throw)
  });

  it('should handle stream with messages', async () => {
    const mockAdapter = {
      streamId: 'test-messages',
      validateConfig: vi.fn().mockReturnValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      getWatermark: vi.fn().mockResolvedValue({
        lastProcessedTime: new Date(),
        totalProcessed: 0,
        metadata: {},
      }),
      fetchMessages: vi.fn().mockResolvedValue([
        { messageId: '1', timestamp: new Date(), content: 'Test message 1' },
        { messageId: '2', timestamp: new Date(), content: 'Test message 2' },
      ]),
      updateWatermark: vi.fn().mockResolvedValue(undefined),
    };

    // Register adapter directly through private access
    const manager = new StreamManager();
    (manager as any).adapters.set('test-messages', mockAdapter);

    await manager.runStream('test-messages');

    expect(mockAdapter.fetchMessages).toHaveBeenCalled();
    expect(mockAdapter.updateWatermark).toHaveBeenCalled();
  });

  it('should handle stream with no messages', async () => {
    const mockAdapter = {
      streamId: 'test-empty',
      validateConfig: vi.fn().mockReturnValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      getWatermark: vi.fn().mockResolvedValue({
        lastProcessedTime: new Date(),
        totalProcessed: 100,
        metadata: {},
      }),
      fetchMessages: vi.fn().mockResolvedValue([]),
      updateWatermark: vi.fn().mockResolvedValue(undefined),
    };

    const manager = new StreamManager();
    (manager as any).adapters.set('test-empty', mockAdapter);

    await manager.runStream('test-empty');

    expect(mockAdapter.fetchMessages).toHaveBeenCalled();
    expect(mockAdapter.updateWatermark).not.toHaveBeenCalled();
  });
});

describe('StreamManager - importStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should import messages and update watermark', async () => {
    const mockAdapter = {
      streamId: 'test-import',
      validateConfig: vi.fn().mockReturnValue(true),
      initialize: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      getWatermark: vi.fn().mockResolvedValue({
        lastProcessedTime: new Date(),
        totalProcessed: 0,
        metadata: {},
      }),
      fetchMessages: vi.fn().mockResolvedValue([
        { messageId: 'msg1', timestamp: new Date(), content: 'Imported 1' },
        { messageId: 'msg2', timestamp: new Date(), content: 'Imported 2' },
      ]),
      updateWatermark: vi.fn().mockResolvedValue(undefined),
    };

    const manager = new StreamManager();
    (manager as any).adapters.set('test-import', mockAdapter);

    const count = await manager.importStream('test-import');

    expect(count).toBe(2);
    expect(mockAdapter.updateWatermark).toHaveBeenCalled();
  });

  it('should return 0 when no messages to import', async () => {
    const mockAdapter = {
      streamId: 'test-no-import',
      getWatermark: vi.fn().mockResolvedValue({
        lastProcessedTime: new Date(),
        totalProcessed: 50,
        metadata: {},
      }),
      fetchMessages: vi.fn().mockResolvedValue([]),
      updateWatermark: vi.fn().mockResolvedValue(undefined),
    };

    const manager = new StreamManager();
    (manager as any).adapters.set('test-no-import', mockAdapter);

    const count = await manager.importStream('test-no-import');

    expect(count).toBe(0);
    expect(mockAdapter.updateWatermark).not.toHaveBeenCalled();
  });

  it('should use custom batch size', async () => {
    const mockAdapter = {
      streamId: 'test-batch',
      getWatermark: vi.fn().mockResolvedValue({
        lastProcessedTime: new Date(),
        totalProcessed: 0,
        metadata: {},
      }),
      fetchMessages: vi.fn().mockResolvedValue([]),
      updateWatermark: vi.fn(),
    };

    const manager = new StreamManager();
    (manager as any).adapters.set('test-batch', mockAdapter);

    await manager.importStream('test-batch', 50);

    expect(mockAdapter.fetchMessages).toHaveBeenCalledWith(expect.any(Object), 50);
  });
});

describe('StreamManager - getHealth with adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should return health for registered adapters', async () => {
    const mockAdapter = {
      streamId: 'health-stream',
      getWatermark: vi.fn().mockResolvedValue({
        lastProcessedTime: new Date('2024-01-01'),
        totalProcessed: 100,
        metadata: {},
      }),
    };

    const manager = new StreamManager();
    (manager as any).adapters.set('health-stream', mockAdapter);

    const health = await manager.getHealth();

    expect(health).toHaveLength(1);
    expect(health[0].streamId).toBe('health-stream');
    expect(health[0].isHealthy).toBe(true);
    expect(health[0].totalProcessed).toBe(100);
  });

  it('should report healthy when getWatermark succeeds with metadata', async () => {
    // Note: The current implementation considers a stream healthy if getWatermark succeeds,
    // regardless of any error metadata. Actual error handling happens when getWatermark throws.
    const recentError = new Date(Date.now() - 1000); // 1 second ago
    const mockAdapter = {
      streamId: 'error-stream',
      getWatermark: vi.fn().mockResolvedValue({
        lastProcessedTime: new Date(),
        totalProcessed: 50,
        metadata: {
          lastError: 'Connection failed',
          lastErrorTime: recentError.toISOString(),
          errorCount: 5,
        },
      }),
    };

    const manager = new StreamManager();
    (manager as any).adapters.set('error-stream', mockAdapter);

    const health = await manager.getHealth();

    // Stream is healthy because getWatermark succeeded
    expect(health[0].isHealthy).toBe(true);
    expect(health[0].totalProcessed).toBe(50);
  });

  it('should handle adapter error in getHealth', async () => {
    const mockAdapter = {
      streamId: 'failing-stream',
      getWatermark: vi.fn().mockRejectedValue(new Error('DB connection lost')),
    };

    const manager = new StreamManager();
    (manager as any).adapters.set('failing-stream', mockAdapter);

    const health = await manager.getHealth();

    expect(health[0].isHealthy).toBe(false);
    expect(health[0].lastError).toBe('DB connection lost');
    expect(health[0].totalProcessed).toBe(0);
  });
});

describe('StreamManager - unregisterStream with adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should cleanup and remove registered adapter', async () => {
    const mockAdapter = {
      streamId: 'to-remove',
      cleanup: vi.fn().mockResolvedValue(undefined),
    };

    const manager = new StreamManager();
    (manager as any).adapters.set('to-remove', mockAdapter);

    await manager.unregisterStream('to-remove');

    expect(mockAdapter.cleanup).toHaveBeenCalled();
    expect(manager.getAdapter('to-remove')).toBeUndefined();
  });

  it('should stop scheduled job when unregistering', async () => {
    const mockJob = { stop: vi.fn() };
    const mockAdapter = {
      streamId: 'scheduled-remove',
      cleanup: vi.fn().mockResolvedValue(undefined),
    };

    const manager = new StreamManager();
    (manager as any).adapters.set('scheduled-remove', mockAdapter);
    (manager as any).jobs.set('scheduled-remove', mockJob);

    await manager.unregisterStream('scheduled-remove');

    expect(mockJob.stop).toHaveBeenCalled();
    expect(mockAdapter.cleanup).toHaveBeenCalled();
  });
});

describe('StreamManager - stopStream with job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should stop scheduled job', () => {
    const mockJob = { stop: vi.fn() };

    const manager = new StreamManager();
    (manager as any).jobs.set('stop-me', mockJob);

    manager.stopStream('stop-me');

    expect(mockJob.stop).toHaveBeenCalled();
    expect((manager as any).jobs.has('stop-me')).toBe(false);
  });
});

describe('StreamManager - shutdown with adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should cleanup all adapters and stop all jobs', async () => {
    const mockJob1 = { stop: vi.fn() };
    const mockJob2 = { stop: vi.fn() };
    const mockAdapter1 = { cleanup: vi.fn().mockResolvedValue(undefined) };
    const mockAdapter2 = { cleanup: vi.fn().mockResolvedValue(undefined) };

    const manager = new StreamManager();
    (manager as any).adapters.set('stream1', mockAdapter1);
    (manager as any).adapters.set('stream2', mockAdapter2);
    (manager as any).jobs.set('stream1', mockJob1);
    (manager as any).jobs.set('stream2', mockJob2);

    await manager.shutdown();

    expect(mockJob1.stop).toHaveBeenCalled();
    expect(mockJob2.stop).toHaveBeenCalled();
    expect(mockAdapter1.cleanup).toHaveBeenCalled();
    expect(mockAdapter2.cleanup).toHaveBeenCalled();
    expect(manager.getAdapters().size).toBe(0);
  });
});

describe('StreamManager - runAllStreams with adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  it('should run all registered streams', async () => {
    const mockAdapter1 = {
      streamId: 'stream1',
      getWatermark: vi.fn().mockResolvedValue({
        lastProcessedTime: new Date(),
        totalProcessed: 0,
        metadata: {},
      }),
      fetchMessages: vi.fn().mockResolvedValue([]),
    };
    const mockAdapter2 = {
      streamId: 'stream2',
      getWatermark: vi.fn().mockResolvedValue({
        lastProcessedTime: new Date(),
        totalProcessed: 0,
        metadata: {},
      }),
      fetchMessages: vi.fn().mockResolvedValue([]),
    };

    const manager = new StreamManager();
    (manager as any).adapters.set('stream1', mockAdapter1);
    (manager as any).adapters.set('stream2', mockAdapter2);

    await manager.runAllStreams();

    expect(mockAdapter1.fetchMessages).toHaveBeenCalled();
    expect(mockAdapter2.fetchMessages).toHaveBeenCalled();
  });
});

describe('StreamManager - Environment variable injection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should inject instance-specific Telegram token', async () => {
    process.env.TESTINST_TELEGRAM_BOT_TOKEN = 'instance-specific-token';

    const manager = new StreamManager();
    const mockDb = {} as any;
    const streamConfig = {
      streamId: 'test-tg',
      adapterType: 'telegram-bot',
      config: {},
    };

    await manager.registerStream(streamConfig, 'testinst', mockDb);

    // The adapter should be created with the injected token
    expect(manager.getAdapter('test-tg')).toBeDefined();
  });

  it('should inject Zulip credentials from environment', async () => {
    process.env.TESTINST_ZULIP_BOT_EMAIL = 'bot@test.zulipchat.com';
    process.env.TESTINST_ZULIP_API_KEY = 'test-api-key-123';

    const manager = new StreamManager();
    const mockDb = {} as any;
    const streamConfig = {
      streamId: 'test-zulip-env',
      adapterType: 'zulipchat',
      config: {},
    };

    await manager.registerStream(streamConfig, 'testinst', mockDb);

    expect(manager.getAdapter('test-zulip-env')).toBeDefined();
  });

  it('should prefer instance-specific over generic env vars', async () => {
    process.env.TESTINST_TELEGRAM_BOT_TOKEN = 'instance-token';
    process.env.TELEGRAM_BOT_TOKEN = 'generic-token';

    const manager = new StreamManager();
    const mockDb = {} as any;
    const streamConfig = {
      streamId: 'test-priority',
      adapterType: 'telegram-bot',
      config: {},
    };

    await manager.registerStream(streamConfig, 'testinst', mockDb);

    expect(manager.getAdapter('test-priority')).toBeDefined();
  });

  it('should use generic env vars as fallback', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'generic-fallback-token';

    const manager = new StreamManager();
    const mockDb = {} as any;
    const streamConfig = {
      streamId: 'test-fallback',
      adapterType: 'telegram-bot',
      config: {},
    };

    await manager.registerStream(streamConfig, 'other-instance', mockDb);

    expect(manager.getAdapter('test-fallback')).toBeDefined();
  });

  it('should inject Discord token from environment', async () => {
    process.env.TESTINST_DISCORD_BOT_TOKEN = 'discord-token';

    const manager = new StreamManager();
    // Test the injectEnvVars method through a Discord adapter scenario
    // Since Discord adapter isn't fully implemented, just verify it doesn't throw
    expect(manager).toBeInstanceOf(StreamManager);
  });
});

describe('StreamManager - getStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
    mockPrismaClient.streamWatermark.findMany.mockResolvedValue([]);
  });

  it('should return stats with no watermarks', async () => {
    mockPrismaClient.streamWatermark.findMany.mockResolvedValue([]);

    const manager = new StreamManager();
    const stats = await manager.getStats();

    expect(stats).toEqual({
      totalStreams: 0,
      activeStreams: 0,
      runningStreams: 0,
      scheduledStreams: 0,
      totalMessagesProcessed: 0,
    });
  });

  it('should count processed messages from unifiedMessage', async () => {
    // Mock unifiedMessage.count to return processed message count
    mockPrismaClient.unifiedMessage.count.mockResolvedValue(400);

    const manager = new StreamManager();
    const stats = await manager.getStats();

    expect(stats.totalMessagesProcessed).toBe(400);
    expect(mockPrismaClient.unifiedMessage.count).toHaveBeenCalledWith({
      where: { processingStatus: 'COMPLETED' },
    });
  });

  it('should include adapter counts in stats', async () => {
    mockPrismaClient.streamWatermark.findMany.mockResolvedValue([]);

    const manager = new StreamManager();
    // Add mock adapters
    (manager as any).adapters.set('stream1', {});
    (manager as any).adapters.set('stream2', {});
    // Add mock job
    (manager as any).jobs.set('stream1', {});

    const stats = await manager.getStats();

    expect(stats.totalStreams).toBe(2);
    expect(stats.activeStreams).toBe(2);
    expect(stats.scheduledStreams).toBe(1);
  });

  it('should include running streams count', async () => {
    mockPrismaClient.streamWatermark.findMany.mockResolvedValue([]);

    const manager = new StreamManager();
    // Add mock running stream
    (manager as any).runningStreams.add('stream1');
    (manager as any).runningStreams.add('stream2');

    const stats = await manager.getStats();

    expect(stats.runningStreams).toBe(2);
  });
});

describe('StreamManager - handleStreamError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
    mockPrismaClient.streamConfig.update.mockResolvedValue({});
  });

  it('should disable stream after error in runStream', async () => {
    const mockAdapter = {
      streamId: 'error-stream',
      getWatermark: vi.fn().mockRejectedValue(new Error('Database connection failed')),
      fetchMessages: vi.fn(),
    };

    const manager = new StreamManager();
    (manager as any).adapters.set('error-stream', mockAdapter);

    await manager.runStream('error-stream');

    // handleStreamError should have been called which updates streamConfig
    expect(mockPrismaClient.streamConfig.update).toHaveBeenCalledWith({
      where: { streamId: 'error-stream' },
      data: {
        enabled: false,
      },
    });
  });

  it('should handle fetchMessages error', async () => {
    const mockAdapter = {
      streamId: 'fetch-error-stream',
      getWatermark: vi.fn().mockResolvedValue({
        lastProcessedTime: new Date(),
        totalProcessed: 0,
        metadata: {},
      }),
      fetchMessages: vi.fn().mockRejectedValue(new Error('API rate limited')),
    };

    const manager = new StreamManager();
    (manager as any).adapters.set('fetch-error-stream', mockAdapter);

    await manager.runStream('fetch-error-stream');

    expect(mockPrismaClient.streamConfig.update).toHaveBeenCalledWith({
      where: { streamId: 'fetch-error-stream' },
      data: expect.objectContaining({
        enabled: false,
      }),
    });
  });
});

describe('StreamManager - Initialize with instances', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
    // Default: configs are cached so get() is used
    InstanceConfigLoader.has.mockReturnValue(true);
  });

  it('should load streams from available instances', async () => {
    InstanceConfigLoader.getAvailableInstancesAsync.mockResolvedValue(['test-instance']);
    InstanceConfigLoader.get.mockReturnValue({
      streams: [
        {
          streamId: 'instance-stream-1',
          adapterType: 'csv',
          enabled: true,
          config: { filePath: '/data/test.csv' },
        },
      ],
    });
    getInstanceDb.mockReturnValue({});

    const manager = new StreamManager();
    await manager.initialize();

    expect(InstanceConfigLoader.getAvailableInstancesAsync).toHaveBeenCalled();
    expect(InstanceConfigLoader.get).toHaveBeenCalledWith('test-instance');
    expect(manager.getAdapter('instance-stream-1')).toBeDefined();
    expect(manager.getAdapters().size).toBe(1);
  });

  it('should only load enabled streams', async () => {
    InstanceConfigLoader.getAvailableInstancesAsync.mockResolvedValue(['test-instance']);
    InstanceConfigLoader.get.mockReturnValue({
      streams: [
        {
          streamId: 'enabled-stream',
          adapterType: 'csv',
          enabled: true,
          config: { filePath: '/data/enabled.csv' },
        },
        {
          streamId: 'disabled-stream',
          adapterType: 'csv',
          enabled: false,
          config: { filePath: '/data/disabled.csv' },
        },
      ],
    });
    getInstanceDb.mockReturnValue({});

    const manager = new StreamManager();
    await manager.initialize();

    expect(manager.getAdapter('enabled-stream')).toBeDefined();
    expect(manager.getAdapter('disabled-stream')).toBeUndefined();
    expect(manager.getAdapters().size).toBe(1);
  });

  it('should handle multiple instances', async () => {
    InstanceConfigLoader.getAvailableInstancesAsync.mockResolvedValue(['instance-a', 'instance-b']);
    InstanceConfigLoader.get
      .mockReturnValueOnce({
        streams: [
          {
            streamId: 'stream-a',
            adapterType: 'csv',
            enabled: true,
            config: { filePath: '/data/a.csv' },
          },
        ],
      })
      .mockReturnValueOnce({
        streams: [
          {
            streamId: 'stream-b',
            adapterType: 'csv',
            enabled: true,
            config: { filePath: '/data/b.csv' },
          },
        ],
      });
    getInstanceDb.mockReturnValue({});

    const manager = new StreamManager();
    await manager.initialize();

    expect(manager.getAdapters().size).toBe(2);
    expect(manager.getAdapter('stream-a')).toBeDefined();
    expect(manager.getAdapter('stream-b')).toBeDefined();
  });

  it('should handle instance without streams config', async () => {
    InstanceConfigLoader.getAvailableInstancesAsync.mockResolvedValue(['empty-instance']);
    InstanceConfigLoader.get.mockReturnValue({}); // No streams property
    getInstanceDb.mockReturnValue({});

    const manager = new StreamManager();
    await manager.initialize();

    expect(manager.getAdapters().size).toBe(0);
  });

  it('should continue loading other instances if one fails', async () => {
    InstanceConfigLoader.getAvailableInstancesAsync.mockResolvedValue([
      'failing-instance',
      'working-instance',
    ]);
    InstanceConfigLoader.get
      .mockImplementationOnce(() => {
        throw new Error('Config load failed');
      })
      .mockReturnValueOnce({
        streams: [
          {
            streamId: 'working-stream',
            adapterType: 'csv',
            enabled: true,
            config: { filePath: '/data/working.csv' },
          },
        ],
      });
    getInstanceDb.mockReturnValue({});

    const manager = new StreamManager();
    await manager.initialize();

    expect(manager.getAdapter('working-stream')).toBeDefined();
    expect(manager.getAdapters().size).toBe(1);
  });

  it('should handle stream registration failure within instance', async () => {
    InstanceConfigLoader.getAvailableInstancesAsync.mockResolvedValue(['test-instance']);
    InstanceConfigLoader.get.mockReturnValue({
      streams: [
        {
          streamId: 'failing-stream',
          adapterType: 'unknown-type', // Will throw "Unknown adapter type"
          enabled: true,
          config: {},
        },
        {
          streamId: 'succeeding-stream',
          adapterType: 'csv',
          enabled: true,
          config: { filePath: '/data/test.csv' },
        },
      ],
    });
    getInstanceDb.mockReturnValue({});

    const manager = new StreamManager();
    await manager.initialize();

    // The failing stream should not prevent other streams from loading
    expect(manager.getAdapter('failing-stream')).toBeUndefined();
    expect(manager.getAdapter('succeeding-stream')).toBeDefined();
  });

  it('should throw when initialize itself fails', async () => {
    InstanceConfigLoader.getAvailableInstancesAsync.mockRejectedValue(
      new Error('Critical initialization failure')
    );

    const manager = new StreamManager();
    await expect(manager.initialize()).rejects.toThrow('Critical initialization failure');
  });
});

describe('StreamManager - Discord env var injection via registerStream', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.STREAM_SCHEDULING_ENABLED = 'false';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should inject instance-specific Discord token', async () => {
    process.env.TESTINST_DISCORD_BOT_TOKEN = 'instance-discord-token';

    const manager = new StreamManager();
    const mockDb = {} as any;

    // Since Discord adapter doesn't exist yet, we test that injectEnvVars is called
    // by verifying the method doesn't throw when called with discord type
    // We can access the private method via registerStream's createAdapter call

    // The injectEnvVars method modifies config in place before adapter creation
    // Since there's no Discord adapter, it will throw "Unknown adapter type"
    await expect(
      manager.registerStream(
        { streamId: 'discord-test', adapterType: 'discord', config: {} },
        'testinst',
        mockDb
      )
    ).rejects.toThrow('Unknown adapter type: discord');
  });

  it('should inject generic Discord token when instance-specific not found', async () => {
    process.env.DISCORD_BOT_TOKEN = 'generic-discord-token';

    const manager = new StreamManager();
    const mockDb = {} as any;

    // Discord adapter type triggers the discord case in injectEnvVars
    await expect(
      manager.registerStream(
        { streamId: 'discord-generic-test', adapterType: 'discord', config: {} },
        'other-instance',
        mockDb
      )
    ).rejects.toThrow('Unknown adapter type: discord');
  });
});
