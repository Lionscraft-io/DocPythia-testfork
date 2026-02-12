/**
 * DatabaseStorage Unit Tests
 * Tests for database storage layer with Prisma

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to create mock before module hoisting
const { mockDb } = vi.hoisted(() => {
  const mockFn = () => vi.fn();
  return {
    mockDb: {
      documentationSection: {
        findMany: mockFn(),
        findUnique: mockFn(),
        create: mockFn(),
        update: mockFn(),
        delete: mockFn(),
      },
      pendingUpdate: {
        findMany: mockFn(),
        findUnique: mockFn(),
        create: mockFn(),
        update: mockFn(),
      },
      updateHistory: {
        findMany: mockFn(),
        create: mockFn(),
      },
      sectionVersion: {
        findMany: mockFn(),
        findUnique: mockFn(),
        findFirst: mockFn(),
        create: mockFn(),
      },
      scrapedMessage: {
        findMany: mockFn(),
        findUnique: mockFn(),
        create: mockFn(),
        update: mockFn(),
      },
      scrapeMetadata: {
        findFirst: mockFn(),
        create: mockFn(),
        update: mockFn(),
      },
      $transaction: mockFn(),
    },
  };
});

vi.mock('../server/db.js', () => ({
  db: mockDb,
}));

import { DatabaseStorage } from '../server/storage.js';

describe('DatabaseStorage', () => {
  let storage: DatabaseStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new DatabaseStorage();
  });

  describe('Documentation Sections', () => {
    describe('getDocumentationSections', () => {
      it('should return all sections ordered by orderIndex', async () => {
        const mockSections = [
          { id: '1', sectionId: 'intro', title: 'Introduction', orderIndex: 1 },
          { id: '2', sectionId: 'setup', title: 'Setup', orderIndex: 2 },
        ];
        mockDb.documentationSection.findMany.mockResolvedValue(mockSections);

        const result = await storage.getDocumentationSections();

        expect(result).toEqual(mockSections);
        expect(mockDb.documentationSection.findMany).toHaveBeenCalledWith({
          orderBy: { orderIndex: 'asc' },
        });
      });

      it('should return empty array when no sections exist', async () => {
        mockDb.documentationSection.findMany.mockResolvedValue([]);

        const result = await storage.getDocumentationSections();

        expect(result).toEqual([]);
      });
    });

    describe('getDocumentationSection', () => {
      it('should return section by sectionId', async () => {
        const mockSection = { id: '1', sectionId: 'intro', title: 'Introduction' };
        mockDb.documentationSection.findUnique.mockResolvedValue(mockSection);

        const result = await storage.getDocumentationSection('intro');

        expect(result).toEqual(mockSection);
        expect(mockDb.documentationSection.findUnique).toHaveBeenCalledWith({
          where: { sectionId: 'intro' },
        });
      });

      it('should return undefined when section not found', async () => {
        mockDb.documentationSection.findUnique.mockResolvedValue(null);

        const result = await storage.getDocumentationSection('nonexistent');

        expect(result).toBeUndefined();
      });
    });

    describe('createDocumentationSection', () => {
      it('should create a new section', async () => {
        const newSection = {
          sectionId: 'new-section',
          title: 'New Section',
          content: 'Content here',
          orderIndex: 3,
        };
        const createdSection = { id: '3', ...newSection };
        mockDb.documentationSection.create.mockResolvedValue(createdSection);

        const result = await storage.createDocumentationSection(newSection);

        expect(result).toEqual(createdSection);
        expect(mockDb.documentationSection.create).toHaveBeenCalledWith({
          data: newSection,
        });
      });
    });

    describe('updateDocumentationSection', () => {
      it('should update section content', async () => {
        const updatedSection = {
          id: '1',
          sectionId: 'intro',
          content: 'Updated content',
          updatedAt: expect.any(Date),
        };
        mockDb.documentationSection.update.mockResolvedValue(updatedSection);

        const result = await storage.updateDocumentationSection('intro', 'Updated content');

        expect(result).toEqual(updatedSection);
        expect(mockDb.documentationSection.update).toHaveBeenCalledWith({
          where: { sectionId: 'intro' },
          data: { content: 'Updated content', updatedAt: expect.any(Date) },
        });
      });
    });
  });

  describe('Pending Updates', () => {
    describe('getPendingUpdates', () => {
      it('should return all pending updates ordered by createdAt desc', async () => {
        const mockUpdates = [
          { id: '1', sectionId: 'intro', status: 'pending' },
          { id: '2', sectionId: 'setup', status: 'pending' },
        ];
        mockDb.pendingUpdate.findMany.mockResolvedValue(mockUpdates);

        const result = await storage.getPendingUpdates();

        expect(result).toEqual(mockUpdates);
        expect(mockDb.pendingUpdate.findMany).toHaveBeenCalledWith({
          orderBy: { createdAt: 'desc' },
        });
      });
    });

    describe('getPendingUpdate', () => {
      it('should return update by id', async () => {
        const mockUpdate = { id: '1', sectionId: 'intro', status: 'pending' };
        mockDb.pendingUpdate.findUnique.mockResolvedValue(mockUpdate);

        const result = await storage.getPendingUpdate('1');

        expect(result).toEqual(mockUpdate);
      });

      it('should return undefined when not found', async () => {
        mockDb.pendingUpdate.findUnique.mockResolvedValue(null);

        const result = await storage.getPendingUpdate('nonexistent');

        expect(result).toBeUndefined();
      });
    });

    describe('createPendingUpdate', () => {
      it('should create a new pending update', async () => {
        const newUpdate = {
          sectionId: 'intro',
          type: 'minor' as const,
          summary: 'Minor update',
          source: 'user',
        };
        const createdUpdate = { id: '1', ...newUpdate, status: 'pending' };
        mockDb.pendingUpdate.create.mockResolvedValue(createdUpdate);

        const result = await storage.createPendingUpdate(newUpdate);

        expect(result).toEqual(createdUpdate);
      });
    });

    describe('updatePendingUpdateStatus', () => {
      it('should update status to approved', async () => {
        const updatedUpdate = {
          id: '1',
          status: 'approved',
          reviewedAt: expect.any(Date),
          reviewedBy: 'admin',
        };
        mockDb.pendingUpdate.update.mockResolvedValue(updatedUpdate);

        const result = await storage.updatePendingUpdateStatus('1', 'approved', 'admin');

        expect(result).toEqual(updatedUpdate);
        expect(mockDb.pendingUpdate.update).toHaveBeenCalledWith({
          where: { id: '1' },
          data: {
            status: 'approved',
            reviewedAt: expect.any(Date),
            reviewedBy: 'admin',
          },
        });
      });

      it('should set reviewedBy to null when not provided', async () => {
        mockDb.pendingUpdate.update.mockResolvedValue({ id: '1', status: 'rejected' });

        await storage.updatePendingUpdateStatus('1', 'rejected');

        expect(mockDb.pendingUpdate.update).toHaveBeenCalledWith({
          where: { id: '1' },
          data: {
            status: 'rejected',
            reviewedAt: expect.any(Date),
            reviewedBy: null,
          },
        });
      });
    });
  });

  describe('Update History', () => {
    describe('createUpdateHistory', () => {
      it('should create history record', async () => {
        const historyData = {
          updateId: 'update-1',
          action: 'approved' as const,
          performedBy: 'admin',
        };
        const createdHistory = { id: '1', ...historyData };
        mockDb.updateHistory.create.mockResolvedValue(createdHistory);

        const result = await storage.createUpdateHistory(historyData);

        expect(result).toEqual(createdHistory);
      });

      it('should set performedBy to null when not provided', async () => {
        const historyData = {
          updateId: 'update-1',
          action: 'rejected' as const,
        };
        mockDb.updateHistory.create.mockResolvedValue({ id: '1', ...historyData });

        await storage.createUpdateHistory(historyData);

        expect(mockDb.updateHistory.create).toHaveBeenCalledWith({
          data: {
            updateId: 'update-1',
            action: 'rejected',
            performedBy: null,
          },
        });
      });
    });

    describe('getUpdateHistory', () => {
      it('should return history ordered by performedAt desc', async () => {
        const mockHistory = [
          { id: '1', action: 'approved' },
          { id: '2', action: 'rejected' },
        ];
        mockDb.updateHistory.findMany.mockResolvedValue(mockHistory);

        const result = await storage.getUpdateHistory();

        expect(result).toEqual(mockHistory);
        expect(mockDb.updateHistory.findMany).toHaveBeenCalledWith({
          orderBy: { performedAt: 'desc' },
        });
      });
    });
  });

  describe('Section Versions', () => {
    describe('createSectionVersion', () => {
      it('should create a section version', async () => {
        const versionData = {
          sectionId: 'intro',
          title: 'Introduction',
          content: 'Content',
          orderIndex: 1,
          op: 'edit' as const,
        };
        const createdVersion = { id: '1', ...versionData };
        mockDb.sectionVersion.create.mockResolvedValue(createdVersion);

        const result = await storage.createSectionVersion(versionData);

        expect(result).toEqual(createdVersion);
      });
    });

    describe('getSectionHistory', () => {
      it('should return version history for section', async () => {
        const mockVersions = [
          { id: '2', sectionId: 'intro', op: 'edit' },
          { id: '1', sectionId: 'intro', op: 'add' },
        ];
        mockDb.sectionVersion.findMany.mockResolvedValue(mockVersions);

        const result = await storage.getSectionHistory('intro');

        expect(result).toEqual(mockVersions);
        expect(mockDb.sectionVersion.findMany).toHaveBeenCalledWith({
          where: { sectionId: 'intro' },
          orderBy: { createdAt: 'desc' },
        });
      });
    });

    describe('rollbackSection', () => {
      it('should rollback section to a previous version', async () => {
        const targetVersion = {
          id: 'v1',
          sectionId: 'intro',
          title: 'Old Title',
          content: 'Old Content',
          level: 1,
          type: 'text',
          orderIndex: 1,
        };
        const updatedSection = { id: '1', ...targetVersion };
        const rollbackVersion = { id: 'v2', op: 'rollback', ...targetVersion };

        const mockTx = {
          sectionVersion: {
            findUnique: vi.fn().mockResolvedValue(targetVersion),
            findFirst: vi.fn().mockResolvedValue({ id: 'v1' }),
            create: vi.fn().mockResolvedValue(rollbackVersion),
          },
          documentationSection: {
            findUnique: vi.fn().mockResolvedValue(updatedSection),
            update: vi.fn().mockResolvedValue(updatedSection),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        const result = await storage.rollbackSection('intro', 'v1', 'admin');

        expect(result.section).toEqual(updatedSection);
        expect(result.version).toEqual(rollbackVersion);
      });

      it('should throw error when version not found', async () => {
        const mockTx = {
          sectionVersion: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        await expect(storage.rollbackSection('intro', 'nonexistent', 'admin')).rejects.toThrow(
          'Version not found'
        );
      });

      it('should throw error when version belongs to different section', async () => {
        const mockTx = {
          sectionVersion: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'v1',
              sectionId: 'different-section',
            }),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        await expect(storage.rollbackSection('intro', 'v1', 'admin')).rejects.toThrow(
          'Version does not belong to this section'
        );
      });

      it('should reinsert deleted section on rollback', async () => {
        const targetVersion = {
          id: 'v1',
          sectionId: 'deleted-section',
          title: 'Deleted Title',
          content: 'Deleted Content',
          level: 1,
          type: 'text',
          orderIndex: 1,
        };
        const reinsertedSection = { id: '1', ...targetVersion };
        const rollbackVersion = { id: 'v2', op: 'rollback' };

        const mockTx = {
          sectionVersion: {
            findUnique: vi.fn().mockResolvedValue(targetVersion),
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue(rollbackVersion),
          },
          documentationSection: {
            findUnique: vi.fn().mockResolvedValue(null), // Section was deleted
            create: vi.fn().mockResolvedValue(reinsertedSection),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        const result = await storage.rollbackSection('deleted-section', 'v1');

        expect(mockTx.documentationSection.create).toHaveBeenCalled();
        expect(result.section).toEqual(reinsertedSection);
      });
    });
  });

  describe('Approve/Reject Updates', () => {
    describe('approveUpdate', () => {
      it('should approve an edit update', async () => {
        const pendingUpdate = {
          id: 'update-1',
          sectionId: 'intro',
          type: 'minor',
          status: 'pending',
          diffAfter: 'Updated content',
        };
        const existingSection = {
          id: '1',
          sectionId: 'intro',
          title: 'Introduction',
          content: 'Old content',
          level: 1,
          type: 'text',
          orderIndex: 1,
        };
        const updatedSection = { ...existingSection, content: 'Updated content' };
        const approvedUpdate = { ...pendingUpdate, status: 'approved' };
        const newHistory = { id: 'h1', updateId: 'update-1', action: 'approved' };

        const mockTx = {
          pendingUpdate: {
            findUnique: vi.fn().mockResolvedValue(pendingUpdate),
            update: vi.fn().mockResolvedValue(approvedUpdate),
          },
          sectionVersion: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({}),
          },
          documentationSection: {
            findUnique: vi.fn().mockResolvedValue(existingSection),
            update: vi.fn().mockResolvedValue(updatedSection),
          },
          updateHistory: {
            create: vi.fn().mockResolvedValue(newHistory),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        const result = await storage.approveUpdate('update-1', 'admin');

        expect(result.update).toEqual(approvedUpdate);
        expect(result.section).toEqual(updatedSection);
        expect(result.history).toEqual(newHistory);
      });

      it('should throw error when update not found', async () => {
        const mockTx = {
          pendingUpdate: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        await expect(storage.approveUpdate('nonexistent')).rejects.toThrow('Update not found');
      });

      it('should throw error when update is not pending', async () => {
        const mockTx = {
          pendingUpdate: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'update-1',
              status: 'approved',
            }),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        await expect(storage.approveUpdate('update-1')).rejects.toThrow(
          'Cannot approve update: status must be pending'
        );
      });

      it('should create new section when type is add', async () => {
        const pendingUpdate = {
          id: 'update-1',
          sectionId: 'new-section',
          type: 'add',
          status: 'pending',
          summary: 'Add new section: "New Feature"',
          diffAfter: 'New section content',
        };
        const createdSection = {
          id: '2',
          sectionId: 'new-section',
          title: 'New Feature',
          content: 'New section content',
          level: 1,
          orderIndex: 2,
        };

        const mockTx = {
          pendingUpdate: {
            findUnique: vi.fn().mockResolvedValue(pendingUpdate),
            update: vi.fn().mockResolvedValue({ ...pendingUpdate, status: 'approved' }),
          },
          sectionVersion: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({}),
          },
          documentationSection: {
            findMany: vi.fn().mockResolvedValue([{ orderIndex: 1 }]),
            create: vi.fn().mockResolvedValue(createdSection),
          },
          updateHistory: {
            create: vi.fn().mockResolvedValue({ id: 'h1' }),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        const result = await storage.approveUpdate('update-1');

        expect(mockTx.documentationSection.create).toHaveBeenCalled();
        expect(result.section).toEqual(createdSection);
      });

      it('should throw error when add type has no diffAfter', async () => {
        const mockTx = {
          pendingUpdate: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'update-1',
              type: 'add',
              status: 'pending',
              diffAfter: null,
            }),
          },
          sectionVersion: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        await expect(storage.approveUpdate('update-1')).rejects.toThrow(
          'Cannot add section: no content provided'
        );
      });

      it('should delete section when type is delete', async () => {
        const pendingUpdate = {
          id: 'update-1',
          sectionId: 'to-delete',
          type: 'delete',
          status: 'pending',
        };
        const existingSection = {
          id: '1',
          sectionId: 'to-delete',
          title: 'To Delete',
          content: 'Content',
          level: 1,
          type: 'text',
          orderIndex: 1,
        };

        const mockTx = {
          pendingUpdate: {
            findUnique: vi.fn().mockResolvedValue(pendingUpdate),
            update: vi.fn().mockResolvedValue({ ...pendingUpdate, status: 'approved' }),
          },
          sectionVersion: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({}),
          },
          documentationSection: {
            findUnique: vi.fn().mockResolvedValue(existingSection),
            delete: vi.fn().mockResolvedValue({}),
          },
          updateHistory: {
            create: vi.fn().mockResolvedValue({ id: 'h1' }),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        await storage.approveUpdate('update-1');

        expect(mockTx.documentationSection.delete).toHaveBeenCalledWith({
          where: { sectionId: 'to-delete' },
        });
      });

      it('should throw error when deleting non-existent section', async () => {
        const mockTx = {
          pendingUpdate: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'update-1',
              sectionId: 'nonexistent',
              type: 'delete',
              status: 'pending',
            }),
          },
          sectionVersion: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          documentationSection: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        await expect(storage.approveUpdate('update-1')).rejects.toThrow(
          'Cannot delete section: section not found'
        );
      });
    });

    describe('rejectUpdate', () => {
      it('should reject an update', async () => {
        const pendingUpdate = {
          id: 'update-1',
          status: 'pending',
        };
        const rejectedUpdate = { ...pendingUpdate, status: 'rejected' };
        const newHistory = { id: 'h1', action: 'rejected' };

        const mockTx = {
          pendingUpdate: {
            findUnique: vi.fn().mockResolvedValue(pendingUpdate),
            update: vi.fn().mockResolvedValue(rejectedUpdate),
          },
          updateHistory: {
            create: vi.fn().mockResolvedValue(newHistory),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        const result = await storage.rejectUpdate('update-1', 'admin');

        expect(result.update).toEqual(rejectedUpdate);
        expect(result.history).toEqual(newHistory);
      });

      it('should throw error when update not found', async () => {
        const mockTx = {
          pendingUpdate: {
            findUnique: vi.fn().mockResolvedValue(null),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        await expect(storage.rejectUpdate('nonexistent')).rejects.toThrow('Update not found');
      });

      it('should throw error when update is not pending', async () => {
        const mockTx = {
          pendingUpdate: {
            findUnique: vi.fn().mockResolvedValue({
              id: 'update-1',
              status: 'approved',
            }),
          },
        };

        mockDb.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

        await expect(storage.rejectUpdate('update-1')).rejects.toThrow(
          'Cannot reject update: status must be pending'
        );
      });
    });
  });

  describe('Scraped Messages', () => {
    describe('getScrapedMessages', () => {
      it('should return all messages ordered by timestamp desc', async () => {
        const mockMessages = [
          { id: '1', messageId: 'msg-1', content: 'Message 1' },
          { id: '2', messageId: 'msg-2', content: 'Message 2' },
        ];
        mockDb.scrapedMessage.findMany.mockResolvedValue(mockMessages);

        const result = await storage.getScrapedMessages();

        expect(result).toEqual(mockMessages);
        expect(mockDb.scrapedMessage.findMany).toHaveBeenCalledWith({
          orderBy: { messageTimestamp: 'desc' },
        });
      });
    });

    describe('getUnanalyzedMessages', () => {
      it('should return only unanalyzed messages', async () => {
        const mockMessages = [{ id: '1', analyzed: false }];
        mockDb.scrapedMessage.findMany.mockResolvedValue(mockMessages);

        const result = await storage.getUnanalyzedMessages();

        expect(result).toEqual(mockMessages);
        expect(mockDb.scrapedMessage.findMany).toHaveBeenCalledWith({
          where: { analyzed: false },
          orderBy: { messageTimestamp: 'asc' },
        });
      });
    });

    describe('createScrapedMessage', () => {
      it('should create a new scraped message', async () => {
        const newMessage = {
          messageId: 'msg-1',
          source: 'zulipchat' as const,
          channelName: 'general',
          content: 'Test message',
          messageTimestamp: new Date(),
        };
        const createdMessage = { id: '1', ...newMessage };
        mockDb.scrapedMessage.create.mockResolvedValue(createdMessage);

        const result = await storage.createScrapedMessage(newMessage);

        expect(result).toEqual(createdMessage);
      });
    });

    describe('markMessageAsAnalyzed', () => {
      it('should mark message as analyzed', async () => {
        const updatedMessage = { id: '1', analyzed: true };
        mockDb.scrapedMessage.update.mockResolvedValue(updatedMessage);

        const result = await storage.markMessageAsAnalyzed('1');

        expect(result).toEqual(updatedMessage);
        expect(mockDb.scrapedMessage.update).toHaveBeenCalledWith({
          where: { id: '1' },
          data: { analyzed: true },
        });
      });
    });

    describe('getMessageByMessageId', () => {
      it('should return message by messageId', async () => {
        const mockMessage = { id: '1', messageId: 'msg-1' };
        mockDb.scrapedMessage.findUnique.mockResolvedValue(mockMessage);

        const result = await storage.getMessageByMessageId('msg-1');

        expect(result).toEqual(mockMessage);
        expect(mockDb.scrapedMessage.findUnique).toHaveBeenCalledWith({
          where: { messageId: 'msg-1' },
        });
      });

      it('should return undefined when not found', async () => {
        mockDb.scrapedMessage.findUnique.mockResolvedValue(null);

        const result = await storage.getMessageByMessageId('nonexistent');

        expect(result).toBeUndefined();
      });
    });
  });

  describe('Scrape Metadata', () => {
    describe('getScrapeMetadata', () => {
      it('should return metadata for source and channel', async () => {
        const mockMetadata = {
          id: '1',
          source: 'zulipchat',
          channelName: 'general',
          lastMessageId: 'msg-100',
        };
        mockDb.scrapeMetadata.findFirst.mockResolvedValue(mockMetadata);

        const result = await storage.getScrapeMetadata('zulipchat', 'general');

        expect(result).toEqual(mockMetadata);
        expect(mockDb.scrapeMetadata.findFirst).toHaveBeenCalledWith({
          where: { source: 'zulipchat', channelName: 'general' },
        });
      });

      it('should return undefined when not found', async () => {
        mockDb.scrapeMetadata.findFirst.mockResolvedValue(null);

        const result = await storage.getScrapeMetadata('telegram', 'nonexistent');

        expect(result).toBeUndefined();
      });
    });

    describe('createOrUpdateScrapeMetadata', () => {
      it('should create new metadata when not exists', async () => {
        mockDb.scrapeMetadata.findFirst.mockResolvedValue(null);
        const newMetadata = {
          source: 'zulipchat' as const,
          channelName: 'new-channel',
          lastMessageId: 'msg-1',
          totalMessagesFetched: 10,
        };
        const createdMetadata = { id: '1', ...newMetadata };
        mockDb.scrapeMetadata.create.mockResolvedValue(createdMetadata);

        const result = await storage.createOrUpdateScrapeMetadata(newMetadata);

        expect(result).toEqual(createdMetadata);
        expect(mockDb.scrapeMetadata.create).toHaveBeenCalled();
      });

      it('should update existing metadata', async () => {
        const existingMetadata = {
          id: '1',
          source: 'zulipchat',
          channelName: 'general',
          totalMessagesFetched: 100,
        };
        mockDb.scrapeMetadata.findFirst.mockResolvedValue(existingMetadata);

        const updateData = {
          source: 'zulipchat' as const,
          channelName: 'general',
          lastMessageId: 'msg-200',
          totalMessagesFetched: 50,
        };
        const updatedMetadata = {
          ...existingMetadata,
          lastMessageId: 'msg-200',
          totalMessagesFetched: 150,
        };
        mockDb.scrapeMetadata.update.mockResolvedValue(updatedMetadata);

        const result = await storage.createOrUpdateScrapeMetadata(updateData);

        expect(result).toEqual(updatedMetadata);
        expect(mockDb.scrapeMetadata.update).toHaveBeenCalledWith({
          where: { id: '1' },
          data: expect.objectContaining({
            lastMessageId: 'msg-200',
            totalMessagesFetched: 150, // 100 + 50
          }),
        });
      });
    });
  });
});
