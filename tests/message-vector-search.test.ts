/**
 * Message Vector Search Tests
 * Tests for MessageVectorSearch service

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to define mocks before vi.mock is hoisted
const { mockEmbedText, mockSearchSimilar, MockPgVectorStore } = vi.hoisted(() => {
  const mockEmbedText = vi.fn();
  const mockSearchSimilar = vi.fn();

  class MockPgVectorStore {
    constructor(_instanceId: string, _db: any) {}
    searchSimilar = mockSearchSimilar;
  }

  return { mockEmbedText, mockSearchSimilar, MockPgVectorStore };
});

vi.mock('../server/embeddings/gemini-embedder.js', () => ({
  geminiEmbedder: {
    embedText: mockEmbedText,
  },
}));

vi.mock('../server/vector-store.js', () => ({
  PgVectorStore: MockPgVectorStore,
}));

import { MessageVectorSearch } from '../server/stream/message-vector-search';

describe('MessageVectorSearch', () => {
  let search: MessageVectorSearch;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbedText.mockReset();
    mockSearchSimilar.mockReset();

    mockDb = {
      $executeRaw: vi.fn(),
      $queryRawUnsafe: vi.fn(),
      $queryRaw: vi.fn(),
    };

    search = new MessageVectorSearch('test-instance', mockDb);
  });

  describe('constructor', () => {
    it('should create instance with correct properties', () => {
      expect(search).toBeInstanceOf(MessageVectorSearch);
    });
  });

  describe('generateEmbedding', () => {
    it('should generate embedding for content', async () => {
      const mockEmbedding = new Array(768).fill(0.5);
      mockEmbedText.mockResolvedValue(mockEmbedding);

      const result = await search.generateEmbedding('Test content');

      expect(result).toEqual(mockEmbedding);
      expect(mockEmbedText).toHaveBeenCalledWith('Test content');
    });

    it('should throw error when embedding generation fails', async () => {
      mockEmbedText.mockRejectedValue(new Error('API error'));

      await expect(search.generateEmbedding('Test')).rejects.toThrow('API error');
    });
  });

  describe('storeEmbedding', () => {
    it('should store embedding for message', async () => {
      const embedding = [0.1, 0.2, 0.3];
      mockDb.$executeRaw.mockResolvedValue(1);

      await search.storeEmbedding(123, embedding);

      expect(mockDb.$executeRaw).toHaveBeenCalled();
    });

    it('should throw error when storing fails', async () => {
      mockDb.$executeRaw.mockRejectedValue(new Error('DB error'));

      await expect(search.storeEmbedding(123, [0.1])).rejects.toThrow('DB error');
    });
  });

  describe('searchSimilarMessages', () => {
    const mockResults = [
      {
        id: 1,
        content: 'Message 1',
        author: 'user1',
        timestamp: new Date('2025-12-23T10:00:00Z'),
        channel: 'general',
        distance: 0.9,
      },
      {
        id: 2,
        content: 'Message 2',
        author: 'user2',
        timestamp: new Date('2025-12-23T11:00:00Z'),
        channel: 'dev',
        distance: 0.85,
      },
    ];

    it('should search and return similar messages', async () => {
      mockDb.$queryRawUnsafe.mockResolvedValue(mockResults);

      const queryEmbedding = new Array(768).fill(0.5);
      const result = await search.searchSimilarMessages(queryEmbedding, 10);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[0].similarity).toBe(0.9);
      expect(result[1].id).toBe(2);
    });

    it('should use default limit of 10', async () => {
      mockDb.$queryRawUnsafe.mockResolvedValue([]);

      await search.searchSimilarMessages([0.1, 0.2]);

      expect(mockDb.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        0.5, // default minSimilarity
        10 // default limit
      );
    });

    it('should exclude specified message ID', async () => {
      mockDb.$queryRawUnsafe.mockResolvedValue([]);

      await search.searchSimilarMessages([0.1], 5, 123, 0.6);

      expect(mockDb.$queryRawUnsafe).toHaveBeenCalled();
      const query = mockDb.$queryRawUnsafe.mock.calls[0][0];
      expect(query).toContain('123'); // excludeMessageId in query
    });

    it('should throw error when search fails', async () => {
      mockDb.$queryRawUnsafe.mockRejectedValue(new Error('Search failed'));

      await expect(search.searchSimilarMessages([0.1])).rejects.toThrow('Search failed');
    });
  });

  describe('searchSimilarByContent', () => {
    it('should generate embedding and search', async () => {
      const mockEmbedding = new Array(768).fill(0.5);
      mockEmbedText.mockResolvedValue(mockEmbedding);
      mockDb.$queryRawUnsafe.mockResolvedValue([
        {
          id: 1,
          content: 'Similar message',
          author: 'user1',
          timestamp: new Date(),
          channel: 'general',
          distance: 0.92,
        },
      ]);

      const result = await search.searchSimilarByContent('Test query', 5);

      expect(mockEmbedText).toHaveBeenCalledWith('Test query');
      expect(result).toHaveLength(1);
      expect(result[0].similarity).toBe(0.92);
    });

    it('should pass through excludeMessageId and minSimilarity', async () => {
      mockEmbedText.mockResolvedValue([0.1]);
      mockDb.$queryRawUnsafe.mockResolvedValue([]);

      await search.searchSimilarByContent('Query', 10, 456, 0.7);

      expect(mockDb.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        0.7,
        10
      );
    });

    it('should throw error when embedding fails', async () => {
      mockEmbedText.mockRejectedValue(new Error('Embedding error'));

      await expect(search.searchSimilarByContent('Test')).rejects.toThrow('Embedding error');
    });
  });

  describe('getEmbeddedMessagesCount', () => {
    it('should return count of embedded messages', async () => {
      mockDb.$queryRaw.mockResolvedValue([{ count: BigInt(42) }]);

      const result = await search.getEmbeddedMessagesCount();

      expect(result).toBe(42);
    });

    it('should return 0 on error', async () => {
      mockDb.$queryRaw.mockRejectedValue(new Error('Query failed'));

      const result = await search.getEmbeddedMessagesCount();

      expect(result).toBe(0);
    });
  });

  describe('hasEmbedding', () => {
    it('should return true when message has embedding', async () => {
      mockDb.$queryRaw.mockResolvedValue([{ has_embedding: true }]);

      const result = await search.hasEmbedding(123);

      expect(result).toBe(true);
    });

    it('should return false when message has no embedding', async () => {
      mockDb.$queryRaw.mockResolvedValue([{ has_embedding: false }]);

      const result = await search.hasEmbedding(123);

      expect(result).toBe(false);
    });

    it('should return false when message not found', async () => {
      mockDb.$queryRaw.mockResolvedValue([]);

      const result = await search.hasEmbedding(999);

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockDb.$queryRaw.mockRejectedValue(new Error('DB error'));

      const result = await search.hasEmbedding(123);

      expect(result).toBe(false);
    });
  });

  describe('batchStoreEmbeddings', () => {
    it('should store multiple embeddings', async () => {
      mockDb.$executeRaw.mockResolvedValue(1);

      const embeddings = [
        { messageId: 1, embedding: [0.1, 0.2] },
        { messageId: 2, embedding: [0.3, 0.4] },
        { messageId: 3, embedding: [0.5, 0.6] },
      ];

      await search.batchStoreEmbeddings(embeddings);

      expect(mockDb.$executeRaw).toHaveBeenCalledTimes(3);
    });

    it('should throw error when batch store fails', async () => {
      mockDb.$executeRaw.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('Store failed'));

      const embeddings = [
        { messageId: 1, embedding: [0.1] },
        { messageId: 2, embedding: [0.2] },
      ];

      await expect(search.batchStoreEmbeddings(embeddings)).rejects.toThrow('Store failed');
    });
  });

  describe('searchSimilarDocs', () => {
    it('should search similar documentation pages', async () => {
      const mockEmbedding = new Array(768).fill(0.5);
      mockEmbedText.mockResolvedValue(mockEmbedding);
      mockSearchSimilar.mockResolvedValue([
        {
          pageId: 1,
          title: 'Getting Started',
          filePath: '/docs/getting-started.md',
          content: 'This is the getting started guide...',
          similarity: 0.95,
        },
        {
          pageId: 2,
          title: 'Installation',
          filePath: '/docs/installation.md',
          content: 'Installation instructions...',
          similarity: 0.88,
        },
      ]);

      const result = await search.searchSimilarDocs('how to get started', 5);

      expect(mockEmbedText).toHaveBeenCalledWith('how to get started');
      expect(mockSearchSimilar).toHaveBeenCalledWith(mockEmbedding, 5);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 1,
        title: 'Getting Started',
        file_path: '/docs/getting-started.md',
        content: 'This is the getting started guide...',
        distance: 0.95,
      });
    });

    it('should use default limit of 5', async () => {
      mockEmbedText.mockResolvedValue([0.1]);
      mockSearchSimilar.mockResolvedValue([]);

      await search.searchSimilarDocs('test query');

      expect(mockSearchSimilar).toHaveBeenCalledWith([0.1], 5);
    });

    it('should throw error when search fails', async () => {
      mockEmbedText.mockResolvedValue([0.1]);
      mockSearchSimilar.mockRejectedValue(new Error('Search failed'));

      await expect(search.searchSimilarDocs('test')).rejects.toThrow('Search failed');
    });
  });
});
