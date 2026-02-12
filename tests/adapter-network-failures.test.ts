/**
 * Adapter Network Failure Tests
 * Tests for network failure handling, retry logic, and recovery in stream adapters
 *

 * @created 2025-12-31
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { StreamWatermark } from '../server/stream/types.js';
import { RetryHandler } from '../server/stream/llm/retry-handler.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock database
const mockDb = {
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

vi.mock('../server/db.js', () => ({
  default: mockDb,
}));

// Import after mocking
import { ZulipBotAdapter } from '../server/stream/adapters/zulip-bot-adapter.js';

describe('Adapter Network Failure Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.streamConfig.findUnique.mockResolvedValue(null);
    mockDb.streamConfig.create.mockResolvedValue({ id: 1 });
    mockDb.importWatermark.findFirst.mockResolvedValue(null);
    mockDb.importWatermark.create.mockResolvedValue({ id: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ZulipBotAdapter Network Failures', () => {
    const validConfig = {
      email: 'bot@test.zulipchat.com',
      apiKey: 'test-api-key',
      site: 'https://test.zulipchat.com',
      channel: 'test-channel',
    };

    describe('Connection Test Failures', () => {
      it('should fail initialization when connection test fails with network error', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const adapter = new ZulipBotAdapter('test-stream', mockDb);

        await expect(adapter.initialize(validConfig)).rejects.toThrow(
          'Failed to connect to Zulip API'
        );
      });

      it('should fail initialization when connection test returns 401', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 401,
        });

        const adapter = new ZulipBotAdapter('test-stream', mockDb);

        await expect(adapter.initialize(validConfig)).rejects.toThrow(
          'Failed to connect to Zulip API'
        );
      });

      it('should fail initialization when connection test returns 500', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

        const adapter = new ZulipBotAdapter('test-stream', mockDb);

        await expect(adapter.initialize(validConfig)).rejects.toThrow(
          'Failed to connect to Zulip API'
        );
      });
    });

    describe('Fetch Messages Network Failures', () => {
      let adapter: ZulipBotAdapter;

      beforeEach(async () => {
        // Successful connection test
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ email: 'bot@test.zulipchat.com' }),
        });

        adapter = new ZulipBotAdapter('test-stream', mockDb);
        await adapter.initialize(validConfig);
      });

      it('should throw on network timeout', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Request timeout'));

        await expect(adapter.fetchMessages()).rejects.toThrow('Request timeout');
      });

      it('should throw on DNS resolution failure', async () => {
        mockFetch.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));

        await expect(adapter.fetchMessages()).rejects.toThrow('ENOTFOUND');
      });

      it('should throw on connection reset', async () => {
        mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

        await expect(adapter.fetchMessages()).rejects.toThrow('ECONNRESET');
      });

      it('should throw on 500 Internal Server Error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
        });

        await expect(adapter.fetchMessages()).rejects.toThrow('Zulip API error (500)');
      });

      it('should throw on 502 Bad Gateway', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 502,
          text: () => Promise.resolve('Bad Gateway'),
        });

        await expect(adapter.fetchMessages()).rejects.toThrow('Zulip API error (502)');
      });

      it('should throw on 503 Service Unavailable', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: () => Promise.resolve('Service Unavailable'),
        });

        await expect(adapter.fetchMessages()).rejects.toThrow('Zulip API error (503)');
      });

      it('should throw on 429 Rate Limited', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: () => Promise.resolve('Rate limited'),
        });

        await expect(adapter.fetchMessages()).rejects.toThrow('Zulip API error (429)');
      });

      it('should NOT update watermark when fetch fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        try {
          await adapter.fetchMessages();
        } catch {
          // Expected to throw
        }

        // Watermark should not be updated on failure
        expect(mockDb.importWatermark.updateMany).not.toHaveBeenCalled();
      });

      it('should preserve existing watermark on fetch failure', async () => {
        const existingWatermark = {
          id: 1,
          streamId: 'test-stream',
          lastImportedTime: new Date('2025-01-01T00:00:00Z'),
          lastImportedId: 'msg-100',
        };
        mockDb.importWatermark.findFirst.mockResolvedValue(existingWatermark);

        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        try {
          await adapter.fetchMessages();
        } catch {
          // Expected to throw
        }

        // Watermark should remain unchanged
        expect(mockDb.importWatermark.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('Partial Fetch Failures', () => {
      let adapter: ZulipBotAdapter;

      beforeEach(async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ email: 'bot@test.zulipchat.com' }),
        });

        adapter = new ZulipBotAdapter('test-stream', mockDb);
        await adapter.initialize(validConfig);
      });

      it('should throw on JSON parse error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.reject(new Error('Unexpected token')),
        });

        await expect(adapter.fetchMessages()).rejects.toThrow('Unexpected token');
      });

      it('should throw on API result error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              result: 'error',
              msg: 'Stream not found',
              messages: [],
            }),
        });

        await expect(adapter.fetchMessages()).rejects.toThrow('Zulip API error: Stream not found');
      });
    });
  });

  describe('RetryHandler Integration', () => {
    it('should successfully retry transient network errors', async () => {
      const mockDelayFn = vi.fn().mockResolvedValue(undefined);
      const retryHandler = new RetryHandler({ maxRetries: 3 }, mockDelayFn);

      let attempts = 0;
      const operation = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          const error = new Error('Connection reset');
          (error as any).transient = true;
          throw error;
        }
        return Promise.resolve({ messages: [] });
      });

      const result = await retryHandler.execute(operation);

      expect(result).toEqual({ messages: [] });
      expect(attempts).toBe(3);
      expect(mockDelayFn).toHaveBeenCalledTimes(2); // 2 retries before success
    });

    it('should give up after max retries on persistent network failure', async () => {
      const mockDelayFn = vi.fn().mockResolvedValue(undefined);
      const retryHandler = new RetryHandler({ maxRetries: 3 }, mockDelayFn);

      const error = new Error('Network unreachable');
      (error as any).transient = true;
      const operation = vi.fn().mockRejectedValue(error);

      await expect(retryHandler.execute(operation)).rejects.toThrow('Network unreachable');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry on authentication errors (non-transient)', async () => {
      const mockDelayFn = vi.fn().mockResolvedValue(undefined);
      const retryHandler = new RetryHandler({ maxRetries: 3 }, mockDelayFn);

      const error = new Error('Invalid API key');
      (error as any).transient = false;
      const operation = vi.fn().mockRejectedValue(error);

      await expect(retryHandler.execute(operation)).rejects.toThrow('Invalid API key');
      expect(operation).toHaveBeenCalledTimes(1); // No retries
      expect(mockDelayFn).not.toHaveBeenCalled();
    });

    it('should apply exponential backoff between retries', async () => {
      const mockDelayFn = vi.fn().mockResolvedValue(undefined);
      const retryHandler = new RetryHandler(
        {
          maxRetries: 4,
          baseDelayMs: 1000,
          transientDelayMultiplier: 1,
        },
        mockDelayFn
      );

      let attempts = 0;
      const operation = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 4) {
          const error = new Error('Timeout');
          (error as any).transient = true;
          throw error;
        }
        return Promise.resolve('success');
      });

      await retryHandler.execute(operation);

      // Check exponential backoff delays
      expect(mockDelayFn).toHaveBeenNthCalledWith(1, 1000); // 1000 * 2^0
      expect(mockDelayFn).toHaveBeenNthCalledWith(2, 2000); // 1000 * 2^1
      expect(mockDelayFn).toHaveBeenNthCalledWith(3, 4000); // 1000 * 2^2
    });
  });

  describe('Network Error Classification', () => {
    it('should classify timeout errors as transient', () => {
      const timeoutErrors = ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'Request timeout', 'read ECONNRESET'];

      timeoutErrors.forEach((msg) => {
        const error = RetryHandler.transientError(msg);
        expect((error as any).transient).toBe(true);
      });
    });

    it('should classify server errors (5xx) as transient', () => {
      const serverErrors = [
        '500 Internal Server Error',
        '502 Bad Gateway',
        '503 Service Unavailable',
        '504 Gateway Timeout',
      ];

      serverErrors.forEach((msg) => {
        const error = RetryHandler.transientError(msg);
        expect((error as any).transient).toBe(true);
      });
    });

    it('should classify auth errors as permanent', () => {
      const authErrors = ['401 Unauthorized', 'Invalid API key', '403 Forbidden'];

      authErrors.forEach((msg) => {
        const error = RetryHandler.permanentError(msg);
        expect((error as any).transient).toBe(false);
      });
    });

    it('should classify client errors (4xx except 429) as permanent', () => {
      const clientErrors = ['400 Bad Request', '404 Not Found', '422 Unprocessable Entity'];

      clientErrors.forEach((msg) => {
        const error = RetryHandler.permanentError(msg);
        expect((error as any).transient).toBe(false);
      });
    });
  });

  describe('Recovery After Network Failure', () => {
    it('should successfully fetch after transient failure resolves', async () => {
      // Connection test success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ email: 'bot@test.zulipchat.com' }),
      });

      const adapter = new ZulipBotAdapter('test-stream', mockDb);
      await adapter.initialize({
        email: 'bot@test.zulipchat.com',
        apiKey: 'test-api-key',
        site: 'https://test.zulipchat.com',
        channel: 'test-channel',
      });

      // First fetch fails
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(adapter.fetchMessages()).rejects.toThrow('Network error');

      // Second fetch succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: 'success',
            messages: [
              {
                id: 123,
                sender_id: 1,
                sender_full_name: 'User',
                sender_email: 'user@test.com',
                timestamp: 1704067200,
                content: 'Test message',
                display_recipient: 'test-channel',
                subject: 'Topic',
                type: 'stream',
              },
            ],
          }),
      });
      mockDb.unifiedMessage.findUnique.mockResolvedValue(null);
      mockDb.unifiedMessage.create.mockResolvedValue({ id: 1 });

      const messages = await adapter.fetchMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Test message');
    });

    it('should continue from correct watermark after recovery', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ email: 'bot@test.zulipchat.com' }),
      });

      const adapter = new ZulipBotAdapter('test-stream', mockDb);
      await adapter.initialize({
        email: 'bot@test.zulipchat.com',
        apiKey: 'test-api-key',
        site: 'https://test.zulipchat.com',
        channel: 'test-channel',
      });

      // Set up existing watermark
      const existingWatermark: StreamWatermark = {
        lastProcessedTime: new Date('2025-01-01T00:00:00Z'),
        lastProcessedId: '100',
        totalProcessed: 50,
      };

      // Fetch with watermark succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            result: 'success',
            messages: [
              {
                id: 100, // Anchor - should be filtered
                sender_id: 1,
                sender_full_name: 'User',
                sender_email: 'user@test.com',
                timestamp: 1704067200,
                content: 'Anchor message',
                display_recipient: 'test-channel',
                subject: 'Topic',
                type: 'stream',
              },
              {
                id: 101, // New message
                sender_id: 1,
                sender_full_name: 'User',
                sender_email: 'user@test.com',
                timestamp: 1704067201,
                content: 'New message',
                display_recipient: 'test-channel',
                subject: 'Topic',
                type: 'stream',
              },
            ],
          }),
      });
      mockDb.unifiedMessage.findUnique.mockResolvedValue(null);
      mockDb.unifiedMessage.create.mockResolvedValue({ id: 1 });

      const messages = await adapter.fetchMessages(existingWatermark);

      // Should only return new message, not anchor
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('101');
    });
  });
});
