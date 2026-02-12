/**
 * Core Pipeline Interfaces
 *
 * Defines the foundational interfaces for the customizable analysis pipeline.
 * These interfaces enable dependency injection, testability, and extensibility.
 *

 * @created 2025-12-30
 */

import type { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

// ============================================================================
// Step Types
// ============================================================================

/**
 * Types of pipeline steps
 */
export enum StepType {
  FILTER = 'filter',
  CLASSIFY = 'classify',
  ENRICH = 'enrich',
  GENERATE = 'generate',
  TRANSFORM = 'transform',
  /** Validates content format and uses LLM to fix on failure */
  VALIDATE = 'validate',
  /** Condenses overly long proposals using LLM */
  CONDENSE = 'condense',
  /** Enriches proposals with context analysis for review */
  CONTEXT_ENRICH = 'context-enrich',
  /** Applies tenant ruleset: rejection, modifications, quality gates */
  RULESET_REVIEW = 'ruleset-review',
}

/**
 * Configuration for a single pipeline step
 */
export interface StepConfig {
  stepId: string;
  stepType: StepType;
  enabled: boolean;
  config: Record<string, unknown>;
}

/**
 * Metadata about a pipeline step
 */
export interface StepMetadata {
  name: string;
  description: string;
  version: string;
  author?: string;
}

// ============================================================================
// Pipeline Step Interface
// ============================================================================

/**
 * Base interface for all pipeline steps
 */
export interface IPipelineStep {
  /**
   * Unique identifier for this step
   */
  readonly stepId: string;

  /**
   * Step type for factory instantiation
   */
  readonly stepType: StepType;

  /**
   * Execute this step with the given context
   * @param context - Shared pipeline context
   * @returns Updated context (may mutate in-place)
   */
  execute(context: PipelineContext): Promise<PipelineContext>;

  /**
   * Validate step configuration
   * @param config - Step-specific configuration
   */
  validateConfig(config: StepConfig): boolean;

  /**
   * Get step metadata for logging/debugging
   */
  getMetadata(): StepMetadata;
}

// ============================================================================
// LLM Handler Interface
// ============================================================================

/**
 * Request structure for LLM calls
 */
export interface LLMRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  history?: ConversationMessage[];
}

/**
 * Conversation message for history
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Context passed to LLM handler for tracking
 */
export interface LLMContext {
  instanceId: string;
  batchId?: string;
  conversationId?: string;
  purpose: string; // e.g., 'classification', 'proposal'
}

/**
 * Response from LLM handler
 */
export interface LLMResponse {
  text: string;
  tokensUsed?: number;
  finishReason?: string;
  model: string;
  cached?: boolean;
}

/**
 * Model capabilities information
 */
export interface ModelInfo {
  provider: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  supportsFunctionCalling: boolean;
  supportsStreaming: boolean;
}

/**
 * Cost estimation for a request
 */
export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
}

/**
 * Interface for LLM provider abstraction
 */
export interface ILLMHandler {
  /**
   * Provider name (e.g., 'gemini', 'openai', 'anthropic')
   */
  readonly name: string;

  /**
   * Generate structured JSON response
   */
  requestJSON<T>(
    request: LLMRequest,
    responseSchema: z.ZodSchema<T>,
    context: LLMContext
  ): Promise<{ data: T; response: LLMResponse }>;

  /**
   * Generate text response
   */
  requestText(request: LLMRequest, context: LLMContext): Promise<LLMResponse>;

  /**
   * Get model capabilities
   */
  getModelInfo(model: string): ModelInfo;

  /**
   * Estimate cost for request
   */
  estimateCost(request: LLMRequest): CostEstimate;
}

// ============================================================================
// Prompt Registry Interface
// ============================================================================

/**
 * Metadata for a prompt template
 */
export interface PromptMetadata {
  author?: string;
  description: string;
  requiredVariables: string[];
  tags?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Prompt template structure
 */
export interface PromptTemplate {
  id: string;
  version: string;
  metadata: PromptMetadata;
  system: string;
  user: string;
}

/**
 * Rendered prompt with variables filled
 */
export interface RenderedPrompt {
  system: string;
  user: string;
  variables: Record<string, unknown>;
}

/**
 * Validation result for templates
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Interface for prompt template storage and retrieval
 */
export interface IPromptRegistry {
  /**
   * Get prompt template by ID
   */
  get(promptId: string): PromptTemplate | null;

  /**
   * Get rendered prompt with variables filled
   */
  render(promptId: string, variables: Record<string, unknown>): RenderedPrompt;

  /**
   * List all available prompts
   */
  list(): PromptTemplate[];

  /**
   * Reload prompts from storage (hot-reload)
   */
  reload(): Promise<void>;

  /**
   * Validate prompt template
   */
  validate(template: PromptTemplate): ValidationResult;
}

// ============================================================================
// Domain Configuration Interface
// ============================================================================

/**
 * Category definition for classification
 */
export interface CategoryDefinition {
  id: string;
  label: string;
  description: string;
  priority: number; // 0-100, higher = more important
  examples?: string[];
}

/**
 * Keyword-based pre-filtering
 */
export interface KeywordFilter {
  include?: string[]; // Messages must contain at least one
  exclude?: string[]; // Messages containing any are filtered out
  caseSensitive?: boolean;
}

/**
 * RAG document path filtering
 */
export interface PathFilter {
  include?: string[]; // Glob patterns for RAG docs to include
  exclude?: string[]; // Glob patterns for RAG docs to exclude
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  blockPatterns?: string[]; // Regex patterns to block
  requireApproval?: boolean; // All proposals require manual approval
  maxProposalsPerBatch?: number;
}

/**
 * Domain context for prompts
 */
export interface DomainContext {
  projectName: string;
  domain: string;
  targetAudience: string;
  documentationPurpose: string;
}

/**
 * Domain-specific configuration
 */
export interface IDomainConfig {
  domainId: string;
  name: string;
  description?: string;

  /**
   * Classification categories for this domain
   */
  categories: CategoryDefinition[];

  /**
   * Keyword-based pre-filtering
   */
  keywords?: KeywordFilter | null;

  /**
   * RAG document path filtering
   */
  ragPaths?: PathFilter;

  /**
   * Security rules
   */
  security?: SecurityConfig;

  /**
   * Domain context injected into prompts
   */
  context: DomainContext;
}

// ============================================================================
// Pipeline Context
// ============================================================================

/**
 * Unified message structure (matches database model)
 */
export interface UnifiedMessage {
  id: number;
  messageId: string;
  streamId: string;
  timestamp: Date;
  author: string;
  authorId?: string;
  content: string;
  conversationId?: string;
  replyToId?: string;
  processingStatus: string;
}

/**
 * Conversation thread after classification
 */
export interface ConversationThread {
  id: string;
  category: string;
  messageIds: number[];
  summary: string;
  docValueReason: string;
  ragSearchCriteria: {
    keywords: string[];
    semanticQuery: string;
  };
}

/**
 * RAG document from vector search
 */
export interface RagDocument {
  id: number;
  filePath: string;
  title: string;
  content: string;
  similarity: number;
}

/**
 * Documentation change proposal
 */
export interface Proposal {
  updateType: 'INSERT' | 'UPDATE' | 'DELETE' | 'NONE';
  page: string;
  section?: string;
  suggestedText?: string;
  reasoning: string;
  sourceMessages?: number[];
  warnings?: string[];
}

/**
 * Pipeline execution metrics
 */
export interface PipelineMetrics {
  totalDurationMs: number;
  stepDurations: Map<string, number>;
  llmCalls: number;
  llmTokensUsed: number;
  llmCostUSD: number;
  cacheHits: number;
  cacheMisses: number;
}

/**
 * Pipeline execution error
 */
export interface PipelineError {
  stepId: string;
  message: string;
  error: Error;
  context: Record<string, unknown>;
}

/**
 * RAG service interface for message vector search
 */
export interface IRagService {
  searchSimilarDocs(query: string, topK: number): Promise<RagDocument[]>;
}

/**
 * LLM call log entry for debugging (legacy single-entry format)
 */
export interface StepPromptLog {
  promptId: string;
  template: { system: string; user: string };
  resolved: { system: string; user: string };
  response: string;
}

/**
 * Multi-entry prompt/query log for pipeline debugging.
 * Supports both LLM calls and RAG vector searches.
 */
export interface StepPromptLogEntry {
  /** Human-readable label, e.g. "Thread: bug-discussion" or "RAG: thread_xxx" */
  label: string;
  /** Type of interaction being logged */
  entryType: 'llm-call' | 'rag-query';
  // LLM call fields
  promptId?: string;
  template?: { system: string; user: string };
  resolved?: { system: string; user: string };
  response?: string;
  // RAG query fields
  query?: string;
  resultCount?: number;
  results?: Array<{ filePath: string; title: string; similarity: number }>;
}

/**
 * Shared context passed through pipeline steps
 */
export interface PipelineContext {
  // Input data
  messages: UnifiedMessage[];
  contextMessages: UnifiedMessage[];
  batchId: string;
  streamId: string;
  instanceId: string;

  // Configuration
  domainConfig: IDomainConfig;
  prompts: IPromptRegistry;

  // Intermediate state (mutated by steps)
  filteredMessages: UnifiedMessage[];
  threads: ConversationThread[];
  ragResults: Map<string, RagDocument[]>;
  proposals: Map<string, Proposal[]>;

  // Services (injected)
  llmHandler: ILLMHandler;
  ragService: IRagService;
  db: PrismaClient;

  // Metadata
  metrics: PipelineMetrics;
  errors: PipelineError[];

  // Debug logging for LLM/RAG calls (populated by steps, read by orchestrator)
  stepPromptLogs: Map<string, StepPromptLogEntry[]>;
}

// ============================================================================
// Pipeline Orchestrator Interface
// ============================================================================

/**
 * Error handling configuration
 */
export interface ErrorHandlingConfig {
  stopOnError: boolean;
  retryAttempts: number;
  retryDelayMs: number;
}

/**
 * Performance configuration
 */
export interface PerformanceConfig {
  maxConcurrentSteps: number;
  timeoutMs: number;
  enableCaching: boolean;
}

/**
 * Full pipeline configuration
 */
export interface PipelineConfig {
  instanceId: string;
  pipelineId: string;
  description?: string;
  steps: StepConfig[];
  errorHandling: ErrorHandlingConfig;
  performance: PerformanceConfig;
}

/**
 * Result of pipeline execution
 */
export interface PipelineResult {
  success: boolean;
  messagesProcessed: number;
  threadsCreated: number;
  proposalsGenerated: number;
  errors: PipelineError[];
  metrics: PipelineMetrics;
}

/**
 * Factory for creating pipeline steps
 */
export interface StepFactory {
  create(config: StepConfig, llmHandler: ILLMHandler): IPipelineStep;
}

/**
 * Orchestrates pipeline execution
 */
export interface IPipelineOrchestrator {
  /**
   * Execute pipeline with given context
   */
  execute(context: PipelineContext): Promise<PipelineResult>;

  /**
   * Get pipeline configuration
   */
  getConfig(): PipelineConfig;

  /**
   * Register custom step factory
   */
  registerStep(
    stepType: string,
    creator: (config: StepConfig, llmHandler: ILLMHandler) => IPipelineStep
  ): void;

  /**
   * Get execution metrics
   */
  getMetrics(): PipelineMetrics;
}
