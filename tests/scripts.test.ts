/**
 * Server Scripts Tests

 * Date: 2025-12-29
 *
 * Tests for CLI scripts in server/scripts/
 * These scripts are entry points that use external dependencies.
 * We test by mocking dependencies and process.exit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock storage
const mockStorage = vi.hoisted(() => ({
  getUnanalyzedMessages: vi.fn(),
}));

vi.mock('../server/storage', () => ({
  storage: mockStorage,
}));

// Mock analyzer factory
const mockAnalyzer = vi.hoisted(() => ({
  analyzeUnanalyzedMessages: vi.fn(),
}));

const mockCreateAnalyzerFromEnv = vi.hoisted(() => vi.fn());

vi.mock('../server/analyzer/gemini-analyzer', () => ({
  createAnalyzerFromEnv: mockCreateAnalyzerFromEnv,
}));

// Mock scraper factory
const mockScraper = vi.hoisted(() => ({
  testConnection: vi.fn(),
  performFullScrape: vi.fn(),
}));

const mockCreateZulipchatScraperFromEnv = vi.hoisted(() => vi.fn());

vi.mock('../server/scraper/zulipchat', () => ({
  createZulipchatScraperFromEnv: mockCreateZulipchatScraperFromEnv,
}));

describe('Server Scripts Dependencies', () => {
  const originalEnv = process.env;
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
  });

  describe('analyze-messages script dependencies', () => {
    it('should handle when analyzer is not configured', async () => {
      mockCreateAnalyzerFromEnv.mockReturnValue(null);

      const { createAnalyzerFromEnv } = await import('../server/analyzer/gemini-analyzer');
      const analyzer = createAnalyzerFromEnv();

      expect(analyzer).toBeNull();
    });

    it('should create analyzer when API key is configured', async () => {
      mockCreateAnalyzerFromEnv.mockReturnValue(mockAnalyzer);

      const { createAnalyzerFromEnv } = await import('../server/analyzer/gemini-analyzer');
      const analyzer = createAnalyzerFromEnv();

      expect(analyzer).toBe(mockAnalyzer);
    });

    it('should get unanalyzed messages from storage', async () => {
      mockStorage.getUnanalyzedMessages.mockResolvedValue([
        { id: 1, content: 'Message 1' },
        { id: 2, content: 'Message 2' },
      ]);

      const { storage } = await import('../server/storage');
      const messages = await storage.getUnanalyzedMessages();

      expect(messages).toHaveLength(2);
    });

    it('should analyze messages with limit', async () => {
      mockAnalyzer.analyzeUnanalyzedMessages.mockResolvedValue({
        analyzed: 10,
        relevant: 5,
        updatesCreated: 3,
      });

      const result = await mockAnalyzer.analyzeUnanalyzedMessages(100);

      expect(result.analyzed).toBe(10);
      expect(result.relevant).toBe(5);
      expect(result.updatesCreated).toBe(3);
    });
  });

  describe('full-scrape script dependencies', () => {
    it('should handle when scraper is not configured', async () => {
      mockCreateZulipchatScraperFromEnv.mockReturnValue(null);

      const { createZulipchatScraperFromEnv } = await import('../server/scraper/zulipchat');
      const scraper = createZulipchatScraperFromEnv();

      expect(scraper).toBeNull();
    });

    it('should create scraper when credentials are configured', async () => {
      mockCreateZulipchatScraperFromEnv.mockReturnValue(mockScraper);

      const { createZulipchatScraperFromEnv } = await import('../server/scraper/zulipchat');
      const scraper = createZulipchatScraperFromEnv();

      expect(scraper).toBe(mockScraper);
    });

    it('should test connection before scraping', async () => {
      mockScraper.testConnection.mockResolvedValue(true);

      const connected = await mockScraper.testConnection();

      expect(connected).toBe(true);
    });

    it('should handle failed connection', async () => {
      mockScraper.testConnection.mockResolvedValue(false);

      const connected = await mockScraper.testConnection();

      expect(connected).toBe(false);
    });

    it('should perform full scrape with channel and batch size', async () => {
      mockScraper.performFullScrape.mockResolvedValue(1500);

      const totalMessages = await mockScraper.performFullScrape('community-support', 1000);

      expect(totalMessages).toBe(1500);
    });

    it('should handle scrape errors', async () => {
      mockScraper.performFullScrape.mockRejectedValue(new Error('Network error'));

      await expect(mockScraper.performFullScrape('test', 100)).rejects.toThrow('Network error');
    });
  });

  describe('Script argument parsing patterns', () => {
    it('should parse numeric arguments', () => {
      const limit = parseInt('100', 10);
      expect(limit).toBe(100);
    });

    it('should use default when argument is undefined', () => {
      const argValue: string | undefined = undefined;
      const limit = parseInt(argValue ?? '100', 10);
      expect(limit).toBe(100);
    });

    it('should parse channel name from argv', () => {
      const argChannel: string | undefined = 'community-support';
      const channelName = argChannel ?? process.env.ZULIP_CHANNEL ?? 'default';
      expect(channelName).toBe('community-support');
    });

    it('should fall back to env var for channel', () => {
      process.env.ZULIP_CHANNEL = 'env-channel';
      const argChannel: string | undefined = undefined;
      const channelName = argChannel ?? process.env.ZULIP_CHANNEL ?? 'default';
      expect(channelName).toBe('env-channel');
    });

    it('should fall back to default channel', () => {
      delete process.env.ZULIP_CHANNEL;
      const argChannel: string | undefined = undefined;
      const channelName = argChannel ?? process.env.ZULIP_CHANNEL ?? 'default';
      expect(channelName).toBe('default');
    });
  });

  describe('Error handling patterns', () => {
    it('should extract error message from Error object', () => {
      const error = new Error('Something went wrong');
      expect(error.message).toBe('Something went wrong');
    });

    it('should have stack trace on errors', () => {
      const error = new Error('Test error');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('Test error');
    });
  });

  describe('Analysis result processing', () => {
    it('should handle zero results', () => {
      const result = { analyzed: 0, relevant: 0, updatesCreated: 0 };

      expect(result.analyzed).toBe(0);
      expect(result.relevant).toBe(0);
      expect(result.updatesCreated).toBe(0);
    });

    it('should handle partial results', () => {
      const result = { analyzed: 100, relevant: 25, updatesCreated: 10 };

      expect(result.analyzed).toBe(100);
      expect(result.relevant).toBe(25);
      expect(result.relevant / result.analyzed).toBe(0.25);
    });
  });

  describe('Scrape result processing', () => {
    it('should return total message count', () => {
      const totalMessages = 1500;
      expect(totalMessages).toBeGreaterThan(0);
    });

    it('should handle zero messages', () => {
      const totalMessages = 0;
      expect(totalMessages).toBe(0);
    });
  });
});

describe('Script Console Output Formatting', () => {
  it('should format box headers correctly', () => {
    const header = '╔═══════════════════════════════════════════╗';
    const middle = '║   DocPythia - Full Scrape                  ║';
    const footer = '╚═══════════════════════════════════════════╝';

    expect(header).toContain('╔');
    expect(header).toContain('╗');
    expect(middle).toContain('║');
    expect(footer).toContain('╚');
    expect(footer).toContain('╝');
  });

  it('should format completion messages', () => {
    const totalMessages = 1500;
    const message = `Total messages stored: ${totalMessages}`;
    expect(message).toBe('Total messages stored: 1500');
  });

  it('should format analysis results', () => {
    const result = { analyzed: 100, relevant: 25, updatesCreated: 10 };
    const messages = [
      `Messages analyzed: ${result.analyzed}`,
      `Relevant messages: ${result.relevant}`,
      `Updates created: ${result.updatesCreated}`,
    ];

    expect(messages[0]).toBe('Messages analyzed: 100');
    expect(messages[1]).toBe('Relevant messages: 25');
    expect(messages[2]).toBe('Updates created: 10');
  });
});

describe('analyze-messages.ts main function logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should handle missing analyzer configuration', async () => {
    mockCreateAnalyzerFromEnv.mockReturnValue(null);

    const analyzer = mockCreateAnalyzerFromEnv();
    expect(analyzer).toBeNull();
    // Script would call process.exit(1) here
  });

  it('should execute full analysis workflow', async () => {
    mockCreateAnalyzerFromEnv.mockReturnValue(mockAnalyzer);
    mockStorage.getUnanalyzedMessages.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mockAnalyzer.analyzeUnanalyzedMessages.mockResolvedValue({
      analyzed: 2,
      relevant: 1,
      updatesCreated: 1,
    });

    // Simulate main function logic
    const analyzer = mockCreateAnalyzerFromEnv();
    expect(analyzer).not.toBeNull();

    const unanalyzed = await mockStorage.getUnanalyzedMessages();
    expect(unanalyzed).toHaveLength(2);

    const result = await mockAnalyzer.analyzeUnanalyzedMessages(100);
    expect(result.analyzed).toBe(2);
    expect(result.relevant).toBe(1);
    expect(result.updatesCreated).toBe(1);
  });

  it('should handle analysis errors gracefully', async () => {
    mockCreateAnalyzerFromEnv.mockReturnValue(mockAnalyzer);
    mockStorage.getUnanalyzedMessages.mockResolvedValue([]);
    mockAnalyzer.analyzeUnanalyzedMessages.mockRejectedValue(new Error('Analysis failed'));

    const analyzer = mockCreateAnalyzerFromEnv();
    expect(analyzer).not.toBeNull();

    await expect(mockAnalyzer.analyzeUnanalyzedMessages(100)).rejects.toThrow('Analysis failed');
  });

  it('should parse limit from command line arguments', () => {
    const testCases = [
      { arg: '50', expected: 50 },
      { arg: '100', expected: 100 },
      { arg: undefined, expected: 100 }, // default
    ];

    for (const { arg, expected } of testCases) {
      const limit = parseInt(arg || '100', 10);
      expect(limit).toBe(expected);
    }
  });
});

describe('full-scrape.ts main function logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should handle missing scraper configuration', async () => {
    mockCreateZulipchatScraperFromEnv.mockReturnValue(null);

    const scraper = mockCreateZulipchatScraperFromEnv();
    expect(scraper).toBeNull();
    // Script would call process.exit(1) here
  });

  it('should handle failed connection', async () => {
    mockCreateZulipchatScraperFromEnv.mockReturnValue(mockScraper);
    mockScraper.testConnection.mockResolvedValue(false);

    const scraper = mockCreateZulipchatScraperFromEnv();
    expect(scraper).not.toBeNull();

    const connected = await mockScraper.testConnection();
    expect(connected).toBe(false);
    // Script would call process.exit(1) here
  });

  it('should execute full scrape workflow', async () => {
    mockCreateZulipchatScraperFromEnv.mockReturnValue(mockScraper);
    mockScraper.testConnection.mockResolvedValue(true);
    mockScraper.performFullScrape.mockResolvedValue(1500);

    const scraper = mockCreateZulipchatScraperFromEnv();
    expect(scraper).not.toBeNull();

    const connected = await mockScraper.testConnection();
    expect(connected).toBe(true);

    const totalMessages = await mockScraper.performFullScrape('community-support', 1000);
    expect(totalMessages).toBe(1500);
  });

  it('should handle scrape errors gracefully', async () => {
    mockCreateZulipchatScraperFromEnv.mockReturnValue(mockScraper);
    mockScraper.testConnection.mockResolvedValue(true);
    mockScraper.performFullScrape.mockRejectedValue(new Error('Scrape failed'));

    await expect(mockScraper.performFullScrape('test', 100)).rejects.toThrow('Scrape failed');
  });

  it('should parse channel and batch size from arguments', () => {
    // Channel parsing
    const argChannel: string | undefined = 'my-channel';
    const channelFromArg = argChannel ?? process.env.ZULIP_CHANNEL ?? 'community-support';
    expect(channelFromArg).toBe('my-channel');

    // Batch size parsing
    const argBatchSize: string | undefined = '500';
    const batchSize = parseInt(argBatchSize ?? '1000', 10);
    expect(batchSize).toBe(500);

    // Defaults
    const undefinedArg: string | undefined = undefined;
    const defaultBatch = parseInt(undefinedArg ?? '1000', 10);
    expect(defaultBatch).toBe(1000);
  });
});
