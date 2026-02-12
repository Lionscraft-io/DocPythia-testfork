/**
 * Proposal Generate Step
 *
 * Generates documentation change proposals using LLM.
 * Creates INSERT, UPDATE, or DELETE proposals based on thread analysis.
 *

 * @created 2025-12-30
 */

import { z } from 'zod';
import { BasePipelineStep } from '../base/BasePipelineStep.js';
import {
  StepType,
  type StepConfig,
  type StepMetadata,
  type PipelineContext,
  type ConversationThread,
  type RagDocument,
  type Proposal,
  type ILLMHandler,
} from '../../core/interfaces.js';
import { postProcessProposal } from '../../utils/ProposalPostProcessor.js';
import { parseRuleset, type ParsedRuleset } from '../../types/ruleset.js';
import { getErrorMessage } from '../../../utils/logger.js';

/**
 * Configuration for ProposalGenerateStep
 */
interface ProposalGenerateConfig {
  promptId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxProposalsPerThread?: number;
}

/**
 * LLM response schema for proposal generation
 */
const ProposalResponseSchema = z.object({
  proposals: z.array(
    z.object({
      updateType: z.enum(['INSERT', 'UPDATE', 'DELETE', 'NONE']),
      page: z.string(),
      section: z.string().nullish(),
      suggestedText: z.string().nullish(),
      reasoning: z.string(),
      sourceMessages: z.array(z.number()).nullish(),
    })
  ),
  proposalsRejected: z.boolean().nullish(),
  rejectionReason: z.string().nullish(),
});

type ProposalResponse = z.infer<typeof ProposalResponseSchema>;

/**
 * Generates documentation change proposals using LLM
 */
export class ProposalGenerateStep extends BasePipelineStep {
  readonly stepType = StepType.GENERATE;

  private promptId: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private maxProposalsPerThread: number;
  private cachedRuleset: ParsedRuleset | null = null;

  constructor(config: StepConfig, llmHandler: ILLMHandler) {
    super(config, llmHandler);

    const generateConfig = config.config as ProposalGenerateConfig;
    this.promptId = generateConfig.promptId || 'changeset-generation';
    this.model = generateConfig.model || 'gemini-2.5-pro';
    this.temperature = generateConfig.temperature ?? 0.4;
    this.maxTokens = generateConfig.maxTokens ?? 32768;
    this.maxProposalsPerThread = generateConfig.maxProposalsPerThread || 5;
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();
    const llmHandler = this.requireLLMHandler();

    // Load tenant ruleset for PROMPT_CONTEXT injection
    this.cachedRuleset = await this.loadRuleset(context);
    if (this.cachedRuleset?.promptContext.length) {
      this.logger.info(
        `Loaded ${this.cachedRuleset.promptContext.length} PROMPT_CONTEXT rules from ruleset`
      );
    }

    // Process all valuable threads — even those without RAG docs can get INSERT proposals for new pages
    const threadsToProcess = context.threads.filter((t) => t.category !== 'no-doc-value');

    if (threadsToProcess.length === 0) {
      this.logger.info('No valuable threads, skipping proposal generation');
      this.recordTiming(context, startTime);
      return context;
    }

    this.logger.info(`Generating proposals for ${threadsToProcess.length} threads`);

    let totalProposals = 0;
    const maxBatchProposals = context.domainConfig.security?.maxProposalsPerBatch || 100;

    for (const thread of threadsToProcess) {
      // Check if we've hit the batch limit
      if (totalProposals >= maxBatchProposals) {
        this.logger.warn(`Reached max proposals per batch (${maxBatchProposals}), stopping`);
        break;
      }

      try {
        const ragDocs = context.ragResults.get(thread.id) || [];
        const proposals = await this.generateProposalsForThread(
          context,
          thread,
          ragDocs,
          llmHandler
        );

        // Apply security filtering
        const filteredProposals = this.applySecurityFilters(proposals, context);

        // Limit proposals per thread
        const limitedProposals = filteredProposals.slice(0, this.maxProposalsPerThread);

        context.proposals.set(thread.id, limitedProposals);
        totalProposals += limitedProposals.length;

        this.logger.debug(`Thread ${thread.id}: generated ${limitedProposals.length} proposals`);
      } catch (error) {
        this.logger.error(`Failed to generate proposals for thread ${thread.id}:`, error);

        // Capture error in the prompt log so it's visible in the Pipeline Debugger response tab
        const entries = context.stepPromptLogs.get(this.stepId);
        if (entries && entries.length > 0) {
          const lastEntry = entries[entries.length - 1];
          if (!lastEntry.response) {
            lastEntry.response = `ERROR: ${getErrorMessage(error)}`;
          }
        }

        context.proposals.set(thread.id, []);
      }
    }

    this.recordTiming(context, startTime);

    this.logger.info(`Proposal generation complete: ${totalProposals} proposals`);

    return context;
  }

  /**
   * Generate proposals for a single thread
   */
  private async generateProposalsForThread(
    context: PipelineContext,
    thread: ConversationThread,
    ragDocs: RagDocument[],
    llmHandler: ILLMHandler
  ): Promise<Proposal[]> {
    // Render the prompt template and log for debugging
    const threadLabel = `Generate: ${thread.summary?.substring(0, 60) || thread.id}`;
    const { system, user, entryIndex } = this.renderAndAppendPrompt(
      context,
      this.promptId,
      {
        projectName: context.domainConfig.context.projectName,
        domain: context.domainConfig.context.domain,
        targetAudience: context.domainConfig.context.targetAudience,
        documentationPurpose: context.domainConfig.context.documentationPurpose,
        threadSummary: thread.summary,
        threadCategory: thread.category,
        docValueReason: thread.docValueReason,
        ragContext: this.formatRagDocs(ragDocs),
        messages: this.formatThreadMessages(thread, context),
      },
      threadLabel
    );

    // Inject PROMPT_CONTEXT from tenant ruleset if available
    let systemPrompt = system;
    if (this.cachedRuleset?.promptContext.length) {
      const contextRules = this.cachedRuleset.promptContext.map((rule) => `- ${rule}`).join('\n');
      systemPrompt += `\n\n## Tenant-Specific Guidelines\n\nFollow these additional guidelines when generating proposals:\n${contextRules}`;
      this.logger.debug('Injected PROMPT_CONTEXT into system prompt');
      // Update the resolved system prompt in the log entry
      const entries = context.stepPromptLogs.get(this.stepId);
      if (entries && entries[entryIndex]) {
        entries[entryIndex].resolved = { system: systemPrompt, user };
      }
    }

    // Call LLM for proposal generation
    const { data, response } = await llmHandler.requestJSON<ProposalResponse>(
      {
        model: this.model,
        systemPrompt,
        userPrompt: user,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      },
      ProposalResponseSchema,
      {
        instanceId: context.instanceId,
        batchId: context.batchId,
        conversationId: thread.id,
        purpose: 'proposal',
      }
    );

    // Update metrics
    context.metrics.llmCalls++;
    if (response.tokensUsed) {
      context.metrics.llmTokensUsed += response.tokensUsed;
    }

    // Log LLM response for debugging
    this.logger.debug(
      `Capturing response for entry ${entryIndex}, length: ${response.text?.length || 0}`
    );
    this.updatePromptLogEntryResponse(context, entryIndex, response.text);

    // Handle rejection
    if (data.proposalsRejected) {
      this.logger.debug(`Thread ${thread.id}: proposals rejected - ${data.rejectionReason}`);
      return [];
    }

    // Log raw LLM response for debugging
    this.logger.debug(`Thread ${thread.id}: LLM returned ${data.proposals.length} proposals`);
    for (const p of data.proposals) {
      if (p.suggestedText) {
        this.logger.debug(
          `  RAW LLM [${p.page}]: ${p.suggestedText.substring(0, 150).replace(/\n/g, '\\n')}...`
        );
      }
    }

    // Filter out NONE proposals and apply post-processing
    return data.proposals
      .filter((p) => p.updateType !== 'NONE')
      .map((p) => {
        // Post-process suggestedText for markdown files (coerce null → undefined)
        const originalText = p.suggestedText ?? undefined;
        const postProcessed = postProcessProposal(originalText, p.page);

        // Debug logging to track post-processing
        if (postProcessed.wasModified) {
          this.logger.info(`POST-PROCESS MODIFIED [${p.page}]:`);
          this.logger.info(`  BEFORE: ${originalText?.substring(0, 120).replace(/\n/g, '\\n')}`);
          this.logger.info(
            `  AFTER:  ${postProcessed.text?.substring(0, 120).replace(/\n/g, '\\n')}`
          );
        } else {
          this.logger.debug(
            `POST-PROCESS unchanged [${p.page}]: ${originalText?.substring(0, 80).replace(/\n/g, '\\n')}`
          );
        }

        return {
          updateType: p.updateType,
          page: p.page,
          section: p.section ?? undefined,
          suggestedText: postProcessed.text || originalText,
          rawSuggestedText: originalText,
          reasoning: p.reasoning,
          sourceMessages: p.sourceMessages ?? undefined,
          warnings: postProcessed.warnings.length > 0 ? postProcessed.warnings : undefined,
        };
      });
  }

  /**
   * Format RAG documents for prompt injection
   */
  private formatRagDocs(docs: RagDocument[]): string {
    if (docs.length === 0) {
      return '(No relevant documentation found)';
    }

    return docs
      .map(
        (doc, idx) =>
          `[DOC ${idx + 1}] ${doc.title}\nPath: ${doc.filePath}\nSimilarity: ${doc.similarity.toFixed(3)}\n\n${doc.content}`
      )
      .join('\n\n---\n\n');
  }

  /**
   * Format thread messages for prompt injection
   */
  private formatThreadMessages(thread: ConversationThread, context: PipelineContext): string {
    // Find messages by their index in the filtered messages array
    const messages = thread.messageIds.map((idx) => context.filteredMessages[idx]).filter(Boolean);

    if (messages.length === 0) {
      return '(No messages)';
    }

    return messages
      .map((m) => `[${m.id}] [${m.timestamp.toISOString()}] ${m.author}: ${m.content}`)
      .join('\n\n');
  }

  /**
   * Apply security filters to proposals
   */
  private applySecurityFilters(proposals: Proposal[], context: PipelineContext): Proposal[] {
    const blockPatterns = context.domainConfig.security?.blockPatterns || [];

    if (blockPatterns.length === 0) {
      return proposals;
    }

    return proposals.map((proposal) => {
      const warnings: string[] = [];

      for (const pattern of blockPatterns) {
        const regex = new RegExp(pattern, 'gi');
        if (proposal.suggestedText && regex.test(proposal.suggestedText)) {
          warnings.push(`Blocked pattern detected: ${pattern}`);
        }
      }

      if (warnings.length > 0) {
        return { ...proposal, warnings };
      }

      return proposal;
    });
  }

  /**
   * Load tenant ruleset for PROMPT_CONTEXT injection
   */
  private async loadRuleset(context: PipelineContext): Promise<ParsedRuleset | null> {
    try {
      const ruleset = await context.db.tenantRuleset.findFirst({
        where: {
          tenantId: context.instanceId,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      if (!ruleset || !ruleset.content) {
        this.logger.debug('No tenant ruleset found for PROMPT_CONTEXT injection');
        return null;
      }

      return parseRuleset(ruleset.content);
    } catch (error) {
      this.logger.warn('Failed to load tenant ruleset:', error);
      return null;
    }
  }

  validateConfig(config: StepConfig): boolean {
    if (!super.validateConfig(config)) {
      return false;
    }

    const generateConfig = config.config as ProposalGenerateConfig;

    // Validate model
    if (generateConfig.model && typeof generateConfig.model !== 'string') {
      this.logger.error('model must be a string');
      return false;
    }

    // Validate temperature
    if (
      generateConfig.temperature !== undefined &&
      (generateConfig.temperature < 0 || generateConfig.temperature > 2)
    ) {
      this.logger.error('temperature must be between 0 and 2');
      return false;
    }

    // Validate maxProposalsPerThread
    if (
      generateConfig.maxProposalsPerThread !== undefined &&
      (typeof generateConfig.maxProposalsPerThread !== 'number' ||
        generateConfig.maxProposalsPerThread < 1)
    ) {
      this.logger.error('maxProposalsPerThread must be a positive number');
      return false;
    }

    return true;
  }

  getMetadata(): StepMetadata {
    return {
      name: 'Proposal Generator',
      description: 'Generates documentation change proposals using LLM',
      version: '1.0.0',
      author: 'system',
    };
  }
}

/**
 * Factory function for ProposalGenerateStep
 */
export function createProposalGenerateStep(
  config: StepConfig,
  llmHandler: ILLMHandler
): ProposalGenerateStep {
  return new ProposalGenerateStep(config, llmHandler);
}
