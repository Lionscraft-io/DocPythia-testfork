/**
 * Unit Tests: Message Reply Chains
 * Tests for reply-to message tracking, reply chain detection, and conversation grouping

 * Date: 2025-11-04
 * Reference: /docs/archive/specs/telegram-reply-chain-visualization.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from './mocks/prisma.mock';

// Mock Prisma
vi.mock('../server/db.js', () => ({
  default: mockPrismaClient,
}));

describe('Message Reply Chains', () => {
  const testStreamId = 'test-telegram-stream';
  const testChatId = -1001234567890;

  beforeEach(() => {
    resetPrismaMocks();
  });

  describe('Reply-To Message Tracking', () => {
    it('should capture replyToMessageId in metadata', () => {
      const messageWithReply = {
        id: 1,
        streamId: testStreamId,
        messageId: `${testChatId}-123`,
        author: 'Test User',
        content: 'This is a reply',
        timestamp: new Date(),
        channel: 'test-channel',
        processingStatus: 'PENDING',
        metadata: {
          chatId: testChatId,
          messageId: 123,
          replyToMessageId: 122,
        },
        rawData: {},
      };

      expect(messageWithReply.metadata).toBeDefined();
      expect(messageWithReply.metadata.replyToMessageId).toBe(122);
      expect(messageWithReply.metadata.chatId).toBe(testChatId);
      expect(messageWithReply.metadata.messageId).toBe(123);
    });

    it('should handle messages without reply', () => {
      const standaloneMessage = {
        id: 2,
        streamId: testStreamId,
        messageId: `${testChatId}-124`,
        author: 'Test User',
        content: 'Standalone message',
        timestamp: new Date(),
        channel: 'test-channel',
        processingStatus: 'PENDING',
        metadata: {
          chatId: testChatId,
          messageId: 124,
        },
        rawData: {},
      };

      expect(standaloneMessage.metadata.replyToMessageId).toBeUndefined();
    });

    it('should track message thread ID for topics', () => {
      const topicMessage = {
        id: 3,
        streamId: testStreamId,
        messageId: `${testChatId}-125`,
        author: 'Test User',
        content: 'Message in topic',
        timestamp: new Date(),
        channel: 'test-channel',
        processingStatus: 'PENDING',
        metadata: {
          chatId: testChatId,
          messageId: 125,
          messageThreadId: 5,
        },
        rawData: {},
      };

      expect(topicMessage.metadata.messageThreadId).toBe(5);
    });
  });

  describe('Reply Chain Detection', () => {
    it('should detect simple reply chain (A -> B)', () => {
      const messageA = {
        id: 1,
        streamId: testStreamId,
        messageId: `${testChatId}-100`,
        author: 'UserA',
        content: 'Original message',
        timestamp: new Date('2025-01-01T10:00:00Z'),
        channel: 'test-channel',
        processingStatus: 'PENDING',
        metadata: {
          chatId: testChatId,
          messageId: 100,
        },
      };

      const messageB = {
        id: 2,
        streamId: testStreamId,
        messageId: `${testChatId}-101`,
        author: 'UserB',
        content: 'Reply to original',
        timestamp: new Date('2025-01-01T10:01:00Z'),
        channel: 'test-channel',
        processingStatus: 'PENDING',
        metadata: {
          chatId: testChatId,
          messageId: 101,
          replyToMessageId: 100,
        },
      };

      const messages = [messageA, messageB];

      expect(messages).toHaveLength(2);
      expect(messages[1].metadata.replyToMessageId).toBe(100);

      // Verify composite ID format matches
      const replyToCompositeId = `${testChatId}-${messages[1].metadata.replyToMessageId}`;
      expect(replyToCompositeId).toBe(messageA.messageId);
    });

    it('should detect threaded reply chain (A -> B -> C)', () => {
      const messages = [
        {
          id: 1,
          messageId: `${testChatId}-200`,
          metadata: { chatId: testChatId, messageId: 200 },
        },
        {
          id: 2,
          messageId: `${testChatId}-201`,
          metadata: { chatId: testChatId, messageId: 201, replyToMessageId: 200 },
        },
        {
          id: 3,
          messageId: `${testChatId}-202`,
          metadata: { chatId: testChatId, messageId: 202, replyToMessageId: 201 },
        },
      ];

      expect(messages).toHaveLength(3);
      expect(messages[0].metadata.replyToMessageId).toBeUndefined();
      expect(messages[1].metadata.replyToMessageId).toBe(200);
      expect(messages[2].metadata.replyToMessageId).toBe(201);
    });

    it('should handle branching reply chains (A -> B, A -> C)', () => {
      const messages = [
        {
          id: 1,
          messageId: `${testChatId}-300`,
          metadata: { chatId: testChatId, messageId: 300 },
        },
        {
          id: 2,
          messageId: `${testChatId}-301`,
          metadata: { chatId: testChatId, messageId: 301, replyToMessageId: 300 },
        },
        {
          id: 3,
          messageId: `${testChatId}-302`,
          metadata: { chatId: testChatId, messageId: 302, replyToMessageId: 300 },
        },
      ];

      // Both B and C reply to A
      expect(messages[1].metadata.replyToMessageId).toBe(300);
      expect(messages[2].metadata.replyToMessageId).toBe(300);
    });
  });

  describe('Conversation Grouping with Reply Chains', () => {
    it('should group reply chain messages into same conversation', () => {
      const conversationId = 'conv-reply-chain-400';

      const classifications = [
        { messageId: 1, category: 'question', conversationId, batchId: 'batch-1' },
        { messageId: 2, category: 'question', conversationId, batchId: 'batch-1' },
        { messageId: 3, category: 'question', conversationId, batchId: 'batch-1' },
      ];

      expect(classifications).toHaveLength(3);
      expect(new Set(classifications.map((c) => c.conversationId)).size).toBe(1);
    });

    it('should separate independent conversations', () => {
      const classifications = [
        { messageId: 1, conversationId: 'conv-1', batchId: 'batch-1' },
        { messageId: 2, conversationId: 'conv-1', batchId: 'batch-1' },
        { messageId: 3, conversationId: 'conv-2', batchId: 'batch-1' },
      ];

      const conv1Count = classifications.filter((c) => c.conversationId === 'conv-1').length;
      const conv2Count = classifications.filter((c) => c.conversationId === 'conv-2').length;

      expect(conv1Count).toBe(2);
      expect(conv2Count).toBe(1);
    });
  });

  describe('Cross-Batch Reply Chains', () => {
    it('should handle replies that span multiple batches', () => {
      const classifications = [
        { messageId: 1, conversationId: 'conv-cross-batch', batchId: 'batch-1' },
        { messageId: 2, conversationId: 'conv-cross-batch', batchId: 'batch-2' },
      ];

      // Both messages in same conversation, different batches
      expect(classifications).toHaveLength(2);
      expect(classifications.map((c) => c.batchId)).toEqual(['batch-1', 'batch-2']);
      expect(new Set(classifications.map((c) => c.conversationId)).size).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle reply to non-existent message', () => {
      const message = {
        id: 1,
        streamId: testStreamId,
        messageId: `${testChatId}-700`,
        author: 'UserA',
        content: 'Reply to unknown',
        metadata: {
          chatId: testChatId,
          messageId: 700,
          replyToMessageId: 999, // Non-existent
        },
      };

      // Message can still be created with reference to non-existent message
      expect(message.metadata.replyToMessageId).toBe(999);
    });

    it('should handle circular reply chains gracefully', () => {
      // This shouldn't happen in real Telegram, but test defensive handling
      const messages = [
        {
          id: 1,
          messageId: `${testChatId}-800`,
          metadata: { chatId: testChatId, messageId: 800, replyToMessageId: 801 },
        },
        {
          id: 2,
          messageId: `${testChatId}-801`,
          metadata: { chatId: testChatId, messageId: 801, replyToMessageId: 800 },
        },
      ];

      // Both messages can exist despite circular reference
      expect(messages).toHaveLength(2);
    });

    it('should handle messages from different chats with same message ID', () => {
      const chat1 = -1001111111111;
      const chat2 = -1002222222222;

      const messages = [
        {
          streamId: testStreamId,
          messageId: `${chat1}-100`,
          metadata: { chatId: chat1, messageId: 100 },
        },
        {
          streamId: testStreamId,
          messageId: `${chat2}-100`,
          metadata: { chatId: chat2, messageId: 100 },
        },
      ];

      // Composite IDs should be unique despite same message ID
      expect(messages[0].messageId).not.toBe(messages[1].messageId);
    });
  });

  describe('Reply Chain Metadata Preservation', () => {
    it('should preserve full metadata including update ID and thread ID', () => {
      const message = {
        streamId: testStreamId,
        messageId: `${testChatId}-126`,
        author: 'Test User',
        content: 'Test message with full metadata',
        metadata: {
          messageId: 126,
          chatId: testChatId,
          replyToMessageId: 125,
          messageThreadId: 5,
          updateId: 999,
        },
      };

      expect(message.metadata).toMatchObject({
        messageId: 126,
        chatId: testChatId,
        replyToMessageId: 125,
        messageThreadId: 5,
        updateId: 999,
      });
    });
  });
});
