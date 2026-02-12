/**
 * Pipeline Context Factory
 *
 * Creates and initializes pipeline context for batch processing.
 *

 * @created 2025-12-30
 */

import type { PrismaClient } from '@prisma/client';
import type {
  PipelineContext,
  PipelineMetrics,
  IDomainConfig,
  IPromptRegistry,
  ILLMHandler,
  IRagService,
  UnifiedMessage,
} from './interfaces.js';

/**
 * Options for creating a pipeline context
 */
export interface CreateContextOptions {
  instanceId: string;
  batchId: string;
  streamId: string;
  messages: UnifiedMessage[];
  contextMessages?: UnifiedMessage[];
  domainConfig: IDomainConfig;
  prompts: IPromptRegistry;
  llmHandler: ILLMHandler;
  ragService: IRagService;
  db: PrismaClient;
}

/**
 * Creates an initial pipeline metrics object
 */
export function createInitialMetrics(): PipelineMetrics {
  return {
    totalDurationMs: 0,
    stepDurations: new Map(),
    llmCalls: 0,
    llmTokensUsed: 0,
    llmCostUSD: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };
}

/**
 * Creates a new pipeline context
 */
export function createPipelineContext(options: CreateContextOptions): PipelineContext {
  return {
    // Input data
    instanceId: options.instanceId,
    batchId: options.batchId,
    streamId: options.streamId,
    messages: options.messages,
    contextMessages: options.contextMessages || [],

    // Configuration
    domainConfig: options.domainConfig,
    prompts: options.prompts,

    // Intermediate state (initialized empty, populated by steps)
    filteredMessages: [...options.messages], // Start with all messages
    threads: [],
    ragResults: new Map(),
    proposals: new Map(),

    // Services
    llmHandler: options.llmHandler,
    ragService: options.ragService,
    db: options.db,

    // Metadata
    metrics: createInitialMetrics(),
    errors: [],

    // Debug logging for LLM calls
    stepPromptLogs: new Map(),
  };
}

/**
 * Clones a pipeline context (shallow clone of maps)
 */
export function clonePipelineContext(context: PipelineContext): PipelineContext {
  return {
    ...context,
    filteredMessages: [...context.filteredMessages],
    threads: [...context.threads],
    ragResults: new Map(context.ragResults),
    proposals: new Map(context.proposals),
    metrics: {
      ...context.metrics,
      stepDurations: new Map(context.metrics.stepDurations),
    },
    errors: [...context.errors],
    stepPromptLogs: new Map(context.stepPromptLogs),
  };
}

/**
 * Serializes metrics for logging/storage
 */
export function serializeMetrics(metrics: PipelineMetrics): Record<string, unknown> {
  return {
    totalDurationMs: metrics.totalDurationMs,
    stepDurations: Object.fromEntries(metrics.stepDurations),
    llmCalls: metrics.llmCalls,
    llmTokensUsed: metrics.llmTokensUsed,
    llmCostUSD: metrics.llmCostUSD,
    cacheHits: metrics.cacheHits,
    cacheMisses: metrics.cacheMisses,
  };
}
