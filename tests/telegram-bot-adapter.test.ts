/**
 * Unit tests for TelegramBotAdapter

 * Date: 2025-11-04
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock Prisma - must be before imports
vi.mock('../server/db', () => ({
  default: {
    importWatermark: {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
    streamConfig: {
      findUnique: vi.fn().mockResolvedValue({ id: 1, streamId: 'test', config: {} }),
      create: vi.fn().mockResolvedValue({ id: 1, streamId: 'test', config: {} }),
      update: vi.fn().mockResolvedValue({ id: 1, streamId: 'test', config: {} }),
    },
    unifiedMessage: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

// Create a mock db object for passing to constructor
const mockDb = {
  importWatermark: {
    findFirst: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
  },
  streamConfig: {
    findUnique: vi.fn().mockResolvedValue({ id: 1, streamId: 'test', config: {} }),
    create: vi.fn().mockResolvedValue({ id: 1, streamId: 'test', config: {} }),
    update: vi.fn().mockResolvedValue({ id: 1, streamId: 'test', config: {} }),
  },
  unifiedMessage: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    count: vi.fn().mockResolvedValue(0),
  },
};

import { TelegramBotAdapter } from '../server/stream/adapters/telegram-bot-adapter';

// Hoisted mock instance for Telegraf
const mockTelegrafInstance = vi.hoisted(() => ({
  on: vi.fn(),
  command: vi.fn(),
  launch: vi.fn().mockResolvedValue(undefined),
  telegram: {
    setWebhook: vi.fn().mockResolvedValue(undefined),
    deleteWebhook: vi.fn().mockResolvedValue(undefined),
  },
  stop: vi.fn(),
  handleUpdate: vi.fn(),
}));

// Mock Telegraf with class syntax
vi.mock('telegraf', () => {
  return {
    Telegraf: class MockTelegraf {
      on = mockTelegrafInstance.on;
      command = mockTelegrafInstance.command;
      launch = mockTelegrafInstance.launch;
      telegram = mockTelegrafInstance.telegram;
      stop = mockTelegrafInstance.stop;
      handleUpdate = mockTelegrafInstance.handleUpdate;
    },
  };
});

describe('TelegramBotAdapter', () => {
  let adapter: TelegramBotAdapter;

  beforeEach(() => {
    adapter = new TelegramBotAdapter('test-telegram-bot', mockDb as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Configuration Validation', () => {
    it('should validate correct polling configuration', () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      };
      expect(adapter.validateConfig(config)).toBe(true);
    });

    it('should validate correct webhook configuration', () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'webhook',
        webhookUrl: 'https://example.com',
      };
      expect(adapter.validateConfig(config)).toBe(true);
    });

    it('should reject configuration without bot token', () => {
      const config = { mode: 'polling' };
      expect(adapter.validateConfig(config)).toBe(false);
    });

    it('should reject configuration with invalid mode', () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'invalid',
      };
      expect(adapter.validateConfig(config)).toBe(false);
    });

    it('should reject webhook mode without webhookUrl', () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'webhook',
      };
      expect(adapter.validateConfig(config)).toBe(false);
    });

    it('should set default values for optional config', () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      };
      adapter.validateConfig(config);

      // Check that defaults are applied
      const botConfig = (adapter as any).botConfig;
      expect(botConfig.webhookPath).toBe('/telegram-webhook');
      expect(botConfig.pollingInterval).toBe(3000);
      expect(botConfig.ignoreOldMessages).toBe(true);
      expect(botConfig.processCommands).toBe(false);
      expect(botConfig.saveRawUpdates).toBe(true);
    });
  });

  describe('Message Normalization', () => {
    it('should normalize group message correctly', () => {
      // Initialize config first
      adapter.validateConfig({
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      });

      const mockMessage = {
        message_id: 123,
        date: 1699012345,
        chat: {
          id: -1001234567890,
          title: 'Test Group',
          type: 'supergroup' as const,
        },
        from: {
          id: 987654321,
          first_name: 'John',
          last_name: 'Doe',
          username: 'johndoe',
        },
        text: 'How do I configure RPC timeout?',
      };

      const mockUpdate = {
        update_id: 456,
        message: mockMessage,
      };

      // Access private method via bracket notation
      const normalized = (adapter as any).normalizeMessage(mockMessage, mockUpdate);

      expect(normalized.messageId).toBe('-1001234567890-123');
      expect(normalized.author).toContain('John Doe');
      expect(normalized.author).toContain('@johndoe');
      expect(normalized.content).toBe('How do I configure RPC timeout?');
      expect(normalized.channel).toBe('Test Group');
      expect(normalized.metadata.chatId).toBe('-1001234567890');
      expect(normalized.metadata.chatType).toBe('supergroup');
      expect(normalized.metadata.updateId).toBe(456);
    });

    it('should normalize direct message correctly', () => {
      // Initialize config first
      adapter.validateConfig({
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      });

      const mockMessage = {
        message_id: 789,
        date: 1699012350,
        chat: {
          id: 12345678,
          first_name: 'Alice',
          type: 'private' as const,
        },
        from: {
          id: 12345678,
          first_name: 'Alice',
        },
        text: 'Hello bot!',
      };

      const mockUpdate = {
        update_id: 457,
        message: mockMessage,
      };

      const normalized = (adapter as any).normalizeMessage(mockMessage, mockUpdate);

      expect(normalized.messageId).toBe('12345678-789');
      expect(normalized.author).toBe('Alice');
      expect(normalized.content).toBe('Hello bot!');
      expect(normalized.channel).toBe('Direct Message');
      expect(normalized.metadata.chatType).toBe('private');
    });

    it('should handle message without username', () => {
      // Initialize config first
      adapter.validateConfig({
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      });

      const mockMessage = {
        message_id: 111,
        date: 1699012360,
        chat: {
          id: -1001234567890,
          title: 'Test Channel',
          type: 'channel' as const,
        },
        from: {
          id: 987654321,
          first_name: 'Bob',
        },
        text: 'Test message',
      };

      const mockUpdate = {
        update_id: 458,
        message: mockMessage,
      };

      const normalized = (adapter as any).normalizeMessage(mockMessage, mockUpdate);

      expect(normalized.author).toBe('Bob');
      expect(normalized.author).not.toContain('@');
    });

    it('should include reply metadata when message is a reply', () => {
      // Initialize config first
      adapter.validateConfig({
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      });

      const mockMessage = {
        message_id: 222,
        date: 1699012370,
        chat: {
          id: -1001234567890,
          title: 'Test Group',
          type: 'supergroup' as const,
        },
        from: {
          id: 987654321,
          first_name: 'Charlie',
        },
        text: 'This is a reply',
        reply_to_message: {
          message_id: 221,
        },
      };

      const mockUpdate = {
        update_id: 459,
        message: mockMessage,
      };

      const normalized = (adapter as any).normalizeMessage(mockMessage, mockUpdate);

      expect(normalized.metadata.replyToMessageId).toBe(221);
    });
  });

  describe('fetchMessages', () => {
    it('should return empty array for push-based bot', async () => {
      const messages = await adapter.fetchMessages();
      expect(messages).toEqual([]);
    });
  });

  describe('Adapter Properties', () => {
    it('should have correct adapter type', () => {
      expect(adapter.adapterType).toBe('telegram-bot');
    });

    it('should have correct stream ID', () => {
      expect(adapter.streamId).toBe('test-telegram-bot');
    });
  });

  describe('Cleanup', () => {
    it('should handle cleanup when not running', async () => {
      await adapter.cleanup();
      expect(adapter).toBeDefined();
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle custom webhook path', () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'webhook',
        webhookUrl: 'https://example.com',
        webhookPath: '/custom-webhook',
      };

      adapter.validateConfig(config);
      const botConfig = (adapter as any).botConfig;
      expect(botConfig.webhookPath).toBe('/custom-webhook');
    });

    it('should handle custom polling interval', () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
        pollingInterval: 5000,
      };

      adapter.validateConfig(config);
      const botConfig = (adapter as any).botConfig;
      expect(botConfig.pollingInterval).toBe(5000);
    });

    it('should handle allowed chats configuration', () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
        allowedChats: ['chat1', 'chat2', 'chat3'],
      };

      adapter.validateConfig(config);
      const botConfig = (adapter as any).botConfig;
      expect(botConfig.allowedChats).toEqual(['chat1', 'chat2', 'chat3']);
    });

    it('should handle ignoreOldMessages=false', () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
        ignoreOldMessages: false,
      };

      adapter.validateConfig(config);
      const botConfig = (adapter as any).botConfig;
      expect(botConfig.ignoreOldMessages).toBe(false);
    });

    it('should handle saveRawUpdates=false', () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
        saveRawUpdates: false,
      };

      adapter.validateConfig(config);
      const botConfig = (adapter as any).botConfig;
      expect(botConfig.saveRawUpdates).toBe(false);
    });

    it('should handle processCommands=true', () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
        processCommands: true,
      };

      adapter.validateConfig(config);
      const botConfig = (adapter as any).botConfig;
      expect(botConfig.processCommands).toBe(true);
    });
  });

  describe('Message Normalization Edge Cases', () => {
    it('should handle message with thread ID', () => {
      adapter.validateConfig({
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      });

      const mockMessage = {
        message_id: 333,
        message_thread_id: 999,
        date: 1699012380,
        chat: {
          id: -1001234567890,
          title: 'Test Group',
          type: 'supergroup' as const,
        },
        from: {
          id: 987654321,
          first_name: 'Dave',
        },
        text: 'Thread message',
      };

      const mockUpdate = {
        update_id: 460,
        message: mockMessage,
      };

      const normalized = (adapter as any).normalizeMessage(mockMessage, mockUpdate);
      expect(normalized.metadata.messageThreadId).toBe(999);
    });

    it('should handle message without from field', () => {
      adapter.validateConfig({
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      });

      const mockMessage = {
        message_id: 444,
        date: 1699012390,
        chat: {
          id: -1001234567890,
          title: 'Test Channel',
          type: 'channel' as const,
        },
        text: 'Channel post without author',
      };

      const mockUpdate = {
        update_id: 461,
        message: mockMessage,
      };

      const normalized = (adapter as any).normalizeMessage(mockMessage, mockUpdate);
      expect(normalized.author).toBe('Unknown');
    });

    it('should store raw update data when saveRawUpdates is true', () => {
      adapter.validateConfig({
        botToken: '123456:ABC-DEF',
        mode: 'polling',
        saveRawUpdates: true,
      });

      const mockMessage = {
        message_id: 555,
        date: 1699012400,
        chat: {
          id: -1001234567890,
          title: 'Test Group',
          type: 'supergroup' as const,
        },
        from: {
          id: 987654321,
          first_name: 'Eve',
        },
        text: 'Test with raw data',
      };

      const mockUpdate = {
        update_id: 462,
        message: mockMessage,
      };

      const normalized = (adapter as any).normalizeMessage(mockMessage, mockUpdate);
      expect(normalized.rawData).toEqual(mockUpdate);
    });

    it('should not store raw update when saveRawUpdates is false', () => {
      adapter.validateConfig({
        botToken: '123456:ABC-DEF',
        mode: 'polling',
        saveRawUpdates: false,
      });

      const mockMessage = {
        message_id: 666,
        date: 1699012410,
        chat: {
          id: -1001234567890,
          title: 'Test Group',
          type: 'supergroup' as const,
        },
        from: {
          id: 987654321,
          first_name: 'Frank',
        },
        text: 'Test without raw data',
      };

      const mockUpdate = {
        update_id: 463,
        message: mockMessage,
      };

      const normalized = (adapter as any).normalizeMessage(mockMessage, mockUpdate);
      expect(normalized.rawData).toEqual({ message_id: 666 });
    });
  });

  describe('Initialize', () => {
    it('should initialize in polling mode', async () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      };

      // Should not throw
      await adapter.initialize(config);
      expect((adapter as any).isRunning).toBe(true);
    });

    it('should initialize in webhook mode', async () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'webhook',
        webhookUrl: 'https://example.com',
        webhookPath: '/webhook',
      };

      await adapter.initialize(config);
      expect((adapter as any).isRunning).toBe(true);
    });

    it('should set up command handlers when processCommands is true', async () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
        processCommands: true,
      };

      await adapter.initialize(config);

      // Verify command handler was called
      const bot = (adapter as any).bot;
      expect(bot.command).toHaveBeenCalled();
    });

    it('should not set up command handlers when processCommands is false', async () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
        processCommands: false,
      };

      await adapter.initialize(config);

      // Verify command handler was NOT called
      const bot = (adapter as any).bot;
      expect(bot.command).not.toHaveBeenCalled();
    });
  });

  describe('Cleanup when running', () => {
    it('should stop polling when cleanup is called in polling mode', async () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      };

      await adapter.initialize(config);
      expect((adapter as any).isRunning).toBe(true);

      await adapter.cleanup();

      expect((adapter as any).isRunning).toBe(false);
      const bot = (adapter as any).bot;
      expect(bot.stop).toHaveBeenCalled();
    });

    it('should delete webhook when cleanup is called in webhook mode', async () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'webhook',
        webhookUrl: 'https://example.com',
      };

      await adapter.initialize(config);

      await adapter.cleanup();

      expect((adapter as any).isRunning).toBe(false);
      const bot = (adapter as any).bot;
      expect(bot.telegram.deleteWebhook).toHaveBeenCalled();
    });
  });

  describe('getBotInstance', () => {
    it('should return bot instance after initialization', async () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      };

      await adapter.initialize(config);

      const botInstance = adapter.getBotInstance();
      expect(botInstance).toBeDefined();
      expect(botInstance.on).toBeDefined();
    });
  });

  describe('handleMessage', () => {
    it('should handle text message and save to database', async () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      };

      await adapter.initialize(config);

      // Get the message handler that was registered
      const bot = (adapter as any).bot;
      const onCalls = bot.on.mock.calls;

      // Find the 'message' handler
      const messageHandler = onCalls.find((call: any[]) => call[0] === 'message');
      expect(messageHandler).toBeDefined();

      // Create mock context
      const mockCtx = {
        message: {
          message_id: 123,
          date: 1699012345,
          chat: {
            id: -1001234567890,
            title: 'Test Group',
            type: 'supergroup',
          },
          from: {
            id: 987654321,
            first_name: 'Test',
            last_name: 'User',
          },
          text: 'Test message content',
        },
        update: {
          update_id: 999,
        },
      };

      // Mock the getWatermark to return no previous processing
      vi.spyOn(adapter, 'getWatermark').mockResolvedValue({
        lastProcessedTime: null,
        lastProcessedId: null,
        totalProcessed: 0,
        metadata: {},
      });

      // Mock saveMessages to return saved IDs
      vi.spyOn(adapter as any, 'saveMessages').mockResolvedValue([1]);

      // Mock updateWatermark
      vi.spyOn(adapter, 'updateWatermark').mockResolvedValue(undefined);

      // Call the handler
      await messageHandler[1](mockCtx);

      expect((adapter as any).saveMessages).toHaveBeenCalled();
    });

    it('should ignore non-text messages', async () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      };

      await adapter.initialize(config);

      const bot = (adapter as any).bot;
      const onCalls = bot.on.mock.calls;
      const messageHandler = onCalls.find((call: any[]) => call[0] === 'message');

      const mockCtx = {
        message: {
          message_id: 123,
          date: 1699012345,
          chat: { id: -1001234567890, type: 'supergroup' },
          // No 'text' field - this is a non-text message (e.g., photo)
          photo: [{ file_id: 'abc123' }],
        },
        update: { update_id: 999 },
      };

      vi.spyOn(adapter as any, 'saveMessages').mockClear();

      await messageHandler[1](mockCtx);

      expect((adapter as any).saveMessages).not.toHaveBeenCalled();
    });

    it('should ignore messages from non-whitelisted chats', async () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
        allowedChats: ['allowed-chat-id'],
      };

      await adapter.initialize(config);

      const bot = (adapter as any).bot;
      const onCalls = bot.on.mock.calls;
      const messageHandler = onCalls.find((call: any[]) => call[0] === 'message');

      const mockCtx = {
        message: {
          message_id: 123,
          date: 1699012345,
          chat: {
            id: -1001234567890, // Not in whitelist
            title: 'Not Allowed Group',
            type: 'supergroup',
          },
          from: { id: 123, first_name: 'User' },
          text: 'Message from non-whitelisted chat',
        },
        update: { update_id: 999 },
      };

      const saveMessagesSpy = vi.spyOn(adapter as any, 'saveMessages');
      saveMessagesSpy.mockClear();

      await messageHandler[1](mockCtx);

      expect(saveMessagesSpy).not.toHaveBeenCalled();
    });

    it('should skip already processed updates', async () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      };

      await adapter.initialize(config);

      const bot = (adapter as any).bot;
      const messageHandler = bot.on.mock.calls.find((call: any[]) => call[0] === 'message');

      const mockCtx = {
        message: {
          message_id: 123,
          date: 1699012345,
          chat: { id: -1001234567890, title: 'Test', type: 'supergroup' },
          from: { id: 123, first_name: 'User' },
          text: 'Test message',
        },
        update: { update_id: 50 }, // Lower than last processed
      };

      vi.spyOn(adapter, 'getWatermark').mockResolvedValue({
        lastProcessedTime: new Date(),
        lastProcessedId: '100', // Already processed up to 100
        totalProcessed: 100,
        metadata: {},
      });

      const saveMessagesSpy = vi.spyOn(adapter as any, 'saveMessages');
      saveMessagesSpy.mockClear();

      await messageHandler[1](mockCtx);

      expect(saveMessagesSpy).not.toHaveBeenCalled();
    });

    it('should handle channel_post messages', async () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      };

      await adapter.initialize(config);

      const bot = (adapter as any).bot;
      const channelHandler = bot.on.mock.calls.find((call: any[]) => call[0] === 'channel_post');
      expect(channelHandler).toBeDefined();

      const mockCtx = {
        channelPost: {
          message_id: 456,
          date: 1699012345,
          chat: { id: -1001234567890, title: 'Test Channel', type: 'channel' },
          text: 'Channel post content',
        },
        update: { update_id: 1000 },
      };

      vi.spyOn(adapter, 'getWatermark').mockResolvedValue({
        lastProcessedTime: null,
        lastProcessedId: null,
        totalProcessed: 0,
        metadata: {},
      });
      vi.spyOn(adapter as any, 'saveMessages').mockResolvedValue([1]);
      vi.spyOn(adapter, 'updateWatermark').mockResolvedValue(undefined);

      await channelHandler[1](mockCtx);

      expect((adapter as any).saveMessages).toHaveBeenCalled();
    });
  });

  describe('getStreamStats', () => {
    it('should return stream statistics', async () => {
      const config = {
        botToken: '123456:ABC-DEF',
        mode: 'polling',
      };

      await adapter.initialize(config);

      // The mock already returns 0 for count
      const stats = await (adapter as any).getStreamStats();

      expect(stats).toHaveProperty('totalMessages');
      expect(stats).toHaveProperty('pendingMessages');
      expect(typeof stats.totalMessages).toBe('number');
      expect(typeof stats.pendingMessages).toBe('number');
    });
  });
});
