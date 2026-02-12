/**
 * Shared schema types for DocPythia
 *
 * These types are used by the client-side code for type safety.
 * The actual database schema is managed by Prisma in prisma/schema.prisma.
 */

// Enum types
export type SectionType = 'text' | 'info' | 'warning' | 'success';
export type UpdateType = 'minor' | 'major' | 'add' | 'delete';
export type UpdateStatus = 'pending' | 'approved' | 'rejected' | 'auto-applied';
export type ActionType = 'approved' | 'rejected' | 'auto-applied';
export type MessageSource = 'zulipchat' | 'telegram';
export type VersionOp = 'add' | 'edit' | 'delete' | 'rollback';

// Documentation section type
export interface DocumentationSection {
  id: string;
  sectionId: string;
  title: string;
  content: string;
  level: number | null;
  type: SectionType | null;
  orderIndex: number;
  updatedAt: Date | string;
}

// Pending update type
export interface PendingUpdate {
  id: string;
  sectionId: string;
  type: UpdateType;
  summary: string;
  source: string;
  status: UpdateStatus;
  diffBefore: string | null;
  diffAfter: string | null;
  createdAt: Date | string;
  reviewedAt: Date | string | null;
  reviewedBy: string | null;
}

// Update history type
export interface UpdateHistory {
  id: string;
  updateId: string;
  action: ActionType;
  performedAt: Date | string;
  performedBy: string | null;
}

// Scraped message type
export interface ScrapedMessage {
  id: string;
  messageId: string;
  source: MessageSource;
  channelName: string;
  topicName: string | null;
  senderEmail: string | null;
  senderName: string | null;
  content: string;
  messageTimestamp: Date | string;
  scrapedAt: Date | string;
  analyzed: boolean;
}

// Scrape metadata type
export interface ScrapeMetadata {
  id: string;
  source: MessageSource;
  channelName: string;
  lastMessageId: string | null;
  lastScrapeTimestamp: Date | string | null;
  lastScrapeAt: Date | string;
  totalMessagesFetched: number;
}

// Section version type for rollback functionality
export interface SectionVersion {
  id: string;
  sectionId: string;
  title: string;
  content: string;
  level: number | null;
  type: SectionType | null;
  orderIndex: number;
  op: VersionOp;
  parentVersionId: string | null;
  fromUpdateId: string | null;
  fromHistoryId: string | null;
  createdAt: Date | string;
  createdBy: string | null;
}

// Insert types (for creating new records)
export type InsertDocumentationSection = Omit<DocumentationSection, 'id' | 'updatedAt'>;
export type InsertPendingUpdate = Omit<PendingUpdate, 'id' | 'createdAt' | 'reviewedAt'>;
export type InsertUpdateHistory = Omit<UpdateHistory, 'id' | 'performedAt'>;
export type InsertScrapedMessage = Omit<ScrapedMessage, 'id' | 'scrapedAt'>;
export type InsertScrapeMetadata = Omit<ScrapeMetadata, 'id' | 'lastScrapeAt'>;
export type InsertSectionVersion = Omit<SectionVersion, 'id' | 'createdAt'>;
