/**
 * Pipeline Integration Tests
 *
 * Tests the integration between pipeline components:
 * - PipelineOrchestrator with StepFactory
 * - Multiple steps working together
 * - Context mutation across steps
 * - Configuration loading with overrides
 *

 * @created 2025-12-30
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineOrchestrator } from '../server/pipeline/core/PipelineOrchestrator.js';
import { createStepFactory, resetStepFactory } from '../server/pipeline/core/StepFactory.js';
import { createPipelineContext } from '../server/pipeline/core/PipelineContext.js';
import { PromptRegistry } from '../server/pipeline/prompts/PromptRegistry.js';
import { KeywordFilterStep } from '../server/pipeline/steps/filter/KeywordFilterStep.js';
import { BatchClassifyStep } from '../server/pipeline/steps/classify/BatchClassifyStep.js';
import { RagEnrichStep } from '../server/pipeline/steps/enrich/RagEnrichStep.js';
import { ProposalGenerateStep } from '../server/pipeline/steps/generate/ProposalGenerateStep.js';
import {
  StepType,
  type PipelineConfig,
  type PipelineContext,
  type UnifiedMessage,
  type IDomainConfig,
  type ILLMHandler,
  type IPromptRegistry,
  type IRagService,
  type RagDocument,
} from '../server/pipeline/core/interfaces.js';

// Mock the logger
vi.mock('../server/utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  hasErrorMessage: (error: unknown, message: string) =>
    error instanceof Error && error.message === message,
}));

// Test fixtures
function createTestMessages(): UnifiedMessage[] {
  return [
    {
      id: 1,
      messageId: 'msg-1',
      streamId: 'test-stream',
      timestamp: new Date('2025-01-01T10:00:00Z'),
      author: 'alice',
      content: 'My validator node is not syncing properly after the upgrade',
      processingStatus: 'PENDING',
    },
    {
      id: 2,
      messageId: 'msg-2',
      streamId: 'test-stream',
      timestamp: new Date('2025-01-01T10:05:00Z'),
      author: 'bob',
      content: 'Have you tried checking the RPC endpoint configuration?',
      processingStatus: 'PENDING',
    },
    {
      id: 3,
      messageId: 'msg-3',
      streamId: 'test-stream',
      timestamp: new Date('2025-01-01T10:10:00Z'),
      author: 'alice',
      content: 'Yes, the staking pool shows incorrect rewards too',
      processingStatus: 'PENDING',
    },
    {
      id: 4,
      messageId: 'msg-4',
      streamId: 'test-stream',
      timestamp: new Date('2025-01-01T11:00:00Z'),
      author: 'charlie',
      content: 'Random NFT marketplace discussion',
      processingStatus: 'PENDING',
    },
  ];
}

function createTestDomainConfig(): IDomainConfig {
  return {
    domainId: 'test-validators',
    name: 'Test Validator Domain',
    categories: [
      {
        id: 'validator-troubleshooting',
        label: 'Validator Troubleshooting',
        description: 'Validator node issues and problems',
        priority: 100,
      },
      {
        id: 'staking-rewards',
        label: 'Staking & Rewards',
        description: 'Staking mechanisms and reward issues',
        priority: 80,
      },
      {
        id: 'no-doc-value',
        label: 'No Documentation Value',
        description: 'Off-topic discussions',
        priority: 0,
      },
    ],
    keywords: {
      include: ['validator', 'staking', 'node', 'rpc'],
      exclude: ['nft', 'marketplace'],
      caseSensitive: false,
    },
    ragPaths: {
      include: ['docs/validator/**'],
      exclude: ['i18n/**'],
    },
    security: {
      blockPatterns: ['private[_\\s]?key'],
      requireApproval: false,
      maxProposalsPerBatch: 10,
    },
    context: {
      projectName: 'Test Protocol',
      domain: 'Validator Operations',
      targetAudience: 'Node operators',
      documentationPurpose: 'Technical guidance for validators',
    },
  };
}

function createTestPipelineConfig(): PipelineConfig {
  return {
    instanceId: 'test',
    pipelineId: 'test-pipeline-v1',
    description: 'Test pipeline configuration',
    steps: [
      {
        stepId: 'keyword-filter',
        stepType: StepType.FILTER,
        enabled: true,
        config: {
          includeKeywords: ['validator', 'staking', 'node', 'rpc'],
          excludeKeywords: ['nft', 'marketplace'],
          caseSensitive: false,
        },
      },
      {
        stepId: 'batch-classify',
        stepType: StepType.CLASSIFY,
        enabled: true,
        config: {
          promptId: 'thread-classification',
          model: 'gemini-2.5-flash',
          temperature: 0.2,
        },
      },
      {
        stepId: 'rag-enrich',
        stepType: StepType.ENRICH,
        enabled: true,
        config: {
          topK: 3,
          minSimilarity: 0.6,
        },
      },
      {
        stepId: 'proposal-generate',
        stepType: StepType.GENERATE,
        enabled: true,
        config: {
          promptId: 'changeset-generation',
          model: 'gemini-2.5-pro',
          temperature: 0.4,
        },
      },
    ],
    errorHandling: {
      stopOnError: false,
      retryAttempts: 1,
      retryDelayMs: 100,
    },
    performance: {
      maxConcurrentSteps: 1,
      timeoutMs: 30000,
      enableCaching: true,
    },
  };
}

function createMockLLMHandler(): ILLMHandler {
  return {
    name: 'mock-llm',
    requestJSON: vi.fn().mockImplementation(async (request, schema, context) => {
      // Return different responses based on purpose
      if (context.purpose === 'classification') {
        return {
          data: {
            threads: [
              {
                category: 'validator-troubleshooting',
                messages: [0, 1, 2],
                summary: 'Validator sync issues after upgrade',
                docValueReason: 'Common validator troubleshooting scenario',
                ragSearchCriteria: {
                  keywords: ['validator', 'sync', 'upgrade'],
                  semanticQuery: 'validator node not syncing after upgrade',
                },
              },
            ],
          },
          response: {
            text: '{}',
            model: 'gemini-2.5-flash',
            tokensUsed: 1500,
          },
        };
      } else if (context.purpose === 'proposal') {
        return {
          data: {
            proposals: [
              {
                updateType: 'UPDATE',
                page: 'docs/validator/troubleshooting.md',
                section: 'Sync Issues',
                suggestedText: 'After upgrading, verify RPC endpoint configuration...',
                reasoning: 'Multiple users reporting sync issues after upgrade',
                sourceMessages: [0, 1],
              },
            ],
            proposalsRejected: false,
          },
          response: {
            text: '{}',
            model: 'gemini-2.5-pro',
            tokensUsed: 2000,
          },
        };
      }
      return { data: {}, response: { text: '{}', model: 'test' } };
    }),
    requestText: vi.fn().mockResolvedValue({
      text: 'Mock response',
      model: 'test',
      tokensUsed: 100,
    }),
    getModelInfo: vi.fn().mockReturnValue({
      provider: 'mock',
      maxInputTokens: 100000,
      maxOutputTokens: 4096,
      supportsFunctionCalling: false,
      supportsStreaming: false,
    }),
    estimateCost: vi.fn().mockReturnValue({
      inputTokens: 1000,
      outputTokens: 500,
      estimatedCostUSD: 0.01,
    }),
  };
}

function createMockRagService(): IRagService {
  return {
    searchSimilarDocs: vi.fn().mockResolvedValue([
      {
        id: 1,
        filePath: 'docs/validator/troubleshooting.md',
        title: 'Validator Troubleshooting Guide',
        content: '# Troubleshooting\n\nCommon issues with validators...',
        similarity: 0.85,
      },
      {
        id: 2,
        filePath: 'docs/validator/setup.md',
        title: 'Validator Setup',
        content: '# Setup Guide\n\nHow to set up a validator node...',
        similarity: 0.75,
      },
    ] as RagDocument[]),
  };
}

function createMockPromptRegistry(): IPromptRegistry {
  const registry = new PromptRegistry('/fake/path');

  // Add test prompts
  registry.addTemplate({
    id: 'thread-classification',
    version: '1.0.0',
    metadata: {
      description: 'Classification prompt',
      requiredVariables: [
        'projectName',
        'domain',
        'categories',
        'messagesToAnalyze',
        'contextText',
      ],
    },
    system: 'You are analyzing conversations for {{projectName}} {{domain}}.',
    user: 'Classify these messages:\n\n{{messagesToAnalyze}}',
  });

  registry.addTemplate({
    id: 'changeset-generation',
    version: '1.0.0',
    metadata: {
      description: 'Proposal generation prompt',
      requiredVariables: ['projectName', 'domain', 'threadSummary', 'ragContext', 'messages'],
    },
    system: 'You are a documentation expert for {{projectName}}.',
    user: 'Generate proposals for:\n\n{{threadSummary}}\n\nContext:\n{{ragContext}}',
  });

  return registry;
}

describe('Pipeline Integration', () => {
  // Reset singleton before each test to avoid cross-test pollution
  beforeEach(() => {
    resetStepFactory();
  });

  describe('StepFactory Integration', () => {
    it('should create all step types from configuration', () => {
      const factory = createStepFactory();
      const llmHandler = createMockLLMHandler();
      const config = createTestPipelineConfig();

      const steps = config.steps.map((stepConfig) => factory.create(stepConfig, llmHandler));

      expect(steps).toHaveLength(4);
      expect(steps[0]).toBeInstanceOf(KeywordFilterStep);
      expect(steps[1]).toBeInstanceOf(BatchClassifyStep);
      expect(steps[2]).toBeInstanceOf(RagEnrichStep);
      expect(steps[3]).toBeInstanceOf(ProposalGenerateStep);
    });

    it('should throw for unknown step type', () => {
      const factory = createStepFactory();
      const llmHandler = createMockLLMHandler();

      expect(() =>
        factory.create(
          {
            stepId: 'unknown',
            stepType: 'unknown' as StepType,
            enabled: true,
            config: {},
          },
          llmHandler
        )
      ).toThrow('Unknown step type');
    });
  });

  describe('PipelineOrchestrator Integration', () => {
    let orchestrator: PipelineOrchestrator;
    let llmHandler: ILLMHandler;
    let context: PipelineContext;

    beforeEach(() => {
      llmHandler = createMockLLMHandler();
      orchestrator = new PipelineOrchestrator(
        createTestPipelineConfig(),
        llmHandler,
        createStepFactory()
      );

      context = createPipelineContext({
        instanceId: 'test',
        batchId: 'test-batch-001',
        streamId: 'test-stream',
        messages: createTestMessages(),
        domainConfig: createTestDomainConfig(),
        prompts: createMockPromptRegistry(),
        llmHandler,
        ragService: createMockRagService(),
        db: {} as any,
      });
    });

    it('should execute all steps in sequence', async () => {
      const result = await orchestrator.execute(context);

      expect(result.success).toBe(true);
      expect(result.metrics.stepDurations.size).toBe(4);
      expect(result.metrics.stepDurations.has('keyword-filter')).toBe(true);
      expect(result.metrics.stepDurations.has('batch-classify')).toBe(true);
      expect(result.metrics.stepDurations.has('rag-enrich')).toBe(true);
      expect(result.metrics.stepDurations.has('proposal-generate')).toBe(true);
    });

    it('should filter messages before classification', async () => {
      await orchestrator.execute(context);

      // Message 4 (NFT marketplace) should be filtered out
      expect(context.filteredMessages.length).toBeLessThan(context.messages.length);
      expect(context.filteredMessages.every((m) => !m.content.includes('NFT'))).toBe(true);
    });

    it('should create threads from classification', async () => {
      await orchestrator.execute(context);

      expect(context.threads.length).toBeGreaterThan(0);
      expect(context.threads[0].category).toBe('validator-troubleshooting');
    });

    it('should enrich threads with RAG context', async () => {
      await orchestrator.execute(context);

      expect(context.ragResults.size).toBeGreaterThan(0);

      // Get first thread's RAG results
      const firstThreadId = context.threads[0]?.id;
      if (firstThreadId) {
        const ragDocs = context.ragResults.get(firstThreadId);
        expect(ragDocs).toBeDefined();
        expect(ragDocs!.length).toBeGreaterThan(0);
      }
    });

    it('should generate proposals', async () => {
      const result = await orchestrator.execute(context);

      expect(result.proposalsGenerated).toBeGreaterThan(0);
      expect(context.proposals.size).toBeGreaterThan(0);
    });

    it('should track metrics correctly', async () => {
      const result = await orchestrator.execute(context);

      // totalDurationMs may be 0 in fast test runs, so we check >= 0
      expect(result.metrics.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.llmCalls).toBe(2); // Classification + Proposal
      expect(result.metrics.llmTokensUsed).toBe(3500); // 1500 + 2000
    });

    it('should handle step errors gracefully when stopOnError is false', async () => {
      // Create an orchestrator with no retries to ensure error is recorded
      const noRetryConfig = createTestPipelineConfig();
      noRetryConfig.errorHandling.retryAttempts = 0;
      const noRetryOrchestrator = new PipelineOrchestrator(
        noRetryConfig,
        llmHandler,
        createStepFactory()
      );

      // Make the classify step fail
      (llmHandler.requestJSON as any).mockRejectedValueOnce(new Error('LLM Error'));

      const result = await noRetryOrchestrator.execute(context);

      // Pipeline should continue despite error
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].stepId).toBe('batch-classify');
    });

    it('should skip disabled steps', async () => {
      const configWithDisabled = createTestPipelineConfig();
      configWithDisabled.steps[2].enabled = false; // Disable rag-enrich

      const orchestrator = new PipelineOrchestrator(
        configWithDisabled,
        llmHandler,
        createStepFactory()
      );
      const result = await orchestrator.execute(context);

      expect(result.metrics.stepDurations.has('rag-enrich')).toBe(false);
      expect(result.metrics.stepDurations.size).toBe(3);
    });
  });

  describe('Context Mutation Across Steps', () => {
    it('should pass mutated context between steps', async () => {
      const llmHandler = createMockLLMHandler();
      const orchestrator = new PipelineOrchestrator(
        createTestPipelineConfig(),
        llmHandler,
        createStepFactory()
      );

      const context = createPipelineContext({
        instanceId: 'test',
        batchId: 'test-batch',
        streamId: 'test-stream',
        messages: createTestMessages(),
        domainConfig: createTestDomainConfig(),
        prompts: createMockPromptRegistry(),
        llmHandler,
        ragService: createMockRagService(),
        db: {} as any,
      });

      // Initial state
      expect(context.filteredMessages).toHaveLength(4);
      expect(context.threads).toHaveLength(0);
      expect(context.ragResults.size).toBe(0);
      expect(context.proposals.size).toBe(0);

      await orchestrator.execute(context);

      // After pipeline
      expect(context.filteredMessages.length).toBeLessThan(4); // Filtered
      expect(context.threads.length).toBeGreaterThan(0); // Classified
      expect(context.ragResults.size).toBeGreaterThan(0); // Enriched
      expect(context.proposals.size).toBeGreaterThan(0); // Generated
    });
  });

  describe('Configuration Override Integration', () => {
    it('should use domain config for filtering', async () => {
      const llmHandler = createMockLLMHandler();
      const domainConfig = createTestDomainConfig();

      // Add more specific exclusions
      domainConfig.keywords!.exclude = ['nft', 'marketplace', 'random'];

      const context = createPipelineContext({
        instanceId: 'test',
        batchId: 'test-batch',
        streamId: 'test-stream',
        messages: createTestMessages(),
        domainConfig,
        prompts: createMockPromptRegistry(),
        llmHandler,
        ragService: createMockRagService(),
        db: {} as any,
      });

      const filterStep = new KeywordFilterStep({
        stepId: 'filter',
        stepType: StepType.FILTER,
        enabled: true,
        config: {
          includeKeywords: domainConfig.keywords!.include,
          excludeKeywords: domainConfig.keywords!.exclude,
        },
      });

      await filterStep.execute(context);

      // Should filter out the NFT message (contains 'Random')
      expect(context.filteredMessages.every((m) => !m.content.includes('Random'))).toBe(true);
    });
  });

  describe('Error Handling Integration', () => {
    it('should stop on error when configured', async () => {
      const llmHandler = createMockLLMHandler();
      const config = createTestPipelineConfig();
      config.errorHandling.stopOnError = true;
      config.errorHandling.retryAttempts = 0; // No retries to ensure immediate error

      // Make classify fail
      (llmHandler.requestJSON as any).mockRejectedValueOnce(new Error('Critical Error'));

      const orchestrator = new PipelineOrchestrator(config, llmHandler, createStepFactory());
      const context = createPipelineContext({
        instanceId: 'test',
        batchId: 'test-batch',
        streamId: 'test-stream',
        messages: createTestMessages(),
        domainConfig: createTestDomainConfig(),
        prompts: createMockPromptRegistry(),
        llmHandler,
        ragService: createMockRagService(),
        db: {} as any,
      });

      const result = await orchestrator.execute(context);

      expect(result.success).toBe(false);
      // Should stop after classify step fails
      expect(result.metrics.stepDurations.has('rag-enrich')).toBe(false);
      expect(result.metrics.stepDurations.has('proposal-generate')).toBe(false);
    });

    it('should retry failed steps', async () => {
      const llmHandler = createMockLLMHandler();
      const config = createTestPipelineConfig();
      config.errorHandling.retryAttempts = 2;
      config.errorHandling.retryDelayMs = 10;

      // Fail first two attempts, succeed on third
      (llmHandler.requestJSON as any)
        .mockRejectedValueOnce(new Error('Transient Error 1'))
        .mockRejectedValueOnce(new Error('Transient Error 2'))
        .mockResolvedValueOnce({
          data: {
            threads: [
              {
                category: 'troubleshooting',
                messages: [0],
                summary: 'Test',
                docValueReason: 'Test',
                ragSearchCriteria: { keywords: [], semanticQuery: '' },
              },
            ],
          },
          response: { text: '{}', model: 'test', tokensUsed: 100 },
        });

      const orchestrator = new PipelineOrchestrator(config, llmHandler, createStepFactory());
      const context = createPipelineContext({
        instanceId: 'test',
        batchId: 'test-batch',
        streamId: 'test-stream',
        messages: createTestMessages(),
        domainConfig: createTestDomainConfig(),
        prompts: createMockPromptRegistry(),
        llmHandler,
        ragService: createMockRagService(),
        db: {} as any,
      });

      const result = await orchestrator.execute(context);

      // Should succeed after retries
      expect(result.errors.some((e) => e.stepId === 'batch-classify')).toBe(false);
    });
  });
});
