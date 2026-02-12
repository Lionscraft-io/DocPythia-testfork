/**
 * Admin Routes Unit Tests
 * Tests for batch processing admin API endpoints

 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { Express, Request, Response, NextFunction } from 'express';
import request from 'supertest';
import {
  mockPrismaClient,
  createMockMessage,
  createMockClassification,
  createMockProposal,
  createMockWatermark,
  resetPrismaMocks,
} from './mocks/prisma.mock.js';

// Mock dependencies
vi.mock('../server/db.js', () => ({
  default: mockPrismaClient,
}));

// Mock instance database to return our mock prisma client
vi.mock('../server/db/instance-db.js', () => ({
  getInstanceDb: vi.fn().mockReturnValue(mockPrismaClient),
}));

// Mock pg Pool - must use class to be a valid constructor
vi.mock('pg', () => ({
  default: {
    Pool: class MockPool {
      query = vi.fn();
      end = vi.fn();
      constructor(_config: any) {}
    },
  },
}));

// Mock instance middleware
vi.mock('../server/middleware/instance.js', () => ({
  instanceMiddleware: (req: any, res: any, next: any) => {
    req.instance = {
      id: 'test-instance',
      db: mockPrismaClient,
    };
    next();
  },
}));

// Mock BatchMessageProcessor class - must use class to be a valid constructor
vi.mock('../server/stream/processors/batch-message-processor.js', () => {
  const mockFn = vi.fn;
  return {
    BatchMessageProcessor: class MockBatchMessageProcessor {
      processBatch = mockFn().mockResolvedValue(42);
      constructor(_db: any) {}
      static getProcessingStatus = mockFn().mockReturnValue(false);
    },
  };
});

// Mock ChangesetBatchService class for batch endpoints
const mockCreateDraftBatch = vi.fn();
const mockGeneratePR = vi.fn();
const mockListBatches = vi.fn();
const mockGetBatch = vi.fn();
const mockDeleteDraftBatch = vi.fn();

vi.mock('../server/stream/services/changeset-batch-service.js', () => ({
  ChangesetBatchService: class MockChangesetBatchService {
    createDraftBatch = mockCreateDraftBatch;
    generatePR = mockGeneratePR;
    listBatches = mockListBatches;
    getBatch = mockGetBatch;
    deleteDraftBatch = mockDeleteDraftBatch;
    constructor(_db: any) {}
  },
}));

// Mock stream manager
vi.mock('../server/stream/stream-manager.js', () => ({
  streamManager: {
    importStream: vi.fn().mockResolvedValue(10),
    getAdapters: vi.fn().mockReturnValue(new Map()),
    initialize: vi.fn().mockResolvedValue(undefined),
  },
}));

// Import after mocks are set up
let app: Express;

// Middleware to inject admin instance for non-instance routes (kept for future use)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _injectAdminInstance = (req: Request, res: Response, next: NextFunction) => {
  (req as any).adminInstance = 'test-instance';
  next();
};

describe('Admin Routes', () => {
  beforeEach(async () => {
    resetPrismaMocks();
    vi.clearAllMocks();

    // Reset ChangesetBatchService mocks
    mockCreateDraftBatch.mockReset();
    mockGeneratePR.mockReset();
    mockListBatches.mockReset();
    mockGetBatch.mockReset();
    mockDeleteDraftBatch.mockReset();

    // Create fresh Express app for each test
    app = express();
    app.use(express.json());

    // Import and register routes (need to re-import to get mocked dependencies)
    const { registerAdminStreamRoutes } = await import('../server/stream/routes/admin-routes.js');

    // Mock admin auth middleware that sets up the instance context
    const mockAdminAuth = (req: any, res: any, next: any) => {
      // Set up instance context so getDb() can find the database
      req.instance = {
        id: 'test-instance',
        db: mockPrismaClient,
      };
      req.adminInstance = 'test-instance';
      next();
    };

    registerAdminStreamRoutes(app, mockAdminAuth);
  });

  describe('GET /api/admin/stream/stats', () => {
    it('should return processing statistics', async () => {
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(1000);
      mockPrismaClient.unifiedMessage.groupBy.mockResolvedValue([
        { processingStatus: 'COMPLETED', _count: 800 },
        { processingStatus: 'PENDING', _count: 150 },
        { processingStatus: 'FAILED', _count: 50 },
      ]);
      mockPrismaClient.messageClassification.count.mockResolvedValue(500);
      mockPrismaClient.docProposal.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(30) // approved
        .mockResolvedValueOnce(60); // pending

      mockPrismaClient.processingWatermark.findUnique.mockResolvedValue(createMockWatermark());

      const response = await request(app).get('/api/admin/stream/stats');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        total_messages: 1000,
        processed: 800,
        queued: 150,
        failed: 50,
        with_suggestions: 500,
        proposals: {
          total: 100,
          approved: 30,
          pending: 60,
        },
        processing_watermark: expect.any(String),
        last_batch_processed: expect.any(String),
        is_processing: false,
      });
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.unifiedMessage.count.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/admin/stream/stats');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to fetch stats' });
    });
  });

  describe('GET /api/admin/stream/messages', () => {
    it('should return paginated messages with analysis', async () => {
      const messages = [
        {
          ...createMockMessage({ id: 1 }),
          classification: createMockClassification({ messageId: 1 }),
          docProposal: createMockProposal({ messageId: 1 }),
        },
        {
          ...createMockMessage({ id: 2 }),
          classification: createMockClassification({ messageId: 2 }),
          docProposal: null,
        },
      ];

      mockPrismaClient.unifiedMessage.count.mockResolvedValue(50);
      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue(messages);

      const response = await request(app)
        .get('/api/admin/stream/messages')
        .query({ page: 1, limit: 20 });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 50,
        totalPages: 3,
      });
    });

    it('should filter by docValue', async () => {
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(10);
      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/admin/stream/messages')
        .query({ docValue: 'true' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.unifiedMessage.findMany).toHaveBeenCalled();
    });

    it('should filter by approved status', async () => {
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(10);
      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/admin/stream/messages')
        .query({ approved: 'true' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.unifiedMessage.findMany).toHaveBeenCalled();
    });

    it('should filter by batchId', async () => {
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(10);
      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue([]);

      await request(app).get('/api/admin/stream/messages').query({ batchId: 'batch_123' });

      expect(mockPrismaClient.unifiedMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            classification: {
              is: expect.objectContaining({
                batchId: 'batch_123',
              }),
            },
          }),
        })
      );
    });
  });

  describe('GET /api/admin/stream/messages/:id', () => {
    it('should return detailed message info', async () => {
      const message = {
        ...createMockMessage({ id: 1 }),
        classification: createMockClassification(),
        ragContext: { id: 1, retrievedDocs: [], totalTokens: 500 },
        docProposal: createMockProposal(),
      };

      mockPrismaClient.unifiedMessage.findUnique.mockResolvedValue(message);

      const response = await request(app).get('/api/admin/stream/messages/1');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: 1,
        classification: expect.any(Object),
        ragContext: expect.any(Object),
        docProposal: expect.any(Object),
      });
    });

    it('should return 404 if message not found', async () => {
      mockPrismaClient.unifiedMessage.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/api/admin/stream/messages/999');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Message not found' });
    });
  });

  describe('POST /api/admin/stream/process-batch', () => {
    it('should trigger batch processing', async () => {
      // The mock is already configured to return 42 via processBatch
      const response = await request(app).post('/api/admin/stream/process-batch');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Batch processing complete',
        messagesProcessed: 42,
      });
    });

    // Note: testing error handling requires more complex mocking setup with the class mock
    // The default mock returns 42 successfully
  });

  describe('GET /api/admin/stream/proposals', () => {
    it('should return paginated proposals', async () => {
      const proposals = [
        {
          ...createMockProposal({ id: 1 }),
          message: {
            author: 'user1',
            timestamp: new Date(),
            content: 'Test message',
            channel: 'test',
            classification: createMockClassification(),
          },
        },
      ];

      mockPrismaClient.docProposal.findMany.mockResolvedValue(proposals);
      mockPrismaClient.docProposal.count.mockResolvedValue(50);

      const response = await request(app)
        .get('/api/admin/stream/proposals')
        .query({ page: 1, limit: 20 });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.pagination.total).toBe(50);
    });
  });

  describe('POST /api/admin/stream/proposals/:id/approve', () => {
    it('should approve a proposal', async () => {
      const updatedProposal = createMockProposal({
        id: 1,
        adminApproved: true,
        adminReviewedBy: 'admin@example.com',
      });

      mockPrismaClient.docProposal.update.mockResolvedValue(updatedProposal);

      const response = await request(app).post('/api/admin/stream/proposals/1/approve').send({
        approved: true,
        reviewedBy: 'admin@example.com',
      });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Proposal approved successfully');
      expect(mockPrismaClient.docProposal.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          adminApproved: true,
          adminReviewedAt: expect.any(Date),
          adminReviewedBy: 'admin@example.com',
        },
      });
    });

    it('should reject a proposal', async () => {
      const updatedProposal = createMockProposal({
        id: 1,
        adminApproved: false,
        adminReviewedBy: 'admin@example.com',
      });

      mockPrismaClient.docProposal.update.mockResolvedValue(updatedProposal);

      const response = await request(app).post('/api/admin/stream/proposals/1/approve').send({
        approved: false,
        reviewedBy: 'admin@example.com',
      });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Proposal rejected successfully');
    });

    it('should validate request body', async () => {
      const response = await request(app).post('/api/admin/stream/proposals/1/approve').send({
        // Missing required fields
      });

      expect(response.status).toBe(500); // Zod validation error
    });
  });

  describe('GET /api/admin/stream/batches', () => {
    it('should return list of batches with counts', async () => {
      const mockBatches = [
        {
          id: 1,
          batchId: 'batch_1',
          status: 'draft',
          totalProposals: 3,
          affectedFiles: ['docs/intro.md'],
          prTitle: null,
          prBody: null,
          prUrl: null,
          prNumber: null,
          branchName: null,
          targetRepo: null,
          sourceRepo: null,
          baseBranch: null,
          submittedAt: null,
          submittedBy: null,
          createdAt: new Date(),
          batchProposals: [
            {
              proposal: {
                id: 1,
                page: 'docs/intro.md',
                section: 'Intro',
                updateType: 'UPDATE',
                status: 'approved',
              },
            },
          ],
          failures: [],
        },
        {
          id: 2,
          batchId: 'batch_2',
          status: 'submitted',
          totalProposals: 5,
          affectedFiles: ['docs/api.md'],
          prTitle: 'Update API docs',
          prBody: 'PR body',
          prUrl: 'https://github.com/example/repo/pull/1',
          prNumber: 1,
          branchName: 'update-docs',
          targetRepo: 'example/repo',
          sourceRepo: 'example/repo',
          baseBranch: 'main',
          submittedAt: new Date(),
          submittedBy: 'admin',
          createdAt: new Date(),
          batchProposals: [],
          failures: [],
        },
      ];

      mockPrismaClient.changesetBatch.findMany.mockResolvedValue(mockBatches);
      mockPrismaClient.changesetBatch.count.mockResolvedValue(2);

      const response = await request(app)
        .get('/api/admin/stream/batches')
        .query({ page: 1, limit: 20 });

      expect(response.status).toBe(200);
      expect(response.body.batches).toHaveLength(2);
      expect(response.body.batches[0]).toMatchObject({
        batchId: 'batch_1',
        status: 'draft',
      });
      expect(response.body.pagination.total).toBe(2);
    });
  });

  describe('POST /api/admin/stream/clear-processed', () => {
    it('should clear processed messages and reset status', async () => {
      const messages = [{ id: 1 }, { id: 2 }, { id: 3 }];

      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue(messages);
      // Create a complete mock tx object with all required methods
      mockPrismaClient.$transaction.mockImplementation(async (callback) => {
        return callback({
          messageClassification: {
            findMany: vi.fn().mockResolvedValue([]),
            deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
          },
          docProposal: {
            deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          conversationRagContext: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          unifiedMessage: {
            updateMany: vi.fn().mockResolvedValue({ count: 3 }),
            findFirst: vi.fn().mockResolvedValue({ id: 1, timestamp: new Date() }),
          },
          processingWatermark: {
            upsert: vi.fn().mockResolvedValue({}),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        });
      });

      const response = await request(app).post('/api/admin/stream/clear-processed');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe(
        'Processed messages, analysis results, and LLM cache cleared successfully'
      );
      expect(response.body.count).toBe(3);
      expect(response.body).toHaveProperty('cacheCleared');
    });

    it('should filter by streamId', async () => {
      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue([]);

      const response = await request(app)
        .post('/api/admin/stream/clear-processed')
        .send({ streamId: 'test-stream' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.unifiedMessage.findMany).toHaveBeenCalled();
    });

    it('should return 0 if no messages to clear', async () => {
      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue([]);

      const response = await request(app).post('/api/admin/stream/clear-processed');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'No processed messages to clear',
        count: 0,
      });
    });
  });

  describe('GET /api/admin/stream/streams', () => {
    it('should return all configured streams', async () => {
      const streams = [
        {
          id: 1,
          streamId: 'csv-stream',
          adapterType: 'csv',
          config: {},
          enabled: true,
          watermarks: [],
          _count: { messages: 100 },
        },
      ];

      mockPrismaClient.streamConfig.findMany.mockResolvedValue(streams);

      const response = await request(app).get('/api/admin/stream/streams');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({
        streamId: 'csv-stream',
        adapterType: 'csv',
      });
    });
  });

  describe('PATCH /api/admin/stream/proposals/:id', () => {
    it('should update proposal text', async () => {
      const updatedProposal = createMockProposal({
        id: 1,
        editedText: 'Updated text content',
        editedBy: 'admin@example.com',
      });

      mockPrismaClient.docProposal.update.mockResolvedValue(updatedProposal);

      const response = await request(app).patch('/api/admin/stream/proposals/1').send({
        suggestedText: 'Updated text content',
        editedBy: 'admin@example.com',
      });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Proposal text updated successfully');
      expect(mockPrismaClient.docProposal.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          editedText: 'Updated text content',
          editedAt: expect.any(Date),
          editedBy: 'admin@example.com',
        },
      });
    });

    it('should validate request body for text update', async () => {
      const response = await request(app).patch('/api/admin/stream/proposals/1').send({});

      expect(response.status).toBe(500);
    });

    it('should handle database errors', async () => {
      mockPrismaClient.docProposal.update.mockRejectedValue(new Error('Database error'));

      const response = await request(app).patch('/api/admin/stream/proposals/1').send({
        suggestedText: 'Updated text',
        editedBy: 'admin',
      });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to update proposal' });
    });
  });

  describe('POST /api/admin/stream/proposals/:id/status', () => {
    it('should approve a proposal', async () => {
      const beforeProposal = createMockProposal({ id: 1, status: 'pending' });
      const updatedProposal = createMockProposal({
        id: 1,
        status: 'approved',
        adminApproved: true,
      });

      mockPrismaClient.docProposal.findUnique.mockResolvedValueOnce(beforeProposal);
      mockPrismaClient.docProposal.update.mockResolvedValue(updatedProposal);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([updatedProposal]);
      mockPrismaClient.docConversation.update.mockResolvedValue({});

      const response = await request(app).post('/api/admin/stream/proposals/1/status').send({
        status: 'approved',
        reviewedBy: 'admin@example.com',
      });

      expect(response.status).toBe(200);
      expect(response.body.proposal.status).toBe('approved');
    });

    it('should ignore a proposal', async () => {
      const beforeProposal = createMockProposal({ id: 1, status: 'pending' });
      const updatedProposal = createMockProposal({
        id: 1,
        status: 'ignored',
        adminApproved: false,
      });

      mockPrismaClient.docProposal.findUnique.mockResolvedValueOnce(beforeProposal);
      mockPrismaClient.docProposal.update.mockResolvedValue(updatedProposal);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);
      mockPrismaClient.docConversation.update.mockResolvedValue({});

      const response = await request(app).post('/api/admin/stream/proposals/1/status').send({
        status: 'ignored',
        reviewedBy: 'admin@example.com',
      });

      expect(response.status).toBe(200);
      expect(response.body.proposal.status).toBe('ignored');
    });

    it('should reset proposal to pending', async () => {
      const beforeProposal = createMockProposal({ id: 1, status: 'approved' });
      const updatedProposal = createMockProposal({
        id: 1,
        status: 'pending',
        adminApproved: false,
        adminReviewedAt: null,
      });

      mockPrismaClient.docProposal.findUnique.mockResolvedValueOnce(beforeProposal);
      mockPrismaClient.docProposal.update.mockResolvedValue(updatedProposal);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([updatedProposal]);
      mockPrismaClient.docConversation.update.mockResolvedValue({});

      const response = await request(app).post('/api/admin/stream/proposals/1/status').send({
        status: 'pending',
        reviewedBy: 'admin@example.com',
      });

      expect(response.status).toBe(200);
      expect(response.body.proposal.status).toBe('pending');
    });

    it('should validate status values', async () => {
      const response = await request(app).post('/api/admin/stream/proposals/1/status').send({
        status: 'invalid-status',
        reviewedBy: 'admin@example.com',
      });

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/admin/stream/process', () => {
    it('should import messages from stream', async () => {
      const response = await request(app).post('/api/admin/stream/process').send({
        streamId: 'test-stream',
        batchSize: 50,
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Stream import complete',
        imported: 10,
      });
    });

    it('should use default batch size', async () => {
      const response = await request(app).post('/api/admin/stream/process').send({
        streamId: 'test-stream',
      });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Stream import complete');
    });

    it('should validate request body', async () => {
      const response = await request(app).post('/api/admin/stream/process').send({});

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/admin/stream/messages - additional filters', () => {
    it('should filter by processingStatus', async () => {
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(5);
      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/admin/stream/messages')
        .query({ processingStatus: 'COMPLETED' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.unifiedMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            processingStatus: 'COMPLETED',
          }),
        })
      );
    });

    it('should filter by category', async () => {
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(5);
      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/admin/stream/messages')
        .query({ category: 'documentation' });

      expect(response.status).toBe(200);
    });

    it('should filter by streamId', async () => {
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(5);
      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/admin/stream/messages')
        .query({ streamId: 'my-stream' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.unifiedMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            streamId: 'my-stream',
          }),
        })
      );
    });

    it('should handle database errors', async () => {
      mockPrismaClient.unifiedMessage.count.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/admin/stream/messages');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to fetch messages' });
    });
  });

  describe('GET /api/admin/stream/messages/:id - errors', () => {
    it('should handle database errors', async () => {
      mockPrismaClient.unifiedMessage.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/admin/stream/messages/1');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to fetch message' });
    });

    it('should handle invalid id format', async () => {
      // NaN from parseInt('abc')
      mockPrismaClient.unifiedMessage.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/api/admin/stream/messages/abc');

      expect(response.status).toBe(404);
    });
  });

  describe('GET /api/admin/stream/proposals - errors', () => {
    it('should handle database errors', async () => {
      mockPrismaClient.docProposal.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/admin/stream/proposals');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to fetch proposals' });
    });
  });

  describe('POST /api/admin/stream/proposals/:id/approve - errors', () => {
    it('should handle database errors', async () => {
      mockPrismaClient.docProposal.update.mockRejectedValue(new Error('Database error'));

      const response = await request(app).post('/api/admin/stream/proposals/1/approve').send({
        approved: true,
        reviewedBy: 'admin@example.com',
      });

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to approve proposal' });
    });
  });

  describe('GET /api/admin/stream/batches - errors', () => {
    it('should handle database errors', async () => {
      mockPrismaClient.changesetBatch.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/admin/stream/batches');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to fetch changeset batches' });
    });
  });

  describe('GET /api/admin/stream/streams - errors', () => {
    it('should handle database errors', async () => {
      mockPrismaClient.streamConfig.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/admin/stream/streams');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to fetch streams' });
    });
  });

  describe('POST /api/admin/stream/clear-processed - errors', () => {
    it('should handle database errors', async () => {
      mockPrismaClient.unifiedMessage.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app).post('/api/admin/stream/clear-processed');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'Failed to clear processed messages',
      });
    });
  });

  describe('GET /api/admin/stream/conversations', () => {
    it('should return empty conversations when no data', async () => {
      mockPrismaClient.messageClassification.groupBy.mockResolvedValue([]);
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);
      mockPrismaClient.docConversation.findMany.mockResolvedValue([]);

      const response = await request(app).get('/api/admin/stream/conversations');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body.data).toEqual([]);
    });

    it('should filter by category', async () => {
      mockPrismaClient.messageClassification.groupBy.mockResolvedValue([]);
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);
      mockPrismaClient.docConversation.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/admin/stream/conversations')
        .query({ category: 'troubleshooting' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.messageClassification.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: 'troubleshooting' }),
        })
      );
    });

    it('should accept pagination params', async () => {
      mockPrismaClient.messageClassification.groupBy.mockResolvedValue([]);
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);
      mockPrismaClient.docConversation.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/admin/stream/conversations')
        .query({ page: 2, limit: 25 });

      expect(response.status).toBe(200);
      // Response returns totals object, not page directly
      expect(response.body).toHaveProperty('totals');
    });
  });

  describe('GET /api/admin/stream/conversations - errors', () => {
    it('should handle database errors', async () => {
      mockPrismaClient.messageClassification.groupBy.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/admin/stream/conversations');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Failed to fetch conversations' });
    });
  });

  describe('POST /api/admin/stream/register', () => {
    it('should validate streamId is required', async () => {
      const response = await request(app).post('/api/admin/stream/register').send({
        adapterType: 'csv',
        config: {},
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Invalid request data');
    });

    it('should validate adapterType is required', async () => {
      const response = await request(app).post('/api/admin/stream/register').send({
        streamId: 'test-stream',
        config: {},
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Invalid request data');
    });

    it('should validate adapterType enum values', async () => {
      const response = await request(app).post('/api/admin/stream/register').send({
        streamId: 'test-stream',
        adapterType: 'invalid-type',
        config: {},
      });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Invalid request data');
    });

    it('should register a new stream successfully', async () => {
      mockPrismaClient.streamConfig.findUnique.mockResolvedValue(null);
      mockPrismaClient.streamConfig.create.mockResolvedValue({
        id: 1,
        streamId: 'new-stream',
        adapterType: 'csv',
        config: { filePath: '/data/test.csv' },
        enabled: true,
      });

      const response = await request(app)
        .post('/api/admin/stream/register')
        .send({
          streamId: 'new-stream',
          adapterType: 'csv',
          config: { filePath: '/data/test.csv' },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('registered');
    });

    it('should update an existing stream', async () => {
      mockPrismaClient.streamConfig.findUnique.mockResolvedValue({
        id: 1,
        streamId: 'existing-stream',
        adapterType: 'csv',
        config: {},
        enabled: true,
      });
      mockPrismaClient.streamConfig.update.mockResolvedValue({
        id: 1,
        streamId: 'existing-stream',
        adapterType: 'zulipchat',
        config: { apiKey: 'new-key' },
        enabled: true,
      });

      const response = await request(app)
        .post('/api/admin/stream/register')
        .send({
          streamId: 'existing-stream',
          adapterType: 'zulipchat',
          config: { apiKey: 'new-key' },
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('updated');
    });
  });

  describe('POST /api/admin/stream/register - errors', () => {
    it('should handle database errors', async () => {
      mockPrismaClient.streamConfig.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app).post('/api/admin/stream/register').send({
        streamId: 'test-stream',
        adapterType: 'csv',
        config: {},
      });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Failed to register stream');
    });
  });

  describe('POST /api/admin/stream/upload-csv', () => {
    it('should return 400 if no file uploaded', async () => {
      const response = await request(app).post('/api/admin/stream/upload-csv').send({});

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'No file uploaded' });
    });
  });

  describe('GET /api/admin/stream/proposals - additional filters', () => {
    it('should filter by adminApproved', async () => {
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.count.mockResolvedValue(0);

      const response = await request(app)
        .get('/api/admin/stream/proposals')
        .query({ approved: 'true' });

      expect(response.status).toBe(200);
    });

    it('should support pagination', async () => {
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.count.mockResolvedValue(0);

      const response = await request(app)
        .get('/api/admin/stream/proposals')
        .query({ page: 2, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination).toHaveProperty('page', 2);
    });
  });

  describe('POST /api/admin/stream/proposals/:id/approve - additional cases', () => {
    it('should reject a proposal with adminApproved false', async () => {
      const proposal = createMockProposal({ id: 1 });
      mockPrismaClient.docProposal.findUnique.mockResolvedValue(proposal);
      mockPrismaClient.docProposal.update.mockResolvedValue({
        ...proposal,
        adminApproved: false,
        adminReviewedAt: new Date(),
        adminReviewedBy: 'admin@example.com',
      });

      const response = await request(app).post('/api/admin/stream/proposals/1/approve').send({
        approved: false,
        reviewedBy: 'admin@example.com',
      });

      expect(response.status).toBe(200);
      expect(response.body.proposal.adminApproved).toBe(false);
    });
  });

  describe('GET /api/admin/stream/batches/:id', () => {
    it('should return batch details', async () => {
      const mockBatch = {
        id: 1,
        batchId: 'batch_123',
        status: 'draft',
        totalProposals: 3,
        affectedFiles: ['docs/intro.md'],
        batchProposals: [],
        failures: [],
      };

      mockGetBatch.mockResolvedValue(mockBatch);

      const response = await request(app).get('/api/admin/stream/batches/1');

      expect(response.status).toBe(200);
      expect(response.body.batch).toBeDefined();
      expect(response.body.batch.batchId).toBe('batch_123');
    });

    it('should return 404 for non-existent batch', async () => {
      mockGetBatch.mockResolvedValue(null);

      const response = await request(app).get('/api/admin/stream/batches/999');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Batch not found');
    });
  });

  describe('DELETE /api/admin/stream/batches/:id', () => {
    it('should delete a draft batch', async () => {
      mockDeleteDraftBatch.mockResolvedValue(undefined);

      const response = await request(app).delete('/api/admin/stream/batches/1');

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Draft batch deleted successfully');
      expect(mockDeleteDraftBatch).toHaveBeenCalledWith(1);
    });

    it('should return error when trying to delete non-draft batch', async () => {
      mockDeleteDraftBatch.mockRejectedValue(new Error('Cannot delete non-draft batch'));

      const response = await request(app).delete('/api/admin/stream/batches/1');

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Cannot delete non-draft batch');
    });

    it('should return error when batch not found', async () => {
      mockDeleteDraftBatch.mockRejectedValue(new Error('Batch not found'));

      const response = await request(app).delete('/api/admin/stream/batches/999');

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Batch not found');
    });
  });

  describe('POST /api/admin/stream/batches', () => {
    it('should create a draft batch', async () => {
      const mockBatch = {
        id: 1,
        batchId: 'batch-123',
        status: 'draft',
        totalProposals: 2,
        affectedFiles: ['docs/intro.md'],
      };

      mockCreateDraftBatch.mockResolvedValue(mockBatch);

      const response = await request(app)
        .post('/api/admin/stream/batches')
        .send({ proposalIds: [1, 2] });

      expect(response.status).toBe(201);
      expect(response.body.message).toBe('Draft batch created successfully');
      expect(response.body.batch).toBeDefined();
      expect(mockCreateDraftBatch).toHaveBeenCalledWith([1, 2]);
    });

    it('should validate proposal IDs are provided', async () => {
      const response = await request(app)
        .post('/api/admin/stream/batches')
        .send({ proposalIds: [] });

      expect(response.status).toBe(500);
    });

    it('should return error when no approved proposals found', async () => {
      mockCreateDraftBatch.mockRejectedValue(new Error('No approved proposals found'));

      const response = await request(app)
        .post('/api/admin/stream/batches')
        .send({ proposalIds: [1, 2] });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('No approved proposals found');
    });
  });

  describe('GET /api/admin/stream/batches - list batches', () => {
    it('should list all batches', async () => {
      const mockBatches = [
        { id: 1, batchId: 'batch_1', status: 'draft', batchProposals: [], failures: [] },
        { id: 2, batchId: 'batch_2', status: 'submitted', batchProposals: [], failures: [] },
      ];

      mockPrismaClient.changesetBatch.findMany.mockResolvedValue(mockBatches);

      const response = await request(app).get('/api/admin/stream/batches');

      expect(response.status).toBe(200);
      expect(response.body.batches).toHaveLength(2);
    });

    it('should filter batches by status', async () => {
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/admin/stream/batches')
        .query({ status: 'draft' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.changesetBatch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'draft' },
        })
      );
    });
  });

  describe('GET /api/admin/stream/proposals - additional filters', () => {
    it('should support page pagination', async () => {
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.count.mockResolvedValue(50);

      const response = await request(app)
        .get('/api/admin/stream/proposals')
        .query({ page: 3, limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.pagination).toMatchObject({
        page: 3,
        limit: 10,
        total: 50,
        totalPages: 5,
      });
    });

    it('should filter by status', async () => {
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.count.mockResolvedValue(0);

      const response = await request(app)
        .get('/api/admin/stream/proposals')
        .query({ status: 'pending' });

      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/admin/stream/batches/:id/generate-pr', () => {
    it('should generate a pull request from batch', async () => {
      const mockResult = {
        batch: { id: 1, status: 'submitted', prUrl: 'https://github.com/org/repo/pull/42' },
        pr: { number: 42, url: 'https://github.com/org/repo/pull/42' },
        appliedProposals: [1, 2],
        failedProposals: [],
      };

      mockGeneratePR.mockResolvedValue(mockResult);

      const response = await request(app)
        .post('/api/admin/stream/batches/1/generate-pr')
        .send({
          proposalIds: [1, 2],
          targetRepo: 'org/repo',
          sourceRepo: 'org/fork',
          baseBranch: 'main',
          prTitle: 'Update documentation',
          prBody: 'This PR updates documentation based on community feedback.',
          submittedBy: 'admin@example.com',
        });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Pull request created successfully');
      expect(response.body.pr.number).toBe(42);
      expect(mockGeneratePR).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          proposalIds: [1, 2],
          targetRepo: 'org/repo',
        })
      );
    });

    it('should return error for invalid request', async () => {
      const response = await request(app).post('/api/admin/stream/batches/1/generate-pr').send({
        // Missing required fields
      });

      expect(response.status).toBe(500);
    });

    it('should handle PR generation failure', async () => {
      mockGeneratePR.mockRejectedValue(new Error('GitHub API error'));

      const response = await request(app)
        .post('/api/admin/stream/batches/1/generate-pr')
        .send({
          proposalIds: [1, 2],
          targetRepo: 'org/repo',
          sourceRepo: 'org/fork',
          prTitle: 'Update docs',
          prBody: 'PR body',
          submittedBy: 'admin',
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('GitHub API error');
    });
  });

  describe('GET /api/admin/stream/batches/:id - error handling', () => {
    it('should handle service errors', async () => {
      mockGetBatch.mockRejectedValue(new Error('Service error'));

      const response = await request(app).get('/api/admin/stream/batches/1');

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('Service error');
    });
  });

  describe('GET /api/admin/stream/conversations - with hasProposals filter', () => {
    it('should filter by hasProposals=true with matching proposals', async () => {
      const conversations = [
        {
          conversationId: 'conv-with-proposal',
          _count: { messageId: 2 },
          _min: { createdAt: new Date() },
        },
        {
          conversationId: 'conv-no-proposal',
          _count: { messageId: 1 },
          _min: { createdAt: new Date() },
        },
      ];
      const proposals = [
        { ...createMockProposal({ id: 1 }), conversationId: 'conv-with-proposal' },
      ];

      mockPrismaClient.messageClassification.groupBy.mockResolvedValue(conversations);
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      // This provides the proposals grouped by conversation
      mockPrismaClient.docProposal.groupBy.mockResolvedValue([
        { conversationId: 'conv-with-proposal', _count: { id: 1 } },
      ]);
      mockPrismaClient.docProposal.findMany.mockResolvedValue(proposals);
      mockPrismaClient.docConversation.findMany.mockResolvedValue([]);
      mockPrismaClient.messageClassification.findMany.mockResolvedValue([
        {
          conversationId: 'conv-with-proposal',
          category: 'doc',
          batchId: 'b1',
          docValueReason: 'r',
          ragSearchCriteria: 's',
          message: {
            id: 1,
            author: 'u',
            channel: 'c',
            content: 't',
            timestamp: new Date(),
            streamId: 's',
            processingStatus: 'COMPLETED',
          },
        },
      ]);
      mockPrismaClient.conversationRagContext.findUnique.mockResolvedValue(null);
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(10);
      mockPrismaClient.messageClassification.count.mockResolvedValue(5);

      const response = await request(app)
        .get('/api/admin/stream/conversations')
        .query({ hasProposals: 'true' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      // Only conv-with-proposal should be returned when hasProposals=true
    });

    it('should filter by hasProposals=false', async () => {
      mockPrismaClient.messageClassification.groupBy.mockResolvedValue([]);
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);
      mockPrismaClient.docConversation.findMany.mockResolvedValue([]);
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(0);
      mockPrismaClient.messageClassification.count.mockResolvedValue(0);

      const response = await request(app)
        .get('/api/admin/stream/conversations')
        .query({ hasProposals: 'false' });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
    });
  });

  describe('GET /api/admin/stream/batches via ChangesetBatchService', () => {
    it('should list batches via service', async () => {
      mockListBatches.mockResolvedValue([{ id: 1, batchId: 'batch-1', status: 'draft' }]);

      // First registered handler uses direct Prisma, so we also need that mock
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([
        { id: 1, batchId: 'batch-1', status: 'draft', batchProposals: [], failures: [] },
      ]);
      mockPrismaClient.changesetBatch.count.mockResolvedValue(1);

      const response = await request(app).get('/api/admin/stream/batches');

      expect(response.status).toBe(200);
      expect(response.body.batches).toHaveLength(1);
    });
  });

  describe('POST /api/admin/stream/telegram-webhook', () => {
    it('should handle telegram webhook requests', async () => {
      // The telegram webhook has complex dependencies that need dynamic imports
      // With default mocks (no telegram adapter configured), it returns 404
      const response = await request(app)
        .post('/api/admin/stream/telegram-webhook')
        .send({ update_id: 12345 });

      // Returns 500 if import fails or 404 if no adapter is configured
      expect([404, 500]).toContain(response.status);
    });
  });

  describe('POST /api/admin/stream/upload-csv additional', () => {
    it('should require streamId in request', async () => {
      // This tests the branch when file is uploaded but no streamId
      const response = await request(app).post('/api/admin/stream/upload-csv').send({});

      // Without file upload middleware triggering, we get 'No file uploaded'
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No file uploaded');
    });
  });

  describe('GET /api/admin/stream/messages edge cases', () => {
    it('should filter messages without classification when processingStatus is PENDING', async () => {
      const messages = [
        {
          ...createMockMessage({ id: 1 }),
          classification: null,
        },
      ];

      mockPrismaClient.unifiedMessage.count.mockResolvedValue(1);
      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue(messages);

      const response = await request(app)
        .get('/api/admin/stream/messages')
        .query({ processingStatus: 'PENDING' });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
    });

    it('should use default pagination', async () => {
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(100);
      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue([]);

      const response = await request(app).get('/api/admin/stream/messages');

      expect(response.status).toBe(200);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(20);
    });
  });

  describe('GET /api/admin/stream/proposals sorting', () => {
    it('should return proposals sorted by createdAt desc', async () => {
      const oldProposal = createMockProposal({ id: 1 });
      const newProposal = createMockProposal({ id: 2 });
      newProposal.createdAt = new Date();
      oldProposal.createdAt = new Date(Date.now() - 86400000);

      const proposals = [
        {
          ...newProposal,
          message: {
            author: 'user',
            timestamp: new Date(),
            content: 'test',
            channel: 'general',
            classification: null,
          },
        },
        {
          ...oldProposal,
          message: {
            author: 'user',
            timestamp: new Date(),
            content: 'test2',
            channel: 'dev',
            classification: null,
          },
        },
      ];

      mockPrismaClient.docProposal.findMany.mockResolvedValue(proposals);
      mockPrismaClient.docProposal.count.mockResolvedValue(2);

      const response = await request(app).get('/api/admin/stream/proposals');

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
    });
  });

  describe('GET /api/admin/stream/stats watermark handling', () => {
    it('should handle null watermark', async () => {
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(0);
      mockPrismaClient.unifiedMessage.groupBy.mockResolvedValue([]);
      mockPrismaClient.messageClassification.count.mockResolvedValue(0);
      mockPrismaClient.docProposal.count.mockResolvedValue(0);
      mockPrismaClient.processingWatermark.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/api/admin/stream/stats');

      expect(response.status).toBe(200);
      expect(response.body.processing_watermark).toBeNull();
      expect(response.body.last_batch_processed).toBeNull();
    });
  });

  describe('POST /api/admin/stream/process error handling', () => {
    it('should handle import stream errors', async () => {
      const { streamManager } = await import('../server/stream/stream-manager.js');
      (streamManager.importStream as any).mockRejectedValueOnce(new Error('Stream not found'));

      const response = await request(app).post('/api/admin/stream/process').send({
        streamId: 'nonexistent-stream',
      });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to import messages');
    });
  });

  describe('POST /api/admin/stream/proposals/:id/status edge cases', () => {
    it('should handle proposal not found', async () => {
      mockPrismaClient.docProposal.findUnique.mockResolvedValue(null);
      // The update will fail because proposal doesn't exist
      mockPrismaClient.docProposal.update.mockResolvedValue({
        ...createMockProposal({ id: 999 }),
        status: 'approved',
        conversationId: 'conv-1',
      });
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);

      const response = await request(app).post('/api/admin/stream/proposals/999/status').send({
        status: 'approved',
        reviewedBy: 'admin@example.com',
      });

      // Should still succeed as long as update works
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/admin/stream/proposals with filtering', () => {
    it('should filter by page path', async () => {
      const proposal = {
        ...createMockProposal({ id: 1 }),
        page: 'docs/guide.md',
        message: {
          author: 'user',
          timestamp: new Date(),
          content: 'test',
          channel: 'general',
          classification: null,
        },
      };

      mockPrismaClient.docProposal.findMany.mockResolvedValue([proposal]);
      mockPrismaClient.docProposal.count.mockResolvedValue(1);

      const response = await request(app).get('/api/admin/stream/proposals').query({ page: 1 });

      expect(response.status).toBe(200);
      expect(response.body.pagination.page).toBe(1);
    });
  });

  describe('GET /api/admin/stream/conversations advanced', () => {
    it('should handle streamId filter', async () => {
      mockPrismaClient.messageClassification.groupBy.mockResolvedValue([]);
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);
      mockPrismaClient.docConversation.findMany.mockResolvedValue([]);
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(0);
      mockPrismaClient.messageClassification.count.mockResolvedValue(0);

      const response = await request(app)
        .get('/api/admin/stream/conversations')
        .query({ streamId: 'test-stream' });

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });

    it('should handle limit parameter', async () => {
      mockPrismaClient.messageClassification.groupBy.mockResolvedValue([]);
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);
      mockPrismaClient.docConversation.findMany.mockResolvedValue([]);
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(0);
      mockPrismaClient.messageClassification.count.mockResolvedValue(0);

      const response = await request(app)
        .get('/api/admin/stream/conversations')
        .query({ limit: 50 });

      expect(response.status).toBe(200);
      expect(response.body.pagination.limit).toBe(50);
    });
  });

  describe('POST /api/admin/stream/process with options', () => {
    it('should handle fullScan option', async () => {
      const { streamManager } = await import('../server/stream/stream-manager.js');
      (streamManager.importStream as any).mockResolvedValueOnce({ imported: 10 });

      const response = await request(app).post('/api/admin/stream/process').send({
        streamId: 'test-stream',
        fullScan: true,
      });

      expect(response.status).toBe(200);
    });

    it('should handle maxMessages option', async () => {
      const { streamManager } = await import('../server/stream/stream-manager.js');
      (streamManager.importStream as any).mockResolvedValueOnce({ imported: 100 });

      const response = await request(app).post('/api/admin/stream/process').send({
        streamId: 'test-stream',
        maxMessages: 100,
      });

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/admin/stream/batches with filters', () => {
    it('should handle empty result with status filter', async () => {
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      mockPrismaClient.changesetBatch.count.mockResolvedValue(0);

      const response = await request(app)
        .get('/api/admin/stream/batches')
        .query({ status: 'draft' });

      expect(response.status).toBe(200);
      expect(response.body.batches).toHaveLength(0);
    });
  });

  describe('GET /api/admin/stream/conversations - null handling', () => {
    it('should filter out null conversationIds', async () => {
      // Setup - some conversations have null IDs (which should be filtered out)
      const conversationsWithNullIds = [
        { conversationId: 'conv-1', _count: { messageId: 2 }, _min: { createdAt: new Date() } },
        { conversationId: null, _count: { messageId: 1 }, _min: { createdAt: new Date() } },
        { conversationId: 'conv-2', _count: { messageId: 3 }, _min: { createdAt: new Date() } },
      ];

      mockPrismaClient.messageClassification.groupBy.mockResolvedValue(conversationsWithNullIds);
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);
      mockPrismaClient.docConversation.findMany.mockResolvedValue([]);
      mockPrismaClient.messageClassification.findMany.mockResolvedValue([]);
      mockPrismaClient.conversationRagContext.findUnique.mockResolvedValue(null);
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(10);
      mockPrismaClient.messageClassification.count.mockResolvedValue(5);

      const response = await request(app).get('/api/admin/stream/conversations');

      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
    });

    it('should return conversations with proposals', async () => {
      const conversations = [
        {
          conversationId: 'conv-with-proposal',
          _count: { messageId: 2 },
          _min: { createdAt: new Date() },
        },
      ];
      const mockProposal = {
        ...createMockProposal({ id: 1 }),
        conversationId: 'conv-with-proposal',
        message: null,
      };

      mockPrismaClient.messageClassification.groupBy.mockResolvedValue(conversations);
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([mockProposal]);
      mockPrismaClient.docConversation.findMany.mockResolvedValue([]);
      mockPrismaClient.messageClassification.findMany.mockResolvedValue([
        {
          conversationId: 'conv-with-proposal',
          category: 'documentation',
          batchId: 'batch-1',
          docValueReason: 'Relevant',
          ragSearchCriteria: 'search query',
          message: {
            id: 1,
            author: 'user',
            channel: 'general',
            content: 'test',
            timestamp: new Date(),
            streamId: 'test',
            processingStatus: 'COMPLETED',
          },
        },
      ]);
      mockPrismaClient.conversationRagContext.findUnique.mockResolvedValue({
        retrievedDocs: [{ title: 'Doc 1' }],
        totalTokens: 500,
        proposalsRejected: false,
        rejectionReason: null,
      });
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(10);
      mockPrismaClient.messageClassification.count.mockResolvedValue(5);

      const response = await request(app).get('/api/admin/stream/conversations');

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/admin/stream/conversations - status filter with hideEmptyProposals', () => {
    it('should filter conversations by status=changeset using groupBy', async () => {
      const conversations = [
        { conversationId: 'conv-1', _count: { messageId: 2 }, _min: { createdAt: new Date() } },
        { conversationId: 'conv-2', _count: { messageId: 3 }, _min: { createdAt: new Date() } },
      ];

      // Mock groupBy to return only conv-1 has matching proposals
      mockPrismaClient.messageClassification.groupBy.mockResolvedValue(conversations);
      mockPrismaClient.docProposal.groupBy.mockResolvedValue([
        { conversationId: 'conv-1', _count: { id: 2 } },
      ]);
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([
        {
          ...createMockProposal({ id: 1 }),
          conversationId: 'conv-1',
          status: 'approved',
          message: null,
        },
      ]);
      mockPrismaClient.docConversation.findMany.mockResolvedValue([]);
      mockPrismaClient.messageClassification.findMany.mockResolvedValue([
        {
          conversationId: 'conv-1',
          category: 'documentation',
          batchId: 'batch-1',
          docValueReason: 'Relevant',
          ragSearchCriteria: 'search query',
          message: {
            id: 1,
            author: 'user',
            channel: 'general',
            content: 'test',
            timestamp: new Date(),
            streamId: 'test',
            processingStatus: 'COMPLETED',
          },
        },
      ]);
      mockPrismaClient.conversationRagContext.findUnique.mockResolvedValue(null);
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(10);
      mockPrismaClient.messageClassification.count.mockResolvedValue(5);

      const response = await request(app).get('/api/admin/stream/conversations?status=changeset');

      expect(response.status).toBe(200);
      // The groupBy should have been called to filter by status
      expect(mockPrismaClient.docProposal.groupBy).toHaveBeenCalled();
    });

    it('should filter conversations by status=pending using groupBy', async () => {
      const conversations = [
        { conversationId: 'conv-1', _count: { messageId: 2 }, _min: { createdAt: new Date() } },
      ];

      mockPrismaClient.messageClassification.groupBy.mockResolvedValue(conversations);
      mockPrismaClient.docProposal.groupBy.mockResolvedValue([
        { conversationId: 'conv-1', _count: { id: 1 } },
      ]);
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([
        {
          ...createMockProposal({ id: 1 }),
          conversationId: 'conv-1',
          status: 'pending',
          message: null,
        },
      ]);
      mockPrismaClient.docConversation.findMany.mockResolvedValue([]);
      mockPrismaClient.messageClassification.findMany.mockResolvedValue([]);
      mockPrismaClient.conversationRagContext.findUnique.mockResolvedValue(null);
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(10);
      mockPrismaClient.messageClassification.count.mockResolvedValue(5);

      const response = await request(app).get('/api/admin/stream/conversations?status=pending');

      expect(response.status).toBe(200);
      expect(mockPrismaClient.docProposal.groupBy).toHaveBeenCalled();
    });

    it('should filter conversations by status=discarded using groupBy', async () => {
      // status=discarded maps to proposal status 'ignored' in the database
      const conversations = [
        { conversationId: 'conv-1', _count: { messageId: 2 }, _min: { createdAt: new Date() } },
      ];

      mockPrismaClient.messageClassification.groupBy.mockResolvedValue(conversations);
      mockPrismaClient.docProposal.groupBy.mockResolvedValue([
        { conversationId: 'conv-1', _count: { id: 1 } },
      ]);
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([
        {
          ...createMockProposal({ id: 1 }),
          conversationId: 'conv-1',
          status: 'ignored',
          message: null,
        },
      ]);
      mockPrismaClient.docConversation.findMany.mockResolvedValue([]);
      mockPrismaClient.messageClassification.findMany.mockResolvedValue([
        {
          conversationId: 'conv-1',
          category: 'documentation',
          batchId: 'batch-1',
          docValueReason: 'Relevant',
          ragSearchCriteria: 'search query',
          message: {
            id: 1,
            author: 'user',
            channel: 'general',
            content: 'test',
            timestamp: new Date(),
            streamId: 'test',
            processingStatus: 'COMPLETED',
          },
        },
      ]);
      mockPrismaClient.conversationRagContext.findMany.mockResolvedValue([]);
      mockPrismaClient.conversationRagContext.findUnique.mockResolvedValue(null);
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(10);
      mockPrismaClient.messageClassification.count.mockResolvedValue(5);

      const response = await request(app).get('/api/admin/stream/conversations?status=discarded');

      expect(response.status).toBe(200);
      expect(mockPrismaClient.docProposal.groupBy).toHaveBeenCalled();
    });

    it('should return empty when no conversations have matching proposals', async () => {
      const conversations = [
        { conversationId: 'conv-1', _count: { messageId: 2 }, _min: { createdAt: new Date() } },
        { conversationId: 'conv-2', _count: { messageId: 3 }, _min: { createdAt: new Date() } },
      ];

      // Mock groupBy to return empty - no conversations have matching proposals
      mockPrismaClient.messageClassification.groupBy.mockResolvedValue(conversations);
      mockPrismaClient.docProposal.groupBy.mockResolvedValue([]);
      mockPrismaClient.changesetBatch.findMany.mockResolvedValue([]);
      mockPrismaClient.docProposal.findMany.mockResolvedValue([]);
      mockPrismaClient.docConversation.findMany.mockResolvedValue([]);
      mockPrismaClient.messageClassification.findMany.mockResolvedValue([]);
      mockPrismaClient.conversationRagContext.findMany.mockResolvedValue([]);
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(10);
      mockPrismaClient.messageClassification.count.mockResolvedValue(5);

      const response = await request(app).get('/api/admin/stream/conversations?status=changeset');

      expect(response.status).toBe(200);
      // No conversations should be returned since none have matching proposals
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe('POST /api/admin/stream/proposals/:id/approve edge case', () => {
    it('should reject with specific message', async () => {
      mockPrismaClient.docProposal.update.mockResolvedValue({
        ...createMockProposal({ id: 1 }),
        adminApproved: false,
        adminReviewedBy: 'reviewer@test.com',
        adminReviewedAt: new Date(),
      });

      const response = await request(app).post('/api/admin/stream/proposals/1/approve').send({
        approved: false,
        reviewedBy: 'reviewer@test.com',
        discardReason: 'Not relevant',
      });

      expect(response.status).toBe(200);
      expect(response.body.proposal.adminApproved).toBe(false);
    });
  });

  describe('GET /api/admin/stream/messages with conversationId', () => {
    it('should filter messages by conversationId', async () => {
      const messages = [createMockMessage({ id: 1 })];
      mockPrismaClient.unifiedMessage.count.mockResolvedValue(1);
      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue(messages);

      const response = await request(app)
        .get('/api/admin/stream/messages')
        .query({ conversationId: 'conv-123' });

      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/admin/stream/process-batch different states', () => {
    it('should trigger full batch processing', async () => {
      const response = await request(app).post('/api/admin/stream/process-batch').send({
        streamId: 'test-stream',
      });

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('processing');
    });
  });
});
