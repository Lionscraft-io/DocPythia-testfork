// Database storage layer - Prisma Client
// Migrated from Drizzle ORM
import { db } from './db';
import type {
  DocumentationSection,
  PendingUpdate,
  UpdateHistory,
  ScrapedMessage,
  ScrapeMetadata,
  SectionVersion,
} from '@prisma/client';

// Insert types - simplified versions without relations
export type InsertDocumentationSection = {
  sectionId: string;
  title: string;
  content: string;
  level?: number | null;
  type?: 'text' | 'info' | 'warning' | 'success' | null;
  orderIndex: number;
};

export type InsertPendingUpdate = {
  sectionId: string;
  type: 'minor' | 'major' | 'add' | 'delete';
  summary: string;
  source: string;
  status?: 'pending' | 'approved' | 'rejected' | 'auto_applied';
  diffBefore?: string | null;
  diffAfter?: string | null;
  reviewedBy?: string | null;
};

export type InsertUpdateHistory = {
  updateId: string;
  action: 'approved' | 'rejected' | 'auto_applied';
  performedBy?: string | null;
};

export type InsertScrapedMessage = {
  messageId: string;
  source: 'zulipchat' | 'telegram';
  channelName: string;
  topicName?: string | null;
  senderEmail?: string | null;
  senderName?: string | null;
  content: string;
  messageTimestamp: Date;
  analyzed?: boolean;
};

export type InsertScrapeMetadata = {
  source: 'zulipchat' | 'telegram';
  channelName: string;
  lastMessageId?: string | null;
  lastScrapeTimestamp?: Date | null;
  totalMessagesFetched?: number;
};

export type InsertSectionVersion = {
  sectionId: string;
  title: string;
  content: string;
  level?: number | null;
  type?: 'text' | 'info' | 'warning' | 'success' | null;
  orderIndex: number;
  op: 'add' | 'edit' | 'delete' | 'rollback';
  parentVersionId?: string | null;
  fromUpdateId?: string | null;
  fromHistoryId?: string | null;
  createdBy?: string | null;
};

// Re-export Prisma-generated types
export type {
  DocumentationSection,
  PendingUpdate,
  UpdateHistory,
  ScrapedMessage,
  ScrapeMetadata,
  SectionVersion,
};

export interface IStorage {
  // Documentation sections
  getDocumentationSections(): Promise<DocumentationSection[]>;
  getDocumentationSection(sectionId: string): Promise<DocumentationSection | undefined>;
  createDocumentationSection(
    section: Omit<InsertDocumentationSection, 'id' | 'updatedAt'>
  ): Promise<DocumentationSection>;
  updateDocumentationSection(sectionId: string, content: string): Promise<DocumentationSection>;

  // Pending updates
  getPendingUpdates(): Promise<PendingUpdate[]>;
  getPendingUpdate(id: string): Promise<PendingUpdate | undefined>;
  createPendingUpdate(
    update: Omit<InsertPendingUpdate, 'id' | 'createdAt' | 'reviewedAt'>
  ): Promise<PendingUpdate>;
  updatePendingUpdateStatus(
    id: string,
    status: 'pending' | 'approved' | 'rejected' | 'auto_applied',
    reviewedBy?: string
  ): Promise<PendingUpdate | undefined>;
  approveUpdate(
    updateId: string,
    reviewedBy?: string
  ): Promise<{ update: PendingUpdate; section: DocumentationSection; history: UpdateHistory }>;
  rejectUpdate(
    updateId: string,
    reviewedBy?: string
  ): Promise<{ update: PendingUpdate; history: UpdateHistory }>;

  // Update history
  createUpdateHistory(
    history: Omit<InsertUpdateHistory, 'id' | 'performedAt'>
  ): Promise<UpdateHistory>;
  getUpdateHistory(): Promise<UpdateHistory[]>;

  // Section versions
  createSectionVersion(
    version: Omit<InsertSectionVersion, 'id' | 'createdAt'>
  ): Promise<SectionVersion>;
  getSectionHistory(sectionId: string): Promise<SectionVersion[]>;
  rollbackSection(
    sectionId: string,
    versionId: string,
    performedBy?: string
  ): Promise<{ section: DocumentationSection; version: SectionVersion }>;

  // Scraped messages
  getScrapedMessages(): Promise<ScrapedMessage[]>;
  getUnanalyzedMessages(): Promise<ScrapedMessage[]>;
  createScrapedMessage(
    message: Omit<InsertScrapedMessage, 'id' | 'scrapedAt'>
  ): Promise<ScrapedMessage>;
  markMessageAsAnalyzed(id: string): Promise<ScrapedMessage | undefined>;
  getMessageByMessageId(messageId: string): Promise<ScrapedMessage | undefined>;

  // Scrape metadata
  getScrapeMetadata(
    source: 'zulipchat' | 'telegram',
    channelName: string
  ): Promise<ScrapeMetadata | undefined>;
  createOrUpdateScrapeMetadata(
    metadata: Omit<InsertScrapeMetadata, 'id' | 'lastScrapeAt'>
  ): Promise<ScrapeMetadata>;
}

export class DatabaseStorage implements IStorage {
  // Documentation sections
  async getDocumentationSections(): Promise<DocumentationSection[]> {
    return await db.documentationSection.findMany({
      orderBy: { orderIndex: 'asc' },
    });
  }

  async getDocumentationSection(sectionId: string): Promise<DocumentationSection | undefined> {
    const section = await db.documentationSection.findUnique({
      where: { sectionId },
    });
    return section || undefined;
  }

  async createDocumentationSection(
    section: Omit<InsertDocumentationSection, 'id' | 'updatedAt'>
  ): Promise<DocumentationSection> {
    return await db.documentationSection.create({
      data: section as any,
    });
  }

  async updateDocumentationSection(
    sectionId: string,
    content: string
  ): Promise<DocumentationSection> {
    return await db.documentationSection.update({
      where: { sectionId },
      data: { content, updatedAt: new Date() },
    });
  }

  // Pending updates
  async getPendingUpdates(): Promise<PendingUpdate[]> {
    return await db.pendingUpdate.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPendingUpdate(id: string): Promise<PendingUpdate | undefined> {
    const update = await db.pendingUpdate.findUnique({
      where: { id },
    });
    return update || undefined;
  }

  async updatePendingUpdate(
    id: string,
    data: { summary?: string; diffAfter?: string }
  ): Promise<PendingUpdate | undefined> {
    const updated = await db.pendingUpdate.update({
      where: { id },
      data,
    });
    return updated || undefined;
  }

  async createPendingUpdate(
    update: Omit<InsertPendingUpdate, 'id' | 'createdAt' | 'reviewedAt'>
  ): Promise<PendingUpdate> {
    return await db.pendingUpdate.create({
      data: update as any,
    });
  }

  async updatePendingUpdateStatus(
    id: string,
    status: 'pending' | 'approved' | 'rejected' | 'auto_applied',
    reviewedBy?: string
  ): Promise<PendingUpdate | undefined> {
    const updated = await db.pendingUpdate.update({
      where: { id },
      data: {
        status,
        reviewedAt: new Date(),
        reviewedBy: reviewedBy || null,
      },
    });
    return updated || undefined;
  }

  // Update history
  async createUpdateHistory(
    history: Omit<InsertUpdateHistory, 'id' | 'performedAt'>
  ): Promise<UpdateHistory> {
    return await db.updateHistory.create({
      data: {
        updateId: history.updateId,
        action: history.action,
        performedBy: history.performedBy || null,
      },
    });
  }

  async getUpdateHistory(): Promise<UpdateHistory[]> {
    return await db.updateHistory.findMany({
      orderBy: { performedAt: 'desc' },
    });
  }

  // Section versions
  async createSectionVersion(
    version: Omit<InsertSectionVersion, 'id' | 'createdAt'>
  ): Promise<SectionVersion> {
    return await db.sectionVersion.create({
      data: version as any,
    });
  }

  async getSectionHistory(sectionId: string): Promise<SectionVersion[]> {
    return await db.sectionVersion.findMany({
      where: { sectionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async rollbackSection(
    sectionId: string,
    versionId: string,
    performedBy?: string
  ): Promise<{ section: DocumentationSection; version: SectionVersion }> {
    return await db.$transaction(async (tx) => {
      // Get the target version to restore
      const targetVersion = await tx.sectionVersion.findUnique({
        where: { id: versionId },
      });

      if (!targetVersion) {
        throw new Error('Version not found');
      }

      if (targetVersion.sectionId !== sectionId) {
        throw new Error('Version does not belong to this section');
      }

      // Get latest version before rollback for parentVersionId
      const latestVersion = await tx.sectionVersion.findFirst({
        where: { sectionId },
        orderBy: { createdAt: 'desc' },
      });

      // Check if section currently exists
      const existingSection = await tx.documentationSection.findUnique({
        where: { sectionId },
      });

      let section: DocumentationSection;

      if (existingSection) {
        // Update existing section
        section = await tx.documentationSection.update({
          where: { sectionId },
          data: {
            title: targetVersion.title,
            content: targetVersion.content,
            level: targetVersion.level,
            type: targetVersion.type,
            orderIndex: targetVersion.orderIndex,
            updatedAt: new Date(),
          },
        });
      } else {
        // Reinsert deleted section
        section = await tx.documentationSection.create({
          data: {
            sectionId: targetVersion.sectionId,
            title: targetVersion.title,
            content: targetVersion.content,
            level: targetVersion.level,
            type: targetVersion.type,
            orderIndex: targetVersion.orderIndex,
          },
        });
      }

      // Create rollback version snapshot
      const rollbackVersion = await tx.sectionVersion.create({
        data: {
          sectionId: targetVersion.sectionId,
          title: targetVersion.title,
          content: targetVersion.content,
          level: targetVersion.level,
          type: targetVersion.type,
          orderIndex: targetVersion.orderIndex,
          op: 'rollback',
          parentVersionId: latestVersion?.id || null,
          fromUpdateId: null,
          fromHistoryId: null,
          createdBy: performedBy || null,
        },
      });

      return { section, version: rollbackVersion };
    });
  }

  // Transactional approval: apply documentation change, update status, and log history
  async approveUpdate(
    updateId: string,
    reviewedBy?: string
  ): Promise<{ update: PendingUpdate; section: DocumentationSection; history: UpdateHistory }> {
    return await db.$transaction(async (tx) => {
      // Get the pending update
      const update = await tx.pendingUpdate.findUnique({
        where: { id: updateId },
      });

      if (!update) {
        throw new Error('Update not found');
      }

      // Enforce status='pending' - cannot approve already processed updates
      if (update.status !== 'pending') {
        throw new Error('Cannot approve update: status must be pending');
      }

      // Get latest version for parentVersionId
      const latestVersion = await tx.sectionVersion.findFirst({
        where: { sectionId: update.sectionId },
        orderBy: { createdAt: 'desc' },
      });

      // Handle different operation types
      let section: DocumentationSection | undefined;
      let versionOp: 'add' | 'edit' | 'delete';

      if (update.type === 'add') {
        // Create a new section
        if (!update.diffAfter) {
          throw new Error('Cannot add section: no content provided');
        }

        // Extract title from summary or use section ID
        const titleMatch = update.summary.match(/Add new section: "([^"]+)"/);
        const title = titleMatch
          ? titleMatch[1]
          : update.sectionId.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());

        // Get the max orderIndex to place new section at the end
        const sections = await tx.documentationSection.findMany();
        const maxOrder = Math.max(...sections.map((s) => s.orderIndex), 0);

        section = await tx.documentationSection.create({
          data: {
            sectionId: update.sectionId,
            title,
            content: update.diffAfter,
            level: 1, // Default to top level
            orderIndex: maxOrder + 1,
          },
        });
        versionOp = 'add';
      } else if (update.type === 'delete') {
        // Delete an existing section - capture snapshot before deletion
        const existing = await tx.documentationSection.findUnique({
          where: { sectionId: update.sectionId },
        });

        if (!existing) {
          throw new Error('Cannot delete section: section not found');
        }

        section = existing;
        versionOp = 'delete';

        // Delete the section AFTER we have the snapshot
        await tx.documentationSection.delete({
          where: { sectionId: update.sectionId },
        });
      } else {
        // Update existing section (minor or major)
        if (update.diffAfter) {
          section = await tx.documentationSection.update({
            where: { sectionId: update.sectionId },
            data: { content: update.diffAfter, updatedAt: new Date() },
          });
        } else {
          const existing = await tx.documentationSection.findUnique({
            where: { sectionId: update.sectionId },
          });
          section = existing || undefined;
        }

        if (!section) {
          throw new Error('Documentation section not found');
        }
        versionOp = 'edit';
      }

      // Mark update as approved
      const approvedUpdate = await tx.pendingUpdate.update({
        where: { id: updateId },
        data: {
          status: 'approved',
          reviewedAt: new Date(),
          reviewedBy: reviewedBy || null,
        },
      });

      // Create history record
      const newHistory = await tx.updateHistory.create({
        data: {
          updateId,
          action: 'approved',
          performedBy: reviewedBy || null,
        },
      });

      // Ensure section was assigned (should always be true based on logic above)
      if (!section) {
        throw new Error('Internal error: section not assigned');
      }

      // Create version snapshot
      await tx.sectionVersion.create({
        data: {
          sectionId: section.sectionId,
          title: section.title,
          content: section.content,
          level: section.level,
          type: section.type,
          orderIndex: section.orderIndex,
          op: versionOp,
          parentVersionId: latestVersion?.id || null,
          fromUpdateId: updateId,
          fromHistoryId: newHistory.id,
          createdBy: reviewedBy || null,
        },
      });

      return { update: approvedUpdate, section, history: newHistory };
    });
  }

  // Transactional rejection: update status and log history
  async rejectUpdate(
    updateId: string,
    reviewedBy?: string
  ): Promise<{ update: PendingUpdate; history: UpdateHistory }> {
    return await db.$transaction(async (tx) => {
      // Get the pending update
      const update = await tx.pendingUpdate.findUnique({
        where: { id: updateId },
      });

      if (!update) {
        throw new Error('Update not found');
      }

      // Enforce status='pending' - cannot reject already processed updates
      if (update.status !== 'pending') {
        throw new Error('Cannot reject update: status must be pending');
      }

      // Mark update as rejected
      const rejectedUpdate = await tx.pendingUpdate.update({
        where: { id: updateId },
        data: {
          status: 'rejected',
          reviewedAt: new Date(),
          reviewedBy: reviewedBy || null,
        },
      });

      // Create history record
      const newHistory = await tx.updateHistory.create({
        data: {
          updateId,
          action: 'rejected',
          performedBy: reviewedBy || null,
        },
      });

      return { update: rejectedUpdate, history: newHistory };
    });
  }

  // Scraped messages
  async getScrapedMessages(): Promise<ScrapedMessage[]> {
    return await db.scrapedMessage.findMany({
      orderBy: { messageTimestamp: 'desc' },
    });
  }

  async getUnanalyzedMessages(): Promise<ScrapedMessage[]> {
    return await db.scrapedMessage.findMany({
      where: { analyzed: false },
      orderBy: { messageTimestamp: 'asc' },
    });
  }

  async createScrapedMessage(
    message: Omit<InsertScrapedMessage, 'id' | 'scrapedAt'>
  ): Promise<ScrapedMessage> {
    return await db.scrapedMessage.create({
      data: message as any,
    });
  }

  async markMessageAsAnalyzed(id: string): Promise<ScrapedMessage | undefined> {
    const updated = await db.scrapedMessage.update({
      where: { id },
      data: { analyzed: true },
    });
    return updated || undefined;
  }

  async getMessageByMessageId(messageId: string): Promise<ScrapedMessage | undefined> {
    const message = await db.scrapedMessage.findUnique({
      where: { messageId },
    });
    return message || undefined;
  }

  // Scrape metadata
  async getScrapeMetadata(
    source: 'zulipchat' | 'telegram',
    channelName: string
  ): Promise<ScrapeMetadata | undefined> {
    const metadata = await db.scrapeMetadata.findFirst({
      where: {
        source,
        channelName,
      },
    });
    return metadata || undefined;
  }

  async createOrUpdateScrapeMetadata(
    metadata: Omit<InsertScrapeMetadata, 'id' | 'lastScrapeAt'>
  ): Promise<ScrapeMetadata> {
    const existing = await this.getScrapeMetadata(metadata.source, metadata.channelName);

    if (existing) {
      // Update existing record
      return await db.scrapeMetadata.update({
        where: { id: existing.id },
        data: {
          lastMessageId: metadata.lastMessageId,
          lastScrapeTimestamp: metadata.lastScrapeTimestamp,
          lastScrapeAt: new Date(),
          totalMessagesFetched:
            (existing.totalMessagesFetched ?? 0) + (metadata.totalMessagesFetched ?? 0),
        },
      });
    } else {
      // Create new record
      return await db.scrapeMetadata.create({
        data: metadata as any,
      });
    }
  }
}

export const storage = new DatabaseStorage();
