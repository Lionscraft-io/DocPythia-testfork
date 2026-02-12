/**
 * Multi-Stream Scanner Types
 * Core type definitions for the multi-stream message scanning system

 * Date: 2025-10-30
 * Reference: /docs/specs/multi-stream-scanner-phase-1.md
 */

// ========== Documentation Index Types ==========

export interface DocumentationPageIndex {
  title: string;
  path: string;
  sections: string[];
  summary: string;
  last_updated: Date;
}

export interface DocumentationIndex {
  pages: DocumentationPageIndex[];
  categories: Record<string, string[]>; // category -> page paths
  generated_at: Date;
}

export interface ProjectContext {
  project_name: string;
  project_description: string;
  doc_purpose: string;
  target_audience: string;
  style_guide: string;
  doc_index: DocumentationIndex;
}

// ========== Stream Adapter Types ==========

export interface StreamMessage {
  messageId: string;
  timestamp: Date;
  author: string;
  content: string;
  channel?: string;
  rawData: any;
  metadata?: Record<string, any>;
}

export interface StreamWatermark {
  lastProcessedTime?: Date;
  lastProcessedId?: string;
  totalProcessed: number;
}

export interface StreamAdapter {
  readonly streamId: string;
  readonly adapterType: string;

  /**
   * Initialize the adapter with configuration
   */
  initialize(config: any): Promise<void>;

  /**
   * Fetch messages since the last watermark
   */
  fetchMessages(watermark?: StreamWatermark, batchSize?: number): Promise<StreamMessage[]>;

  /**
   * Get the current watermark for this stream
   */
  getWatermark(): Promise<StreamWatermark>;

  /**
   * Update the watermark after processing messages
   */
  updateWatermark(timestamp: Date, messageId: string, count: number): Promise<void>;

  /**
   * Validate adapter configuration
   */
  validateConfig(config: any): boolean;

  /**
   * Clean up resources
   */
  cleanup(): Promise<void>;
}

// ========== Message Processing Types ==========

export type ProposalStatus = 'pending' | 'approved' | 'ignored';

export interface MessageClassification {
  category: string;
  docValue: boolean;
  docValueReason?: string;
  suggestedDocPage?: string;
  ragSearchCriteria?: any;
  confidence: number;
  modelUsed: string;
}

export interface RAGContext {
  retrievedDocs: Array<{
    doc_id: number;
    title: string;
    content: string;
    similarity: number;
  }>;
  totalTokens?: number;
}

export interface DocProposal {
  page: string;
  updateType: 'INSERT' | 'UPDATE' | 'DELETE' | 'NONE';
  section?: string;
  location?: {
    lineStart?: number;
    lineEnd?: number;
    sectionName?: string;
  };
  suggestedText?: string;
  sourceConversation?: any; // Context messages
  confidence: number;
  reasoning?: string;
  modelUsed: string;
  // Workflow fields
  status?: ProposalStatus;
  editedText?: string;
  editedAt?: Date;
  editedBy?: string;
  // Admin fields
  adminApproved?: boolean;
  adminReviewedAt?: Date;
  adminReviewedBy?: string;
}

// ========== LLM Service Types ==========

export enum LLMModel {
  FLASH = 'gemini-2.5-flash',
  PRO = 'gemini-2.5-pro',
  // PRO_2 removed - was duplicate of PRO (gemini-exp-1206 deprecated, consolidated to 2.5-pro)
}

export interface LLMRequest {
  model: string; // Allow any model name, not just enum values
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  history?: Array<{ role: string; content: string }>; // Conversation history for multi-turn requests
}

export interface LLMResponse {
  content: string;
  modelUsed: string;
  tokensUsed?: number;
  finishReason?: string;
}

// ========== Configuration Types ==========

export interface StreamConfig {
  streamId: string;
  adapterType: string;
  config: any;
  enabled: boolean;
  schedule?: string;
}

export interface ProcessorConfig {
  batchSize: number;
  classificationModel: string; // Allow any model name, not just enum values
  proposalModel: string; // Allow any model name, not just enum values
  ragTopK: number;
  minConfidence: number;
}

// ========== Admin Dashboard Types ==========

export interface AdminMessageAnalysis {
  id: number;
  streamId: string;
  messageId: string;
  timestamp: Date;
  author: string;
  content: string;
  channel?: string;

  // Classification
  category?: string;
  docValue?: boolean;
  docValueReason?: string;
  suggestedDocPage?: string;
  batchId?: string;

  // Proposal
  proposedPage?: string;
  updateType?: string;
  suggestedText?: string;
  proposalConfidence?: number;

  // Admin approval (replaces automated review)
  adminApproved?: boolean;
  adminReviewedAt?: Date;
  adminReviewedBy?: string;

  // RAG
  ragDocsCount?: number;

  createdAt: Date;
}
