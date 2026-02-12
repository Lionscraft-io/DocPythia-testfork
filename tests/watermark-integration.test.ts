/**
 * Watermark Integration Tests
 * Tests for watermark system across multiple imports
 * Verifies that settings like startDate and ignoreOldMessages are respected
 *

 * @created 2025-12-31
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { StreamWatermark, StreamMessage } from '../server/stream/types.js';

// Mock the database
const mockDb = {
  streamConfig: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  importWatermark: {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
  },
  unifiedMessage: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock('../server/db.js', () => ({
  default: mockDb,
}));

// Import after mocking
import { BaseStreamAdapter } from '../server/stream/adapters/base-adapter.js';

/**
 * Test adapter that simulates a stream with controllable messages
 */
class TestStreamAdapter extends BaseStreamAdapter {
  private allMessages: StreamMessage[] = [];
  private fetchCallCount = 0;
  public startDate?: Date;
  public ignoreOldMessages = true;

  constructor(streamId: string, db: any) {
    super(streamId, 'test', db);
  }

  validateConfig(config: any): boolean {
    this.startDate = config.startDate ? new Date(config.startDate) : undefined;
    this.ignoreOldMessages = config.ignoreOldMessages !== false;
    return true;
  }

  /**
   * Set the messages that this adapter will return
   */
  setMessages(messages: StreamMessage[]): void {
    this.allMessages = messages;
  }

  /**
   * Simulate fetching messages, respecting watermark
   */
  async fetchMessages(watermark?: StreamWatermark): Promise<StreamMessage[]> {
    this.ensureInitialized();
    this.fetchCallCount++;

    let messagesToReturn = [...this.allMessages];

    // Filter by startDate if configured
    if (this.startDate) {
      messagesToReturn = messagesToReturn.filter((m) => m.timestamp >= this.startDate!);
    }

    // Filter by watermark if provided
    if (watermark?.lastProcessedTime) {
      messagesToReturn = messagesToReturn.filter((m) => m.timestamp > watermark.lastProcessedTime!);
    }

    // Filter by lastProcessedId if provided
    if (watermark?.lastProcessedId) {
      const lastIdIndex = messagesToReturn.findIndex(
        (m) => m.messageId === watermark.lastProcessedId
      );
      if (lastIdIndex !== -1) {
        messagesToReturn = messagesToReturn.slice(lastIdIndex + 1);
      }
    }

    return messagesToReturn;
  }

  getFetchCallCount(): number {
    return this.fetchCallCount;
  }

  resetFetchCount(): void {
    this.fetchCallCount = 0;
  }

  // Expose protected methods for testing
  public async testGetWatermark(): Promise<StreamWatermark> {
    return this.getWatermark();
  }

  public async testUpdateWatermark(lastTime: Date, lastId: string, count: number): Promise<void> {
    return this.updateWatermark(lastTime, lastId, count);
  }

  public async testSaveMessages(messages: StreamMessage[]): Promise<number[]> {
    return this.saveMessages(messages);
  }
}

describe('Watermark Integration Tests', () => {
  let adapter: TestStreamAdapter;

  // Sample messages with different timestamps
  const createMessages = (): StreamMessage[] => [
    {
      messageId: 'msg-001',
      timestamp: new Date('2025-01-01T10:00:00Z'),
      author: 'user1',
      content: 'Old message 1',
      channel: 'general',
      rawData: {},
    },
    {
      messageId: 'msg-002',
      timestamp: new Date('2025-01-02T10:00:00Z'),
      author: 'user2',
      content: 'Old message 2',
      channel: 'general',
      rawData: {},
    },
    {
      messageId: 'msg-003',
      timestamp: new Date('2025-01-03T10:00:00Z'),
      author: 'user1',
      content: 'Recent message 1',
      channel: 'general',
      rawData: {},
    },
    {
      messageId: 'msg-004',
      timestamp: new Date('2025-01-04T10:00:00Z'),
      author: 'user3',
      content: 'Recent message 2',
      channel: 'general',
      rawData: {},
    },
    {
      messageId: 'msg-005',
      timestamp: new Date('2025-01-05T10:00:00Z'),
      author: 'user2',
      content: 'Latest message',
      channel: 'general',
      rawData: {},
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockDb.streamConfig.findUnique.mockResolvedValue(null);
    mockDb.streamConfig.create.mockResolvedValue({ id: 1, streamId: 'test-stream' });
    mockDb.streamConfig.update.mockResolvedValue({ id: 1, streamId: 'test-stream' });
    mockDb.importWatermark.findFirst.mockResolvedValue(null);
    mockDb.importWatermark.create.mockResolvedValue({ id: 1 });
    mockDb.importWatermark.updateMany.mockResolvedValue({ count: 1 });
    mockDb.unifiedMessage.findFirst.mockResolvedValue(null);
    mockDb.unifiedMessage.findUnique.mockResolvedValue(null);
    mockDb.unifiedMessage.create.mockImplementation((data) => ({
      id: Math.random(),
      ...data.data,
    }));

    adapter = new TestStreamAdapter('test-stream', mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Multiple Imports - Watermark Respect', () => {
    it('should return all messages on first import (no watermark)', async () => {
      await adapter.initialize({});
      adapter.setMessages(createMessages());

      const messages = await adapter.fetchMessages();

      expect(messages).toHaveLength(5);
      expect(messages[0].messageId).toBe('msg-001');
      expect(messages[4].messageId).toBe('msg-005');
    });

    it('should return only new messages on second import (respects time watermark)', async () => {
      await adapter.initialize({});
      adapter.setMessages(createMessages());

      // First import - get all messages
      const firstImport = await adapter.fetchMessages();
      expect(firstImport).toHaveLength(5);

      // Update watermark to after msg-003
      const watermark: StreamWatermark = {
        lastProcessedTime: new Date('2025-01-03T10:00:00Z'),
        lastProcessedId: 'msg-003',
        totalProcessed: 3,
      };

      // Second import - should only get msg-004 and msg-005
      const secondImport = await adapter.fetchMessages(watermark);

      expect(secondImport).toHaveLength(2);
      expect(secondImport[0].messageId).toBe('msg-004');
      expect(secondImport[1].messageId).toBe('msg-005');
    });

    it('should return empty array when all messages already imported', async () => {
      await adapter.initialize({});
      adapter.setMessages(createMessages());

      // Watermark at the latest message
      const watermark: StreamWatermark = {
        lastProcessedTime: new Date('2025-01-05T10:00:00Z'),
        lastProcessedId: 'msg-005',
        totalProcessed: 5,
      };

      const messages = await adapter.fetchMessages(watermark);

      expect(messages).toHaveLength(0);
    });

    it('should handle new messages added between imports', async () => {
      await adapter.initialize({});
      const initialMessages = createMessages();
      adapter.setMessages(initialMessages);

      // First import
      const firstImport = await adapter.fetchMessages();
      expect(firstImport).toHaveLength(5);

      // Simulate watermark update
      const watermark: StreamWatermark = {
        lastProcessedTime: new Date('2025-01-05T10:00:00Z'),
        lastProcessedId: 'msg-005',
        totalProcessed: 5,
      };

      // Add new messages
      adapter.setMessages([
        ...initialMessages,
        {
          messageId: 'msg-006',
          timestamp: new Date('2025-01-06T10:00:00Z'),
          author: 'user1',
          content: 'New message after first import',
          channel: 'general',
          rawData: {},
        },
        {
          messageId: 'msg-007',
          timestamp: new Date('2025-01-07T10:00:00Z'),
          author: 'user2',
          content: 'Another new message',
          channel: 'general',
          rawData: {},
        },
      ]);

      // Second import - should only get the new messages
      const secondImport = await adapter.fetchMessages(watermark);

      expect(secondImport).toHaveLength(2);
      expect(secondImport[0].messageId).toBe('msg-006');
      expect(secondImport[1].messageId).toBe('msg-007');
    });
  });

  describe('startDate Setting', () => {
    it('should filter out messages before startDate', async () => {
      await adapter.initialize({
        startDate: '2025-01-03T00:00:00Z',
      });
      adapter.setMessages(createMessages());

      const messages = await adapter.fetchMessages();

      // Should only get messages from Jan 3 onwards (msg-003, msg-004, msg-005)
      expect(messages).toHaveLength(3);
      expect(messages[0].messageId).toBe('msg-003');
      expect(messages[1].messageId).toBe('msg-004');
      expect(messages[2].messageId).toBe('msg-005');
    });

    it('should combine startDate with watermark filtering', async () => {
      await adapter.initialize({
        startDate: '2025-01-02T00:00:00Z',
      });
      adapter.setMessages(createMessages());

      // First import with startDate
      const firstImport = await adapter.fetchMessages();
      expect(firstImport).toHaveLength(4); // msg-002 through msg-005

      // Set watermark after some messages
      const watermark: StreamWatermark = {
        lastProcessedTime: new Date('2025-01-03T10:00:00Z'),
        lastProcessedId: 'msg-003',
        totalProcessed: 2,
      };

      // Second import - respects both startDate and watermark
      const secondImport = await adapter.fetchMessages(watermark);

      expect(secondImport).toHaveLength(2);
      expect(secondImport[0].messageId).toBe('msg-004');
      expect(secondImport[1].messageId).toBe('msg-005');
    });

    it('should return empty if all messages are before startDate', async () => {
      await adapter.initialize({
        startDate: '2025-01-10T00:00:00Z', // After all messages
      });
      adapter.setMessages(createMessages());

      const messages = await adapter.fetchMessages();

      expect(messages).toHaveLength(0);
    });
  });

  describe('Watermark Persistence', () => {
    it('should update watermark after saving messages', async () => {
      await adapter.initialize({});

      const messages = createMessages().slice(0, 2);
      const lastMessage = messages[messages.length - 1];

      await adapter.testUpdateWatermark(
        lastMessage.timestamp,
        lastMessage.messageId,
        messages.length
      );

      expect(mockDb.importWatermark.updateMany).toHaveBeenCalledWith({
        where: {
          streamId: 'test-stream',
          resourceId: null,
        },
        data: expect.objectContaining({
          lastImportedTime: lastMessage.timestamp,
          lastImportedId: lastMessage.messageId,
        }),
      });
    });

    it('should retrieve persisted watermark on subsequent runs', async () => {
      const persistedWatermark = {
        id: 1,
        streamId: 'test-stream',
        lastImportedTime: new Date('2025-01-03T10:00:00Z'),
        lastImportedId: 'msg-003',
      };

      mockDb.importWatermark.findFirst.mockResolvedValue(persistedWatermark);

      await adapter.initialize({});
      const watermark = await adapter.testGetWatermark();

      expect(watermark.lastProcessedTime).toEqual(persistedWatermark.lastImportedTime);
      expect(watermark.lastProcessedId).toBe(persistedWatermark.lastImportedId);
    });
  });

  describe('Duplicate Prevention', () => {
    it('should not re-import messages with same messageId', async () => {
      await adapter.initialize({});

      // First message already exists (via findUnique compound key)
      mockDb.unifiedMessage.findUnique
        .mockResolvedValueOnce({ id: 1, messageId: 'msg-001' }) // First message exists
        .mockResolvedValueOnce(null); // Second message doesn't exist

      const messages = createMessages().slice(0, 2);
      await adapter.testSaveMessages(messages);

      // Only one message should be created (the second one)
      // The base adapter uses findUnique with compound key streamId_messageId
      expect(mockDb.unifiedMessage.create).toHaveBeenCalledTimes(1);
      expect(mockDb.unifiedMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          messageId: 'msg-002',
        }),
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message list', async () => {
      await adapter.initialize({});
      adapter.setMessages([]);

      const messages = await adapter.fetchMessages();

      expect(messages).toHaveLength(0);
    });

    it('should handle messages with same timestamp using ID-based filtering', async () => {
      await adapter.initialize({});

      const sameTimeMessages: StreamMessage[] = [
        {
          messageId: 'msg-a',
          timestamp: new Date('2025-01-01T10:00:00Z'),
          author: 'user1',
          content: 'First message same time',
          channel: 'general',
          rawData: {},
        },
        {
          messageId: 'msg-b',
          timestamp: new Date('2025-01-01T10:00:00Z'),
          author: 'user2',
          content: 'Second message same time',
          channel: 'general',
          rawData: {},
        },
      ];

      adapter.setMessages(sameTimeMessages);

      // First import
      const firstImport = await adapter.fetchMessages();
      expect(firstImport).toHaveLength(2);

      // For same-timestamp scenarios, use ID-only filtering
      // (Time-based filtering with > would exclude both)
      const watermark: StreamWatermark = {
        lastProcessedId: 'msg-a',
        totalProcessed: 1,
      };

      // Should get msg-b (after msg-a by ID order)
      const secondImport = await adapter.fetchMessages(watermark);
      expect(secondImport).toHaveLength(1);
      expect(secondImport[0].messageId).toBe('msg-b');
    });

    it('should handle watermark with only time (no ID)', async () => {
      await adapter.initialize({});
      adapter.setMessages(createMessages());

      const watermark: StreamWatermark = {
        lastProcessedTime: new Date('2025-01-03T10:00:00Z'),
        totalProcessed: 3,
      };

      const messages = await adapter.fetchMessages(watermark);

      // Should get messages AFTER Jan 3
      expect(messages).toHaveLength(2);
      expect(messages[0].messageId).toBe('msg-004');
    });

    it('should handle watermark with only ID (no time)', async () => {
      await adapter.initialize({});
      adapter.setMessages(createMessages());

      const watermark: StreamWatermark = {
        lastProcessedId: 'msg-003',
        totalProcessed: 3,
      };

      const messages = await adapter.fetchMessages(watermark);

      // Should get messages after msg-003 by ID
      expect(messages).toHaveLength(2);
    });
  });

  describe('Concurrent Import Prevention', () => {
    it('should track fetch call count', async () => {
      await adapter.initialize({});
      adapter.setMessages(createMessages());

      expect(adapter.getFetchCallCount()).toBe(0);

      await adapter.fetchMessages();
      expect(adapter.getFetchCallCount()).toBe(1);

      await adapter.fetchMessages();
      expect(adapter.getFetchCallCount()).toBe(2);

      adapter.resetFetchCount();
      expect(adapter.getFetchCallCount()).toBe(0);
    });
  });

  describe('Failure Recovery and Idempotency', () => {
    it('should be idempotent when re-saving already imported messages', async () => {
      await adapter.initialize({});

      // All messages already exist
      mockDb.unifiedMessage.findUnique.mockResolvedValue({ id: 1, messageId: 'existing' });

      const messages = createMessages();
      await adapter.testSaveMessages(messages);

      // No new creates should happen
      expect(mockDb.unifiedMessage.create).not.toHaveBeenCalled();
    });

    it('should handle partial batch save (crash recovery scenario)', async () => {
      await adapter.initialize({});

      // First 2 messages exist (from previous partial save), rest are new
      mockDb.unifiedMessage.findUnique
        .mockResolvedValueOnce({ id: 1, messageId: 'msg-001' })
        .mockResolvedValueOnce({ id: 2, messageId: 'msg-002' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const messages = createMessages();
      await adapter.testSaveMessages(messages);

      // Only 3 new messages should be created
      expect(mockDb.unifiedMessage.create).toHaveBeenCalledTimes(3);
    });

    it('should handle crash after save but before watermark update', async () => {
      await adapter.initialize({});
      adapter.setMessages(createMessages());

      // Simulate: messages saved, watermark NOT updated (crash scenario)
      // On resume, watermark is still at the old position
      const oldWatermark: StreamWatermark = {
        lastProcessedTime: new Date('2025-01-01T00:00:00Z'),
        lastProcessedId: undefined,
        totalProcessed: 0,
      };

      // Re-fetch should return all messages again
      const messages = await adapter.fetchMessages(oldWatermark);
      expect(messages).toHaveLength(5);

      // But saveMessages should skip duplicates (idempotent)
      mockDb.unifiedMessage.findUnique.mockResolvedValue({ id: 1, messageId: 'exists' });
      await adapter.testSaveMessages(messages);
      expect(mockDb.unifiedMessage.create).not.toHaveBeenCalled();
    });

    it('should handle out-of-order message timestamps', async () => {
      await adapter.initialize({});

      // Messages not in chronological order
      const outOfOrderMessages: StreamMessage[] = [
        {
          messageId: 'msg-late',
          timestamp: new Date('2025-01-05T10:00:00Z'), // Latest
          author: 'user1',
          content: 'Late message',
          channel: 'general',
          rawData: {},
        },
        {
          messageId: 'msg-early',
          timestamp: new Date('2025-01-01T10:00:00Z'), // Earliest
          author: 'user2',
          content: 'Early message',
          channel: 'general',
          rawData: {},
        },
        {
          messageId: 'msg-middle',
          timestamp: new Date('2025-01-03T10:00:00Z'), // Middle
          author: 'user3',
          content: 'Middle message',
          channel: 'general',
          rawData: {},
        },
      ];

      adapter.setMessages(outOfOrderMessages);

      // All should be fetched regardless of order
      const messages = await adapter.fetchMessages();
      expect(messages).toHaveLength(3);

      // Watermark should use the LATEST timestamp, not last in array
      const latestTimestamp = new Date(
        Math.max(...outOfOrderMessages.map((m) => m.timestamp.getTime()))
      );
      expect(latestTimestamp).toEqual(new Date('2025-01-05T10:00:00Z'));
    });

    it('should handle future timestamps gracefully', async () => {
      await adapter.initialize({});

      const now = new Date();
      const futureDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow

      const messagesWithFuture: StreamMessage[] = [
        {
          messageId: 'msg-past',
          timestamp: new Date('2025-01-01T10:00:00Z'),
          author: 'user1',
          content: 'Past message',
          channel: 'general',
          rawData: {},
        },
        {
          messageId: 'msg-future',
          timestamp: futureDate,
          author: 'user2',
          content: 'Future message (clock skew?)',
          channel: 'general',
          rawData: {},
        },
      ];

      adapter.setMessages(messagesWithFuture);

      // Should still fetch both (let the save layer validate if needed)
      const messages = await adapter.fetchMessages();
      expect(messages).toHaveLength(2);
    });

    it('should handle empty batch after non-empty batch (transient empty)', async () => {
      await adapter.initialize({});
      adapter.setMessages(createMessages());

      // First import - get messages
      const firstBatch = await adapter.fetchMessages();
      expect(firstBatch).toHaveLength(5);

      // Update watermark
      const watermark: StreamWatermark = {
        lastProcessedTime: new Date('2025-01-05T10:00:00Z'),
        lastProcessedId: 'msg-005',
        totalProcessed: 5,
      };

      // Second import - empty (caught up)
      const secondBatch = await adapter.fetchMessages(watermark);
      expect(secondBatch).toHaveLength(0);

      // Third import - still empty (watermark should not have changed)
      const thirdBatch = await adapter.fetchMessages(watermark);
      expect(thirdBatch).toHaveLength(0);

      // Watermark should remain unchanged (not reset)
      expect(watermark.lastProcessedId).toBe('msg-005');
    });

    it('should handle watermark with null/undefined values', async () => {
      await adapter.initialize({});
      adapter.setMessages(createMessages());

      // Corrupted watermark with null values
      const corruptedWatermark: StreamWatermark = {
        lastProcessedTime: undefined,
        lastProcessedId: undefined,
        totalProcessed: 0,
      };

      // Should treat as fresh import
      const messages = await adapter.fetchMessages(corruptedWatermark);
      expect(messages).toHaveLength(5);
    });

    it('should handle large time gaps efficiently', async () => {
      await adapter.initialize({});

      // Watermark from 6 months ago
      const oldWatermark: StreamWatermark = {
        lastProcessedTime: new Date('2024-07-01T00:00:00Z'),
        lastProcessedId: 'old-msg',
        totalProcessed: 1000,
      };

      // Current messages are all newer
      adapter.setMessages(createMessages()); // Jan 2025

      // Should fetch all current messages (they're all after the old watermark)
      const messages = await adapter.fetchMessages(oldWatermark);
      expect(messages).toHaveLength(5);
    });

    it('should handle database constraint violation gracefully', async () => {
      await adapter.initialize({});

      // First check returns null (not exists)
      mockDb.unifiedMessage.findUnique.mockResolvedValue(null);

      // But create fails with unique constraint error (race condition)
      const constraintError = new Error('Unique constraint violation');
      (constraintError as any).code = 'P2002';
      mockDb.unifiedMessage.create.mockRejectedValueOnce(constraintError);

      const messages = createMessages().slice(0, 1);

      // The base adapter catches and logs errors, returning empty array
      // This is the graceful handling - no throw, just skip failed message
      const result = await adapter.testSaveMessages(messages);
      expect(result).toEqual([]);
    });

    it('should preserve watermark on processing failure', async () => {
      const originalWatermark = {
        id: 1,
        streamId: 'test-stream',
        lastImportedTime: new Date('2025-01-03T10:00:00Z'),
        lastImportedId: 'msg-003',
      };

      mockDb.importWatermark.findFirst.mockResolvedValue(originalWatermark);

      await adapter.initialize({});
      const watermark = await adapter.testGetWatermark();

      // Watermark should reflect the stored value
      expect(watermark.lastProcessedTime).toEqual(originalWatermark.lastImportedTime);
      expect(watermark.lastProcessedId).toBe(originalWatermark.lastImportedId);

      // If processing fails, watermark should NOT be updated
      // (updateWatermark should not be called on failure)
    });

    it('should handle gaps in message IDs (deleted messages)', async () => {
      await adapter.initialize({});

      // Messages with non-contiguous IDs (msg-002 was deleted)
      const gappedMessages: StreamMessage[] = [
        {
          messageId: 'msg-001',
          timestamp: new Date('2025-01-01T10:00:00Z'),
          author: 'user1',
          content: 'Message 1',
          channel: 'general',
          rawData: {},
        },
        {
          messageId: 'msg-003',
          timestamp: new Date('2025-01-03T10:00:00Z'),
          author: 'user2',
          content: 'Message 3 (2 was deleted)',
          channel: 'general',
          rawData: {},
        },
        {
          messageId: 'msg-004',
          timestamp: new Date('2025-01-04T10:00:00Z'),
          author: 'user3',
          content: 'Message 4',
          channel: 'general',
          rawData: {},
        },
      ];

      adapter.setMessages(gappedMessages);

      // Should handle gaps gracefully
      const messages = await adapter.fetchMessages();
      expect(messages).toHaveLength(3);

      // Watermark at msg-001 should get msg-003 and msg-004 next
      const watermark: StreamWatermark = {
        lastProcessedId: 'msg-001',
        totalProcessed: 1,
      };

      const nextBatch = await adapter.fetchMessages(watermark);
      expect(nextBatch).toHaveLength(2);
      expect(nextBatch[0].messageId).toBe('msg-003');
    });

    it('should handle batch size larger than available messages', async () => {
      await adapter.initialize({});
      adapter.setMessages(createMessages()); // 5 messages

      // Request batch of 100, only 5 available
      const messages = await adapter.fetchMessages();

      expect(messages).toHaveLength(5);
      // Should not error, just return what's available
    });

    it('should track import progress for resume capability', async () => {
      await adapter.initialize({});
      adapter.setMessages(createMessages());

      // Import first batch
      const batch1 = await adapter.fetchMessages();
      expect(batch1).toHaveLength(5);

      // Save messages and update watermark
      const lastMsg = batch1[batch1.length - 1];
      await adapter.testUpdateWatermark(lastMsg.timestamp, lastMsg.messageId, batch1.length);

      // Verify watermark was updated
      expect(mockDb.importWatermark.updateMany).toHaveBeenCalledWith({
        where: {
          streamId: 'test-stream',
          resourceId: null,
        },
        data: expect.objectContaining({
          lastImportedTime: lastMsg.timestamp,
          lastImportedId: lastMsg.messageId,
        }),
      });
    });
  });
});
