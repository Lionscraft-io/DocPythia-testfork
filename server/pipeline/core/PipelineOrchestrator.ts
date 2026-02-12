/**
 * Pipeline Orchestrator
 *
 * Coordinates execution of pipeline steps in sequence.
 * Handles errors, retries, and metrics collection.
 * Logs pipeline runs to PipelineRunLog for debugging.
 *

 * @created 2025-12-30
 * @updated 2026-01-19 - Added PipelineRunLog integration
 */

import type {
  IPipelineOrchestrator,
  PipelineContext,
  PipelineConfig,
  PipelineResult,
  PipelineMetrics,
  PipelineError,
  IPipelineStep,
  ILLMHandler,
  StepPromptLogEntry,
} from './interfaces.js';
import type { Prisma } from '@prisma/client';
import { createLogger, getErrorMessage } from '../../utils/logger.js';
import { createInitialMetrics, serializeMetrics } from './PipelineContext.js';
import { StepFactory, getStepFactory } from './StepFactory.js';

const logger = createLogger('PipelineOrchestrator');

/**
 * Step execution log entry for PipelineRunLog
 */
interface StepLogEntry {
  stepName: string;
  stepType: string;
  status: 'completed' | 'failed' | 'skipped';
  durationMs: number;
  inputCount?: number;
  outputCount?: number;
  promptUsed?: string;
  error?: string;
  outputSummary?: string; // Summary of step output for debugging
  // Prompt debugging fields (legacy single-entry, kept for backward compat)
  promptId?: string;
  promptTemplate?: { system: string; user: string };
  promptResolved?: { system: string; user: string };
  llmResponse?: string;
  // Multi-entry prompt/query log (new format)
  promptEntries?: StepPromptLogEntry[];
}

/**
 * Orchestrates execution of pipeline steps
 */
export class PipelineOrchestrator implements IPipelineOrchestrator {
  private config: PipelineConfig;
  private stepFactory: StepFactory;
  private llmHandler: ILLMHandler;
  private enableRunLogging: boolean;

  constructor(
    config: PipelineConfig,
    llmHandler: ILLMHandler,
    stepFactory?: StepFactory,
    options?: { enableRunLogging?: boolean }
  ) {
    this.config = config;
    this.llmHandler = llmHandler;
    this.stepFactory = stepFactory || getStepFactory();
    this.enableRunLogging = options?.enableRunLogging ?? true;
  }

  /**
   * Execute pipeline with given context
   */
  async execute(context: PipelineContext): Promise<PipelineResult> {
    const startTime = Date.now();
    const errors: PipelineError[] = [];
    const stepLogs: StepLogEntry[] = [];
    let runLogId: number | null = null;

    logger.info(`Starting pipeline execution`, {
      instanceId: context.instanceId,
      batchId: context.batchId,
      pipelineId: this.config.pipelineId,
      messageCount: context.messages.length,
    });

    // Create initial PipelineRunLog entry
    if (this.enableRunLogging && context.db) {
      try {
        const runLog = await context.db.pipelineRunLog.create({
          data: {
            instanceId: context.instanceId,
            batchId: context.batchId,
            pipelineId: this.config.pipelineId,
            status: 'running',
            inputMessages: context.messages.length,
            steps: [],
          },
        });
        runLogId = runLog.id;
        logger.debug(`Created PipelineRunLog entry: ${runLogId}`);
      } catch (error) {
        logger.warn('Failed to create PipelineRunLog entry:', error);
      }
    }

    // Create steps from configuration
    const steps = this.createSteps();

    if (steps.length === 0) {
      logger.warn('No enabled steps in pipeline configuration');
      await this.updateRunLog(context, runLogId, 'completed', stepLogs, errors, startTime);
      return this.buildResult(context, errors, startTime);
    }

    // Execute steps in sequence
    for (const step of steps) {
      const stepStartTime = Date.now();
      const stepLog: StepLogEntry = {
        stepName: step.stepId,
        stepType: step.stepType,
        status: 'completed',
        durationMs: 0,
      };

      try {
        logger.info(`Executing step: ${step.stepId}`, {
          stepType: step.stepType,
          batchId: context.batchId,
        });

        // Capture input counts before execution
        stepLog.inputCount = this.getInputCount(step.stepType, context);

        // Skip steps that have no input to process
        if (stepLog.inputCount === 0) {
          stepLog.status = 'skipped';
          stepLog.durationMs = 0;
          stepLog.outputCount = 0;
          stepLogs.push(stepLog);

          // Update run log progressively so frontend can show step-by-step progress
          await this.updateRunLog(context, runLogId, 'running', stepLogs, [], startTime);

          logger.info(`Skipping step ${step.stepId}: no input to process`);
          continue;
        }

        // Execute with retry logic
        await this.executeStepWithRetry(step, context);

        const stepDuration = Date.now() - stepStartTime;
        context.metrics.stepDurations.set(step.stepId, stepDuration);

        // Capture output counts after execution
        stepLog.durationMs = stepDuration;
        stepLog.outputCount = this.getOutputCount(step.stepType, context);
        stepLog.status = 'completed';
        stepLog.outputSummary = this.getOutputSummary(step.stepType, context);

        // Capture prompt/query logs from context (populated by LLM and RAG steps)
        const promptEntries = context.stepPromptLogs.get(step.stepId);
        if (promptEntries && promptEntries.length > 0) {
          // Debug: log response lengths for each entry
          for (let i = 0; i < promptEntries.length; i++) {
            const entry = promptEntries[i];
            logger.debug(
              `Step ${step.stepId} entry ${i}: response length = ${entry.response?.length || 0}`
            );
          }
          stepLog.promptEntries = promptEntries;
          // Also populate legacy single fields from first LLM entry (backward compat)
          const firstLlm = promptEntries.find((e) => e.entryType === 'llm-call');
          if (firstLlm) {
            stepLog.promptId = firstLlm.promptId;
            stepLog.promptTemplate = firstLlm.template;
            stepLog.promptResolved = firstLlm.resolved;
            stepLog.llmResponse = firstLlm.response;
          }
          context.stepPromptLogs.delete(step.stepId);
        }

        stepLogs.push(stepLog);

        // Update run log progressively so frontend can show step-by-step progress
        await this.updateRunLog(context, runLogId, 'running', stepLogs, [], startTime);

        logger.debug(`Step completed: ${step.stepId}`, {
          durationMs: stepDuration,
          filteredMessages: context.filteredMessages.length,
          threads: context.threads.length,
        });
      } catch (error) {
        const stepDuration = Date.now() - stepStartTime;
        context.metrics.stepDurations.set(step.stepId, stepDuration);

        stepLog.durationMs = stepDuration;
        stepLog.status = 'failed';
        stepLog.error = getErrorMessage(error);

        // Capture prompt/query logs even on failure (may have partial data)
        const promptEntries = context.stepPromptLogs.get(step.stepId);
        if (promptEntries && promptEntries.length > 0) {
          stepLog.promptEntries = promptEntries;
          const firstLlm = promptEntries.find((e) => e.entryType === 'llm-call');
          if (firstLlm) {
            stepLog.promptId = firstLlm.promptId;
            stepLog.promptTemplate = firstLlm.template;
            stepLog.promptResolved = firstLlm.resolved;
            stepLog.llmResponse = firstLlm.response;
          }
          context.stepPromptLogs.delete(step.stepId);
        }

        stepLogs.push(stepLog);

        // Update run log progressively so frontend can show step-by-step progress
        await this.updateRunLog(context, runLogId, 'running', stepLogs, [], startTime);

        const pipelineError: PipelineError = {
          stepId: step.stepId,
          message: `Step execution failed: ${getErrorMessage(error)}`,
          error: error instanceof Error ? error : new Error(String(error)),
          context: {
            batchId: context.batchId,
            instanceId: context.instanceId,
            stepType: step.stepType,
          },
        };

        errors.push(pipelineError);
        context.errors.push(pipelineError);

        logger.error(`Step ${step.stepId} failed`, {
          error: getErrorMessage(error),
          stepType: step.stepType,
          batchId: context.batchId,
        });

        if (this.config.errorHandling.stopOnError) {
          logger.error('Stopping pipeline due to error (stopOnError=true)');
          break;
        }
      }
    }

    // Calculate final metrics
    context.metrics.totalDurationMs = Date.now() - startTime;

    const result = this.buildResult(context, errors, startTime);

    // Update PipelineRunLog with final results
    await this.updateRunLog(
      context,
      runLogId,
      result.success ? 'completed' : 'failed',
      stepLogs,
      errors,
      startTime
    );

    logger.info('Pipeline execution complete', {
      success: result.success,
      messagesProcessed: result.messagesProcessed,
      threadsCreated: result.threadsCreated,
      proposalsGenerated: result.proposalsGenerated,
      totalDurationMs: result.metrics.totalDurationMs,
      metrics: serializeMetrics(result.metrics),
    });

    return result;
  }

  /**
   * Update PipelineRunLog with execution results
   */
  private async updateRunLog(
    context: PipelineContext,
    runLogId: number | null,
    status: string,
    stepLogs: StepLogEntry[],
    errors: PipelineError[],
    startTime: number
  ): Promise<void> {
    if (!this.enableRunLogging || !context.db || !runLogId) {
      return;
    }

    try {
      const proposalsGenerated = Array.from(context.proposals.values()).reduce(
        (sum, proposals) => sum + proposals.length,
        0
      );

      await context.db.pipelineRunLog.update({
        where: { id: runLogId },
        data: {
          status,
          steps: stepLogs as unknown as Prisma.InputJsonValue,
          outputThreads: context.threads.length,
          outputProposals: proposalsGenerated,
          totalDurationMs: Date.now() - startTime,
          llmCalls: context.metrics.llmCalls,
          llmTokensUsed: context.metrics.llmTokensUsed,
          errorMessage: errors.length > 0 ? errors.map((e) => e.message).join('; ') : null,
          completedAt: new Date(),
        },
      });
      logger.debug(`Updated PipelineRunLog entry: ${runLogId}`);
    } catch (error) {
      logger.warn('Failed to update PipelineRunLog entry:', error);
    }
  }

  /**
   * Get input count for a step type
   */
  private getInputCount(stepType: string, context: PipelineContext): number {
    switch (stepType) {
      case 'filter':
        return context.messages.length;
      case 'classify':
        return context.filteredMessages.length;
      case 'enrich':
      case 'context-enrich':
        return context.threads.length;
      case 'generate':
        return context.threads.length;
      case 'ruleset-review':
      case 'validate':
      case 'condense':
        return Array.from(context.proposals.values()).reduce((sum, p) => sum + p.length, 0);
      default:
        return 0;
    }
  }

  /**
   * Get output count for a step type
   */
  private getOutputCount(stepType: string, context: PipelineContext): number {
    switch (stepType) {
      case 'filter':
        return context.filteredMessages.length;
      case 'classify':
        return context.threads.length;
      case 'enrich':
      case 'context-enrich':
        return context.ragResults.size;
      case 'generate':
      case 'ruleset-review':
      case 'validate':
      case 'condense':
        return Array.from(context.proposals.values()).reduce((sum, p) => sum + p.length, 0);
      default:
        return 0;
    }
  }

  /**
   * Get output summary for debugging - truncated JSON of step results
   */
  private getOutputSummary(stepType: string, context: PipelineContext): string {
    const MAX_LENGTH = 5000; // Limit summary size

    const truncate = (str: string) => {
      if (str.length <= MAX_LENGTH) return str;
      return str.substring(0, MAX_LENGTH) + '... [truncated]';
    };

    try {
      switch (stepType) {
        case 'filter': {
          const messages = context.filteredMessages.slice(0, 10).map((m) => ({
            id: m.id,
            author: m.author,
            content: m.content?.substring(0, 200) + (m.content?.length > 200 ? '...' : ''),
          }));
          return truncate(
            JSON.stringify(
              {
                totalFiltered: context.filteredMessages.length,
                sample: messages,
              },
              null,
              2
            )
          );
        }

        case 'classify': {
          const threads = context.threads.slice(0, 10).map((t) => ({
            id: t.id,
            category: t.category,
            summary: t.summary,
            messageCount: t.messageIds.length,
            docValueReason: t.docValueReason,
          }));
          return truncate(
            JSON.stringify(
              {
                totalThreads: context.threads.length,
                threads: threads,
              },
              null,
              2
            )
          );
        }

        case 'enrich':
        case 'context-enrich': {
          const ragSummary: Record<string, number> = {};
          context.ragResults.forEach((results, threadId) => {
            ragSummary[threadId] = results.length;
          });
          return truncate(
            JSON.stringify(
              {
                threadsEnriched: context.ragResults.size,
                resultsPerThread: ragSummary,
              },
              null,
              2
            )
          );
        }

        case 'generate': {
          const proposals: Array<{
            threadId: string;
            page: string;
            section: string;
            updateType: string;
            contentPreview: string;
          }> = [];
          context.proposals.forEach((threadProposals, threadId) => {
            threadProposals.slice(0, 5).forEach((p) => {
              proposals.push({
                threadId,
                page: p.page || 'unknown',
                section: p.section || 'unknown',
                updateType: p.updateType || 'unknown',
                contentPreview: p.suggestedText?.substring(0, 200) + '...',
              });
            });
          });
          return truncate(
            JSON.stringify(
              {
                totalProposals: Array.from(context.proposals.values()).reduce(
                  (sum, p) => sum + p.length,
                  0
                ),
                proposals: proposals,
              },
              null,
              2
            )
          );
        }

        case 'validate':
        case 'condense': {
          const proposals: Array<{
            threadId: string;
            page: string;
            section: string;
            updateType: string;
          }> = [];
          context.proposals.forEach((threadProposals, threadId) => {
            threadProposals.forEach((p) => {
              proposals.push({
                threadId,
                page: p.page || 'unknown',
                section: p.section || 'unknown',
                updateType: p.updateType || 'unknown',
              });
            });
          });
          return truncate(
            JSON.stringify(
              {
                totalProposals: proposals.length,
                proposals: proposals.slice(0, 10),
              },
              null,
              2
            )
          );
        }

        default:
          return JSON.stringify({ note: 'No summary available for this step type' });
      }
    } catch (error) {
      return JSON.stringify({
        error: 'Failed to generate summary',
        details: getErrorMessage(error),
      });
    }
  }

  /**
   * Execute a step with retry logic
   */
  private async executeStepWithRetry(step: IPipelineStep, context: PipelineContext): Promise<void> {
    const { retryAttempts, retryDelayMs } = this.config.errorHandling;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      try {
        await step.execute(context);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < retryAttempts) {
          const delay = retryDelayMs * Math.pow(2, attempt);
          logger.warn(`Step ${step.stepId} failed, retrying in ${delay}ms`, {
            attempt: attempt + 1,
            maxAttempts: retryAttempts + 1,
            error: getErrorMessage(error),
          });
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Create pipeline steps from configuration
   */
  private createSteps(): IPipelineStep[] {
    const steps: IPipelineStep[] = [];

    for (const stepConfig of this.config.steps) {
      if (!stepConfig.enabled) {
        logger.debug(`Skipping disabled step: ${stepConfig.stepId}`);
        continue;
      }

      if (!this.stepFactory.hasStepType(stepConfig.stepType)) {
        logger.warn(`No factory registered for step type: ${stepConfig.stepType}`);
        continue;
      }

      const step = this.stepFactory.create(stepConfig, this.llmHandler);
      steps.push(step);
    }

    return steps;
  }

  /**
   * Build pipeline result
   */
  private buildResult(
    context: PipelineContext,
    errors: PipelineError[],
    startTime: number
  ): PipelineResult {
    const proposalsGenerated = Array.from(context.proposals.values()).reduce(
      (sum, proposals) => sum + proposals.length,
      0
    );

    return {
      success: errors.length === 0,
      messagesProcessed: context.filteredMessages.length,
      threadsCreated: context.threads.length,
      proposalsGenerated,
      errors,
      metrics: {
        ...context.metrics,
        totalDurationMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Get pipeline configuration
   */
  getConfig(): PipelineConfig {
    return this.config;
  }

  /**
   * Register custom step creator
   */
  registerStep(
    stepType: string,
    creator: (config: any, llmHandler: ILLMHandler) => IPipelineStep
  ): void {
    this.stepFactory.register(stepType, creator);
    logger.debug(`Registered step factory: ${stepType}`);
  }

  /**
   * Get execution metrics
   */
  getMetrics(): PipelineMetrics {
    return createInitialMetrics();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
