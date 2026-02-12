/**
 * Batch Message Processor
 *
 * Implements Phase 1 batch processing architecture:
 * - Dual watermark system (import + processing)
 * - 24-hour batch windows with 24-hour context
 * - Batch classification for efficiency
 * - Proposal generation only for valuable messages
 * - Multi-instance aware: Each instance has its own batch processor
 *

 * Date: 2025-10-31
 * Updated: 2025-11-14 - Multi-instance support
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { MessageVectorSearch } from '../message-vector-search.js';
import { InstanceConfigLoader } from '../../config/instance-loader.js';
import { createLogger } from '../../utils/logger.js';
import { postProcessProposal } from '../../pipeline/utils/ProposalPostProcessor.js';

// Pipeline integration imports
import {
  loadPipelineConfig,
  clearPipelineConfigCache,
} from '../../pipeline/config/PipelineConfigLoader.js';
import { loadDomainConfig } from '../../pipeline/config/DomainConfigLoader.js';
import { PipelineOrchestrator } from '../../pipeline/core/PipelineOrchestrator.js';
import { createPipelineContext } from '../../pipeline/core/PipelineContext.js';
import { createPromptRegistry, PromptRegistry } from '../../pipeline/prompts/PromptRegistry.js';
import { createGeminiHandler, GeminiHandler } from '../../pipeline/handlers/GeminiHandler.js';
import type {
  PipelineConfig,
  Proposal as PipelineProposal,
  IDomainConfig,
  ConversationThread,
  UnifiedMessage as PipelineUnifiedMessage,
} from '../../pipeline/core/interfaces.js';
import { parseRuleset, hasRules, type ParsedRuleset } from '../../pipeline/types/ruleset.js';
import {
  type ProposalEnrichment,
  type RelatedDoc,
  type StyleMetrics,
  createEmptyEnrichment,
  textAnalysis,
} from '../../pipeline/types/enrichment.js';

const logger = createLogger('BatchProcessor');

// ========== Proposal Generation Interface ==========

interface ProposalGeneration {
  updateType: 'INSERT' | 'UPDATE' | 'DELETE' | 'NONE';
  page: string;
  section?: string;
  location?: {
    lineStart?: number;
    lineEnd?: number;
    sectionName?: string;
  };
  suggestedText?: string;
  reasoning: string;
  sourceMessages?: number[];
  warnings?: string[];
}

/**
 * Extended proposal with enrichment and review data
 */
interface EnrichedProposal extends ProposalGeneration {
  enrichment?: ProposalEnrichment;
  reviewResult?: {
    rejected: boolean;
    rejectionReason?: string;
    rejectionRule?: string;
    modificationsApplied: string[];
    qualityFlags: string[];
    modifiedContent?: string;
    originalContent?: string;
  };
}

// ========== Conversation Grouping Types ==========

interface ConversationGroup {
  id: string;
  channel: string | null;
  summary: string; // Thread summary from LLM
  messages: Array<{
    messageId: number;
    timestamp: Date;
    author: string;
    content: string;
    category: string;
    docValueReason: string;
    suggestedDocPage?: string;
    ragSearchCriteria?: any;
  }>;
  timeStart: Date;
  timeEnd: Date;
  messageCount: number;
}

// ========== Configuration ==========

interface BatchProcessorConfig {
  batchWindowHours: number; // 24 hours
  contextWindowHours: number; // 24 hours (previous batch)
  maxBatchSize: number; // Maximum messages per batch
  classificationModel: string;
  proposalModel: string;
  ragTopK: number; // Number of docs to retrieve for RAG
  conversationTimeWindowMinutes: number; // Time window for grouping messages into conversations
  maxConversationSize: number; // Maximum messages per conversation
  minConversationGapMinutes: number; // Minimum gap to start new conversation
}

const DEFAULT_CONFIG: BatchProcessorConfig = {
  batchWindowHours: 24,
  contextWindowHours: 24,
  maxBatchSize: 30, // Reduced from 500 to prevent LLM from generating overly long responses
  classificationModel: process.env.LLM_CLASSIFICATION_MODEL || 'gemini-2.0-flash-exp',
  proposalModel: process.env.LLM_PROPOSAL_MODEL || 'gemini-1.5-pro',
  ragTopK: 5,
  conversationTimeWindowMinutes: 15,
  maxConversationSize: 20,
  minConversationGapMinutes: 5,
};

// ========== Batch Message Processor ==========

export class BatchMessageProcessor {
  private config: BatchProcessorConfig;
  private static isProcessing: boolean = false;
  private instanceId: string;
  private db: PrismaClient;
  private messageVectorSearch: MessageVectorSearch;

  // Pipeline integration
  private pipelineConfig: PipelineConfig | null = null;
  private promptRegistry: PromptRegistry | null = null;
  private llmHandler: GeminiHandler | null = null;
  private pipelineInitialized: boolean = false;

  // Quality system integration
  private cachedRuleset: ParsedRuleset | null = null;
  private rulesetLoadedAt: Date | null = null;
  private rulesetUpdatedAt: Date | null = null;
  private readonly RULESET_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(instanceId: string, db: PrismaClient, config: Partial<BatchProcessorConfig> = {}) {
    this.instanceId = instanceId;
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.messageVectorSearch = new MessageVectorSearch(instanceId, db);
    logger.info(`[${instanceId}] BatchMessageProcessor initialized`);
  }

  /**
   * Initialize pipeline components (lazy initialization)
   * Loads config from S3 if CONFIG_SOURCE=s3, otherwise from local files
   */
  private async initializePipeline(): Promise<void> {
    if (this.pipelineInitialized) return;

    try {
      const configBasePath = process.env.CONFIG_BASE_PATH || './config';

      // Load pipeline config (with S3 support) - use default-v1 for full pipeline
      this.pipelineConfig = await loadPipelineConfig(configBasePath, this.instanceId, 'default-v1');
      logger.info(`Loaded pipeline config: ${this.pipelineConfig.pipelineId}`, {
        steps: this.pipelineConfig.steps.map((s) => `${s.stepId}:${s.enabled}`),
      });

      // Initialize prompt registry
      this.promptRegistry = createPromptRegistry(configBasePath, this.instanceId);
      await this.promptRegistry.load();
      logger.debug(`Loaded ${this.promptRegistry.list().length} prompt templates`);

      // Initialize LLM handler
      this.llmHandler = createGeminiHandler();

      this.pipelineInitialized = true;
    } catch (error) {
      logger.warn('Failed to initialize pipeline, post-processing steps will be skipped:', error);
      this.pipelineInitialized = true; // Don't retry on every batch
    }
  }

  /**
   * Clear pipeline cache (useful for hot-reload of configs)
   */
  clearPipelineCache(): void {
    clearPipelineConfigCache();
    this.pipelineInitialized = false;
    this.pipelineConfig = null;
    this.promptRegistry = null;
    this.cachedRuleset = null;
    this.rulesetLoadedAt = null;
    this.rulesetUpdatedAt = null;
    logger.info('Pipeline cache cleared');
  }

  /**
   * Load tenant ruleset for PROMPT_CONTEXT injection
   * Cached for RULESET_CACHE_TTL_MS to avoid repeated DB queries
   */
  private async loadTenantRuleset(): Promise<ParsedRuleset | null> {
    // Check cache validity
    if (
      this.cachedRuleset &&
      this.rulesetLoadedAt &&
      Date.now() - this.rulesetLoadedAt.getTime() < this.RULESET_CACHE_TTL_MS
    ) {
      return this.cachedRuleset;
    }

    try {
      const ruleset = await this.db.tenantRuleset.findFirst({
        where: { tenantId: this.instanceId },
        orderBy: { updatedAt: 'desc' },
      });

      if (!ruleset || !ruleset.content) {
        logger.debug(`[${this.instanceId}] No tenant ruleset found`);
        this.cachedRuleset = null;
        this.rulesetLoadedAt = new Date();
        this.rulesetUpdatedAt = null;
        return null;
      }

      this.cachedRuleset = parseRuleset(ruleset.content);
      this.rulesetLoadedAt = new Date();
      this.rulesetUpdatedAt = ruleset.updatedAt;

      if (this.cachedRuleset.promptContext.length > 0) {
        logger.info(
          `[${this.instanceId}] Loaded ruleset with ${this.cachedRuleset.promptContext.length} PROMPT_CONTEXT rules`
        );
      }

      return this.cachedRuleset;
    } catch (error) {
      logger.warn(`[${this.instanceId}] Failed to load tenant ruleset:`, error);
      return null;
    }
  }

  /**
   * Run enrichment and ruleset review on proposals
   * Returns enriched proposals with review results
   */
  private async runEnrichmentAndReview(
    proposals: ProposalGeneration[],
    conversation: ConversationGroup,
    ragDocs: any[],
    ruleset: ParsedRuleset | null
  ): Promise<EnrichedProposal[]> {
    const enrichedProposals: EnrichedProposal[] = [];

    // Count pending proposals for context
    let pendingProposalCount = 0;
    try {
      pendingProposalCount = await this.db.docProposal.count({
        where: { status: 'pending' },
      });
    } catch {
      logger.warn('Could not fetch pending proposal count');
    }

    for (const proposal of proposals) {
      const enriched: EnrichedProposal = { ...proposal };

      // Skip enrichment for NONE type proposals
      if (proposal.updateType === 'NONE') {
        enrichedProposals.push(enriched);
        continue;
      }

      // 1. Run enrichment
      try {
        enriched.enrichment = this.enrichProposal(
          proposal,
          ragDocs,
          conversation.messages,
          pendingProposalCount
        );
        logger.debug(`Enriched proposal for ${proposal.page}`, {
          relatedDocs: enriched.enrichment.relatedDocs.length,
          duplicationDetected: enriched.enrichment.duplicationWarning.detected,
        });
      } catch (error) {
        logger.warn(`Failed to enrich proposal for ${proposal.page}:`, error);
        enriched.enrichment = createEmptyEnrichment();
      }

      // 2. Apply ruleset review if ruleset has rules
      if (ruleset && hasRules(ruleset)) {
        try {
          enriched.reviewResult = this.applyRulesetReview(ruleset, enriched);

          const reviewResult = enriched.reviewResult;
          if (reviewResult?.rejected) {
            logger.info(`Proposal for ${proposal.page} rejected by ruleset`, {
              rule: reviewResult.rejectionRule,
              reason: reviewResult.rejectionReason,
            });
          } else if (reviewResult?.qualityFlags && reviewResult.qualityFlags.length > 0) {
            logger.debug(`Proposal for ${proposal.page} flagged`, {
              flags: reviewResult.qualityFlags,
            });
          }
        } catch (error) {
          logger.warn(`Failed to apply ruleset review for ${proposal.page}:`, error);
        }
      }

      enrichedProposals.push(enriched);
    }

    return enrichedProposals;
  }

  /**
   * Enrich a single proposal with context analysis
   */
  private enrichProposal(
    proposal: ProposalGeneration,
    ragDocs: any[],
    messages: ConversationGroup['messages'],
    pendingProposalCount: number
  ): ProposalEnrichment {
    const enrichment = createEmptyEnrichment();

    // 1. Find related documentation
    enrichment.relatedDocs = this.findRelatedDocs(proposal, ragDocs);

    // 2. Check for duplication
    if (proposal.suggestedText) {
      enrichment.duplicationWarning = this.checkDuplication(proposal, ragDocs);
    }

    // 3. Analyze style consistency
    enrichment.styleAnalysis = this.analyzeStyle(proposal, ragDocs);

    // 4. Calculate change context
    enrichment.changeContext = this.calculateChangeContext(proposal, ragDocs, pendingProposalCount);

    // 5. Analyze source conversation
    enrichment.sourceAnalysis = this.analyzeSourceConversation(messages);

    return enrichment;
  }

  /**
   * Find related documentation for a proposal
   */
  private findRelatedDocs(proposal: ProposalGeneration, ragDocs: any[]): RelatedDoc[] {
    const relatedDocs: RelatedDoc[] = [];
    const seenPages = new Set<string>();
    const minSimilarity = 0.6;
    const maxDocs = 5;

    for (const doc of ragDocs) {
      if (doc.similarity >= minSimilarity && !seenPages.has(doc.filePath)) {
        const matchType =
          doc.filePath === proposal.page
            ? 'same-section'
            : doc.similarity >= 0.8
              ? 'semantic'
              : 'keyword';

        relatedDocs.push({
          page: doc.filePath,
          section: doc.title,
          similarityScore: doc.similarity,
          matchType: matchType as 'semantic' | 'keyword' | 'same-section',
          snippet: doc.content.slice(0, 200) + (doc.content.length > 200 ? '...' : ''),
        });
        seenPages.add(doc.filePath);

        if (relatedDocs.length >= maxDocs) break;
      }
    }

    return relatedDocs.sort((a, b) => b.similarityScore - a.similarityScore);
  }

  /**
   * Check for duplication with existing documentation
   */
  private checkDuplication(
    proposal: ProposalGeneration,
    ragDocs: any[]
  ): ProposalEnrichment['duplicationWarning'] {
    if (!proposal.suggestedText) {
      return { detected: false };
    }

    const duplicationThreshold = 50;
    let maxOverlap = 0;
    let matchingPage: string | undefined;
    let matchingSection: string | undefined;

    for (const doc of ragDocs) {
      const overlap = textAnalysis.ngramOverlap(proposal.suggestedText, doc.content, 3);

      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        matchingPage = doc.filePath;
        matchingSection = doc.title;
      }
    }

    return {
      detected: maxOverlap >= duplicationThreshold,
      matchingPage: maxOverlap >= duplicationThreshold ? matchingPage : undefined,
      matchingSection: maxOverlap >= duplicationThreshold ? matchingSection : undefined,
      overlapPercentage: maxOverlap,
    };
  }

  /**
   * Analyze style consistency between proposal and target page
   */
  private analyzeStyle(
    proposal: ProposalGeneration,
    ragDocs: any[]
  ): ProposalEnrichment['styleAnalysis'] {
    const targetDoc = ragDocs.find((d) => d.filePath === proposal.page);
    const targetContent = targetDoc?.content || '';
    const proposalContent = proposal.suggestedText || '';

    const targetPageStyle: StyleMetrics = {
      avgSentenceLength: textAnalysis.avgSentenceLength(targetContent),
      usesCodeExamples: textAnalysis.hasCodeExamples(targetContent),
      formatPattern: textAnalysis.detectFormatPattern(targetContent),
      technicalDepth: textAnalysis.estimateTechnicalDepth(targetContent),
    };

    const proposalStyle: StyleMetrics = {
      avgSentenceLength: textAnalysis.avgSentenceLength(proposalContent),
      usesCodeExamples: textAnalysis.hasCodeExamples(proposalContent),
      formatPattern: textAnalysis.detectFormatPattern(proposalContent),
      technicalDepth: textAnalysis.estimateTechnicalDepth(proposalContent),
    };

    const consistencyNotes: string[] = [];

    if (targetContent) {
      if (targetPageStyle.formatPattern !== proposalStyle.formatPattern) {
        consistencyNotes.push(
          `Format mismatch: target uses ${targetPageStyle.formatPattern}, proposal uses ${proposalStyle.formatPattern}`
        );
      }

      if (targetPageStyle.technicalDepth !== proposalStyle.technicalDepth) {
        consistencyNotes.push(
          `Technical depth mismatch: target is ${targetPageStyle.technicalDepth}, proposal is ${proposalStyle.technicalDepth}`
        );
      }

      if (targetPageStyle.usesCodeExamples && !proposalStyle.usesCodeExamples) {
        consistencyNotes.push('Target page uses code examples but proposal does not');
      }
    }

    return { targetPageStyle, proposalStyle, consistencyNotes };
  }

  /**
   * Calculate change impact context
   */
  private calculateChangeContext(
    proposal: ProposalGeneration,
    ragDocs: any[],
    pendingProposalCount: number
  ): ProposalEnrichment['changeContext'] {
    const targetDoc = ragDocs.find((d) => d.filePath === proposal.page);
    const targetContent = targetDoc?.content || '';
    const proposalContent = proposal.suggestedText || '';

    const targetCharCount = targetContent.length;
    const proposalCharCount = proposalContent.length;

    let changePercentage = 0;
    if (proposal.updateType === 'INSERT' || proposal.updateType === 'DELETE') {
      changePercentage = 100;
    } else if (targetCharCount > 0) {
      const diff = Math.abs(targetCharCount - proposalCharCount);
      changePercentage = Math.round((diff / targetCharCount) * 100);
    }

    return {
      targetSectionCharCount: targetCharCount,
      proposalCharCount: proposalCharCount,
      changePercentage: Math.min(changePercentage, 100),
      lastUpdated: null,
      otherPendingProposals: pendingProposalCount,
    };
  }

  /**
   * Analyze the source conversation
   */
  private analyzeSourceConversation(
    messages: ConversationGroup['messages']
  ): ProposalEnrichment['sourceAnalysis'] {
    if (messages.length === 0) {
      return {
        messageCount: 0,
        uniqueAuthors: 0,
        threadHadConsensus: false,
        conversationSummary: '',
      };
    }

    const uniqueAuthors = new Set(messages.map((m) => m.author)).size;
    const threadHadConsensus = uniqueAuthors >= 2 && messages.length >= 3;

    const allContent = messages.map((m) => m.content).join(' ');
    const conversationSummary =
      allContent.length > 200 ? allContent.slice(0, 200) + '...' : allContent || 'No content';

    return {
      messageCount: messages.length,
      uniqueAuthors,
      threadHadConsensus,
      conversationSummary,
    };
  }

  /**
   * Apply ruleset review rules to a proposal
   */
  private applyRulesetReview(
    ruleset: ParsedRuleset,
    proposal: EnrichedProposal
  ): EnrichedProposal['reviewResult'] {
    const result = {
      rejected: false,
      modificationsApplied: [] as string[],
      qualityFlags: [] as string[],
      originalContent: proposal.suggestedText || undefined,
    };

    const enrichment = proposal.enrichment;

    // 1. Check rejection rules
    for (const rule of ruleset.rejectionRules) {
      const ruleLower = rule.toLowerCase();

      // Check duplication-based rules
      if (enrichment?.duplicationWarning?.detected) {
        if (ruleLower.includes('duplicationwarning') && ruleLower.includes('overlappercentage')) {
          const thresholdMatch = rule.match(/>\s*(\d+)/);
          const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 80;

          if ((enrichment.duplicationWarning.overlapPercentage || 0) > threshold) {
            return {
              ...result,
              rejected: true,
              rejectionReason: `Duplicate content detected: ${enrichment.duplicationWarning.overlapPercentage}% overlap with ${enrichment.duplicationWarning.matchingPage}`,
              rejectionRule: rule,
            };
          }
        }
      }

      // Check similarity-based rules
      if (enrichment?.relatedDocs && ruleLower.includes('similarityscore')) {
        const thresholdMatch = rule.match(/>\s*(\d*\.?\d+)/);
        const threshold = thresholdMatch ? parseFloat(thresholdMatch[1]) : 0.85;

        for (const doc of enrichment.relatedDocs) {
          if (doc.similarityScore > threshold) {
            return {
              ...result,
              rejected: true,
              rejectionReason: `High similarity with existing doc: ${Math.round(doc.similarityScore * 100)}% match with ${doc.page}`,
              rejectionRule: rule,
            };
          }
        }
      }

      // Check content pattern rules
      if (proposal.suggestedText) {
        if (ruleLower.includes('proposals mentioning') || ruleLower.includes('containing')) {
          const patternMatch = rule.match(/(?:mentioning|containing)\s+["']?([^"']+)["']?/i);
          if (patternMatch) {
            const pattern = patternMatch[1].trim();
            if (proposal.suggestedText.toLowerCase().includes(pattern.toLowerCase())) {
              return {
                ...result,
                rejected: true,
                rejectionReason: `Content matches rejection pattern: "${pattern}"`,
                rejectionRule: rule,
              };
            }
          }
        }
      }
    }

    // 2. Check quality gates (flagging without rejection)
    for (const gate of ruleset.qualityGates) {
      const gateLower = gate.toLowerCase();

      if (
        enrichment?.styleAnalysis &&
        gateLower.includes('consistencynotes') &&
        (gateLower.includes('not empty') || gateLower.includes('is not empty'))
      ) {
        if (enrichment.styleAnalysis.consistencyNotes.length > 0) {
          result.qualityFlags.push(
            `Style review: ${enrichment.styleAnalysis.consistencyNotes.join(', ')}`
          );
        }
      }

      if (enrichment?.changeContext && gateLower.includes('changepercentage')) {
        const thresholdMatch = gate.match(/>\s*(\d+)/);
        const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 50;

        if (enrichment.changeContext.changePercentage > threshold) {
          result.qualityFlags.push(
            `Significant change: ${enrichment.changeContext.changePercentage}% modification`
          );
        }
      }

      if (
        enrichment?.changeContext &&
        gateLower.includes('otherpendingproposals') &&
        gateLower.includes('> 0')
      ) {
        if (enrichment.changeContext.otherPendingProposals > 0) {
          result.qualityFlags.push(
            `Coordination needed: ${enrichment.changeContext.otherPendingProposals} other pending proposals`
          );
        }
      }

      if (enrichment?.sourceAnalysis && gateLower.includes('messagecount')) {
        const thresholdMatch = gate.match(/<\s*(\d+)/);
        if (thresholdMatch) {
          const threshold = parseInt(thresholdMatch[1], 10);
          if (enrichment.sourceAnalysis.messageCount < threshold) {
            result.qualityFlags.push(
              `Limited evidence: only ${enrichment.sourceAnalysis.messageCount} messages`
            );
          }
        }
      }
    }

    return result;
  }

  /**
   * Run the FULL pipeline (FILTER, CLASSIFY, ENRICH, GENERATE, VALIDATE, CONDENSE)
   * Returns threads, proposals, and RAG results extracted from pipeline context
   */
  private async runFullPipeline(
    messages: any[],
    contextMessages: any[],
    batchId: string,
    streamId: string
  ): Promise<{
    threads: ConversationThread[];
    proposals: Map<string, PipelineProposal[]>;
    ragResults: Map<string, any[]>;
    messagesProcessed: number;
    success: boolean;
  }> {
    // Check if pipeline is available
    if (!this.pipelineConfig || !this.promptRegistry || !this.llmHandler) {
      logger.warn('Pipeline not initialized, cannot run full pipeline');
      return {
        threads: [],
        proposals: new Map(),
        ragResults: new Map(),
        messagesProcessed: 0,
        success: false,
      };
    }

    logger.info(`Running full pipeline for ${messages.length} messages`, {
      batchId,
      streamId,
      enabledSteps: this.pipelineConfig.steps.filter((s) => s.enabled).map((s) => s.stepId),
    });

    // Load domain config for this instance
    let domainConfig: IDomainConfig;
    try {
      const configBasePath = process.env.CONFIG_BASE_PATH || './config';
      domainConfig = await loadDomainConfig(configBasePath, this.instanceId);
      logger.debug(`Loaded domain config for ${this.instanceId}`, {
        categories: domainConfig.categories.length,
      });
    } catch (error) {
      // Fallback to basic domain config
      logger.warn('Failed to load domain config, using fallback', error);
      const instanceConfig = InstanceConfigLoader.get(this.instanceId);
      domainConfig = {
        domainId: this.instanceId,
        name: instanceConfig.project.name,
        categories: [],
        context: {
          projectName: instanceConfig.project.name,
          domain: instanceConfig.project.domain || 'documentation',
          targetAudience: 'developers',
          documentationPurpose: 'technical documentation',
        },
      };
    }

    // Convert DB messages to pipeline UnifiedMessage format
    const pipelineMessages: PipelineUnifiedMessage[] = messages.map((msg) => ({
      id: msg.id,
      messageId: msg.messageId,
      streamId: msg.streamId,
      timestamp: msg.timestamp,
      author: msg.author,
      authorId: msg.authorId || undefined,
      content: msg.content,
      conversationId: msg.metadata?.topic || undefined, // Use Zulip topic as conversationId
      replyToId: msg.metadata?.replyToMessageId
        ? `${msg.metadata.chatId}-${msg.metadata.replyToMessageId}`
        : undefined,
      processingStatus: msg.processingStatus,
    }));

    const pipelineContextMessages: PipelineUnifiedMessage[] = contextMessages.map((msg) => ({
      id: msg.id,
      messageId: msg.messageId,
      streamId: msg.streamId,
      timestamp: msg.timestamp,
      author: msg.author,
      authorId: msg.authorId || undefined,
      content: msg.content,
      conversationId: msg.metadata?.topic || undefined,
      replyToId: msg.metadata?.replyToMessageId
        ? `${msg.metadata.chatId}-${msg.metadata.replyToMessageId}`
        : undefined,
      processingStatus: msg.processingStatus,
    }));

    // Create RAG service adapter
    const ragServiceAdapter = {
      searchSimilarDocs: async (query: string, topK: number) => {
        const results = await this.messageVectorSearch.searchSimilarDocs(query, topK);
        return results.map((r) => ({
          id: r.id,
          filePath: r.file_path,
          title: r.title,
          content: r.content,
          similarity: r.distance,
        }));
      },
    };

    // Create full pipeline context
    const context = createPipelineContext({
      instanceId: this.instanceId,
      batchId,
      streamId,
      messages: pipelineMessages,
      contextMessages: pipelineContextMessages,
      domainConfig,
      prompts: this.promptRegistry,
      llmHandler: this.llmHandler,
      ragService: ragServiceAdapter,
      db: this.db,
    });

    try {
      // Create orchestrator with FULL pipeline config (all enabled steps)
      const orchestrator = new PipelineOrchestrator(this.pipelineConfig, this.llmHandler);
      const result = await orchestrator.execute(context);

      if (!result.success) {
        logger.warn(`Full pipeline had errors`, {
          errors: result.errors.map((e) => e.message),
          messagesProcessed: result.messagesProcessed,
          threadsCreated: result.threadsCreated,
          proposalsGenerated: result.proposalsGenerated,
        });
      }

      logger.info(`Full pipeline complete`, {
        success: result.success,
        messagesProcessed: result.messagesProcessed,
        threadsCreated: result.threadsCreated,
        proposalsGenerated: result.proposalsGenerated,
        llmCalls: result.metrics.llmCalls,
        llmTokensUsed: result.metrics.llmTokensUsed,
        totalDurationMs: result.metrics.totalDurationMs,
      });

      return {
        threads: context.threads,
        proposals: context.proposals,
        ragResults: context.ragResults,
        messagesProcessed: result.messagesProcessed,
        success: result.success || result.proposalsGenerated > 0,
      };
    } catch (error) {
      logger.error('Full pipeline failed:', error);
      return {
        threads: [],
        proposals: new Map(),
        ragResults: new Map(),
        messagesProcessed: 0,
        success: false,
      };
    }
  }

  /**
   * Store pipeline results to database (classification, RAG context, proposals)
   * Returns the set of successfully processed message IDs
   */
  private async storePipelineResults(
    threads: ConversationThread[],
    proposals: Map<string, PipelineProposal[]>,
    ragResults: Map<string, any[]>,
    messages: any[],
    batchId: string
  ): Promise<{ processedMessageIds: Set<number>; proposalCount: number }> {
    const processedMessageIds = new Set<number>();
    let proposalCount = 0;

    // Load tenant ruleset for enrichment and review
    const ruleset = await this.loadTenantRuleset();

    // Separate threads into valuable and no-value
    const valuableThreads = threads.filter((t) => t.category !== 'no-doc-value');
    const noValueThreads = threads.filter((t) => t.category === 'no-doc-value');

    logger.info(
      `Storing pipeline results: ${valuableThreads.length} valuable threads, ${noValueThreads.length} no-value threads`
    );

    // 1. Store classification results for ALL threads
    for (const thread of threads) {
      const isNoValue = thread.category === 'no-doc-value';

      for (const messageIdx of thread.messageIds) {
        // messageIds are indices into filteredMessages in pipeline, find actual message by index
        const message = messages[messageIdx];
        if (!message) {
          logger.debug(`Message at index ${messageIdx} not found, skipping`);
          continue;
        }

        await this.db.messageClassification.upsert({
          where: { messageId: message.id },
          update: {
            batchId,
            conversationId: thread.id,
            category: thread.category,
            docValueReason: thread.docValueReason,
            suggestedDocPage: null,
            ragSearchCriteria: isNoValue ? Prisma.DbNull : thread.ragSearchCriteria,
            modelUsed: this.config.classificationModel,
          },
          create: {
            messageId: message.id,
            batchId,
            conversationId: thread.id,
            category: thread.category,
            docValueReason: thread.docValueReason,
            suggestedDocPage: null,
            ragSearchCriteria: isNoValue ? Prisma.DbNull : thread.ragSearchCriteria,
            modelUsed: this.config.classificationModel,
          },
        });
      }
    }

    // 2. Store RAG context and proposals for valuable threads
    for (const thread of valuableThreads) {
      try {
        const threadRagDocs = ragResults.get(thread.id) || [];
        const threadProposals = proposals.get(thread.id) || [];

        // Truncate summary to fit database
        const truncatedSummary =
          thread.summary.length > 200 ? thread.summary.substring(0, 197) + '...' : thread.summary;

        // Store RAG context (with metadata only)
        const ragDocsMetadata = threadRagDocs.map((doc: any) => ({
          docId: doc.id,
          title: doc.title,
          filePath: doc.filePath,
          similarity: doc.similarity,
          contentPreview: doc.content ? doc.content.substring(0, 1000) + '...' : '',
        }));

        await this.db.conversationRagContext.upsert({
          where: { conversationId: thread.id },
          create: {
            conversationId: thread.id,
            batchId,
            retrievedDocs: ragDocsMetadata,
            totalTokens: this.estimateTokens(threadRagDocs),
            summary: truncatedSummary,
          },
          update: {
            batchId,
            retrievedDocs: ragDocsMetadata,
            totalTokens: this.estimateTokens(threadRagDocs),
            summary: truncatedSummary,
            proposalsRejected: null,
            rejectionReason: null,
          },
        });

        // Build fake conversation group for enrichment compatibility
        const conversationForEnrichment: ConversationGroup = {
          id: thread.id,
          channel: null,
          summary: thread.summary,
          messages: thread.messageIds
            .map((idx) => {
              const msg = messages[idx];
              return msg
                ? {
                    messageId: msg.id,
                    timestamp: msg.timestamp,
                    author: msg.author,
                    content: msg.content,
                    category: thread.category,
                    docValueReason: thread.docValueReason,
                    ragSearchCriteria: thread.ragSearchCriteria,
                  }
                : null;
            })
            .filter((m): m is NonNullable<typeof m> => m !== null),
          timeStart: new Date(),
          timeEnd: new Date(),
          messageCount: thread.messageIds.length,
        };

        // Convert pipeline proposals to our format for enrichment
        const proposalsForEnrichment: ProposalGeneration[] = threadProposals.map((p) => ({
          updateType: p.updateType,
          page: p.page,
          section: p.section,
          suggestedText: p.suggestedText,
          reasoning: p.reasoning,
          sourceMessages: p.sourceMessages,
          warnings: p.warnings,
        }));

        // Run enrichment and ruleset review
        const enrichedProposals = await this.runEnrichmentAndReview(
          proposalsForEnrichment,
          conversationForEnrichment,
          threadRagDocs,
          ruleset
        );

        // Filter out rejected proposals
        const acceptedProposals = enrichedProposals.filter((p) => !p.reviewResult?.rejected);
        const rejectedByRuleset = enrichedProposals.filter((p) => p.reviewResult?.rejected);

        if (rejectedByRuleset.length > 0) {
          logger.info(
            `Ruleset rejected ${rejectedByRuleset.length}/${enrichedProposals.length} proposals for thread ${thread.id}`
          );
        }

        // Store proposals
        for (const proposal of acceptedProposals) {
          const textToProcess = proposal.reviewResult?.modifiedContent || proposal.suggestedText;
          const postProcessed = postProcessProposal(textToProcess, proposal.page);

          const qualityWarnings = [
            ...(proposal.warnings || []),
            ...(postProcessed.warnings || []),
            ...(proposal.reviewResult?.qualityFlags || []),
          ];

          const createdProposal = await this.db.docProposal.create({
            data: {
              conversationId: thread.id,
              batchId,
              page: proposal.page,
              updateType: proposal.updateType,
              section: proposal.section || null,
              location: proposal.location ?? Prisma.DbNull,
              suggestedText: postProcessed.text || textToProcess || null,
              rawSuggestedText: proposal.suggestedText || null,
              reasoning: proposal.reasoning || null,
              sourceMessages: proposal.sourceMessages ?? Prisma.DbNull,
              modelUsed: this.config.proposalModel,
              warnings: qualityWarnings.length > 0 ? qualityWarnings : Prisma.DbNull,
              enrichment: proposal.enrichment
                ? (proposal.enrichment as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
            },
          });

          // Create ProposalReviewLog if ruleset was applied
          if (proposal.reviewResult && this.rulesetUpdatedAt) {
            try {
              await this.db.proposalReviewLog.create({
                data: {
                  proposalId: createdProposal.id,
                  rulesetVersion: this.rulesetUpdatedAt,
                  originalContent: proposal.reviewResult.originalContent || null,
                  modificationsApplied:
                    proposal.reviewResult.modificationsApplied.length > 0
                      ? proposal.reviewResult.modificationsApplied
                      : Prisma.DbNull,
                  rejected: false,
                  qualityFlags:
                    proposal.reviewResult.qualityFlags.length > 0
                      ? proposal.reviewResult.qualityFlags
                      : Prisma.DbNull,
                },
              });
            } catch (reviewLogError) {
              logger.warn(
                `Failed to create ProposalReviewLog for proposal ${createdProposal.id}:`,
                reviewLogError
              );
            }
          }

          proposalCount++;
        }

        // Mark thread messages as processed
        for (const idx of thread.messageIds) {
          const msg = messages[idx];
          if (msg) {
            processedMessageIds.add(msg.id);
          }
        }

        logger.debug(`Thread ${thread.id}: stored ${acceptedProposals.length} proposals`);
      } catch (error) {
        logger.error(`Error storing results for thread ${thread.id}:`, error);
        // Don't mark messages as processed if storage failed
      }
    }

    // 3. Store RAG context for no-value threads (mark as discarded)
    for (const thread of noValueThreads) {
      try {
        const truncatedSummary =
          thread.summary.length > 200 ? thread.summary.substring(0, 197) + '...' : thread.summary;

        await this.db.conversationRagContext.create({
          data: {
            conversationId: thread.id,
            batchId,
            retrievedDocs: [],
            totalTokens: 0,
            summary: truncatedSummary,
            proposalsRejected: true,
            rejectionReason: thread.docValueReason || 'Classified as no documentation value',
          },
        });

        // Mark messages as processed
        for (const idx of thread.messageIds) {
          const msg = messages[idx];
          if (msg) {
            processedMessageIds.add(msg.id);
          }
        }
      } catch (error) {
        logger.error(`Error storing no-value thread ${thread.id}:`, error);
      }
    }

    return { processedMessageIds, proposalCount };
  }

  /**
   * Check if batch processing is currently running
   */
  static getProcessingStatus(): boolean {
    return BatchMessageProcessor.isProcessing;
  }

  /**
   * Process the next batch of messages
   * @param options.streamIdFilter - Optional: only process messages from this stream
   * Returns number of messages processed
   */
  async processBatch(options?: { streamIdFilter?: string }): Promise<number> {
    // Check if already processing
    if (BatchMessageProcessor.isProcessing) {
      logger.warn('Already processing, skipping...');
      return 0;
    }

    // Set processing flag
    BatchMessageProcessor.isProcessing = true;
    const filterMsg = options?.streamIdFilter
      ? ` (filtered to stream: ${options.streamIdFilter})`
      : '';
    logger.info(`Starting batch processing...${filterMsg}`);

    // Initialize pipeline components (loads config from S3 if enabled)
    await this.initializePipeline();

    try {
      let totalMessagesProcessedAcrossAllBatches = 0;
      let batchNumber = 0;

      // Build where clause with optional stream filter
      // By default, exclude test stream ('pipeline-test') from production runs
      const whereClause: { processingStatus: 'PENDING'; streamId?: string | { not: string } } = {
        processingStatus: 'PENDING',
      };
      if (options?.streamIdFilter) {
        // Specific stream filter (e.g., for test runs)
        whereClause.streamId = options.streamIdFilter;
      } else {
        // Production: exclude test stream
        whereClause.streamId = { not: 'pipeline-test' };
      }

      // Get all distinct streams with pending messages
      const allStreams = await this.db.unifiedMessage.findMany({
        where: whereClause,
        distinct: ['streamId'],
        select: { streamId: true },
      });

      if (allStreams.length === 0) {
        logger.debug('No pending messages found across any streams.');
        return 0;
      }

      logger.info(`Found ${allStreams.length} streams with pending messages`);

      // Process each stream independently
      for (const { streamId } of allStreams) {
        logger.info(`Processing stream: ${streamId}`);

        // Process batches for this stream until no more pending messages
        while (true) {
          batchNumber++;

          // 1. Get processing watermark for this stream
          const watermark = await this.getProcessingWatermark(streamId);
          logger.debug(`Stream ${streamId} watermark: ${watermark.toISOString()}`);

          // 2. Find the earliest unprocessed message for this stream after its watermark
          const earliestUnprocessed = await this.db.unifiedMessage.findFirst({
            where: {
              streamId,
              timestamp: { gte: watermark },
              processingStatus: 'PENDING',
            },
            orderBy: { timestamp: 'asc' },
            select: { timestamp: true },
          });

          if (!earliestUnprocessed) {
            logger.debug(`Stream ${streamId}: No more unprocessed messages.`);
            break;
          }

          logger.debug(
            `Stream ${streamId}: Earliest unprocessed at ${earliestUnprocessed.timestamp.toISOString()}`
          );

          // 3. Calculate batch window for this stream
          const batchStart = earliestUnprocessed.timestamp;
          const idealBatchEnd = new Date(
            batchStart.getTime() + this.config.batchWindowHours * 60 * 60 * 1000
          );
          const now = new Date();
          const batchEnd = idealBatchEnd < now ? idealBatchEnd : now;

          logger.debug(
            `Stream ${streamId} batch window: ${batchStart.toISOString()} to ${batchEnd.toISOString()}`
          );

          // Check if there are any messages in this window for this stream
          const messageCount = await this.db.unifiedMessage.count({
            where: {
              streamId,
              timestamp: { gte: batchStart, lt: batchEnd },
              processingStatus: 'PENDING',
            },
          });

          if (messageCount === 0) {
            logger.debug(
              `Stream ${streamId}: No pending messages in batch window, moving watermark forward`
            );
            await this.updateProcessingWatermark(streamId, batchEnd);
            continue;
          }

          logger.info(`Stream ${streamId}: Found ${messageCount} pending messages`);

          // Use timestamps instead of ISO strings to keep batch_id under 50 chars
          const batchId = `${streamId.substring(0, 10)}_${batchStart.getTime()}`;

          // Fetch context messages for this stream batch
          const contextStart = new Date(
            batchStart.getTime() - this.config.contextWindowHours * 60 * 60 * 1000
          );
          const contextMessages = await this.fetchContextMessages(
            contextStart,
            batchStart,
            streamId
          );
          logger.debug(`Stream ${streamId}: Fetched ${contextMessages.length} context messages`);

          // Process messages in chunks until this batch window is exhausted
          let totalMessagesProcessed = 0;
          let totalConversationsProcessed = 0;
          let totalProposalsGenerated = 0;
          let anyMessagesFailed = false;
          let iteration = 0;
          void batchNumber; // Used for logging context

          while (true) {
            iteration++;
            logger.debug(`Stream ${streamId} - Iteration ${iteration}: Fetching next chunk...`);

            // Fetch next chunk of messages for batch (up to maxBatchSize) from this stream
            const messages = await this.fetchMessagesForBatch(batchStart, batchEnd, streamId);
            logger.debug(
              `Stream ${streamId} - Iteration ${iteration}: Fetched ${messages.length} messages`
            );

            if (messages.length === 0) {
              // No more messages in this batch window
              break;
            }

            // 5. Run the FULL pipeline (FILTER → CLASSIFY → ENRICH → GENERATE → VALIDATE → CONDENSE)
            // This replaces the old classifyBatch + processConversation flow
            const pipelineResult = await this.runFullPipeline(
              messages,
              contextMessages,
              batchId,
              streamId
            );

            if (!pipelineResult.success && pipelineResult.threads.length === 0) {
              // Pipeline failed completely - mark messages as failed and continue
              logger.error(`Pipeline failed for batch ${batchId}, will retry`);
              anyMessagesFailed = true;
              break; // Exit inner loop, will retry on next batch run
            }

            const valuableThreads = pipelineResult.threads.filter(
              (t) => t.category !== 'no-doc-value'
            );
            const noValueThreads = pipelineResult.threads.filter(
              (t) => t.category === 'no-doc-value'
            );
            logger.info(
              `Iteration ${iteration}: Pipeline classified ${pipelineResult.threads.length} threads (${valuableThreads.length} valuable, ${noValueThreads.length} no-value)`
            );

            // 6. Store pipeline results (classification, RAG context, proposals)
            // This also runs enrichment and ruleset review
            const {
              processedMessageIds: successfullyProcessedMessageIds,
              proposalCount: iterationProposals,
            } = await this.storePipelineResults(
              pipelineResult.threads,
              pipelineResult.proposals,
              pipelineResult.ragResults,
              messages,
              batchId
            );

            totalConversationsProcessed += pipelineResult.threads.length;

            // 7. Mark only successfully processed messages as COMPLETED
            if (successfullyProcessedMessageIds.size > 0) {
              await this.db.unifiedMessage.updateMany({
                where: { id: { in: Array.from(successfullyProcessedMessageIds) } },
                data: { processingStatus: 'COMPLETED' },
              });
              logger.info(`Marked ${successfullyProcessedMessageIds.size} messages as COMPLETED`);
            }

            // 8. Clean up classification data for failed messages so they can be re-classified on retry
            const failedMessageIds = messages
              .map((m) => m.id)
              .filter((id) => !successfullyProcessedMessageIds.has(id));

            if (failedMessageIds.length > 0) {
              await this.db.messageClassification.deleteMany({
                where: { messageId: { in: failedMessageIds } },
              });
              anyMessagesFailed = true;
              logger.warn(
                `${failedMessageIds.length} messages remain unprocessed due to errors and will retry (classifications cleaned up)`
              );
            }

            totalMessagesProcessed += successfullyProcessedMessageIds.size;
            totalProposalsGenerated += iterationProposals;
            logger.info(
              `Stream ${streamId} - Iteration ${iteration} complete: ${successfullyProcessedMessageIds.size}/${messages.length} messages successfully processed via full pipeline, ${pipelineResult.threads.length} threads (${valuableThreads.length} valuable, ${noValueThreads.length} no-value), ${iterationProposals} proposals`
            );
          }

          // Update stream watermark only if ALL messages in this batch succeeded
          if (!anyMessagesFailed) {
            await this.updateProcessingWatermark(streamId, batchEnd);
            logger.info(
              `Stream ${streamId} batch complete: ${totalMessagesProcessed} messages, ${totalConversationsProcessed} conversations, ${totalProposalsGenerated} proposals. Watermark updated to ${batchEnd.toISOString()}`
            );
          } else {
            logger.warn(
              `Stream ${streamId} batch complete with failures: ${totalMessagesProcessed} messages succeeded, ${totalConversationsProcessed} conversations, ${totalProposalsGenerated} proposals. Watermark NOT updated - failed messages will retry on next run.`
            );
          }

          // Accumulate totals across all batches
          totalMessagesProcessedAcrossAllBatches += totalMessagesProcessed;
        }

        logger.info(`Stream ${streamId} processing complete`);
      }

      // All batches processed
      logger.info('All batches complete');
      logger.info(`Total across all batches: ${totalMessagesProcessedAcrossAllBatches} messages`);
      return totalMessagesProcessedAcrossAllBatches;
    } finally {
      // Always clear processing flag
      BatchMessageProcessor.isProcessing = false;
      logger.debug('Processing flag cleared');
    }
  }

  /**
   * Get current processing watermark for a specific stream
   */
  private async getProcessingWatermark(streamId: string): Promise<Date> {
    const watermark = await this.db.processingWatermark.findUnique({
      where: { streamId },
    });

    if (!watermark) {
      // Initialize watermark to earliest message in this stream, or 7 days ago if no messages
      const earliestMessage = await this.db.unifiedMessage.findFirst({
        where: { streamId },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true },
      });

      const initialWatermark =
        earliestMessage?.timestamp || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      await this.db.processingWatermark.create({
        data: {
          streamId,
          watermarkTime: initialWatermark,
        },
      });
      return initialWatermark;
    }

    return watermark.watermarkTime;
  }

  /**
   * Update processing watermark for a specific stream
   */
  private async updateProcessingWatermark(streamId: string, newTime: Date): Promise<void> {
    await this.db.processingWatermark.upsert({
      where: { streamId },
      update: {
        watermarkTime: newTime,
        lastProcessedBatch: new Date(),
      },
      create: {
        streamId,
        watermarkTime: newTime,
        lastProcessedBatch: new Date(),
      },
    });
  }

  /**
   * Fetch messages for batch window (only PENDING messages)
   */
  private async fetchMessagesForBatch(start: Date, end: Date, streamId?: string): Promise<any[]> {
    return await this.db.unifiedMessage.findMany({
      where: {
        ...(streamId && { streamId }), // Filter by stream if provided
        timestamp: {
          gte: start,
          lt: end,
        },
        processingStatus: 'PENDING', // Only fetch messages that haven't been processed yet
      },
      orderBy: {
        timestamp: 'asc',
      },
      take: this.config.maxBatchSize,
    });
  }

  /**
   * Fetch context messages (can include COMPLETED messages for context)
   */
  private async fetchContextMessages(start: Date, end: Date, streamId?: string): Promise<any[]> {
    return await this.db.unifiedMessage.findMany({
      where: {
        ...(streamId && { streamId }), // Filter by stream if provided
        timestamp: {
          gte: start,
          lt: end,
        },
        // No processingStatus filter - include all messages for context
      },
      orderBy: {
        timestamp: 'asc',
      },
      take: 100, // Limit context messages
    });
  }

  /**
   * Estimate token count for RAG docs
   */
  private estimateTokens(ragDocs: any[]): number {
    const totalChars = ragDocs.reduce((sum, doc) => sum + doc.content.length, 0);
    return Math.ceil(totalChars / 4); // Rough estimate: 4 chars per token
  }
}
