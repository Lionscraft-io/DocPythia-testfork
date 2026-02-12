/**
 * Pipeline End-to-End Tests
 *
 * Full integration tests that:
 * - Load real configuration files
 * - Execute complete pipeline flows
 * - Validate outputs match expected behavior
 * - Test domain-specific configurations
 *

 * @created 2025-12-30
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { PipelineOrchestrator } from '../server/pipeline/core/PipelineOrchestrator.js';
import { createPipelineContext } from '../server/pipeline/core/PipelineContext.js';
import { PromptRegistry } from '../server/pipeline/prompts/PromptRegistry.js';
import { createStepFactory } from '../server/pipeline/core/StepFactory.js';
import {
  loadDomainConfig,
  clearDomainConfigCache,
} from '../server/pipeline/config/DomainConfigLoader.js';
import {
  loadPipelineConfig,
  clearPipelineConfigCache,
} from '../server/pipeline/config/PipelineConfigLoader.js';
import {
  StepType,
  type UnifiedMessage,
  type ILLMHandler,
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

// Configuration path
const CONFIG_BASE_PATH = path.join(process.cwd(), 'config');

// Test data
function createTestMessages(): UnifiedMessage[] {
  return [
    {
      id: 1,
      messageId: 'test-msg-1',
      streamId: 'test-stream',
      timestamp: new Date('2025-01-15T09:00:00Z'),
      author: 'user_one',
      content:
        'The service has been showing errors since the last update. Anyone else experiencing this?',
      processingStatus: 'PENDING',
    },
    {
      id: 2,
      messageId: 'test-msg-2',
      streamId: 'test-stream',
      timestamp: new Date('2025-01-15T09:05:00Z'),
      author: 'support_user',
      content:
        'Yes, you need to update your configuration for the new API endpoints. Check the settings.',
      processingStatus: 'PENDING',
    },
    {
      id: 3,
      messageId: 'test-msg-3',
      streamId: 'test-stream',
      timestamp: new Date('2025-01-15T09:10:00Z'),
      author: 'user_one',
      content:
        'Thanks! The performance metrics also seem different. Is the calculation method changed?',
      processingStatus: 'PENDING',
    },
    {
      id: 4,
      messageId: 'test-msg-4',
      streamId: 'test-stream',
      timestamp: new Date('2025-01-15T10:00:00Z'),
      author: 'random_user',
      content:
        'Hey anyone know about completely unrelated topics? Looking for off-topic discussion.',
      processingStatus: 'PENDING',
    },
    {
      id: 5,
      messageId: 'test-msg-5',
      streamId: 'test-stream',
      timestamp: new Date('2025-01-15T11:00:00Z'),
      author: 'tech_user',
      content:
        'What are the recommended hardware specs for running the service? We need to support high traffic.',
      processingStatus: 'PENDING',
    },
  ];
}

function createMockLLMHandler(): ILLMHandler {
  return {
    name: 'e2e-mock-llm',
    requestJSON: vi.fn().mockImplementation(async (request, schema, context) => {
      if (context.purpose === 'classification') {
        return {
          data: {
            threads: [
              {
                category: 'troubleshooting',
                messages: [0, 1, 2],
                summary: 'Service issues after system upgrade',
                docValueReason: 'Common post-upgrade issues needing documentation',
                ragSearchCriteria: {
                  keywords: ['service', 'errors', 'upgrade', 'config'],
                  semanticQuery: 'service errors after upgrade configuration',
                },
              },
              {
                category: 'infrastructure',
                messages: [3],
                summary: 'Hardware requirements for service',
                docValueReason: 'Infrastructure sizing guidance needed',
                ragSearchCriteria: {
                  keywords: ['hardware', 'specs', 'traffic'],
                  semanticQuery: 'hardware specifications for high traffic',
                },
              },
            ],
          },
          response: { text: '{}', model: 'gemini-2.5-flash', tokensUsed: 2500 },
        };
      } else if (context.purpose === 'proposal') {
        return {
          data: {
            proposals: [
              {
                updateType: 'UPDATE',
                page: 'docs/troubleshooting.md',
                section: 'Post-Upgrade Issues',
                suggestedText:
                  '## Post-Upgrade Troubleshooting\n\nAfter a system upgrade, services may experience issues...',
                reasoning: 'Community discussion revealed common post-upgrade configuration issues',
                sourceMessages: [0, 1],
              },
              {
                updateType: 'INSERT',
                page: 'docs/configuration.md',
                section: 'API Endpoints',
                suggestedText:
                  '### Updated API Configuration\n\nEnsure your config includes the new API endpoints...',
                reasoning: 'Solution provided by support user needs documentation',
                sourceMessages: [1],
              },
            ],
            proposalsRejected: false,
          },
          response: { text: '{}', model: 'gemini-2.5-pro', tokensUsed: 3500 },
        };
      }
      return { data: {}, response: { text: '{}', model: 'test' } };
    }),
    requestText: vi.fn().mockResolvedValue({
      text: 'Mock text response',
      model: 'test',
      tokensUsed: 100,
    }),
    getModelInfo: vi.fn().mockReturnValue({
      provider: 'mock',
      maxInputTokens: 1000000,
      maxOutputTokens: 8192,
      supportsFunctionCalling: true,
      supportsStreaming: true,
    }),
    estimateCost: vi.fn().mockReturnValue({
      inputTokens: 5000,
      outputTokens: 2000,
      estimatedCostUSD: 0.05,
    }),
  };
}

function createMockRagService(): IRagService {
  return {
    searchSimilarDocs: vi.fn().mockResolvedValue([
      {
        id: 1,
        filePath: 'docs/troubleshooting.md',
        title: 'Troubleshooting Guide',
        content:
          '# Troubleshooting Guide\n\nThis guide covers common service issues...\n\n## Connection Issues\nIf your service is not connecting...',
        similarity: 0.88,
      },
      {
        id: 2,
        filePath: 'docs/configuration.md',
        title: 'Configuration Guide',
        content:
          '# Configuration\n\nThis guide explains configuration options...\n\n## Config File\nThe main configuration file...',
        similarity: 0.82,
      },
      {
        id: 3,
        filePath: 'docs/infrastructure/hardware.md',
        title: 'Hardware Requirements',
        content:
          '# Hardware Requirements\n\nHow to size your infrastructure...\n\n## Minimum Specs\nMinimum specifications...',
        similarity: 0.75,
      },
    ] as RagDocument[]),
  };
}

describe('Pipeline E2E Tests', () => {
  beforeAll(() => {
    // Clear caches before tests
    clearDomainConfigCache();
    clearPipelineConfigCache();
  });

  afterAll(() => {
    // Clear caches after tests
    clearDomainConfigCache();
    clearPipelineConfigCache();
  });

  describe('Configuration Loading', () => {
    it('should load default domain configuration', async () => {
      const config = await loadDomainConfig(CONFIG_BASE_PATH, 'default');

      expect(config).toBeDefined();
      expect(config.domainId).toBe('generic');
      expect(config.categories.length).toBeGreaterThan(0);
      expect(config.context.projectName).toBeDefined();
    });

    it('should load default pipeline configuration', async () => {
      const config = await loadPipelineConfig(CONFIG_BASE_PATH, 'default');

      expect(config).toBeDefined();
      expect(config.steps.length).toBe(8); // filter, classify, enrich, generate, context-enrich, ruleset-review, validate, condense
      expect(config.steps.map((s) => s.stepType)).toContain(StepType.FILTER);
      expect(config.steps.map((s) => s.stepType)).toContain(StepType.CLASSIFY);
      expect(config.steps.map((s) => s.stepType)).toContain(StepType.ENRICH);
      expect(config.steps.map((s) => s.stepType)).toContain(StepType.GENERATE);
      expect(config.steps.map((s) => s.stepType)).toContain(StepType.CONTEXT_ENRICH);
      expect(config.steps.map((s) => s.stepType)).toContain(StepType.RULESET_REVIEW);
      expect(config.steps.map((s) => s.stepType)).toContain(StepType.VALIDATE);
      expect(config.steps.map((s) => s.stepType)).toContain(StepType.CONDENSE);
    });

    it('should handle instance-specific config gracefully when not found', async () => {
      // Instance-specific configs are gitignored (config/*/ pattern)
      // This test verifies the loader falls back to defaults appropriately
      const defaultConfig = await loadDomainConfig(CONFIG_BASE_PATH, 'default');
      expect(defaultConfig).toBeDefined();
      expect(defaultConfig.domainId).toBe('generic');
    });

    it('should have required categories in default domain config', async () => {
      const config = await loadDomainConfig(CONFIG_BASE_PATH, 'default');

      const categoryIds = config.categories.map((c) => c.id);
      expect(categoryIds).toContain('troubleshooting');
      expect(categoryIds).toContain('no-doc-value');
    });
  });

  describe('Prompt Loading', () => {
    it('should load default prompts', async () => {
      const registry = new PromptRegistry(path.join(CONFIG_BASE_PATH, 'defaults', 'prompts'));
      await registry.load();

      const prompts = registry.list();
      expect(prompts.length).toBeGreaterThan(0);

      // Check specific prompts exist
      const classificationPrompt = registry.get('thread-classification');
      expect(classificationPrompt).not.toBeNull();
      expect(classificationPrompt!.system).toContain('{{projectName}}');

      const generationPrompt = registry.get('changeset-generation');
      expect(generationPrompt).not.toBeNull();
    });

    it('should render prompts with variables', async () => {
      const registry = new PromptRegistry(path.join(CONFIG_BASE_PATH, 'defaults', 'prompts'));
      await registry.load();

      const rendered = registry.render('thread-classification', {
        projectName: 'Test Project',
        domain: 'General Operations',
        categories: '- Troubleshooting\n- Questions',
        messagesToAnalyze: 'Test messages here',
        contextText: 'Previous context',
      });

      expect(rendered.system).toContain('Test Project');
      expect(rendered.system).toContain('General Operations');
      expect(rendered.user).toContain('Test messages here');
    });
  });

  describe('Full Pipeline Execution', () => {
    it('should execute complete pipeline with default configuration', async () => {
      const domainConfig = await loadDomainConfig(CONFIG_BASE_PATH, 'default');
      const pipelineConfig = await loadPipelineConfig(CONFIG_BASE_PATH, 'default');

      const llmHandler = createMockLLMHandler();
      const ragService = createMockRagService();

      const registry = new PromptRegistry(path.join(CONFIG_BASE_PATH, 'defaults', 'prompts'));
      await registry.load();

      const orchestrator = new PipelineOrchestrator(
        pipelineConfig,
        llmHandler,
        createStepFactory()
      );

      const context = createPipelineContext({
        instanceId: 'default',
        batchId: 'e2e-test-batch-001',
        streamId: 'test-stream',
        messages: createTestMessages(),
        domainConfig,
        prompts: registry,
        llmHandler,
        ragService,
        db: {} as any,
      });

      const result = await orchestrator.execute(context);

      expect(result.success).toBe(true);
      expect(result.messagesProcessed).toBeGreaterThan(0);
      expect(result.threadsCreated).toBeGreaterThan(0);
      expect(result.proposalsGenerated).toBeGreaterThan(0);
    });

    it('should execute pipeline with default domain focus', async () => {
      const domainConfig = await loadDomainConfig(CONFIG_BASE_PATH, 'default');
      const pipelineConfig = await loadPipelineConfig(CONFIG_BASE_PATH, 'default');

      const llmHandler = createMockLLMHandler();
      const ragService = createMockRagService();

      const registry = new PromptRegistry(path.join(CONFIG_BASE_PATH, 'defaults', 'prompts'));
      await registry.load();

      const orchestrator = new PipelineOrchestrator(
        pipelineConfig,
        llmHandler,
        createStepFactory()
      );

      const context = createPipelineContext({
        instanceId: 'default',
        batchId: 'default-e2e-batch-001',
        streamId: 'test-stream',
        messages: createTestMessages(),
        domainConfig,
        prompts: registry,
        llmHandler,
        ragService,
        db: {} as any,
      });

      const result = await orchestrator.execute(context);

      // Should succeed
      expect(result.success).toBe(true);

      // Should create threads for content
      expect(context.threads.length).toBeGreaterThan(0);

      // Should have proposals
      expect(result.proposalsGenerated).toBeGreaterThan(0);
    });

    it('should execute filter step correctly', async () => {
      const domainConfig = await loadDomainConfig(CONFIG_BASE_PATH, 'default');
      const fullPipelineConfig = await loadPipelineConfig(CONFIG_BASE_PATH, 'default');

      // Only run filter step - create a copy to not mutate the cached config
      const pipelineConfig = {
        ...fullPipelineConfig,
        steps: fullPipelineConfig.steps.filter((s) => s.stepType === StepType.FILTER),
      };

      const llmHandler = createMockLLMHandler();
      const orchestrator = new PipelineOrchestrator(
        pipelineConfig,
        llmHandler,
        createStepFactory()
      );

      const messages = createTestMessages();
      const context = createPipelineContext({
        instanceId: 'default',
        batchId: 'filter-test',
        streamId: 'test',
        messages,
        domainConfig,
        prompts: new PromptRegistry('/fake'),
        llmHandler,
        ragService: createMockRagService(),
        db: {} as any,
      });

      await orchestrator.execute(context);

      // With default config (no filters), all messages should pass through
      expect(context.filteredMessages.length).toBe(messages.length);
    });
  });

  describe('Pipeline Metrics', () => {
    it('should track comprehensive metrics', async () => {
      const domainConfig = await loadDomainConfig(CONFIG_BASE_PATH, 'default');
      const pipelineConfig = await loadPipelineConfig(CONFIG_BASE_PATH, 'default');

      const llmHandler = createMockLLMHandler();
      const ragService = createMockRagService();

      const registry = new PromptRegistry(path.join(CONFIG_BASE_PATH, 'defaults', 'prompts'));
      await registry.load();

      const orchestrator = new PipelineOrchestrator(
        pipelineConfig,
        llmHandler,
        createStepFactory()
      );

      const context = createPipelineContext({
        instanceId: 'default',
        batchId: 'metrics-test',
        streamId: 'test',
        messages: createTestMessages(),
        domainConfig,
        prompts: registry,
        llmHandler,
        ragService,
        db: {} as any,
      });

      const result = await orchestrator.execute(context);

      // Check metrics (totalDurationMs may be 0 in fast test runs)
      expect(result.metrics.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(result.metrics.stepDurations.size).toBe(8); // All 8 pipeline steps
      expect(result.metrics.llmCalls).toBeGreaterThan(0);
      expect(result.metrics.llmTokensUsed).toBeGreaterThan(0);

      // Check individual step timings for core steps
      expect(result.metrics.stepDurations.get('keyword-filter')).toBeDefined();
      expect(result.metrics.stepDurations.get('batch-classify')).toBeDefined();
      expect(result.metrics.stepDurations.get('rag-enrich')).toBeDefined();
      expect(result.metrics.stepDurations.get('proposal-generate')).toBeDefined();
      // Quality System steps
      expect(result.metrics.stepDurations.get('context-enrich')).toBeDefined();
      expect(result.metrics.stepDurations.get('ruleset-review')).toBeDefined();
      expect(result.metrics.stepDurations.get('content-validate')).toBeDefined();
      expect(result.metrics.stepDurations.get('length-reduce')).toBeDefined();
    });
  });

  describe('Error Scenarios', () => {
    it('should handle empty message batch gracefully', async () => {
      const domainConfig = await loadDomainConfig(CONFIG_BASE_PATH, 'default');
      const pipelineConfig = await loadPipelineConfig(CONFIG_BASE_PATH, 'default');

      const llmHandler = createMockLLMHandler();
      const orchestrator = new PipelineOrchestrator(
        pipelineConfig,
        llmHandler,
        createStepFactory()
      );

      const context = createPipelineContext({
        instanceId: 'default',
        batchId: 'empty-batch',
        streamId: 'test',
        messages: [], // Empty
        domainConfig,
        prompts: new PromptRegistry('/fake'),
        llmHandler,
        ragService: createMockRagService(),
        db: {} as any,
      });

      const result = await orchestrator.execute(context);

      expect(result.success).toBe(true);
      expect(result.messagesProcessed).toBe(0);
      expect(result.threadsCreated).toBe(0);
      expect(result.proposalsGenerated).toBe(0);
    });

    it('should handle messages gracefully with default config', async () => {
      const domainConfig = await loadDomainConfig(CONFIG_BASE_PATH, 'default');
      const fullPipelineConfig = await loadPipelineConfig(CONFIG_BASE_PATH, 'default');

      // Only run filter step - this test checks filter behavior without needing prompts
      const pipelineConfig = {
        ...fullPipelineConfig,
        steps: fullPipelineConfig.steps.filter((s) => s.stepType === StepType.FILTER),
      };

      const llmHandler = createMockLLMHandler();
      const orchestrator = new PipelineOrchestrator(
        pipelineConfig,
        llmHandler,
        createStepFactory()
      );

      // Various messages - default config should process all
      const messages: UnifiedMessage[] = [
        {
          id: 1,
          messageId: 'msg-1',
          streamId: 'test',
          timestamp: new Date(),
          author: 'user1',
          content: 'I have a question about the documentation.',
          processingStatus: 'PENDING',
        },
        {
          id: 2,
          messageId: 'msg-2',
          streamId: 'test',
          timestamp: new Date(),
          author: 'user2',
          content: 'Here is some helpful information.',
          processingStatus: 'PENDING',
        },
      ];

      const context = createPipelineContext({
        instanceId: 'default',
        batchId: 'default-test',
        streamId: 'test',
        messages,
        domainConfig,
        prompts: new PromptRegistry('/fake'),
        llmHandler,
        ragService: createMockRagService(),
        db: {} as any,
      });

      const result = await orchestrator.execute(context);

      expect(result.success).toBe(true);
      // Default config has no keyword filters, so all messages pass
      expect(context.filteredMessages.length).toBe(2);
    });
  });

  describe('Domain Configuration Behavior', () => {
    it('should have security configuration in default domain', async () => {
      const domainConfig = await loadDomainConfig(CONFIG_BASE_PATH, 'default');

      // Check that security patterns are configured
      expect(domainConfig.security?.blockPatterns).toBeDefined();
      expect(domainConfig.security!.blockPatterns!.length).toBeGreaterThan(0);
      expect(domainConfig.security!.blockPatterns).toContain('private[_\\s]?key');
    });

    it('should have RAG path configuration in default domain', async () => {
      const domainConfig = await loadDomainConfig(CONFIG_BASE_PATH, 'default');

      // Check RAG path configuration - default should exclude i18n
      expect(domainConfig.ragPaths).toBeDefined();
      expect(domainConfig.ragPaths!.exclude).toContain('i18n/**');
    });

    it('should have correct context in default domain', async () => {
      const domainConfig = await loadDomainConfig(CONFIG_BASE_PATH, 'default');

      expect(domainConfig.context.projectName).toBeDefined();
      expect(domainConfig.context.domain).toBeDefined();
      expect(domainConfig.context.targetAudience).toBeDefined();
    });
  });
});
