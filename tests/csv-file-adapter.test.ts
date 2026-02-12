/**
 * CSV File Adapter Tests
 * Tests for CsvFileAdapter stream adapter

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CsvFileAdapter } from '../server/stream/adapters/csv-file-adapter';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock csv-parse/sync
vi.mock('csv-parse/sync', () => ({
  parse: vi.fn(),
}));

import * as fs from 'fs/promises';
import { parse } from 'csv-parse/sync';

describe('CsvFileAdapter', () => {
  let adapter: CsvFileAdapter;
  let mockDb: any;

  const validConfig = {
    inboxDir: '/tmp/inbox',
    processedDir: '/tmp/processed',
    columnMapping: {
      content: 'message',
      timestamp: 'date',
      author: 'user',
      channel: 'channel',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      streamConfig: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 1 }),
        update: vi.fn().mockResolvedValue({ id: 1 }),
      },
      importWatermark: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      unifiedMessage: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 1 }),
      },
    };

    adapter = new CsvFileAdapter('test-csv', mockDb);
  });

  describe('constructor', () => {
    it('should create adapter with correct type', () => {
      expect(adapter.adapterType).toBe('csv');
      expect(adapter.streamId).toBe('test-csv');
    });
  });

  describe('validateConfig', () => {
    it('should accept valid configuration', () => {
      const result = adapter.validateConfig(validConfig);
      expect(result).toBe(true);
    });

    it('should reject config without inboxDir', () => {
      const config = { ...validConfig, inboxDir: undefined };
      const result = adapter.validateConfig(config);
      expect(result).toBe(false);
    });

    it('should reject config with non-string inboxDir', () => {
      const config = { ...validConfig, inboxDir: 123 };
      const result = adapter.validateConfig(config);
      expect(result).toBe(false);
    });

    it('should reject config without processedDir', () => {
      const config = { ...validConfig, processedDir: undefined };
      const result = adapter.validateConfig(config);
      expect(result).toBe(false);
    });

    it('should reject config with non-string processedDir', () => {
      const config = { ...validConfig, processedDir: [] };
      const result = adapter.validateConfig(config);
      expect(result).toBe(false);
    });

    it('should reject config without columnMapping', () => {
      const config = { inboxDir: '/tmp/in', processedDir: '/tmp/out' };
      const result = adapter.validateConfig(config);
      expect(result).toBe(false);
    });

    it('should reject config with non-object columnMapping', () => {
      const config = { ...validConfig, columnMapping: 'invalid' };
      const result = adapter.validateConfig(config);
      expect(result).toBe(false);
    });

    it('should reject config without content column mapping', () => {
      const config = {
        ...validConfig,
        columnMapping: { author: 'user' },
      };
      const result = adapter.validateConfig(config);
      expect(result).toBe(false);
    });

    it('should reject config with non-string content column mapping', () => {
      const config = {
        ...validConfig,
        columnMapping: { content: 123 },
      };
      const result = adapter.validateConfig(config);
      expect(result).toBe(false);
    });
  });

  describe('initialize', () => {
    it('should create directories on initialize', async () => {
      await adapter.initialize(validConfig);

      expect(fs.mkdir).toHaveBeenCalledWith('/tmp/inbox', { recursive: true });
      expect(fs.mkdir).toHaveBeenCalledWith('/tmp/processed', { recursive: true });
    });

    it('should throw error for invalid config', async () => {
      await expect(adapter.initialize({ invalid: true })).rejects.toThrow('Invalid configuration');
    });
  });

  describe('fetchMessages', () => {
    const csvContent = `date,user,message,channel
2025-12-23T10:00:00Z,alice,Hello world,general
2025-12-23T11:00:00Z,bob,Hi there,dev`;

    beforeEach(async () => {
      await adapter.initialize(validConfig);
    });

    it('should return empty array when no files in inbox', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const messages = await adapter.fetchMessages();

      expect(messages).toEqual([]);
    });

    it('should process CSV files and return messages', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([{ name: 'test.csv', isFile: () => true }] as any);
      vi.mocked(fs.readFile).mockResolvedValue(csvContent);
      vi.mocked(parse).mockReturnValue([
        { date: '2025-12-23T10:00:00Z', user: 'alice', message: 'Hello world', channel: 'general' },
        { date: '2025-12-23T11:00:00Z', user: 'bob', message: 'Hi there', channel: 'dev' },
      ]);

      const messages = await adapter.fetchMessages();

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('Hello world');
      expect(messages[0].author).toBe('alice');
      expect(messages[0].channel).toBe('general');
      expect(messages[1].content).toBe('Hi there');
      expect(messages[1].author).toBe('bob');
    });

    it('should filter CSV files only', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'data.csv', isFile: () => true },
        { name: 'readme.txt', isFile: () => true },
        { name: 'data', isFile: () => false },
      ] as any);
      vi.mocked(fs.readFile).mockResolvedValue('');
      vi.mocked(parse).mockReturnValue([]);

      await adapter.fetchMessages();

      expect(fs.readFile).toHaveBeenCalledTimes(1);
      expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining('data.csv'), 'utf-8');
    });

    it('should move processed file to processed directory', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([{ name: 'test.csv', isFile: () => true }] as any);
      vi.mocked(fs.readFile).mockResolvedValue('');
      vi.mocked(parse).mockReturnValue([]);

      await adapter.fetchMessages();

      expect(fs.rename).toHaveBeenCalledWith(
        expect.stringContaining('test.csv'),
        expect.stringContaining('processed')
      );
    });

    it('should save processing report', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([{ name: 'test.csv', isFile: () => true }] as any);
      vi.mocked(fs.readFile).mockResolvedValue('');
      vi.mocked(parse).mockReturnValue([
        { date: '2025-12-23T10:00:00Z', user: 'alice', message: 'Test', channel: 'ch1' },
      ]);

      await adapter.fetchMessages();

      // Verify report was written
      expect(fs.writeFile).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      expect(writeCall[0]).toContain('_report.json');

      // Parse and verify the report content
      const reportJson = JSON.parse(writeCall[1] as string);
      expect(reportJson.totalRows).toBe(1);
      expect(reportJson.successfulRows).toBe(1);
    });

    it('should continue processing on file error', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'bad.csv', isFile: () => true },
        { name: 'good.csv', isFile: () => true },
      ] as any);
      vi.mocked(fs.readFile)
        .mockRejectedValueOnce(new Error('Cannot read file'))
        .mockResolvedValueOnce('');
      vi.mocked(parse).mockReturnValue([
        { date: '2025-12-23T10:00:00Z', user: 'bob', message: 'Success', channel: 'test' },
      ]);

      const messages = await adapter.fetchMessages();

      // Should still process the good file
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Success');
    });

    it('should filter messages by watermark', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([{ name: 'test.csv', isFile: () => true }] as any);
      vi.mocked(fs.readFile).mockResolvedValue('');
      vi.mocked(parse).mockReturnValue([
        { date: '2025-12-23T08:00:00Z', user: 'old', message: 'Old message', channel: 'ch1' },
        { date: '2025-12-23T12:00:00Z', user: 'new', message: 'New message', channel: 'ch1' },
      ]);

      const watermark = {
        lastProcessedTime: new Date('2025-12-23T10:00:00Z'),
        lastProcessedId: undefined,
        totalProcessed: 0,
      };

      const messages = await adapter.fetchMessages(watermark);

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('New message');
    });

    it('should throw when not initialized', async () => {
      const uninitAdapter = new CsvFileAdapter('uninit', mockDb);

      await expect(uninitAdapter.fetchMessages()).rejects.toThrow('not initialized');
    });
  });

  describe('row parsing', () => {
    beforeEach(async () => {
      await adapter.initialize(validConfig);
    });

    it('should generate message ID from filename and row number', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([{ name: 'data.csv', isFile: () => true }] as any);
      vi.mocked(fs.readFile).mockResolvedValue('');
      vi.mocked(parse).mockReturnValue([
        { date: '2025-12-23T10:00:00Z', user: 'alice', message: 'Test' },
      ]);

      const messages = await adapter.fetchMessages();

      expect(messages[0].messageId).toBe('data.csv-row-1');
    });

    it('should use custom message ID column when configured', async () => {
      const configWithId = {
        ...validConfig,
        columnMapping: {
          ...validConfig.columnMapping,
          messageId: 'id',
        },
      };
      const adapterWithId = new CsvFileAdapter('test-id', mockDb);
      await adapterWithId.initialize(configWithId);

      vi.mocked(fs.readdir).mockResolvedValue([{ name: 'data.csv', isFile: () => true }] as any);
      vi.mocked(fs.readFile).mockResolvedValue('');
      vi.mocked(parse).mockReturnValue([
        { id: 'custom-123', date: '2025-12-23T10:00:00Z', user: 'alice', message: 'Test' },
      ]);

      const messages = await adapterWithId.fetchMessages();

      expect(messages[0].messageId).toBe('custom-123');
    });

    it('should use current time when timestamp missing', async () => {
      const configNoTimestamp = {
        inboxDir: '/tmp/inbox',
        processedDir: '/tmp/processed',
        columnMapping: {
          content: 'message',
        },
      };
      const adapterNoTs = new CsvFileAdapter('test-nots', mockDb);
      await adapterNoTs.initialize(configNoTimestamp);

      vi.mocked(fs.readdir).mockResolvedValue([{ name: 'data.csv', isFile: () => true }] as any);
      vi.mocked(fs.readFile).mockResolvedValue('');
      vi.mocked(parse).mockReturnValue([{ message: 'No timestamp message' }]);

      const before = new Date();
      const messages = await adapterNoTs.fetchMessages();
      const after = new Date();

      expect(messages[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(messages[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should use unknown author when author missing', async () => {
      const configNoAuthor = {
        inboxDir: '/tmp/inbox',
        processedDir: '/tmp/processed',
        columnMapping: {
          content: 'message',
        },
      };
      const adapterNoAuthor = new CsvFileAdapter('test-noauthor', mockDb);
      await adapterNoAuthor.initialize(configNoAuthor);

      vi.mocked(fs.readdir).mockResolvedValue([{ name: 'data.csv', isFile: () => true }] as any);
      vi.mocked(fs.readFile).mockResolvedValue('');
      vi.mocked(parse).mockReturnValue([{ message: 'Anonymous message' }]);

      const messages = await adapterNoAuthor.fetchMessages();

      expect(messages[0].author).toBe('unknown');
    });

    it('should handle invalid timestamp', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([{ name: 'data.csv', isFile: () => true }] as any);
      vi.mocked(fs.readFile).mockResolvedValue('');
      vi.mocked(parse).mockReturnValue([
        { date: 'invalid-date', user: 'alice', message: 'Test', channel: 'ch1' },
        { date: '2025-12-23T10:00:00Z', user: 'bob', message: 'Valid', channel: 'ch1' },
      ]);

      const messages = await adapter.fetchMessages();

      // First row fails, second succeeds
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Valid');
    });

    it('should handle missing content field', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([{ name: 'data.csv', isFile: () => true }] as any);
      vi.mocked(fs.readFile).mockResolvedValue('');
      vi.mocked(parse).mockReturnValue([
        { date: '2025-12-23T10:00:00Z', user: 'alice' }, // Missing 'message'
        { date: '2025-12-23T10:00:00Z', user: 'bob', message: 'Valid', channel: 'ch1' },
      ]);

      const messages = await adapter.fetchMessages();

      // First row fails, second succeeds
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Valid');
    });

    it('should include metadata with source info', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([{ name: 'source.csv', isFile: () => true }] as any);
      vi.mocked(fs.readFile).mockResolvedValue('');
      vi.mocked(parse).mockReturnValue([
        { date: '2025-12-23T10:00:00Z', user: 'alice', message: 'Test', channel: 'ch1' },
      ]);

      const messages = await adapter.fetchMessages();

      expect(messages[0].metadata).toEqual({
        source: 'csv',
        fileName: 'source.csv',
        rowNumber: 1,
      });
    });

    it('should store raw row data', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([{ name: 'data.csv', isFile: () => true }] as any);
      vi.mocked(fs.readFile).mockResolvedValue('');
      const rawRow = {
        date: '2025-12-23T10:00:00Z',
        user: 'alice',
        message: 'Test',
        channel: 'general',
        extra_field: 'extra_value',
      };
      vi.mocked(parse).mockReturnValue([rawRow]);

      const messages = await adapter.fetchMessages();

      expect(messages[0].rawData).toEqual(rawRow);
    });
  });

  describe('processing report', () => {
    beforeEach(async () => {
      await adapter.initialize(validConfig);
    });

    it('should include error details in report', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([{ name: 'mixed.csv', isFile: () => true }] as any);
      vi.mocked(fs.readFile).mockResolvedValue('');
      vi.mocked(parse).mockReturnValue([
        { date: 'bad-date', user: 'alice', message: 'Test1', channel: 'ch1' },
        { date: '2025-12-23T10:00:00Z', user: 'bob', message: 'Test2', channel: 'ch1' },
        { user: 'charlie' }, // Missing content
      ]);

      await adapter.fetchMessages();

      // Verify report was written
      expect(fs.writeFile).toHaveBeenCalled();
      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      expect(writeCall[0]).toContain('_report.json');

      // Parse and verify the report content
      const reportJson = JSON.parse(writeCall[1] as string);
      expect(reportJson.totalRows).toBe(3);
      expect(reportJson.successfulRows).toBe(1);
      expect(reportJson.failedRows).toBe(2);
    });
  });
});
