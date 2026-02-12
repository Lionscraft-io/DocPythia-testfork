/**
 * Pipeline Module
 *
 * Exports all pipeline components for easy importing.
 *

 * @created 2025-12-30
 */

// Core interfaces and types
export * from './core/interfaces.js';

// Pipeline context and orchestration
export { createPipelineContext, serializeMetrics } from './core/PipelineContext.js';
export { PipelineOrchestrator } from './core/PipelineOrchestrator.js';
export { StepFactory, getStepFactory, createStepFactory } from './core/StepFactory.js';

// LLM handlers
export { GeminiHandler, createGeminiHandler } from './handlers/GeminiHandler.js';

// Prompt management
export { PromptRegistry, createPromptRegistry } from './prompts/PromptRegistry.js';

// Configuration loaders
export {
  loadDomainConfig,
  clearDomainConfigCache,
  validateDomainConfig,
  listDomainConfigs,
  DomainConfigSchema,
} from './config/DomainConfigLoader.js';

export {
  loadPipelineConfig,
  clearPipelineConfigCache,
  validatePipelineConfig,
  listPipelineConfigs,
  getDefaultPipelineConfig,
  PipelineConfigSchema,
} from './config/PipelineConfigLoader.js';

// Pipeline steps
export { BasePipelineStep } from './steps/base/BasePipelineStep.js';
export { KeywordFilterStep, createKeywordFilterStep } from './steps/filter/KeywordFilterStep.js';
export { BatchClassifyStep, createBatchClassifyStep } from './steps/classify/BatchClassifyStep.js';
export { RagEnrichStep, createRagEnrichStep } from './steps/enrich/RagEnrichStep.js';
export {
  ProposalGenerateStep,
  createProposalGenerateStep,
} from './steps/generate/ProposalGenerateStep.js';
