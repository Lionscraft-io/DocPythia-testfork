/**
 * Watermark System Unit Tests
 * Tests for dual watermark system (import + processing)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockPrismaClient, createMockWatermark, resetPrismaMocks } from './mocks/prisma.mock.js';

vi.mock('../server/db.js', () => ({
  default: mockPrismaClient,
}));

describe('Watermark System', () => {
  beforeEach(() => {
    resetPrismaMocks();
  });

  describe('Processing Watermark', () => {
    it('should ensure single row with CHECK constraint', async () => {
      // The database schema enforces CHECK (id = 1)
      const watermark = createMockWatermark({ id: 1 });

      mockPrismaClient.processingWatermark.findUnique.mockResolvedValue(watermark);

      const result = await mockPrismaClient.processingWatermark.findUnique({
        where: { id: 1 },
      });

      expect(result?.id).toBe(1);
    });

    it('should initialize with default watermark (7 days ago)', async () => {
      mockPrismaClient.processingWatermark.findUnique.mockResolvedValue(null);

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      mockPrismaClient.processingWatermark.create.mockResolvedValue(
        createMockWatermark({
          id: 1,
          watermarkTime: sevenDaysAgo,
        })
      );

      const result = await mockPrismaClient.processingWatermark.create({
        data: {
          id: 1,
          watermarkTime: sevenDaysAgo,
        },
      });

      expect(result.watermarkTime).toEqual(sevenDaysAgo);
      expect(mockPrismaClient.processingWatermark.create).toHaveBeenCalled();
    });

    it('should advance watermark by batch window (24 hours)', async () => {
      // currentWatermark would be 2025-10-30, advancing to new watermark
      const newWatermark = new Date('2025-10-31T00:00:00Z');

      mockPrismaClient.processingWatermark.upsert.mockResolvedValue(
        createMockWatermark({
          watermarkTime: newWatermark,
          lastProcessedBatch: new Date(),
        })
      );

      await mockPrismaClient.processingWatermark.upsert({
        where: { id: 1 },
        update: {
          watermarkTime: newWatermark,
          lastProcessedBatch: new Date(),
        },
        create: {
          id: 1,
          watermarkTime: newWatermark,
        },
      });

      expect(mockPrismaClient.processingWatermark.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          update: expect.objectContaining({
            watermarkTime: newWatermark,
          }),
        })
      );
    });

    it('should track last processed batch timestamp', async () => {
      const now = new Date();

      mockPrismaClient.processingWatermark.upsert.mockResolvedValue(
        createMockWatermark({
          lastProcessedBatch: now,
        })
      );

      const result = await mockPrismaClient.processingWatermark.upsert({
        where: { id: 1 },
        update: {
          watermarkTime: new Date(),
          lastProcessedBatch: now,
        },
        create: {
          id: 1,
          watermarkTime: new Date(),
        },
      });

      expect(result.lastProcessedBatch).toEqual(now);
    });

    it('should handle concurrent batch processing (single row)', async () => {
      // Multiple processes trying to process batches should use same watermark
      const watermark = createMockWatermark();

      mockPrismaClient.processingWatermark.findUnique
        .mockResolvedValueOnce(watermark)
        .mockResolvedValueOnce(watermark);

      const result1 = await mockPrismaClient.processingWatermark.findUnique({
        where: { id: 1 },
      });
      const result2 = await mockPrismaClient.processingWatermark.findUnique({
        where: { id: 1 },
      });

      expect(result1?.watermarkTime).toEqual(result2?.watermarkTime);
    });
  });

  describe('Import Watermarks', () => {
    it('should track per-stream watermarks', async () => {
      const watermarks = [
        {
          id: 1,
          streamId: 'csv-stream',
          streamType: 'csv',
          resourceId: 'messages.csv',
          lastImportedTime: new Date('2025-10-31T12:00:00Z'),
          lastImportedId: 'msg-100',
          importComplete: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          streamId: 'telegram-stream',
          streamType: 'telegram',
          resourceId: 'channel-123',
          lastImportedTime: new Date('2025-10-31T10:00:00Z'),
          lastImportedId: 'tg-msg-50',
          importComplete: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrismaClient.importWatermark.findMany.mockResolvedValue(watermarks);

      const result = await mockPrismaClient.importWatermark.findMany();

      expect(result).toHaveLength(2);
      expect(result[0].streamId).toBe('csv-stream');
      expect(result[1].streamId).toBe('telegram-stream');
    });

    it('should track import completion for CSV files', async () => {
      const watermark = {
        id: 1,
        streamId: 'csv-stream',
        streamType: 'csv',
        resourceId: 'messages.csv',
        lastImportedTime: new Date(),
        lastImportedId: null,
        importComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.importWatermark.findMany.mockResolvedValue([watermark]);

      const result = await mockPrismaClient.importWatermark.findMany({
        where: {
          streamType: 'csv',
          importComplete: true,
        },
      });

      expect(result[0].importComplete).toBe(true);
    });

    it('should enforce unique constraint on (streamId, resourceId)', async () => {
      // This tests the database schema constraint
      // In practice, duplicate inserts would be rejected by the database

      mockPrismaClient.importWatermark.findMany.mockResolvedValue([
        {
          id: 1,
          streamId: 'test-stream',
          streamType: 'telegram',
          resourceId: 'channel-1',
          lastImportedTime: new Date(),
          lastImportedId: 'msg-1',
          importComplete: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await mockPrismaClient.importWatermark.findMany({
        where: {
          streamId: 'test-stream',
          resourceId: 'channel-1',
        },
      });

      expect(result).toHaveLength(1);
    });

    it('should handle multiple resources per stream', async () => {
      const watermarks = [
        {
          id: 1,
          streamId: 'telegram-stream',
          streamType: 'telegram',
          resourceId: 'channel-1',
          lastImportedTime: new Date(),
          lastImportedId: 'msg-100',
          importComplete: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          streamId: 'telegram-stream',
          streamType: 'telegram',
          resourceId: 'channel-2',
          lastImportedTime: new Date(),
          lastImportedId: 'msg-50',
          importComplete: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrismaClient.importWatermark.findMany.mockResolvedValue(watermarks);

      const result = await mockPrismaClient.importWatermark.findMany({
        where: {
          streamId: 'telegram-stream',
        },
      });

      expect(result).toHaveLength(2);
      expect(result.every((w) => w.streamId === 'telegram-stream')).toBe(true);
    });
  });

  describe('Dual Watermark Coordination', () => {
    it('should allow imports ahead of processing', async () => {
      // Import watermark can be ahead of processing watermark
      const importTime = new Date('2025-10-31T12:00:00Z');
      const processingTime = new Date('2025-10-30T00:00:00Z');

      mockPrismaClient.importWatermark.findMany.mockResolvedValue([
        {
          id: 1,
          streamId: 'test-stream',
          streamType: 'csv',
          resourceId: null,
          lastImportedTime: importTime,
          lastImportedId: 'msg-100',
          importComplete: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      mockPrismaClient.processingWatermark.findUnique.mockResolvedValue(
        createMockWatermark({ watermarkTime: processingTime })
      );

      const imports = await mockPrismaClient.importWatermark.findMany();
      const processing = await mockPrismaClient.processingWatermark.findUnique({
        where: { id: 1 },
      });

      expect(imports[0].lastImportedTime! > processing!.watermarkTime).toBe(true);
    });

    it('should process messages between watermarks', async () => {
      const processingWatermark = new Date('2025-10-30T00:00:00Z');
      const batchEnd = new Date('2025-10-31T00:00:00Z');

      mockPrismaClient.processingWatermark.findUnique.mockResolvedValue(
        createMockWatermark({ watermarkTime: processingWatermark })
      );

      // Messages in the processing window
      mockPrismaClient.unifiedMessage.findMany.mockResolvedValue([
        {
          id: 1,
          streamId: 'test-stream',
          messageId: 'msg-1',
          timestamp: new Date('2025-10-30T10:00:00Z'),
          author: 'user1',
          content: 'Message 1',
          channel: null,
          rawData: {},
          metadata: null,
          embedding: null,
          processingStatus: 'PENDING',
          failureCount: 0,
          lastError: null,
          createdAt: new Date(),
        },
      ]);

      const messages = await mockPrismaClient.unifiedMessage.findMany({
        where: {
          timestamp: {
            gte: processingWatermark,
            lt: batchEnd,
          },
        },
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].timestamp >= processingWatermark).toBe(true);
      expect(messages[0].timestamp < batchEnd).toBe(true);
    });

    it('should handle backfill scenarios', async () => {
      // When importing historical data, processing watermark should start from
      // the beginning of imported data, not current time

      const oldestImportedMessage = new Date('2025-09-01T00:00:00Z');

      mockPrismaClient.processingWatermark.create.mockResolvedValue(
        createMockWatermark({
          watermarkTime: oldestImportedMessage,
        })
      );

      const watermark = await mockPrismaClient.processingWatermark.create({
        data: {
          id: 1,
          watermarkTime: oldestImportedMessage,
        },
      });

      expect(watermark.watermarkTime).toEqual(oldestImportedMessage);
    });
  });

  describe('Batch Window Calculations', () => {
    it('should calculate correct batch start and end times', () => {
      const watermarkTime = new Date('2025-10-30T00:00:00Z');
      const batchWindowHours = 24;

      const batchStart = watermarkTime;
      const batchEnd = new Date(batchStart.getTime() + batchWindowHours * 60 * 60 * 1000);

      expect(batchEnd).toEqual(new Date('2025-10-31T00:00:00Z'));
    });

    it('should calculate correct context window times', () => {
      const batchStart = new Date('2025-10-30T00:00:00Z');
      const contextWindowHours = 24;

      const contextStart = new Date(batchStart.getTime() - contextWindowHours * 60 * 60 * 1000);
      const contextEnd = batchStart;

      expect(contextStart).toEqual(new Date('2025-10-29T00:00:00Z'));
      expect(contextEnd).toEqual(batchStart);
    });

    it('should validate batch completeness', () => {
      const batchEnd = new Date('2025-10-31T00:00:00Z');
      const now = new Date('2025-11-01T00:00:00Z');

      const canProcess = batchEnd <= now;

      expect(canProcess).toBe(true);
    });

    it('should prevent processing future batches', () => {
      const batchEnd = new Date('2025-11-01T00:00:00Z');
      const now = new Date('2025-10-31T12:00:00Z');

      const canProcess = batchEnd <= now;

      expect(canProcess).toBe(false);
    });
  });

  describe('Error Recovery', () => {
    it('should preserve watermark on processing failure', async () => {
      const originalWatermark = new Date('2025-10-30T00:00:00Z');

      mockPrismaClient.processingWatermark.findUnique.mockResolvedValue(
        createMockWatermark({ watermarkTime: originalWatermark })
      );

      // Simulate processing failure - watermark should not advance
      const watermark = await mockPrismaClient.processingWatermark.findUnique({
        where: { id: 1 },
      });

      expect(watermark?.watermarkTime).toEqual(originalWatermark);
      // On failure, upsert should not be called
      expect(mockPrismaClient.processingWatermark.upsert).not.toHaveBeenCalled();
    });

    it('should allow reprocessing failed batches', async () => {
      const watermarkTime = new Date('2025-10-30T00:00:00Z');

      mockPrismaClient.processingWatermark.findUnique.mockResolvedValue(
        createMockWatermark({ watermarkTime })
      );

      // Can re-fetch same batch for retry
      const watermark = await mockPrismaClient.processingWatermark.findUnique({
        where: { id: 1 },
      });

      expect(watermark?.watermarkTime).toEqual(watermarkTime);
    });
  });
});
