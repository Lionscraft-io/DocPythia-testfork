/**
 * Base Pipeline Step
 *
 * Abstract base class for all pipeline steps.
 * Provides common functionality and enforces the step interface.
 *

 * @created 2025-12-30
 */

import type {
  IPipelineStep,
  StepType,
  StepConfig,
  StepMetadata,
  PipelineContext,
  ILLMHandler,
  StepPromptLogEntry,
} from '../../core/interfaces.js';
import { createLogger, type Logger } from '../../../utils/logger.js';

/**
 * Abstract base class for pipeline steps
 */
export abstract class BasePipelineStep implements IPipelineStep {
  readonly stepId: string;
  abstract readonly stepType: StepType;

  protected config: StepConfig;
  protected logger: Logger;
  protected llmHandler?: ILLMHandler;

  constructor(config: StepConfig, llmHandler?: ILLMHandler) {
    this.stepId = config.stepId;
    this.config = config;
    this.llmHandler = llmHandler;
    this.logger = createLogger(`Step:${config.stepId}`);
  }

  /**
   * Execute this step with the given context
   * Must be implemented by subclasses
   */
  abstract execute(context: PipelineContext): Promise<PipelineContext>;

  /**
   * Validate step configuration
   * Can be overridden by subclasses for custom validation
   */
  validateConfig(config: StepConfig): boolean {
    if (!config.stepId || typeof config.stepId !== 'string') {
      this.logger.error('Step configuration missing stepId');
      return false;
    }
    if (!config.stepType || typeof config.stepType !== 'string') {
      this.logger.error('Step configuration missing stepType');
      return false;
    }
    return true;
  }

  /**
   * Get step metadata
   * Should be overridden by subclasses to provide specific metadata
   */
  getMetadata(): StepMetadata {
    return {
      name: this.stepId,
      description: 'Pipeline step',
      version: '1.0.0',
    };
  }

  /**
   * Helper to get a required config value
   */
  protected getConfigValue<T>(key: string, defaultValue?: T): T {
    const value = this.config.config[key];
    if (value === undefined) {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw new Error(`Missing required config key: ${key}`);
    }
    return value as T;
  }

  /**
   * Helper to record step timing in metrics
   */
  protected recordTiming(context: PipelineContext, startTime: number): void {
    const duration = Date.now() - startTime;
    context.metrics.stepDurations.set(this.stepId, duration);
  }

  /**
   * Helper to add an error to context
   */
  protected addError(
    context: PipelineContext,
    error: Error,
    additionalContext?: Record<string, unknown>
  ): void {
    context.errors.push({
      stepId: this.stepId,
      message: error.message,
      error,
      context: {
        batchId: context.batchId,
        instanceId: context.instanceId,
        ...additionalContext,
      },
    });
  }

  /**
   * Helper to check if LLM handler is available
   */
  protected requireLLMHandler(): ILLMHandler {
    if (!this.llmHandler) {
      throw new Error(`Step ${this.stepId} requires LLM handler but none provided`);
    }
    return this.llmHandler;
  }

  // =========================================================================
  // Prompt/Query Logging (array-based, supports multiple entries per step)
  // =========================================================================

  /**
   * Append a prompt log entry to this step's log array.
   */
  protected appendPromptLogEntry(context: PipelineContext, entry: StepPromptLogEntry): void {
    const existing = context.stepPromptLogs.get(this.stepId) || [];
    existing.push(entry);
    context.stepPromptLogs.set(this.stepId, existing);
  }

  /**
   * Render a prompt, append it to the log array, and return rendered text.
   * Returns the rendered prompt and the entry index for later response update.
   */
  protected renderAndAppendPrompt(
    context: PipelineContext,
    promptId: string,
    variables: Record<string, unknown>,
    label: string
  ): { system: string; user: string; entryIndex: number } {
    const template = context.prompts.get(promptId);
    const rendered = context.prompts.render(promptId, variables);

    const entries = context.stepPromptLogs.get(this.stepId) || [];
    const entryIndex = entries.length;
    entries.push({
      label,
      entryType: 'llm-call',
      promptId,
      template: template
        ? { system: template.system, user: template.user }
        : { system: '', user: '' },
      resolved: { system: rendered.system, user: rendered.user },
      response: '',
    });
    context.stepPromptLogs.set(this.stepId, entries);

    return { system: rendered.system, user: rendered.user, entryIndex };
  }

  /**
   * Update the response of a specific prompt log entry by index.
   */
  protected updatePromptLogEntryResponse(
    context: PipelineContext,
    entryIndex: number,
    response: string
  ): void {
    const entries = context.stepPromptLogs.get(this.stepId);
    if (entries && entries[entryIndex]) {
      entries[entryIndex].response = response;
    }
  }

  /**
   * Append a RAG query entry to the prompt log.
   */
  protected appendRagQueryLog(
    context: PipelineContext,
    label: string,
    query: string,
    results: Array<{ filePath: string; title: string; similarity: number }>
  ): void {
    this.appendPromptLogEntry(context, {
      label,
      entryType: 'rag-query',
      query,
      resultCount: results.length,
      results,
    });
  }

  /**
   * Render a prompt and log it for debugging (single-entry convenience wrapper).
   * Clears any prior entries for this step, creating a single-entry array.
   * For multi-call steps, use renderAndAppendPrompt instead.
   */
  protected renderAndLogPrompt(
    context: PipelineContext,
    promptId: string,
    variables: Record<string, unknown>
  ): { system: string; user: string } {
    // Clear prior entries (single-entry semantics)
    context.stepPromptLogs.set(this.stepId, []);
    const { system, user } = this.renderAndAppendPrompt(context, promptId, variables, 'LLM Call');
    return { system, user };
  }

  /**
   * Update the LLM response in the prompt log (single-entry convenience wrapper).
   * Updates the last entry in the array.
   */
  protected updatePromptLogResponse(context: PipelineContext, response: string): void {
    const entries = context.stepPromptLogs.get(this.stepId);
    if (entries && entries.length > 0) {
      entries[entries.length - 1].response = response;
    }
  }
}
