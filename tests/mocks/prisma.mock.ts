/**
 * Prisma Client Mock
 * Provides mock implementations for Prisma database operations
 */

import { vi } from 'vitest';

export const mockPrismaClient = {
  // Processing Watermark
  processingWatermark: {
    findUnique: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
  },

  // Unified Messages
  unifiedMessage: {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    groupBy: vi.fn(),
  },

  // Message Classification
  messageClassification: {
    count: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    groupBy: vi.fn(),
  },

  // RAG Context
  messageRagContext: {
    create: vi.fn(),
    deleteMany: vi.fn(),
  },

  // Conversation RAG Context (newer naming)
  conversationRagContext: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },

  // Doc Proposals
  docProposal: {
    count: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
    groupBy: vi.fn(),
  },

  // Doc Conversations
  docConversation: {
    count: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },

  // Stream Config
  streamConfig: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },

  // Changeset Batch
  changesetBatch: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },

  // Batch Proposal
  batchProposal: {
    createMany: vi.fn(),
  },

  // Proposal Failure
  proposalFailure: {
    create: vi.fn(),
  },

  // Import Watermarks
  importWatermark: {
    findMany: vi.fn(),
  },

  // Transactions
  $transaction: vi.fn((callback) => {
    // Execute callback with mock prisma
    return callback(mockPrismaClient);
  }),

  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  $queryRawUnsafe: vi.fn(),
};

export const createMockMessage = (overrides = {}) => ({
  id: 1,
  streamId: 'test-stream',
  messageId: 'msg-123',
  timestamp: new Date('2025-10-31T12:00:00Z'),
  author: 'test-user',
  content: 'Test message content about troubleshooting',
  channel: 'test-channel',
  rawData: {},
  metadata: null,
  embedding: null,
  processingStatus: 'PENDING',
  failureCount: 0,
  lastError: null,
  createdAt: new Date('2025-10-31T12:00:00Z'),
  ...overrides,
});

export const createMockClassification = (overrides = {}) => ({
  id: 1,
  messageId: 1,
  batchId: 'batch_test',
  category: 'troubleshooting',
  docValueReason: 'Contains valuable troubleshooting information',
  suggestedDocPage: 'docs/troubleshooting.md',
  ragSearchCriteria: {
    keywords: ['error', 'troubleshoot'],
    semanticQuery: 'troubleshooting errors',
  },
  modelUsed: 'gemini-2.5-flash',
  createdAt: new Date(),
  ...overrides,
});

export const createMockProposal = (overrides = {}) => ({
  id: 1,
  messageId: 1,
  page: 'docs/troubleshooting.md',
  updateType: 'UPDATE',
  section: 'Common Errors',
  location: { lineStart: 10, lineEnd: 20 },
  suggestedText: 'Updated troubleshooting content',
  reasoning: 'This information is missing from the docs',
  confidence: 0.85,
  sourceConversation: null,
  adminApproved: false,
  adminReviewedAt: null,
  adminReviewedBy: null,
  modelUsed: 'gemini-2.5-flash',
  createdAt: new Date(),
  ...overrides,
});

export const createMockWatermark = (overrides = {}) => ({
  id: Math.floor(Math.random() * 10000), // Auto-increment simulation
  streamId: 'test-stream', // Per-stream watermarks require streamId
  watermarkTime: new Date('2025-10-31T00:00:00Z'),
  lastProcessedBatch: new Date('2025-10-30T00:00:00Z'),
  updatedAt: new Date(),
  ...overrides,
});

// Helper to reset all mocks
export const resetPrismaMocks = () => {
  Object.values(mockPrismaClient).forEach((model: any) => {
    if (model && typeof model === 'object') {
      Object.values(model).forEach((method: any) => {
        if (typeof method?.mockReset === 'function') {
          method.mockReset();
        }
      });
    }
  });
};
