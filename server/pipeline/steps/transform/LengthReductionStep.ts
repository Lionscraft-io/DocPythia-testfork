/**
 * Length Reduction Step
 *
 * Detects overly long proposals and uses LLM to condense them.
 * Uses priority-based max lengths - higher priority content gets more space.
 * Single attempt only - whatever LLM returns is used.
 *

 * @created 2026-01-07
 */

import { z } from 'zod';
import { BasePipelineStep } from '../base/BasePipelineStep.js';
import {
  StepType,
  type StepConfig,
  type StepMetadata,
  type PipelineContext,
  type Proposal,
  type ILLMHandler,
} from '../../core/interfaces.js';

/**
 * Priority-based length configuration
 */
interface PriorityLengthConfig {
  /** Priority threshold (0-100) - applies to priorities >= this value */
  minPriority: number;
  /** Maximum characters for this priority tier */
  maxLength: number;
  /** Target length hint for LLM (aim for this, don't exceed max) */
  targetLength: number;
}

/**
 * Configuration for LengthReductionStep
 */
interface LengthReductionConfig {
  /** Default max length when no priority match (default: 3000) */
  defaultMaxLength?: number;
  /** Default target length hint (default: 2000) */
  defaultTargetLength?: number;
  /** Priority-based length tiers (highest priority first) */
  priorityTiers?: PriorityLengthConfig[];
  /** Prompt template ID */
  promptId?: string;
  /** Model to use for condensing */
  model?: string;
  /** Temperature for LLM call */
  temperature?: number;
  /** Max tokens for response */
  maxTokens?: number;
}

/**
 * LLM response schema for content condensing
 */
const CondenseResponseSchema = z.object({
  condensedContent: z.string(),
});

type CondenseResponse = z.infer<typeof CondenseResponseSchema>;

/**
 * Condenses overly long proposals using LLM (single attempt)
 */
export class LengthReductionStep extends BasePipelineStep {
  readonly stepType = StepType.CONDENSE;

  private defaultMaxLength: number;
  private defaultTargetLength: number;
  private priorityTiers: PriorityLengthConfig[];
  private promptId: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: StepConfig, llmHandler: ILLMHandler) {
    super(config, llmHandler);

    const reductionConfig = config.config as LengthReductionConfig;
    this.defaultMaxLength = reductionConfig.defaultMaxLength ?? 3000;
    this.defaultTargetLength = reductionConfig.defaultTargetLength ?? 2000;
    this.priorityTiers = reductionConfig.priorityTiers ?? [
      // High priority (70-100): important content gets more space
      { minPriority: 70, maxLength: 5000, targetLength: 3500 },
      // Medium priority (40-69): standard length
      { minPriority: 40, maxLength: 3500, targetLength: 2500 },
      // Low priority (0-39): keep it brief
      { minPriority: 0, maxLength: 2000, targetLength: 1500 },
    ];
    this.promptId = reductionConfig.promptId || 'content-condense';
    this.model = reductionConfig.model || 'gemini-2.5-flash';
    this.temperature = reductionConfig.temperature ?? 0.3;
    this.maxTokens = reductionConfig.maxTokens ?? 8192;
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();
    const llmHandler = this.requireLLMHandler();

    let checkedCount = 0;
    let condensedCount = 0;

    // Build category to priority map
    const categoryPriority = new Map<string, number>();
    for (const cat of context.domainConfig.categories) {
      categoryPriority.set(cat.id, cat.priority);
    }

    // Build thread ID to category map
    const threadCategory = new Map<string, string>();
    for (const thread of context.threads) {
      threadCategory.set(thread.id, thread.category);
    }

    // Process each thread's proposals
    for (const [threadId, proposals] of context.proposals) {
      const category = threadCategory.get(threadId) || 'unknown';
      const priority = categoryPriority.get(category) ?? 50; // Default to medium
      const { maxLength, targetLength } = this.getLengthsForPriority(priority);

      const processedProposals: Proposal[] = [];

      for (const proposal of proposals) {
        // Skip proposals without content or DELETE/NONE types
        if (
          !proposal.suggestedText ||
          proposal.updateType === 'DELETE' ||
          proposal.updateType === 'NONE'
        ) {
          processedProposals.push(proposal);
          continue;
        }

        checkedCount++;
        const contentLength = proposal.suggestedText.length;

        if (contentLength <= maxLength) {
          processedProposals.push(proposal);
          continue;
        }

        this.logger.debug(
          `Proposal for ${proposal.page} exceeds max (priority ${priority}): ${contentLength} > ${maxLength}`
        );

        try {
          const condensed = await this.condenseContent(
            proposal,
            maxLength,
            targetLength,
            priority,
            llmHandler,
            context
          );
          processedProposals.push(condensed);
          condensedCount++;

          const newLength = condensed.suggestedText?.length || 0;
          this.logger.info(
            `Condensed ${proposal.page}: ${contentLength} -> ${newLength} chars ` +
              `(priority ${priority}, max ${maxLength})`
          );
        } catch (error) {
          this.logger.error(`Failed to condense proposal for ${proposal.page}:`, error);
          // Keep original proposal on error
          processedProposals.push({
            ...proposal,
            warnings: [
              ...(proposal.warnings || []),
              `Length reduction failed: ${(error as Error).message}`,
            ],
          });
        }
      }

      context.proposals.set(threadId, processedProposals);
    }

    this.recordTiming(context, startTime);

    this.logger.info(
      `Length reduction complete: ${checkedCount} checked, ${condensedCount} condensed`
    );

    return context;
  }

  /**
   * Get max and target lengths for a given priority
   */
  private getLengthsForPriority(priority: number): { maxLength: number; targetLength: number } {
    // Find the first tier where priority >= minPriority
    for (const tier of this.priorityTiers) {
      if (priority >= tier.minPriority) {
        return { maxLength: tier.maxLength, targetLength: tier.targetLength };
      }
    }
    return { maxLength: this.defaultMaxLength, targetLength: this.defaultTargetLength };
  }

  /**
   * Condense content using LLM (single attempt)
   */
  private async condenseContent(
    proposal: Proposal,
    maxLength: number,
    targetLength: number,
    priority: number,
    llmHandler: ILLMHandler,
    context: PipelineContext
  ): Promise<Proposal> {
    const originalLength = proposal.suggestedText!.length;

    // Try to get the prompt template, fall back to inline prompt
    let systemPrompt: string;
    let userPrompt: string;

    try {
      const rendered = context.prompts.render(this.promptId, {
        currentLength: originalLength,
        maxLength,
        targetLength,
        priority,
        content: proposal.suggestedText,
        page: proposal.page,
        section: proposal.section,
        updateType: proposal.updateType,
      });
      systemPrompt = rendered.system;
      userPrompt = rendered.user;
    } catch {
      // Fallback to inline prompt if template not found
      systemPrompt = `You are a technical documentation editor. Condense the provided content to be as short as possible while preserving essential information.

CONSTRAINTS:
- MAXIMUM: ${maxLength} characters (hard limit - do not exceed)
- TARGET: Aim for ${targetLength} characters or less if possible
- Priority level: ${priority}/100 (higher = more important, preserve more detail)

KEEP (in order of importance):
1. Code examples, commands, and exact syntax
2. Error messages and their solutions
3. Critical warnings and breaking changes
4. Step-by-step instructions (condensed)
5. Configuration values and parameters

REMOVE/CONDENSE:
- Verbose introductions and conclusions
- Redundant explanations
- "Note that", "Please note", "It's important to" phrases
- Background context (unless critical)
- Multiple examples when one suffices

Return ONLY the condensed content. Maintain markdown formatting.`;

      userPrompt = `Condense this documentation update for ${proposal.page}${proposal.section ? ` (section: ${proposal.section})` : ''}.

Current: ${originalLength} chars | Max: ${maxLength} chars | Target: ≤${targetLength} chars

---
${proposal.suggestedText}
---

Return only the condensed content.`;
    }

    const { data, response } = await llmHandler.requestJSON<CondenseResponse>(
      {
        model: this.model,
        systemPrompt,
        userPrompt,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      },
      CondenseResponseSchema,
      {
        instanceId: context.instanceId,
        batchId: context.batchId,
        conversationId: proposal.page,
        purpose: 'content-condense',
      }
    );

    // Update metrics
    context.metrics.llmCalls++;
    if (response.tokensUsed) {
      context.metrics.llmTokensUsed += response.tokensUsed;
    }

    const newLength = data.condensedContent.length;

    return {
      ...proposal,
      suggestedText: data.condensedContent,
      warnings: [
        ...(proposal.warnings || []),
        `Condensed: ${originalLength} -> ${newLength} chars (priority ${priority}, max ${maxLength})`,
      ],
    };
  }

  validateConfig(config: StepConfig): boolean {
    if (!super.validateConfig(config)) {
      return false;
    }

    const reductionConfig = config.config as LengthReductionConfig;

    if (reductionConfig.defaultMaxLength !== undefined && reductionConfig.defaultMaxLength < 100) {
      this.logger.error('defaultMaxLength must be at least 100 characters');
      return false;
    }

    if (reductionConfig.priorityTiers) {
      for (const tier of reductionConfig.priorityTiers) {
        if (tier.targetLength >= tier.maxLength) {
          this.logger.error('targetLength must be less than maxLength in priority tiers');
          return false;
        }
      }
    }

    return true;
  }

  getMetadata(): StepMetadata {
    return {
      name: 'Length Reducer',
      description: 'Condenses overly long proposals using LLM with priority-based limits',
      version: '1.1.0',
      author: 'system',
    };
  }
}

/**
 * Factory function for LengthReductionStep
 */
export function createLengthReductionStep(
  config: StepConfig,
  llmHandler: ILLMHandler
): LengthReductionStep {
  return new LengthReductionStep(config, llmHandler);
}
