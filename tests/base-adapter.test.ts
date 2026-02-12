/**
 * Base Stream Adapter Tests
 * Tests for BaseStreamAdapter abstract class

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseStreamAdapter } from '../server/stream/adapters/base-adapter';
import { StreamMessage, StreamWatermark } from '../server/stream/types';

// Create a concrete test implementation
class TestAdapter extends BaseStreamAdapter {
  public configValid = true;
  public messagesToReturn: StreamMessage[] = [];

  constructor(streamId: string, db: any) {
    super(streamId, 'test', db);
  }

  async fetchMessages(_watermark?: StreamWatermark): Promise<StreamMessage[]> {
    this.ensureInitialized();
    return this.messagesToReturn;
  }

  validateConfig(_config: any): boolean {
    return this.configValid;
  }

  // Expose protected methods for testing
  public async testGetWatermark(): Promise<StreamWatermark> {
    return this.getWatermark();
  }

  public async testUpdateWatermark(
    lastProcessedTime: Date,
    lastProcessedId: string,
    messagesProcessed: number
  ): Promise<void> {
    return this.updateWatermark(lastProcessedTime, lastProcessedId, messagesProcessed);
  }

  public async testSaveMessages(messages: StreamMessage[]): Promise<number[]> {
    return this.saveMessages(messages);
  }

  public testEnsureInitialized(): void {
    return this.ensureInitialized();
  }
}

describe('BaseStreamAdapter', () => {
  let adapter: TestAdapter;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      streamConfig: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      importWatermark: {
        findFirst: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      unifiedMessage: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    };

    adapter = new TestAdapter('test-stream', mockDb);
  });

  describe('constructor', () => {
    it('should set streamId and adapterType', () => {
      expect(adapter.streamId).toBe('test-stream');
      expect(adapter.adapterType).toBe('test');
    });
  });

  describe('initialize', () => {
    beforeEach(() => {
      mockDb.streamConfig.findUnique.mockResolvedValue(null);
      mockDb.streamConfig.create.mockResolvedValue({});
      mockDb.importWatermark.findFirst.mockResolvedValue(null);
      mockDb.importWatermark.create.mockResolvedValue({});
    });

    it('should throw error for invalid config', async () => {
      adapter.configValid = false;

      await expect(adapter.initialize({})).rejects.toThrow(
        'Invalid configuration for adapter test-stream'
      );
    });

    it('should initialize successfully with valid config', async () => {
      adapter.configValid = true;

      await adapter.initialize({ key: 'value' });

      expect(mockDb.streamConfig.create).toHaveBeenCalled();
      expect(mockDb.importWatermark.create).toHaveBeenCalled();
    });

    it('should create stream config if not exists', async () => {
      mockDb.streamConfig.findUnique.mockResolvedValue(null);

      await adapter.initialize({ key: 'value' });

      expect(mockDb.streamConfig.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          streamId: 'test-stream',
          adapterType: 'test',
          enabled: true,
        }),
      });
    });

    it('should update stream config if exists', async () => {
      mockDb.streamConfig.findUnique.mockResolvedValue({ id: 1 });

      await adapter.initialize({ key: 'value' });

      expect(mockDb.streamConfig.update).toHaveBeenCalledWith({
        where: { streamId: 'test-stream' },
        data: expect.objectContaining({
          config: { key: 'value' },
          adapterType: 'test',
        }),
      });
    });

    it('should create watermark if not exists', async () => {
      mockDb.importWatermark.findFirst.mockResolvedValue(null);

      await adapter.initialize({ key: 'value' });

      expect(mockDb.importWatermark.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          streamId: 'test-stream',
          streamType: 'test',
          resourceId: null,
        }),
      });
    });

    it('should not create watermark if already exists', async () => {
      mockDb.importWatermark.findFirst.mockResolvedValue({ id: 1 });

      await adapter.initialize({ key: 'value' });

      expect(mockDb.importWatermark.create).not.toHaveBeenCalled();
    });
  });

  describe('getWatermark', () => {
    it('should return empty watermark when none exists', async () => {
      mockDb.importWatermark.findFirst.mockResolvedValue(null);

      const result = await adapter.testGetWatermark();

      expect(result).toEqual({
        lastProcessedTime: undefined,
        lastProcessedId: undefined,
        totalProcessed: 0,
      });
    });

    it('should return watermark from database', async () => {
      const lastTime = new Date('2025-12-23T10:00:00Z');
      mockDb.importWatermark.findFirst.mockResolvedValue({
        lastImportedTime: lastTime,
        lastImportedId: 'msg-123',
      });

      const result = await adapter.testGetWatermark();

      expect(result.lastProcessedTime).toEqual(lastTime);
      expect(result.lastProcessedId).toBe('msg-123');
    });
  });

  describe('updateWatermark', () => {
    it('should update watermark in database', async () => {
      const lastTime = new Date('2025-12-23T10:00:00Z');

      await adapter.testUpdateWatermark(lastTime, 'msg-456', 10);

      expect(mockDb.importWatermark.updateMany).toHaveBeenCalledWith({
        where: {
          streamId: 'test-stream',
          resourceId: null,
        },
        data: {
          lastImportedTime: lastTime,
          lastImportedId: 'msg-456',
        },
      });
    });
  });

  describe('saveMessages', () => {
    const testMessage: StreamMessage = {
      messageId: 'msg-001',
      timestamp: new Date('2025-12-23T10:00:00Z'),
      author: 'test-user',
      content: 'Test message content',
      channel: 'test-channel',
      rawData: {},
    };

    it('should save new messages', async () => {
      mockDb.unifiedMessage.findUnique.mockResolvedValue(null);
      mockDb.unifiedMessage.create.mockResolvedValue({ id: 1 });

      const result = await adapter.testSaveMessages([testMessage]);

      expect(result).toEqual([1]);
      expect(mockDb.unifiedMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          streamId: 'test-stream',
          messageId: 'msg-001',
          author: 'test-user',
          content: 'Test message content',
        }),
      });
    });

    it('should skip existing messages', async () => {
      mockDb.unifiedMessage.findUnique.mockResolvedValue({ id: 5 });

      const result = await adapter.testSaveMessages([testMessage]);

      expect(result).toEqual([5]);
      expect(mockDb.unifiedMessage.create).not.toHaveBeenCalled();
    });

    it('should handle errors and continue', async () => {
      const messages = [testMessage, { ...testMessage, messageId: 'msg-002' }];

      mockDb.unifiedMessage.findUnique.mockResolvedValue(null);
      mockDb.unifiedMessage.create
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ id: 2 });

      const result = await adapter.testSaveMessages(messages);

      // First message failed, second succeeded
      expect(result).toEqual([2]);
    });

    it('should save multiple messages', async () => {
      const messages = [
        testMessage,
        { ...testMessage, messageId: 'msg-002' },
        { ...testMessage, messageId: 'msg-003' },
      ];

      mockDb.unifiedMessage.findUnique.mockResolvedValue(null);
      mockDb.unifiedMessage.create
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce({ id: 2 })
        .mockResolvedValueOnce({ id: 3 });

      const result = await adapter.testSaveMessages(messages);

      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('ensureInitialized', () => {
    it('should throw when not initialized', () => {
      expect(() => adapter.testEnsureInitialized()).toThrow(
        'Adapter test-stream is not initialized'
      );
    });

    it('should not throw when initialized', async () => {
      mockDb.streamConfig.findUnique.mockResolvedValue(null);
      mockDb.streamConfig.create.mockResolvedValue({});
      mockDb.importWatermark.findFirst.mockResolvedValue(null);
      mockDb.importWatermark.create.mockResolvedValue({});

      await adapter.initialize({ key: 'value' });

      expect(() => adapter.testEnsureInitialized()).not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should complete without error', async () => {
      await expect(adapter.cleanup()).resolves.not.toThrow();
    });
  });

  describe('fetchMessages', () => {
    beforeEach(async () => {
      mockDb.streamConfig.findUnique.mockResolvedValue(null);
      mockDb.streamConfig.create.mockResolvedValue({});
      mockDb.importWatermark.findFirst.mockResolvedValue(null);
      mockDb.importWatermark.create.mockResolvedValue({});

      await adapter.initialize({});
    });

    it('should return configured messages', async () => {
      const messages: StreamMessage[] = [
        {
          messageId: 'msg-001',
          timestamp: new Date(),
          author: 'user',
          content: 'content',
          channel: 'ch',
          rawData: {},
        },
      ];
      adapter.messagesToReturn = messages;

      const result = await adapter.fetchMessages();

      expect(result).toEqual(messages);
    });

    it('should throw if not initialized', async () => {
      const uninitializedAdapter = new TestAdapter('new-stream', mockDb);

      await expect(uninitializedAdapter.fetchMessages()).rejects.toThrow(
        'Adapter new-stream is not initialized'
      );
    });
  });
});
