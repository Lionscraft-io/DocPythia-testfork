/**
 * Step Factory
 *
 * Factory for creating pipeline steps from configuration.
 * Registers built-in steps and allows custom step registration.
 *

 * @created 2025-12-30
 */

import { StepType, type StepConfig, type IPipelineStep, type ILLMHandler } from './interfaces.js';
import { KeywordFilterStep } from '../steps/filter/KeywordFilterStep.js';
import { BatchClassifyStep } from '../steps/classify/BatchClassifyStep.js';
import { RagEnrichStep } from '../steps/enrich/RagEnrichStep.js';
import { ContextEnrichmentStep } from '../steps/enrich/ContextEnrichmentStep.js';
import { ProposalGenerateStep } from '../steps/generate/ProposalGenerateStep.js';
import { ContentValidationStep } from '../steps/transform/ContentValidationStep.js';
import { LengthReductionStep } from '../steps/transform/LengthReductionStep.js';
import { RulesetReviewStep } from '../steps/review/RulesetReviewStep.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('StepFactory');

/**
 * Step creator function type
 */
type StepCreator = (config: StepConfig, llmHandler: ILLMHandler) => IPipelineStep;

/**
 * Factory for creating pipeline steps
 */
export class StepFactory {
  private creators: Map<string, StepCreator> = new Map();

  constructor() {
    this.registerBuiltInSteps();
  }

  /**
   * Register built-in step types
   */
  private registerBuiltInSteps(): void {
    // Filter steps
    this.register(StepType.FILTER, (config) => new KeywordFilterStep(config));

    // Classify steps
    this.register(
      StepType.CLASSIFY,
      (config, llmHandler) => new BatchClassifyStep(config, llmHandler)
    );

    // Enrich steps
    this.register(StepType.ENRICH, (config) => new RagEnrichStep(config));

    // Generate steps
    this.register(
      StepType.GENERATE,
      (config, llmHandler) => new ProposalGenerateStep(config, llmHandler)
    );

    // Transform steps - content validation
    this.register(
      StepType.VALIDATE,
      (config, llmHandler) => new ContentValidationStep(config, llmHandler)
    );

    // Transform steps - length reduction
    this.register(
      StepType.CONDENSE,
      (config, llmHandler) => new LengthReductionStep(config, llmHandler)
    );

    // Context enrichment - proposal analysis
    this.register(StepType.CONTEXT_ENRICH, (config) => new ContextEnrichmentStep(config));

    // Ruleset review - applies tenant ruleset rules
    this.register(
      StepType.RULESET_REVIEW,
      (config, llmHandler) => new RulesetReviewStep(config, llmHandler)
    );

    logger.debug('Registered built-in steps', {
      types: Array.from(this.creators.keys()),
    });
  }

  /**
   * Register a step creator
   */
  register(stepType: string, creator: StepCreator): void {
    this.creators.set(stepType, creator);
    logger.debug(`Registered step type: ${stepType}`);
  }

  /**
   * Create a step from configuration
   */
  create(config: StepConfig, llmHandler: ILLMHandler): IPipelineStep {
    const creator = this.creators.get(config.stepType);

    if (!creator) {
      throw new Error(`Unknown step type: ${config.stepType}`);
    }

    const step = creator(config, llmHandler);

    // Validate configuration
    if (!step.validateConfig(config)) {
      throw new Error(`Invalid configuration for step: ${config.stepId}`);
    }

    logger.debug(`Created step: ${config.stepId}`, {
      type: config.stepType,
      enabled: config.enabled,
    });

    return step;
  }

  /**
   * Check if a step type is registered
   */
  hasStepType(stepType: string): boolean {
    return this.creators.has(stepType);
  }

  /**
   * Get all registered step types
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.creators.keys());
  }
}

/**
 * Singleton step factory instance
 */
let defaultFactory: StepFactory | null = null;

/**
 * Get the default step factory instance
 */
export function getStepFactory(): StepFactory {
  if (!defaultFactory) {
    defaultFactory = new StepFactory();
  }
  return defaultFactory;
}

/**
 * Create a new step factory (useful for testing)
 */
export function createStepFactory(): StepFactory {
  return new StepFactory();
}

/**
 * Reset the singleton step factory (for testing)
 */
export function resetStepFactory(): void {
  defaultFactory = null;
}
