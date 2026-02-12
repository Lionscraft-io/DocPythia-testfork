/**
 * Multi-Stream Scanner Admin Routes
 * API endpoints for admin dashboard and batch processing management

 * Date: 2025-10-31
 * Updated for batch processing architecture (Phase 1)
 * Reference: /docs/specs/multi-stream-scanner-phase-1.md
 */

import type { Express, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { BatchMessageProcessor } from '../processors/batch-message-processor.js';
import { instanceMiddleware } from '../../middleware/instance.js';
import { getInstanceDb } from '../../db/instance-db.js';
import { createLogger } from '../../utils/logger.js';
import multer from 'multer';
import * as fs from 'fs/promises';
import * as path from 'path';
import { llmCache } from '../../llm/llm-cache.js';
import { postProcessProposal } from '../../pipeline/utils/ProposalPostProcessor.js';

const logger = createLogger('AdminStreamRoutes');

// Helper to get instance ID from request
function getInstanceId(req: Request): string {
  // First try: Instance middleware (for routes with /:instance prefix)
  if (req.instance?.id) {
    return req.instance.id;
  }

  // Second try: Admin auth middleware (for routes without /:instance prefix)
  const adminInstance = (req as any).adminInstance;
  if (adminInstance) {
    return adminInstance;
  }

  throw new Error('No instance ID available. Instance middleware may not be applied.');
}

// Helper to get instance-aware database client from request
function getDb(req: Request): PrismaClient {
  // First try: Instance middleware (for routes with /:instance prefix)
  if (req.instance?.db) {
    return req.instance.db;
  }

  // Second try: Admin auth middleware (for routes without /:instance prefix)
  // The multiInstanceAdminAuth middleware stores the instance ID from the auth token
  const adminInstance = (req as any).adminInstance;
  if (adminInstance) {
    return getInstanceDb(adminInstance);
  }

  // Fallback error
  throw new Error('No instance database available. Instance middleware may not be applied.');
}

// Validation schemas
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const filterSchema = z.object({
  docValue: z.enum(['true', 'false', 'all']).optional(),
  approved: z.enum(['true', 'false', 'all']).optional(),
  streamId: z.string().optional(),
  category: z.string().optional(),
  batchId: z.string().optional(),
  processingStatus: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'all']).optional(),
});

const processRequestSchema = z.object({
  streamId: z.string(),
  batchSize: z.number().int().min(1).max(500).optional(),
});

// Schema for approving proposals (reserved for future use)
// const approveProposalSchema = z.object({
//   proposalId: z.number().int(),
//   approved: z.boolean(),
//   reviewedBy: z.string(),
// });

/**
 * Register multi-stream scanner admin routes
 */
export function registerAdminStreamRoutes(app: Express, adminAuth: any) {
  /**
   * GET /api/admin/stream/stats
   * Get processing statistics
   *
   * Registered twice:
   * 1. /api/admin/stream/stats (non-instance)
   * 2. /:instance/api/admin/stream/stats (instance-specific)
   */
  const statsHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      // Get total messages
      const totalMessages = await db.unifiedMessage.count();

      // Get messages by processing status
      const statusCounts = await db.unifiedMessage.groupBy({
        by: ['processingStatus'],
        _count: true,
      });

      const processed = statusCounts.find((s) => s.processingStatus === 'COMPLETED')?._count || 0;
      const queued = statusCounts.find((s) => s.processingStatus === 'PENDING')?._count || 0;
      const failed = statusCounts.find((s) => s.processingStatus === 'FAILED')?._count || 0;

      // Get messages with doc value
      const withDocValue = await db.messageClassification.count();

      // Get proposals (total and by approval status)
      const totalProposals = await db.docProposal.count();
      const approvedProposals = await db.docProposal.count({
        where: { adminApproved: true },
      });
      const pendingProposals = await db.docProposal.count({
        where: { adminApproved: false, adminReviewedAt: null },
      });

      // Get processing watermark info
      const watermark = await db.processingWatermark.findUnique({
        where: { id: 1 },
      });

      res.json({
        total_messages: totalMessages,
        processed,
        queued,
        failed,
        with_suggestions: withDocValue,
        proposals: {
          total: totalProposals,
          approved: approvedProposals,
          pending: pendingProposals,
        },
        processing_watermark: watermark?.watermarkTime || null,
        last_batch_processed: watermark?.lastProcessedBatch || null,
        is_processing: BatchMessageProcessor.getProcessingStatus(),
      });
    } catch (error) {
      logger.error('Error fetching stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  };

  // Register both non-instance and instance-specific versions
  app.get('/api/admin/stream/stats', adminAuth, statsHandler);
  app.get('/:instance/api/admin/stream/stats', instanceMiddleware, adminAuth, statsHandler);

  /**
   * GET /api/admin/stream/messages
   * List all messages with analysis results
   */
  app.get('/api/admin/stream/messages', adminAuth, async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const { page, limit } = paginationSchema.parse(req.query);
      const filters = filterSchema.parse(req.query);

      const offset = (page - 1) * limit;

      // Build Prisma where clause
      const where: any = {};

      // If processingStatus filter is provided, use it
      if (filters.processingStatus && filters.processingStatus !== 'all') {
        where.processingStatus = filters.processingStatus;
      }

      // Handle classification-based filters (category, batchId)
      const needsClassification = filters.category || filters.batchId;

      if (needsClassification || filters.processingStatus !== 'PENDING') {
        where.classification = {
          is: {}, // Only show messages with classification
        };

        if (filters.category) {
          where.classification.is.category = filters.category;
        }

        if (filters.batchId) {
          where.classification.is.batchId = filters.batchId;
        }
      }

      // Note: docProposal filtering removed - proposals are now conversation-based, not message-based
      // To filter by proposals, query the doc_proposals table by conversation_id instead

      if (filters.streamId) {
        where.streamId = filters.streamId;
      }

      // Get total count
      const total = await db.unifiedMessage.count({ where });

      // Get paginated results with full data
      const messages = await db.unifiedMessage.findMany({
        where,
        include: {
          classification: true,
          // docProposal removed - proposals are conversation-based now
        },
        orderBy: {
          timestamp: 'desc',
        },
        skip: offset,
        take: limit,
      });

      // Transform to match expected format
      const data = messages.map((msg) => ({
        id: msg.id,
        stream_id: msg.streamId,
        author: msg.author,
        channel: msg.channel,
        content: msg.content,
        timestamp: msg.timestamp,
        created_at: msg.timestamp,
        processing_status: msg.processingStatus,
        category: msg.classification?.category || null,
        doc_value_reason: msg.classification?.docValueReason || null,
        suggested_doc_page: msg.classification?.suggestedDocPage || null,
        batch_id: msg.classification?.batchId || null,
        conversation_id: msg.classification?.conversationId || null,
        // Note: proposal info removed - proposals are conversation-based, not message-based
        page: null,
        update_type: null,
        section: null,
        suggested_text: null,
        confidence: null,
        admin_approved: false,
        admin_reviewed_at: null,
        admin_reviewed_by: null,
      }));

      res.json({
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('Error fetching messages:', error);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  /**
   * GET /api/admin/stream/messages/:id
   * Get detailed information about a single message
   */
  app.get('/api/admin/stream/messages/:id', adminAuth, async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const messageId = parseInt(req.params.id);

      const message = await db.unifiedMessage.findUnique({
        where: { id: messageId },
        include: {
          classification: true,
        },
      });

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      res.json(message);
    } catch (error) {
      logger.error('Error fetching message:', error);
      res.status(500).json({ error: 'Failed to fetch message' });
    }
  });

  /**
   * POST /api/admin/stream/process
   * Manually trigger stream import (fetch messages without processing)
   * Registered twice:
   * 1. /api/admin/stream/process (non-instance)
   * 2. /:instance/api/admin/stream/process (instance-specific)
   */
  const processHandler = async (req: Request, res: Response) => {
    try {
      const { streamId, batchSize } = processRequestSchema.parse(req.body);

      // Import streamManager here to avoid circular dependency
      const { streamManager } = await import('../stream-manager.js');

      // Fetch messages without processing them
      const imported = await streamManager.importStream(streamId, batchSize);

      res.json({
        message: 'Stream import complete',
        imported,
      });
    } catch (error) {
      logger.error('Error importing messages:', error);
      res.status(500).json({ error: 'Failed to import messages' });
    }
  };

  // Register both non-instance and instance-specific versions
  app.post('/api/admin/stream/process', adminAuth, processHandler);
  app.post('/:instance/api/admin/stream/process', instanceMiddleware, adminAuth, processHandler);

  /**
   * POST /api/admin/stream/process-batch
   * Process the next 24-hour batch of messages
   * Registered twice:
   * 1. /api/admin/stream/process-batch (non-instance)
   * 2. /:instance/api/admin/stream/process-batch (instance-specific)
   */
  const processBatchHandler = async (req: Request, res: Response) => {
    try {
      const instanceId = getInstanceId(req);
      const db = getDb(req);

      logger.info(`[${instanceId}] Starting batch processing...`);

      // Create instance-specific batch processor
      const processor = new BatchMessageProcessor(instanceId, db);
      const messagesProcessed = await processor.processBatch();

      res.json({
        message: 'Batch processing complete',
        messagesProcessed,
      });
    } catch (error) {
      logger.error('Error processing batch:', error);
      res.status(500).json({ error: 'Failed to process batch' });
    }
  };

  // Register both non-instance and instance-specific versions
  app.post('/api/admin/stream/process-batch', adminAuth, processBatchHandler);
  app.post(
    '/:instance/api/admin/stream/process-batch',
    instanceMiddleware,
    adminAuth,
    processBatchHandler
  );

  /**
   * GET /api/admin/stream/proposals
   * List documentation update proposals
   *
   * Registered twice:
   * 1. /api/admin/stream/proposals (non-instance)
   * 2. /:instance/api/admin/stream/proposals (instance-specific)
   */
  const proposalsListHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const { page, limit } = paginationSchema.parse(req.query);
      const offset = (page - 1) * limit;

      const proposals = await db.docProposal.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        skip: offset,
        take: limit,
      });

      const total = await db.docProposal.count();

      res.json({
        data: proposals,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('Error fetching proposals:', error);
      res.status(500).json({ error: 'Failed to fetch proposals' });
    }
  };
  app.get('/api/admin/stream/proposals', adminAuth, proposalsListHandler);
  app.get(
    '/:instance/api/admin/stream/proposals',
    instanceMiddleware,
    adminAuth,
    proposalsListHandler
  );

  /**
   * POST /api/admin/stream/proposals/:id/approve
   * Approve or reject a documentation proposal
   */
  const proposalApproveHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const proposalId = parseInt(req.params.id);
      const { approved, reviewedBy } = z
        .object({
          approved: z.boolean(),
          reviewedBy: z.string(),
        })
        .parse(req.body);

      const updated = await db.docProposal.update({
        where: { id: proposalId },
        data: {
          adminApproved: approved,
          adminReviewedAt: new Date(),
          adminReviewedBy: reviewedBy,
        },
      });

      res.json({
        message: `Proposal ${approved ? 'approved' : 'rejected'} successfully`,
        proposal: updated,
      });
    } catch (error) {
      logger.error('Error approving proposal:', error);
      res.status(500).json({ error: 'Failed to approve proposal' });
    }
  };
  app.post('/api/admin/stream/proposals/:id/approve', adminAuth, proposalApproveHandler);
  app.post(
    '/:instance/api/admin/stream/proposals/:id/approve',
    instanceMiddleware,
    adminAuth,
    proposalApproveHandler
  );

  /**
   * PATCH /api/admin/stream/proposals/:id
   * Update proposal text
   */
  const proposalUpdateHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const proposalId = parseInt(req.params.id);
      const { suggestedText, editedBy } = z
        .object({
          suggestedText: z.string().max(10000),
          editedBy: z.string(),
        })
        .parse(req.body);

      const updated = await db.docProposal.update({
        where: { id: proposalId },
        data: {
          editedText: suggestedText,
          editedAt: new Date(),
          editedBy: editedBy,
        },
      });

      res.json({
        message: 'Proposal text updated successfully',
        proposal: updated,
      });
    } catch (error) {
      logger.error('Error updating proposal:', error);
      res.status(500).json({ error: 'Failed to update proposal' });
    }
  };
  app.patch('/api/admin/stream/proposals/:id', adminAuth, proposalUpdateHandler);
  app.patch(
    '/:instance/api/admin/stream/proposals/:id',
    instanceMiddleware,
    adminAuth,
    proposalUpdateHandler
  );

  /**
   * POST /api/admin/stream/proposals/:id/status
   * Change proposal status (approve/ignore/reset)
   */
  const proposalStatusHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const proposalId = parseInt(req.params.id);
      logger.debug('Raw request body:', JSON.stringify(req.body));

      const { status, reviewedBy } = z
        .object({
          status: z.enum(['approved', 'ignored', 'pending']),
          reviewedBy: z.string(),
        })
        .parse(req.body);

      // Get current status before update
      const beforeUpdate = await db.docProposal.findUnique({
        where: { id: proposalId },
        select: { status: true, conversationId: true },
      });
      logger.debug(
        `Proposal ${proposalId} - Current status: ${beforeUpdate?.status}, Requested status: ${status}`
      );

      const updateData = {
        status: status,
        adminApproved: status === 'approved',
        adminReviewedAt: status !== 'pending' ? new Date() : null,
        adminReviewedBy: status !== 'pending' ? reviewedBy : null,
        discardReason: status === 'ignored' ? 'Admin discarded change' : null,
      };

      // Update the proposal
      const updated = await db.docProposal.update({
        where: { id: proposalId },
        data: updateData,
      });

      logger.debug(`Proposal ${proposalId} - Database returned status: ${updated.status}`);

      // Calculate conversation status
      const allProposals = await db.docProposal.findMany({
        where: { conversationId: updated.conversationId },
        select: { status: true },
      });

      const hasPending = allProposals.some((p) => p.status === 'pending');
      let conversationStatus: 'pending' | 'changeset' | 'discarded';

      if (hasPending) {
        conversationStatus = 'pending';
      } else {
        const hasApproved = allProposals.some((p) => p.status === 'approved');
        conversationStatus = hasApproved ? 'changeset' : 'discarded';
      }

      res.json({
        message: `Proposal status changed to ${status} successfully`,
        proposal: updated,
        conversationStatus,
      });
    } catch (error) {
      logger.error('Error changing proposal status:', error);
      res.status(500).json({ error: 'Failed to change proposal status' });
    }
  };
  app.post('/api/admin/stream/proposals/:id/status', adminAuth, proposalStatusHandler);
  app.post(
    '/:instance/api/admin/stream/proposals/:id/status',
    instanceMiddleware,
    adminAuth,
    proposalStatusHandler
  );

  /**
   * GET /api/admin/stream/batches
   * List changeset batches (PR batches)
   * Query params: status (draft|submitted|merged|closed), page, limit
   *
   * Registered twice:
   * 1. /api/admin/stream/batches (non-instance)
   * 2. /:instance/api/admin/stream/batches (instance-specific)
   */
  const batchesHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const { page, limit } = paginationSchema.parse(req.query);
      const status = req.query.status as string | undefined;
      const offset = (page - 1) * limit;

      // Build where clause
      const where: any = {};
      if (status) {
        where.status = status;
      }

      // Get changeset batches with related data
      const batches = await db.changesetBatch.findMany({
        where,
        include: {
          batchProposals: {
            include: {
              proposal: {
                select: {
                  id: true,
                  page: true,
                  section: true,
                  updateType: true,
                  status: true,
                },
              },
            },
          },
          failures: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: offset,
        take: limit,
      });

      const total = await db.changesetBatch.count({ where });

      res.json({
        batches: batches.map((batch) => ({
          id: batch.id,
          batchId: batch.batchId,
          status: batch.status,
          totalProposals: batch.totalProposals,
          affectedFiles: batch.affectedFiles,
          prTitle: batch.prTitle,
          prBody: batch.prBody,
          prUrl: batch.prUrl,
          prNumber: batch.prNumber,
          branchName: batch.branchName,
          targetRepo: batch.targetRepo,
          sourceRepo: batch.sourceRepo,
          baseBranch: batch.baseBranch,
          submittedAt: batch.submittedAt,
          submittedBy: batch.submittedBy,
          createdAt: batch.createdAt,
          proposals: batch.batchProposals.map((bp) => bp.proposal),
          failureCount: batch.failures.length,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('Error fetching changeset batches:', error);
      res.status(500).json({ error: 'Failed to fetch changeset batches' });
    }
  };

  // Register both non-instance and instance-specific versions
  app.get('/api/admin/stream/batches', adminAuth, batchesHandler);
  app.get('/:instance/api/admin/stream/batches', instanceMiddleware, adminAuth, batchesHandler);

  /**
   * GET /api/admin/stream/streams
   * List all configured streams
   * Registered twice:
   * 1. /api/admin/stream/streams (non-instance)
   * 2. /:instance/api/admin/stream/streams (instance-specific)
   */
  const streamsHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const streams = await db.streamConfig.findMany({
        include: {
          watermarks: true,
          _count: {
            select: {
              messages: true,
            },
          },
        },
      });

      res.json(streams);
    } catch (error) {
      logger.error('Error fetching streams:', error);
      res.status(500).json({ error: 'Failed to fetch streams' });
    }
  };

  // Register both non-instance and instance-specific versions
  app.get('/api/admin/stream/streams', adminAuth, streamsHandler);
  app.get('/:instance/api/admin/stream/streams', instanceMiddleware, adminAuth, streamsHandler);

  /**
   * POST /api/admin/stream/register
   * Register a new stream or update existing stream configuration
   */
  app.post('/api/admin/stream/register', adminAuth, async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const schema = z.object({
        streamId: z.string().min(1),
        adapterType: z.enum(['telegram-bot', 'csv', 'zulipchat']),
        config: z.record(z.any()),
        enabled: z.boolean().optional().default(true),
      });

      const data = schema.parse(req.body);

      // Check if stream already exists
      const existing = await db.streamConfig.findUnique({
        where: { streamId: data.streamId },
      });

      let stream;
      if (existing) {
        // Update existing stream
        stream = await db.streamConfig.update({
          where: { streamId: data.streamId },
          data: {
            adapterType: data.adapterType,
            config: data.config as any,
            enabled: data.enabled,
          },
        });
        logger.info(`Updated stream config for ${data.streamId}`);
      } else {
        // Create new stream
        stream = await db.streamConfig.create({
          data: {
            streamId: data.streamId,
            adapterType: data.adapterType,
            config: data.config as any,
            enabled: data.enabled,
          },
        });
        logger.info(`Created stream config for ${data.streamId}`);
      }

      // Import and reinitialize stream manager to pick up new config
      const { streamManager } = await import('../stream-manager.js');
      await streamManager.initialize();

      res.json({
        success: true,
        message: existing ? 'Stream updated successfully' : 'Stream registered successfully',
        stream,
      });
    } catch (error: any) {
      logger.error('Error registering stream:', error);
      if (error.name === 'ZodError') {
        res.status(400).json({ error: 'Invalid request data', details: error.errors });
      } else {
        res.status(500).json({ error: 'Failed to register stream', details: error.message });
      }
    }
  });

  /**
   * POST /api/admin/stream/upload-csv
   * Upload a CSV file to the stream inbox for processing
   */
  const upload = multer({ dest: '/tmp/uploads/' });
  app.post(
    '/api/admin/stream/upload-csv',
    adminAuth,
    upload.single('file'),
    async (req: Request, res: Response) => {
      try {
        const db = getDb(req);
        const instanceId = getInstanceId(req);

        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }

        // Get streamId from request
        const streamId = req.body.streamId;
        if (!streamId) {
          // Clean up uploaded file
          await fs.unlink(req.file.path);
          return res.status(400).json({ error: 'streamId is required' });
        }

        // Get stream config
        const streamConfig = await db.streamConfig.findUnique({
          where: { streamId },
        });

        if (!streamConfig) {
          await fs.unlink(req.file.path);
          return res.status(404).json({ error: `Stream ${streamId} not found` });
        }

        if (streamConfig.adapterType !== 'csv') {
          await fs.unlink(req.file.path);
          return res.status(400).json({ error: `Stream ${streamId} is not a CSV stream` });
        }

        // Get inbox directory from config
        const config = streamConfig.config as any;
        const inboxDir = config.inboxDir;

        if (!inboxDir) {
          await fs.unlink(req.file.path);
          return res.status(500).json({ error: 'Stream config missing inboxDir' });
        }

        // Ensure inbox directory exists
        await fs.mkdir(inboxDir, { recursive: true });

        // Move file to inbox with original filename
        const originalFilename = req.file.originalname;
        const targetPath = path.join(inboxDir, originalFilename);

        await fs.rename(req.file.path, targetPath);

        logger.info(`[${instanceId}] CSV file uploaded: ${targetPath}`);

        // Auto-process the CSV file immediately (App Runner /tmp is ephemeral)
        logger.info(`[${instanceId}] Auto-processing CSV file: ${streamId}`);

        try {
          const { streamManager } = await import('../stream-manager.js');
          const imported = await streamManager.importStream(streamId);

          res.json({
            success: true,
            message: 'CSV file uploaded and processed successfully',
            filename: originalFilename,
            path: targetPath,
            streamId,
            imported,
          });
        } catch (processError: any) {
          logger.error(`[${instanceId}] Error processing CSV:`, processError);
          // File uploaded but processing failed - return partial success
          res.json({
            success: true,
            message: 'CSV file uploaded but processing failed',
            filename: originalFilename,
            path: targetPath,
            streamId,
            error: processError.message,
          });
        }
      } catch (error: any) {
        logger.error('Error uploading CSV:', error);
        // Clean up uploaded file on error
        if (req.file?.path) {
          try {
            await fs.unlink(req.file.path);
          } catch {
            // Ignore cleanup errors - file may already be removed
          }
        }
        res.status(500).json({ error: 'Failed to upload CSV file', details: error.message });
      }
    }
  );

  /**
   * POST /api/admin/stream/clear-processed
   * Reset processed messages back to PENDING status and delete all analysis results for re-testing
   *
   * Registered twice:
   * 1. /api/admin/stream/clear-processed (non-instance)
   * 2. /:instance/api/admin/stream/clear-processed (instance-specific)
   */
  const clearProcessedHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const bodyValidation = z
        .object({
          streamId: z.string().optional(),
        })
        .safeParse(req.body);

      const streamId = bodyValidation.success ? bodyValidation.data.streamId : undefined;

      // Get all COMPLETED messages (includes both classified and orphaned messages)
      const messagesToClear = await db.unifiedMessage.findMany({
        where: {
          ...(streamId ? { streamId } : {}),
          processingStatus: 'COMPLETED',
        },
        select: { id: true },
      });

      const messageIds = messagesToClear.map((m) => m.id);
      logger.info(`Found ${messageIds.length} messages to clear`);

      if (messageIds.length === 0) {
        return res.json({
          message: 'No processed messages to clear',
          count: 0,
        });
      }

      // Delete all related records in a transaction
      await db.$transaction(async (tx) => {
        // Get all conversation IDs associated with these messages
        const conversationIds = await tx.messageClassification.findMany({
          where: {
            messageId: { in: messageIds },
            conversationId: { not: null },
          },
          select: { conversationId: true },
          distinct: ['conversationId'],
        });
        const conversationIdList = conversationIds
          .map((c) => c.conversationId)
          .filter((id): id is string => id !== null);

        logger.debug(`Found ${conversationIdList.length} unique conversations`);

        // Delete proposals by conversationId
        const proposalsDeleted = await tx.docProposal.deleteMany({
          where: {
            conversationId: { in: conversationIdList },
          },
        });
        logger.debug(`Deleted ${proposalsDeleted.count} proposals`);

        // Delete conversation RAG context for known conversations
        const ragDeleted = await tx.conversationRagContext.deleteMany({
          where: {
            conversationId: { in: conversationIdList },
          },
        });
        logger.debug(`Deleted ${ragDeleted.count} conversation RAG contexts`);

        // Also delete any orphaned RAG contexts (from failed processing attempts)
        // These won't be in conversationIdList if the messages are still PENDING
        const orphanedRagDeleted = await tx.conversationRagContext.deleteMany({
          where: streamId
            ? {
                // For stream-scoped clears, delete RAG contexts where conversation ID contains the stream prefix
                conversationId: { contains: streamId.split('-').slice(2).join('-') || streamId },
              }
            : {}, // For full clears, delete all RAG contexts
        });
        if (orphanedRagDeleted.count > 0) {
          logger.debug(`Deleted ${orphanedRagDeleted.count} orphaned RAG contexts`);
        }

        // Delete classifications
        const classificationsDeleted = await tx.messageClassification.deleteMany({
          where: {
            messageId: { in: messageIds },
          },
        });
        logger.debug(`Deleted ${classificationsDeleted.count} classifications`);

        // Reset messages back to PENDING
        const messagesUpdated = await tx.unifiedMessage.updateMany({
          where: { id: { in: messageIds } },
          data: {
            processingStatus: 'PENDING',
            failureCount: 0,
            lastError: null,
          },
        });
        logger.debug(`Reset ${messagesUpdated.count} messages to PENDING`);

        // Reset processing watermark to allow reprocessing from the beginning
        // Find the earliest message timestamp
        const earliestMessage = await tx.unifiedMessage.findFirst({
          where: streamId ? { streamId } : {},
          orderBy: { timestamp: 'asc' },
          select: { timestamp: true },
        });

        // Set watermark to before the earliest message (or a very early date if no messages)
        const resetWatermark = earliestMessage
          ? new Date(earliestMessage.timestamp.getTime() - 1000) // 1 second before earliest message
          : new Date('2000-01-01T00:00:00Z'); // Very early date if no messages

        await tx.processingWatermark.updateMany({
          data: {
            watermarkTime: resetWatermark,
            lastProcessedBatch: null,
          },
        });
        logger.debug(`Reset processing watermark to ${resetWatermark.toISOString()}`);
      });

      // Clear LLM cache to force fresh processing
      const cacheCleared = await llmCache.clearAllAsync();
      logger.info(`Cleared ${cacheCleared} LLM cache entries`);

      res.json({
        message: 'Processed messages, analysis results, and LLM cache cleared successfully',
        count: messageIds.length,
        cacheCleared,
      });
    } catch (error) {
      logger.error('Error clearing processed messages:', error);
      res.status(500).json({ error: 'Failed to clear processed messages' });
    }
  };

  // Register for both non-instance and instance-specific routes
  app.post('/api/admin/stream/clear-processed', adminAuth, clearProcessedHandler);
  app.post(
    '/:instance/api/admin/stream/clear-processed',
    instanceMiddleware,
    adminAuth,
    clearProcessedHandler
  );

  /**
   * POST /api/admin/stream/reprocess-proposals
   * Re-run all proposals through the post-processing pipeline
   * Uses rawSuggestedText as input and updates suggestedText with new output
   *
   * Registered twice:
   * 1. /api/admin/stream/reprocess-proposals (non-instance)
   * 2. /:instance/api/admin/stream/reprocess-proposals (instance-specific)
   */
  const reprocessProposalsHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      // Get all proposals that have rawSuggestedText
      const proposals = await db.docProposal.findMany({
        where: {
          rawSuggestedText: { not: null },
        },
        select: {
          id: true,
          page: true,
          rawSuggestedText: true,
          suggestedText: true,
        },
      });

      if (proposals.length === 0) {
        return res.json({
          message: 'No proposals with raw text found to reprocess',
          processed: 0,
          modified: 0,
        });
      }

      logger.info(`Reprocessing ${proposals.length} proposals through post-processor pipeline`);

      let modified = 0;
      const errors: Array<{ id: number; error: string }> = [];

      // Process each proposal
      for (const proposal of proposals) {
        try {
          if (!proposal.rawSuggestedText) continue;

          // Run through post-processing pipeline
          const result = postProcessProposal(proposal.rawSuggestedText, proposal.page);

          // Only update if the result is different from current suggestedText
          if (result.text !== proposal.suggestedText) {
            await db.docProposal.update({
              where: { id: proposal.id },
              data: { suggestedText: result.text },
            });
            modified++;
            logger.debug(`Proposal ${proposal.id} updated with new post-processed text`);
          }
        } catch (error: any) {
          logger.error(`Error reprocessing proposal ${proposal.id}:`, error);
          errors.push({ id: proposal.id, error: error.message });
        }
      }

      logger.info(
        `Reprocessing complete: ${proposals.length} proposals checked, ${modified} modified, ${errors.length} errors`
      );

      res.json({
        message: 'Proposals reprocessed through post-processor pipeline',
        processed: proposals.length,
        modified,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      logger.error('Error reprocessing proposals:', error);
      res.status(500).json({ error: 'Failed to reprocess proposals' });
    }
  };

  // Register for both non-instance and instance-specific routes
  app.post('/api/admin/stream/reprocess-proposals', adminAuth, reprocessProposalsHandler);
  app.post(
    '/:instance/api/admin/stream/reprocess-proposals',
    instanceMiddleware,
    adminAuth,
    reprocessProposalsHandler
  );

  /**
   * GET /api/admin/stream/conversations
   * List conversations with messages, RAG context, and proposals
   * Conversation-centric view for admin dashboard
   * Query params: page, limit, category, hasProposals, status (pending|changeset|discarded)
   *
   * Registered twice:
   * 1. /api/admin/stream/conversations (non-instance)
   * 2. /:instance/api/admin/stream/conversations (instance-specific)
   */
  const conversationsHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const { page, limit } = paginationSchema.parse(req.query);
      const category = req.query.category as string | undefined;
      const hasProposals = req.query.hasProposals === 'true';
      const statusFilter = req.query.status as 'pending' | 'changeset' | 'discarded' | undefined;
      const hideEmptyProposals = req.query.hideEmptyProposals !== 'false'; // Default to true
      const search = req.query.search as string | undefined;
      const offset = (page - 1) * limit;

      logger.debug(
        `Query params - category: ${category}, hasProposals: ${req.query.hasProposals}, status: ${statusFilter}, hideEmptyProposals: ${hideEmptyProposals}, search: ${search || 'none'}`
      );

      // Build where clause for filtering
      const where: any = {
        conversationId: { not: null }, // Exclude no-doc-value messages (conversationId = null)
      };
      if (category && category !== 'all') {
        where.category = category;
      }

      // Search: find matching conversationIds from proposals and messages
      if (search && search.trim()) {
        const searchTerm = search.trim();

        // Find proposals matching search text
        const matchingProposals = await db.docProposal.findMany({
          where: {
            OR: [
              { suggestedText: { contains: searchTerm, mode: 'insensitive' } },
              { reasoning: { contains: searchTerm, mode: 'insensitive' } },
              { page: { contains: searchTerm, mode: 'insensitive' } },
            ],
          },
          select: { conversationId: true },
          distinct: ['conversationId'],
        });

        // Find messages matching search text
        const matchingMessages = await db.messageClassification.findMany({
          where: {
            message: {
              content: { contains: searchTerm, mode: 'insensitive' },
            },
          },
          select: { conversationId: true },
          distinct: ['conversationId'],
        });

        const matchedIds = new Set([
          ...matchingProposals.map((p) => p.conversationId),
          ...matchingMessages
            .map((m) => m.conversationId)
            .filter((id): id is string => id !== null),
        ]);

        // Short-circuit if no matches
        if (matchedIds.size === 0) {
          return res.json({
            data: [],
            totals: {
              total_messages: await db.unifiedMessage.count(),
              total_processed: 0,
              total_messages_in_conversations: 0,
            },
            pagination: { page, limit, total: 0, totalPages: 0 },
          });
        }

        where.conversationId = {
          not: null,
          in: Array.from(matchedIds),
        };
      }

      // Get all unique conversation IDs with message counts
      let allConversations = await db.messageClassification.groupBy({
        by: ['conversationId'],
        where,
        _count: {
          messageId: true,
        },
        _min: {
          createdAt: true,
        },
        orderBy: {
          _min: {
            createdAt: 'desc',
          },
        },
      });

      // Filter by status if needed
      if (statusFilter) {
        // Get IDs of proposals that are already in submitted batches
        const submittedBatchIds = await db.changesetBatch.findMany({
          where: { status: 'submitted' },
          select: { id: true },
        });
        const submittedBatchIdSet = new Set(submittedBatchIds.map((b) => b.id));

        // Get all proposals with their batch info
        const allProposalsWithBatch = await db.docProposal.findMany({
          select: {
            conversationId: true,
            status: true,
            prBatchId: true,
          },
        });

        // Build a map of conversationId -> proposal statuses
        // Exclude proposals that are already in submitted batches
        const conversationStatusMap = new Map<string, Set<string>>();
        for (const proposal of allProposalsWithBatch) {
          // Skip proposals that are in submitted batches
          if (proposal.prBatchId && submittedBatchIdSet.has(proposal.prBatchId)) {
            continue;
          }

          if (!conversationStatusMap.has(proposal.conversationId)) {
            conversationStatusMap.set(proposal.conversationId, new Set());
          }
          conversationStatusMap.get(proposal.conversationId)!.add(proposal.status);
        }

        // Calculate status for each conversation
        // Note: Conversations can appear in multiple tabs if they have mixed statuses
        const conversationsByStatus = {
          pending: new Set<string>(),
          changeset: new Set<string>(),
          discarded: new Set<string>(),
        };

        for (const [conversationId, statuses] of conversationStatusMap.entries()) {
          // Pending: has any pending proposals
          if (statuses.has('pending')) {
            conversationsByStatus.pending.add(conversationId);
          }

          // Changeset: has any approved proposals (not yet submitted)
          if (statuses.has('approved')) {
            conversationsByStatus.changeset.add(conversationId);
          }

          // Discarded: has any ignored proposals
          if (statuses.has('ignored')) {
            conversationsByStatus.discarded.add(conversationId);
          }
        }

        // For discarded filter, also include conversations with proposalsRejected=true but no proposals
        if (statusFilter === 'discarded') {
          const autoRejectedConversations = await db.conversationRagContext.findMany({
            where: {
              proposalsRejected: true,
            },
            select: {
              conversationId: true,
            },
          });

          for (const conv of autoRejectedConversations) {
            conversationsByStatus.discarded.add(conv.conversationId);
          }

          logger.debug(
            `Added ${autoRejectedConversations.length} auto-rejected conversations to discarded`
          );
        }

        logger.debug(
          `Status filter: ${statusFilter}, found ${conversationsByStatus[statusFilter].size} conversations`
        );
        allConversations = allConversations.filter(
          (c) => c.conversationId && conversationsByStatus[statusFilter].has(c.conversationId)
        );
      } else if (req.query.hasProposals !== undefined) {
        // Legacy filter - kept for backward compatibility
        const conversationsWithProposals = await db.docProposal.findMany({
          select: { conversationId: true },
          distinct: ['conversationId'],
        });
        const idsWithProposals = new Set(conversationsWithProposals.map((p) => p.conversationId));

        if (hasProposals) {
          allConversations = allConversations.filter(
            (c) => c.conversationId && idsWithProposals.has(c.conversationId)
          );
        } else {
          allConversations = allConversations.filter(
            (c) => c.conversationId && !idsWithProposals.has(c.conversationId)
          );
        }
      }

      // If hideEmptyProposals is true and we have a status filter,
      // we need to filter out conversations with no matching proposals before pagination
      let conversationsToFetch = allConversations;

      if (hideEmptyProposals && statusFilter) {
        // Get proposal counts for each conversation that match the status filter
        const proposalCountsByConv = await db.docProposal.groupBy({
          by: ['conversationId'],
          where: {
            conversationId: {
              in: allConversations
                .map((c) => c.conversationId)
                .filter((id): id is string => id !== null),
            },
            status:
              statusFilter === 'changeset'
                ? 'approved'
                : statusFilter === 'pending'
                  ? 'pending'
                  : 'ignored',
            OR: [
              { prBatchId: null },
              {
                prBatch: {
                  status: { not: 'submitted' },
                },
              },
            ],
          },
          _count: {
            id: true,
          },
        });

        const convsWithMatchingProposals = new Set(
          proposalCountsByConv.map((p) => p.conversationId)
        );
        conversationsToFetch = allConversations.filter(
          (c) => c.conversationId && convsWithMatchingProposals.has(c.conversationId)
        );
      }

      const total = conversationsToFetch.length;
      const conversations = conversationsToFetch.slice(offset, offset + limit);

      // For each conversation, fetch detailed data
      const conversationData = await Promise.all(
        conversations.map(async (conv) => {
          if (!conv.conversationId) return null;

          // Get all messages in this conversation (ordered by timestamp)
          const messages = await db.messageClassification.findMany({
            where: { conversationId: conv.conversationId },
            include: {
              message: {
                select: {
                  id: true,
                  author: true,
                  channel: true,
                  content: true,
                  timestamp: true,
                  streamId: true,
                  processingStatus: true,
                },
              },
            },
            orderBy: {
              message: {
                timestamp: 'asc',
              },
            },
          });

          // Count processed messages (COMPLETED status)
          const processedCount = messages.filter(
            (m) => m.message.processingStatus === 'COMPLETED'
          ).length;

          // Get conversation-level category (from first message)
          const category = messages[0]?.category || 'unknown';
          const batchId = messages[0]?.batchId || null;

          // Get RAG context for this conversation
          const ragContext = await db.conversationRagContext.findUnique({
            where: { conversationId: conv.conversationId },
          });

          // Get all proposals for this conversation (excluding those in submitted batches)
          const proposals = await db.docProposal.findMany({
            where: {
              conversationId: conv.conversationId,
              OR: [
                { prBatchId: null }, // Not in any batch
                {
                  prBatch: {
                    status: { not: 'submitted' }, // Or in a non-submitted batch
                  },
                },
              ],
            },
            include: {
              prBatch: {
                select: {
                  id: true,
                  status: true,
                  prNumber: true,
                  prUrl: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          });

          return {
            conversation_id: conv.conversationId,
            category,
            batch_id: batchId,
            message_count: conv._count.messageId,
            processed_count: processedCount,
            created_at: conv._min.createdAt,
            messages: messages.map((m) => ({
              id: m.message.id,
              author: m.message.author,
              channel: m.message.channel,
              content: m.message.content,
              timestamp: m.message.timestamp,
              stream_id: m.message.streamId,
              category: m.category,
              doc_value_reason: m.docValueReason,
              rag_search_criteria: m.ragSearchCriteria,
            })),
            rag_context: ragContext
              ? {
                  retrieved_docs: ragContext.retrievedDocs,
                  total_tokens: ragContext.totalTokens,
                  proposals_rejected: ragContext.proposalsRejected,
                  rejection_reason: ragContext.rejectionReason,
                }
              : null,
            proposals: proposals.map((p) => ({
              id: p.id,
              page: p.page,
              update_type: p.updateType,
              section: p.section,
              location: p.location,
              suggested_text: p.suggestedText,
              reasoning: p.reasoning,
              source_messages: p.sourceMessages,
              status: p.status,
              edited_text: p.editedText,
              edited_at: p.editedAt,
              edited_by: p.editedBy,
              admin_approved: p.adminApproved,
              admin_reviewed_at: p.adminReviewedAt,
              admin_reviewed_by: p.adminReviewedBy,
              discard_reason: p.discardReason,
              model_used: p.modelUsed,
              created_at: p.createdAt,
            })),
          };
        })
      );

      // Filter out null values
      const validConversations = conversationData.filter((c) => c !== null);

      // Calculate total message counts across ALL messages in system, not just conversations
      const totalMessagesInSystem = await db.unifiedMessage.count();
      const totalProcessedMessages = validConversations.reduce(
        (sum, conv) => sum + (conv?.processed_count || 0),
        0
      );

      // Get total message count across FILTERED conversations (not all conversations)
      // Extract all conversation IDs from the filtered list
      const filteredConversationIds = allConversations
        .map((c) => c.conversationId)
        .filter((id): id is string => id !== null);

      const totalMessagesInConversations = await db.messageClassification.count({
        where: {
          conversationId: { in: filteredConversationIds },
        },
      });

      res.json({
        data: validConversations,
        totals: {
          total_messages: totalMessagesInSystem,
          total_processed: totalProcessedMessages,
          total_messages_in_conversations: totalMessagesInConversations,
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error('Error fetching conversations:', error);
      res.status(500).json({ error: 'Failed to fetch conversations' });
    }
  };

  // Register both non-instance and instance-specific versions
  app.get('/api/admin/stream/conversations', adminAuth, conversationsHandler);
  app.get(
    '/:instance/api/admin/stream/conversations',
    instanceMiddleware,
    adminAuth,
    conversationsHandler
  );

  /**
   * POST /api/admin/stream/telegram-webhook
   * Telegram bot webhook endpoint
   * Only used when adapter is in webhook mode
   */
  app.post('/api/admin/stream/telegram-webhook', async (req: Request, res: Response) => {
    try {
      // Import streamManager here to avoid circular dependency
      const { streamManager } = await import('../stream-manager.js');
      const { TelegramBotAdapter } = await import('../adapters/telegram-bot-adapter.js');

      // Find active Telegram bot adapter
      const adapters = Array.from(streamManager.getAdapters().values());
      const telegramAdapter = adapters.find(
        (adapter) => adapter instanceof TelegramBotAdapter
      ) as any;

      if (!telegramAdapter) {
        return res.status(404).json({ error: 'Telegram bot not configured' });
      }

      // Process update through Telegraf
      const bot = telegramAdapter.getBotInstance();
      await bot.handleUpdate(req.body);

      res.status(200).json({ ok: true });
    } catch (error) {
      logger.error('Telegram webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ========== PR Generation Routes (Phase 2) ==========

  /**
   * POST /api/admin/stream/batches
   * Create a draft changeset batch from approved proposals
   *
   * Registered twice:
   * 1. /api/admin/stream/batches (non-instance)
   * 2. /:instance/api/admin/stream/batches (instance-specific)
   */
  const createBatchHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const { proposalIds } = z
        .object({
          proposalIds: z.array(z.number().int()).min(1),
        })
        .parse(req.body);

      const { ChangesetBatchService } = await import('../services/changeset-batch-service.js');
      const batchService = new ChangesetBatchService(db);

      const batch = await batchService.createDraftBatch(proposalIds);

      res.status(201).json({
        message: 'Draft batch created successfully',
        batch,
      });
    } catch (error: any) {
      logger.error('Error creating draft batch:', error);
      res.status(500).json({ error: error.message || 'Failed to create draft batch' });
    }
  };

  // Register both non-instance and instance-specific versions
  app.post('/api/admin/stream/batches', adminAuth, createBatchHandler);
  app.post(
    '/:instance/api/admin/stream/batches',
    instanceMiddleware,
    adminAuth,
    createBatchHandler
  );

  /**
   * POST /api/admin/stream/batches/:id/generate-pr
   * Generate a pull request from a draft batch
   *
   * Registered twice:
   * 1. /api/admin/stream/batches/:id/generate-pr (non-instance)
   * 2. /:instance/api/admin/stream/batches/:id/generate-pr (instance-specific)
   */
  const generatePRHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const batchId = parseInt(req.params.id);
      const options = z
        .object({
          proposalIds: z.array(z.number().int()),
          targetRepo: z.string(),
          sourceRepo: z.string(),
          baseBranch: z.string().optional(),
          prTitle: z.string(),
          prBody: z.string(),
          submittedBy: z.string(),
        })
        .parse(req.body);

      const { ChangesetBatchService } = await import('../services/changeset-batch-service.js');
      const batchService = new ChangesetBatchService(db);

      const result = await batchService.generatePR(batchId, options);

      res.status(200).json({
        message: 'Pull request created successfully',
        batch: result.batch,
        pr: result.pr,
        appliedProposals: result.appliedProposals,
        failedProposals: result.failedProposals,
      });
    } catch (error: any) {
      logger.error('Error generating PR:', error);
      res.status(500).json({ error: error.message || 'Failed to generate pull request' });
    }
  };

  // Register both non-instance and instance-specific versions
  app.post('/api/admin/stream/batches/:id/generate-pr', adminAuth, generatePRHandler);
  app.post(
    '/:instance/api/admin/stream/batches/:id/generate-pr',
    instanceMiddleware,
    adminAuth,
    generatePRHandler
  );

  // Note: GET /api/admin/stream/batches is handled by batchesHandler at line 613

  /**
   * GET /api/admin/stream/batches/:id
   * Get detailed information about a specific batch
   *
   * Registered twice:
   * 1. /api/admin/stream/batches/:id (non-instance)
   * 2. /:instance/api/admin/stream/batches/:id (instance-specific)
   */
  const getBatchHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const batchId = parseInt(req.params.id);

      const { ChangesetBatchService } = await import('../services/changeset-batch-service.js');
      const batchService = new ChangesetBatchService(db);

      const batch = await batchService.getBatch(batchId);

      if (!batch) {
        return res.status(404).json({ error: 'Batch not found' });
      }

      res.json({ batch });
    } catch (error: any) {
      logger.error('Error fetching batch:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch batch' });
    }
  };

  // Register both non-instance and instance-specific versions
  app.get('/api/admin/stream/batches/:id', adminAuth, getBatchHandler);
  app.get(
    '/:instance/api/admin/stream/batches/:id',
    instanceMiddleware,
    adminAuth,
    getBatchHandler
  );

  /**
   * DELETE /api/admin/stream/batches/:id
   * Delete a draft batch (only allowed for draft status)
   *
   * Registered twice:
   * 1. /api/admin/stream/batches/:id (non-instance)
   * 2. /:instance/api/admin/stream/batches/:id (instance-specific)
   */
  const deleteBatchHandler = async (req: Request, res: Response) => {
    try {
      const db = getDb(req);

      const batchId = parseInt(req.params.id);

      const { ChangesetBatchService } = await import('../services/changeset-batch-service.js');
      const batchService = new ChangesetBatchService(db);

      await batchService.deleteDraftBatch(batchId);

      res.json({ message: 'Draft batch deleted successfully' });
    } catch (error: any) {
      logger.error('Error deleting batch:', error);
      res.status(500).json({ error: error.message || 'Failed to delete batch' });
    }
  };

  // Register both non-instance and instance-specific versions
  app.delete('/api/admin/stream/batches/:id', adminAuth, deleteBatchHandler);
  app.delete(
    '/:instance/api/admin/stream/batches/:id',
    instanceMiddleware,
    adminAuth,
    deleteBatchHandler
  );

  logger.info('Multi-stream scanner admin routes registered');
}
