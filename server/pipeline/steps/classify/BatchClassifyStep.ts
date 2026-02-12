/**
 * Batch Classify Step
 *
 * Classifies messages into conversation threads using LLM.
 * Groups related messages and assigns categories based on domain configuration.
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
  type CategoryDefinition,
  type UnifiedMessage,
  type ILLMHandler,
} from '../../core/interfaces.js';

/**
 * Configuration for BatchClassifyStep
 */
interface BatchClassifyConfig {
  promptId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * LLM response schema for thread classification
 */
const ClassificationResponseSchema = z.object({
  threads: z.array(
    z.object({
      category: z.string(),
      messages: z.array(z.number()),
      summary: z.string(),
      docValueReason: z.string(),
      ragSearchCriteria: z.object({
        keywords: z.array(z.string()),
        semanticQuery: z.string(),
      }),
    })
  ),
});

type ClassificationResponse = z.infer<typeof ClassificationResponseSchema>;

/**
 * Classifies messages into conversation threads using LLM
 */
export class BatchClassifyStep extends BasePipelineStep {
  readonly stepType = StepType.CLASSIFY;

  private promptId: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: StepConfig, llmHandler: ILLMHandler) {
    super(config, llmHandler);

    const classifyConfig = config.config as BatchClassifyConfig;
    this.promptId = classifyConfig.promptId || 'thread-classification';
    this.model = classifyConfig.model || 'gemini-2.5-flash';
    this.temperature = classifyConfig.temperature ?? 0.2;
    this.maxTokens = classifyConfig.maxTokens ?? 32768;
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();
    const llmHandler = this.requireLLMHandler();

    // Skip if no messages to classify
    if (context.filteredMessages.length === 0) {
      this.logger.info('No messages to classify, skipping');
      context.threads = [];
      this.recordTiming(context, startTime);
      return context;
    }

    this.logger.info(`Classifying ${context.filteredMessages.length} messages`);

    // Render the prompt template and log for debugging
    const rendered = this.renderAndLogPrompt(context, this.promptId, {
      projectName: context.domainConfig.context.projectName,
      domain: context.domainConfig.context.domain,
      categories: this.formatCategories(context.domainConfig.categories),
      messagesToAnalyze: this.formatMessages(context.filteredMessages),
      contextText: this.formatMessages(context.contextMessages),
    });

    // Call LLM for classification
    const { data, response } = await llmHandler.requestJSON<ClassificationResponse>(
      {
        model: this.model,
        systemPrompt: rendered.system,
        userPrompt: rendered.user,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      },
      ClassificationResponseSchema,
      {
        instanceId: context.instanceId,
        batchId: context.batchId,
        purpose: 'classification',
      }
    );

    // Log the LLM response for debugging
    this.updatePromptLogResponse(context, response.text);

    // Transform LLM response into context threads
    context.threads = data.threads.map((thread, idx) => ({
      id: `thread_${context.batchId}_${idx}_${Date.now()}`,
      category: thread.category,
      messageIds: thread.messages,
      summary: thread.summary,
      docValueReason: thread.docValueReason,
      ragSearchCriteria: thread.ragSearchCriteria,
    }));

    // Update metrics
    context.metrics.llmCalls++;
    if (response.tokensUsed) {
      context.metrics.llmTokensUsed += response.tokensUsed;
    }

    this.recordTiming(context, startTime);

    this.logger.info(`Classified into ${context.threads.length} threads`, {
      categories: [...new Set(context.threads.map((t) => t.category))],
      llmTokensUsed: response.tokensUsed,
    });

    return context;
  }

  /**
   * Format categories for prompt injection
   */
  private formatCategories(categories: CategoryDefinition[]): string {
    return categories
      .map((c) => {
        let entry = `- **${c.label}** (${c.id}): ${c.description}`;
        if (c.examples && c.examples.length > 0) {
          entry += `\n  Examples: ${c.examples.join(', ')}`;
        }
        return entry;
      })
      .join('\n');
  }

  /**
   * Format messages for prompt injection
   */
  private formatMessages(messages: UnifiedMessage[]): string {
    if (messages.length === 0) {
      return '(No messages)';
    }

    return messages
      .map((m, idx) => {
        const timestamp = m.timestamp.toISOString();
        const replyInfo = m.replyToId ? ` (reply to ${m.replyToId})` : '';
        return `[${idx}] [${timestamp}] ${m.author}${replyInfo}: ${m.content}`;
      })
      .join('\n\n');
  }

  validateConfig(config: StepConfig): boolean {
    if (!super.validateConfig(config)) {
      return false;
    }

    const classifyConfig = config.config as BatchClassifyConfig;

    // Validate model if specified
    if (classifyConfig.model && typeof classifyConfig.model !== 'string') {
      this.logger.error('model must be a string');
      return false;
    }

    // Validate temperature range
    if (
      classifyConfig.temperature !== undefined &&
      (classifyConfig.temperature < 0 || classifyConfig.temperature > 2)
    ) {
      this.logger.error('temperature must be between 0 and 2');
      return false;
    }

    return true;
  }

  getMetadata(): StepMetadata {
    return {
      name: 'Batch Classifier',
      description: 'Classifies messages into conversation threads using LLM',
      version: '1.0.0',
      author: 'system',
    };
  }
}

/**
 * Factory function for BatchClassifyStep
 */
export function createBatchClassifyStep(
  config: StepConfig,
  llmHandler: ILLMHandler
): BatchClassifyStep {
  return new BatchClassifyStep(config, llmHandler);
}
