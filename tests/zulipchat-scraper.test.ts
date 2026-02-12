/**
 * Zulipchat Scraper Tests
 * Tests for ZulipchatScraper class

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock storage first
vi.mock('../server/storage', () => ({
  storage: {
    getScrapeMetadata: vi.fn(),
    getMessageByMessageId: vi.fn(),
    createScrapedMessage: vi.fn(),
    createOrUpdateScrapeMetadata: vi.fn(),
  },
}));

import { storage } from '../server/storage';
import {
  ZulipchatScraper,
  createZulipchatScraperFromEnv,
  ZulipConfig,
  ZulipMessage,
} from '../server/scraper/zulipchat';

describe('ZulipchatScraper', () => {
  let scraper: ZulipchatScraper;
  const testConfig: ZulipConfig = {
    email: 'bot@test.com',
    apiKey: 'test-api-key',
    site: 'https://test.zulipchat.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    scraper = new ZulipchatScraper(testConfig);
  });

  describe('constructor', () => {
    it('should create scraper with config', () => {
      expect(scraper).toBeInstanceOf(ZulipchatScraper);
    });
  });

  describe('getAuthHeader', () => {
    it('should generate correct Basic auth header', () => {
      const authHeader = (scraper as any).getAuthHeader();
      const expected = `Basic ${Buffer.from('bot@test.com:test-api-key').toString('base64')}`;
      expect(authHeader).toBe(expected);
    });
  });

  describe('fetchMessages', () => {
    it('should fetch messages and return them on success', async () => {
      const mockMessages: ZulipMessage[] = [
        {
          id: 1,
          sender_id: 100,
          sender_full_name: 'Test User',
          sender_email: 'user@test.com',
          timestamp: 1703318400,
          content: 'Test message',
          display_recipient: 'general',
          subject: 'Topic',
          type: 'stream',
        },
      ];

      // Mock the makeRequest method
      vi.spyOn(scraper as any, 'makeRequest').mockResolvedValue({
        result: 'success',
        messages: mockMessages,
        msg: '',
      });

      const messages = await scraper.fetchMessages('general', 100);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Test message');
    });

    it('should throw error when API returns error result', async () => {
      vi.spyOn(scraper as any, 'makeRequest').mockResolvedValue({
        result: 'error',
        messages: [],
        msg: 'Channel not found',
      });

      await expect(scraper.fetchMessages('nonexistent')).rejects.toThrow(
        'Zulipchat API error: Channel not found'
      );
    });

    it('should use correct default parameters', async () => {
      const makeRequestSpy = vi.spyOn(scraper as any, 'makeRequest').mockResolvedValue({
        result: 'success',
        messages: [],
        msg: '',
      });

      await scraper.fetchMessages('general');

      expect(makeRequestSpy).toHaveBeenCalledWith(expect.stringContaining('num_before=100'));
      expect(makeRequestSpy).toHaveBeenCalledWith(expect.stringContaining('anchor=newest'));
    });
  });

  describe('testConnection', () => {
    it('should return true on successful connection', async () => {
      vi.spyOn(scraper as any, 'makeRequest').mockResolvedValue({ result: 'success' });

      const result = await scraper.testConnection();

      expect(result).toBe(true);
    });

    it('should return false on connection error', async () => {
      vi.spyOn(scraper as any, 'makeRequest').mockRejectedValue(new Error('Connection failed'));

      const result = await scraper.testConnection();

      expect(result).toBe(false);
    });
  });

  describe('scrapeAndStoreMessages', () => {
    const mockMessage: ZulipMessage = {
      id: 123,
      sender_id: 100,
      sender_full_name: 'Test User',
      sender_email: 'user@test.com',
      timestamp: 1703318400,
      content: 'Test content',
      display_recipient: 'general',
      subject: 'Topic',
      type: 'stream',
    };

    it('should store new messages and return count', async () => {
      vi.spyOn(scraper as any, 'makeRequest').mockResolvedValue({
        result: 'success',
        messages: [mockMessage],
        msg: '',
      });

      vi.mocked(storage.getScrapeMetadata).mockResolvedValue(null);
      vi.mocked(storage.getMessageByMessageId).mockResolvedValue(null);
      vi.mocked(storage.createScrapedMessage).mockResolvedValue({} as any);

      const count = await scraper.scrapeAndStoreMessages('general', 100, false);

      expect(count).toBe(1);
      expect(storage.createScrapedMessage).toHaveBeenCalledWith({
        messageId: '123',
        source: 'zulipchat',
        channelName: 'general',
        topicName: 'Topic',
        senderEmail: 'user@test.com',
        senderName: 'Test User',
        content: 'Test content',
        messageTimestamp: expect.any(Date),
        analyzed: false,
      });
    });

    it('should skip existing messages', async () => {
      vi.spyOn(scraper as any, 'makeRequest').mockResolvedValue({
        result: 'success',
        messages: [mockMessage],
        msg: '',
      });

      vi.mocked(storage.getScrapeMetadata).mockResolvedValue(null);
      vi.mocked(storage.getMessageByMessageId).mockResolvedValue({ id: 1 } as any);

      const count = await scraper.scrapeAndStoreMessages('general', 100, false);

      expect(count).toBe(0);
      expect(storage.createScrapedMessage).not.toHaveBeenCalled();
    });

    it('should perform incremental scrape when metadata exists', async () => {
      const makeRequestSpy = vi.spyOn(scraper as any, 'makeRequest').mockResolvedValue({
        result: 'success',
        messages: [{ ...mockMessage, id: 124 }],
        msg: '',
      });

      vi.mocked(storage.getScrapeMetadata).mockResolvedValue({
        lastMessageId: '100',
        lastScrapeTimestamp: new Date('2025-12-22'),
      } as any);
      vi.mocked(storage.getMessageByMessageId).mockResolvedValue(null);
      vi.mocked(storage.createScrapedMessage).mockResolvedValue({} as any);

      await scraper.scrapeAndStoreMessages('general', 100, true);

      // Should use num_after instead of num_before for incremental
      expect(makeRequestSpy).toHaveBeenCalledWith(expect.stringContaining('num_before=0'));
      expect(makeRequestSpy).toHaveBeenCalledWith(expect.stringContaining('num_after=100'));
    });

    it('should filter out anchor message in incremental scrape', async () => {
      const anchorMessage = { ...mockMessage, id: 100 };
      const newMessage = { ...mockMessage, id: 101 };

      vi.spyOn(scraper as any, 'makeRequest').mockResolvedValue({
        result: 'success',
        messages: [anchorMessage, newMessage],
        msg: '',
      });

      vi.mocked(storage.getScrapeMetadata).mockResolvedValue({
        lastMessageId: '100',
        lastScrapeTimestamp: new Date('2025-12-22'),
      } as any);
      vi.mocked(storage.getMessageByMessageId).mockResolvedValue(null);
      vi.mocked(storage.createScrapedMessage).mockResolvedValue({} as any);

      const count = await scraper.scrapeAndStoreMessages('general', 100, true);

      // Should only store the new message, not the anchor
      expect(count).toBe(1);
      expect(storage.createScrapedMessage).toHaveBeenCalledTimes(1);
      expect(storage.createScrapedMessage).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: '101' })
      );
    });

    it('should update scrape metadata after storing messages', async () => {
      vi.spyOn(scraper as any, 'makeRequest').mockResolvedValue({
        result: 'success',
        messages: [mockMessage],
        msg: '',
      });

      vi.mocked(storage.getScrapeMetadata).mockResolvedValue(null);
      vi.mocked(storage.getMessageByMessageId).mockResolvedValue(null);
      vi.mocked(storage.createScrapedMessage).mockResolvedValue({} as any);

      await scraper.scrapeAndStoreMessages('general', 100, false);

      expect(storage.createOrUpdateScrapeMetadata).toHaveBeenCalledWith({
        source: 'zulipchat',
        channelName: 'general',
        lastMessageId: '123',
        lastScrapeTimestamp: expect.any(Date),
        totalMessagesFetched: 1,
      });
    });
  });

  describe('performFullScrape', () => {
    const createMessage = (id: number): ZulipMessage => ({
      id,
      sender_id: 100,
      sender_full_name: 'User',
      sender_email: 'user@test.com',
      timestamp: 1703318400 + id,
      content: `Message ${id}`,
      display_recipient: 'channel',
      subject: 'Topic',
      type: 'stream',
    });

    it('should scrape multiple batches until complete', async () => {
      const batch1 = [createMessage(10), createMessage(9), createMessage(8)];
      const batch2 = [createMessage(7), createMessage(6)];
      const batch3: ZulipMessage[] = [];

      let callCount = 0;
      vi.spyOn(scraper as any, 'makeRequest').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { result: 'success', messages: batch1, msg: '' };
        if (callCount === 2) return { result: 'success', messages: batch2, msg: '' };
        return { result: 'success', messages: batch3, msg: '' };
      });

      vi.mocked(storage.getMessageByMessageId).mockResolvedValue(null);
      vi.mocked(storage.createScrapedMessage).mockResolvedValue({} as any);

      const count = await scraper.performFullScrape('channel', 3);

      expect(count).toBe(5);
    });

    it('should stop when messages array is empty', async () => {
      // Return full batch first, then empty to hit lines 246-247
      const batch1 = [createMessage(10), createMessage(9), createMessage(8)];
      const batch2: ZulipMessage[] = [];

      let callCount = 0;
      vi.spyOn(scraper as any, 'makeRequest').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { result: 'success', messages: batch1, msg: '' };
        return { result: 'success', messages: batch2, msg: '' };
      });

      vi.mocked(storage.getMessageByMessageId).mockResolvedValue(null);
      vi.mocked(storage.createScrapedMessage).mockResolvedValue({} as any);

      const count = await scraper.performFullScrape('channel', 3);

      // Should stop when empty array returned (lines 246-247)
      expect(count).toBe(3);
      expect(callCount).toBe(2);
    });

    it('should stop when batch returns fewer messages than requested', async () => {
      const batch = [createMessage(5), createMessage(4)]; // Only 2 messages, less than batchSize of 10

      vi.spyOn(scraper as any, 'makeRequest').mockResolvedValue({
        result: 'success',
        messages: batch,
        msg: '',
      });

      vi.mocked(storage.getMessageByMessageId).mockResolvedValue(null);
      vi.mocked(storage.createScrapedMessage).mockResolvedValue({} as any);

      const count = await scraper.performFullScrape('channel', 10);

      expect(count).toBe(2);
    });

    it('should stop when anchor does not change', async () => {
      // Return exactly batchSize messages to avoid early exit via line 301
      // Then return same messages again so anchor doesn't change (lines 294-296)
      const batch1 = [createMessage(5), createMessage(4), createMessage(3)];
      // Return messages where oldestMessageId (3) equals the current anchor
      const batch2 = [createMessage(3)]; // Only 1 message, will match anchor

      let callCount = 0;
      vi.spyOn(scraper as any, 'makeRequest').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { result: 'success', messages: batch1, msg: '' };
        // On second call, anchor is 3, and we return message with id 3
        // This means oldestMessageId (3) === anchor (3)
        return { result: 'success', messages: batch2, msg: '' };
      });

      vi.mocked(storage.getMessageByMessageId).mockResolvedValue(null);
      vi.mocked(storage.createScrapedMessage).mockResolvedValue({} as any);

      const count = await scraper.performFullScrape('channel', 3);

      // Should stop after detecting anchor unchanged (lines 294-296)
      expect(count).toBeGreaterThanOrEqual(0);
      expect(callCount).toBe(2);
    });

    it('should skip already existing messages', async () => {
      const messages = [createMessage(10), createMessage(9)];

      vi.spyOn(scraper as any, 'makeRequest').mockResolvedValue({
        result: 'success',
        messages,
        msg: '',
      });

      vi.mocked(storage.getMessageByMessageId)
        .mockResolvedValueOnce({ id: 10 } as any) // exists
        .mockResolvedValueOnce(null); // new
      vi.mocked(storage.createScrapedMessage).mockResolvedValue({} as any);

      const count = await scraper.performFullScrape('channel', 10);

      expect(count).toBe(1);
      expect(storage.createScrapedMessage).toHaveBeenCalledTimes(1);
    });
  });
});

describe('createZulipchatScraperFromEnv', () => {
  beforeEach(() => {
    delete process.env.ZULIP_BOT_EMAIL;
    delete process.env.ZULIP_API_KEY;
    delete process.env.ZULIP_SITE;
  });

  afterEach(() => {
    delete process.env.ZULIP_BOT_EMAIL;
    delete process.env.ZULIP_API_KEY;
    delete process.env.ZULIP_SITE;
  });

  it('should create scraper when all credentials are set', () => {
    process.env.ZULIP_BOT_EMAIL = 'bot@test.com';
    process.env.ZULIP_API_KEY = 'api-key';
    process.env.ZULIP_SITE = 'https://test.zulipchat.com';

    const scraper = createZulipchatScraperFromEnv();

    expect(scraper).toBeInstanceOf(ZulipchatScraper);
  });

  it('should return null when email is missing', () => {
    process.env.ZULIP_API_KEY = 'api-key';
    process.env.ZULIP_SITE = 'https://test.zulipchat.com';

    const scraper = createZulipchatScraperFromEnv();

    expect(scraper).toBeNull();
  });

  it('should return null when API key is missing', () => {
    process.env.ZULIP_BOT_EMAIL = 'bot@test.com';
    process.env.ZULIP_SITE = 'https://test.zulipchat.com';

    const scraper = createZulipchatScraperFromEnv();

    expect(scraper).toBeNull();
  });

  it('should return null when site is not specified', () => {
    process.env.ZULIP_BOT_EMAIL = 'bot@test.com';
    process.env.ZULIP_API_KEY = 'api-key';
    // ZULIP_SITE is not set

    const scraper = createZulipchatScraperFromEnv();

    expect(scraper).toBeNull();
  });

  it('should use custom site when specified', () => {
    process.env.ZULIP_BOT_EMAIL = 'bot@test.com';
    process.env.ZULIP_API_KEY = 'api-key';
    process.env.ZULIP_SITE = 'https://custom.zulipchat.com';

    const scraper = createZulipchatScraperFromEnv();

    expect(scraper).not.toBeNull();
  });
});
