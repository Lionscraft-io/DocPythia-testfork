/**
 * Pipeline Steps Unit Tests
 *
 * Tests for the customizable analysis pipeline steps.
 *

 * @created 2025-12-30
 */

import { describe, it, expect, vi } from 'vitest';
import { KeywordFilterStep } from '../server/pipeline/steps/filter/KeywordFilterStep.js';
import { BatchClassifyStep } from '../server/pipeline/steps/classify/BatchClassifyStep.js';
import { RagEnrichStep } from '../server/pipeline/steps/enrich/RagEnrichStep.js';
import {
  StepType,
  type PipelineContext,
  type UnifiedMessage,
  type IDomainConfig,
  type ILLMHandler,
  type IPromptRegistry,
  type IRagService,
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

// Helper to create mock messages
function createMockMessage(id: number, content: string, author = 'user'): UnifiedMessage {
  return {
    id,
    messageId: `msg-${id}`,
    streamId: 'test-stream',
    timestamp: new Date(),
    author,
    content,
    processingStatus: 'PENDING',
  };
}

// Helper to create mock domain config
function createMockDomainConfig(): IDomainConfig {
  return {
    domainId: 'test',
    name: 'Test Domain',
    categories: [
      {
        id: 'troubleshooting',
        label: 'Troubleshooting',
        description: 'Problem solving',
        priority: 90,
      },
      {
        id: 'no-doc-value',
        label: 'No Value',
        description: 'No documentation value',
        priority: 0,
      },
    ],
    context: {
      projectName: 'Test Project',
      domain: 'Testing',
      targetAudience: 'Developers',
      documentationPurpose: 'Testing',
    },
  };
}

// Helper to create mock prompt registry
function createMockPromptRegistry(): IPromptRegistry {
  return {
    get: vi.fn().mockReturnValue({
      id: 'test-prompt',
      version: '1.0.0',
      metadata: {
        description: 'Test prompt',
        requiredVariables: [],
      },
      system: 'System prompt',
      user: 'User prompt',
    }),
    render: vi.fn().mockReturnValue({
      system: 'Rendered system prompt',
      user: 'Rendered user prompt',
      variables: {},
    }),
    list: vi.fn().mockReturnValue([]),
    reload: vi.fn(),
    validate: vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
  };
}

// Helper to create mock LLM handler
function createMockLLMHandler(): ILLMHandler {
  return {
    name: 'mock',
    requestJSON: vi.fn().mockResolvedValue({
      data: {
        threads: [
          {
            category: 'troubleshooting',
            messages: [0, 1],
            summary: 'Test thread',
            docValueReason: 'Test reason',
            ragSearchCriteria: {
              keywords: ['test'],
              semanticQuery: 'test query',
            },
          },
        ],
      },
      response: { text: '{}', model: 'test', tokensUsed: 100 },
    }),
    requestText: vi.fn().mockResolvedValue({
      text: 'Test response',
      model: 'test',
      tokensUsed: 50,
    }),
    getModelInfo: vi.fn().mockReturnValue({
      provider: 'test',
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

// Helper to create mock RAG service
function createMockRagService(): IRagService {
  return {
    searchSimilarDocs: vi.fn().mockResolvedValue([
      {
        id: 1,
        filePath: 'docs/test.md',
        title: 'Test Doc',
        content: 'Test content',
        similarity: 0.85,
      },
    ]),
  };
}

// Helper to create mock context
function createMockContext(
  messages: UnifiedMessage[],
  overrides: Partial<PipelineContext> = {}
): PipelineContext {
  return {
    instanceId: 'test',
    batchId: 'test-batch',
    streamId: 'test-stream',
    messages,
    contextMessages: [],
    domainConfig: createMockDomainConfig(),
    prompts: createMockPromptRegistry(),
    filteredMessages: [...messages],
    threads: [],
    ragResults: new Map(),
    proposals: new Map(),
    llmHandler: createMockLLMHandler(),
    ragService: createMockRagService(),
    db: {} as any,
    metrics: {
      totalDurationMs: 0,
      stepDurations: new Map(),
      llmCalls: 0,
      llmTokensUsed: 0,
      llmCostUSD: 0,
      cacheHits: 0,
      cacheMisses: 0,
    },
    stepPromptLogs: new Map(),
    errors: [],
    ...overrides,
  };
}

describe('KeywordFilterStep', () => {
  describe('execute', () => {
    it('should pass all messages when no filters configured', async () => {
      const step = new KeywordFilterStep({
        stepId: 'test-filter',
        stepType: StepType.FILTER,
        enabled: true,
        config: {
          includeKeywords: [],
          excludeKeywords: [],
        },
      });

      const messages = [
        createMockMessage(1, 'Hello world'),
        createMockMessage(2, 'Another message'),
      ];

      const context = createMockContext(messages);
      const result = await step.execute(context);

      expect(result.filteredMessages).toHaveLength(2);
    });

    it('should filter messages with exclude keywords', async () => {
      const step = new KeywordFilterStep({
        stepId: 'test-filter',
        stepType: StepType.FILTER,
        enabled: true,
        config: {
          excludeKeywords: ['spam', 'scam'],
        },
      });

      const messages = [
        createMockMessage(1, 'Hello world'),
        createMockMessage(2, 'This is spam'),
        createMockMessage(3, 'SCAM ALERT'),
      ];

      const context = createMockContext(messages);
      const result = await step.execute(context);

      expect(result.filteredMessages).toHaveLength(1);
      expect(result.filteredMessages[0].id).toBe(1);
    });

    it('should pass messages with include keywords', async () => {
      const step = new KeywordFilterStep({
        stepId: 'test-filter',
        stepType: StepType.FILTER,
        enabled: true,
        config: {
          includeKeywords: ['validator', 'staking'],
        },
      });

      const messages = [
        createMockMessage(1, 'My validator is down'),
        createMockMessage(2, 'How does staking work?'),
        createMockMessage(3, 'Random message'),
      ];

      const context = createMockContext(messages);
      const result = await step.execute(context);

      expect(result.filteredMessages).toHaveLength(2);
    });

    it('should be case insensitive by default', async () => {
      const step = new KeywordFilterStep({
        stepId: 'test-filter',
        stepType: StepType.FILTER,
        enabled: true,
        config: {
          includeKeywords: ['validator'],
          caseSensitive: false,
        },
      });

      const messages = [
        createMockMessage(1, 'VALIDATOR issue'),
        createMockMessage(2, 'Validator problem'),
        createMockMessage(3, 'other topic'),
      ];

      const context = createMockContext(messages);
      const result = await step.execute(context);

      expect(result.filteredMessages).toHaveLength(2);
    });

    it('should record timing metrics', async () => {
      const step = new KeywordFilterStep({
        stepId: 'test-filter',
        stepType: StepType.FILTER,
        enabled: true,
        config: {},
      });

      const context = createMockContext([createMockMessage(1, 'Hello')]);
      const result = await step.execute(context);

      expect(result.metrics.stepDurations.has('test-filter')).toBe(true);
    });
  });

  describe('validateConfig', () => {
    it('should validate valid config', () => {
      const step = new KeywordFilterStep({
        stepId: 'test',
        stepType: StepType.FILTER,
        enabled: true,
        config: {
          includeKeywords: ['test'],
          excludeKeywords: ['spam'],
        },
      });

      expect(
        step.validateConfig({
          stepId: 'test',
          stepType: StepType.FILTER,
          enabled: true,
          config: {
            includeKeywords: ['test'],
          },
        })
      ).toBe(true);
    });
  });

  describe('getMetadata', () => {
    it('should return step metadata', () => {
      const step = new KeywordFilterStep({
        stepId: 'test',
        stepType: StepType.FILTER,
        enabled: true,
        config: {},
      });

      const metadata = step.getMetadata();
      expect(metadata.name).toBe('Keyword Filter');
      expect(metadata.version).toBe('1.0.0');
    });
  });
});

describe('BatchClassifyStep', () => {
  describe('execute', () => {
    it('should skip when no messages to classify', async () => {
      const llmHandler = createMockLLMHandler();
      const step = new BatchClassifyStep(
        {
          stepId: 'test-classify',
          stepType: StepType.CLASSIFY,
          enabled: true,
          config: {
            promptId: 'thread-classification',
            model: 'gemini-2.5-flash',
          },
        },
        llmHandler
      );

      const context = createMockContext([]);
      context.filteredMessages = [];

      const result = await step.execute(context);

      expect(result.threads).toHaveLength(0);
      expect(llmHandler.requestJSON).not.toHaveBeenCalled();
    });

    it('should classify messages into threads', async () => {
      const llmHandler = createMockLLMHandler();
      const step = new BatchClassifyStep(
        {
          stepId: 'test-classify',
          stepType: StepType.CLASSIFY,
          enabled: true,
          config: {
            promptId: 'thread-classification',
            model: 'gemini-2.5-flash',
          },
        },
        llmHandler
      );

      const messages = [
        createMockMessage(1, 'My validator is offline'),
        createMockMessage(2, 'Try restarting it'),
      ];

      const context = createMockContext(messages);
      const result = await step.execute(context);

      expect(result.threads).toHaveLength(1);
      expect(result.threads[0].category).toBe('troubleshooting');
      expect(result.threads[0].messageIds).toEqual([0, 1]);
      expect(result.metrics.llmCalls).toBe(1);
    });

    it('should render prompts with correct variables', async () => {
      const llmHandler = createMockLLMHandler();
      const prompts = createMockPromptRegistry();

      const step = new BatchClassifyStep(
        {
          stepId: 'test-classify',
          stepType: StepType.CLASSIFY,
          enabled: true,
          config: {
            promptId: 'thread-classification',
          },
        },
        llmHandler
      );

      const context = createMockContext([createMockMessage(1, 'Test message')], {
        prompts,
      });

      await step.execute(context);

      expect(prompts.render).toHaveBeenCalledWith(
        'thread-classification',
        expect.objectContaining({
          projectName: 'Test Project',
          domain: 'Testing',
        })
      );
    });
  });
});

describe('RagEnrichStep', () => {
  describe('execute', () => {
    it('should skip when no valuable threads', async () => {
      const step = new RagEnrichStep({
        stepId: 'test-enrich',
        stepType: StepType.ENRICH,
        enabled: true,
        config: {
          topK: 5,
        },
      });

      const context = createMockContext([]);
      context.threads = [
        {
          id: 'thread-1',
          category: 'no-doc-value',
          messageIds: [0],
          summary: 'Test',
          docValueReason: 'No value',
          ragSearchCriteria: { keywords: [], semanticQuery: '' },
        },
      ];

      const result = await step.execute(context);

      expect(result.ragResults.size).toBe(0);
    });

    it('should enrich threads with RAG context', async () => {
      const ragService = createMockRagService();
      const step = new RagEnrichStep({
        stepId: 'test-enrich',
        stepType: StepType.ENRICH,
        enabled: true,
        config: {
          topK: 5,
          minSimilarity: 0.7,
        },
      });

      const context = createMockContext([], { ragService });
      context.threads = [
        {
          id: 'thread-1',
          category: 'troubleshooting',
          messageIds: [0],
          summary: 'Validator issue',
          docValueReason: 'Help needed',
          ragSearchCriteria: {
            keywords: ['validator'],
            semanticQuery: 'validator not working',
          },
        },
      ];

      const result = await step.execute(context);

      expect(result.ragResults.size).toBe(1);
      expect(result.ragResults.get('thread-1')).toHaveLength(1);
      expect(ragService.searchSimilarDocs).toHaveBeenCalledWith('validator not working', 10);
    });

    it('should filter results by similarity threshold', async () => {
      const ragService: IRagService = {
        searchSimilarDocs: vi.fn().mockResolvedValue([
          { id: 1, filePath: 'a.md', title: 'A', content: 'A', similarity: 0.9 },
          { id: 2, filePath: 'b.md', title: 'B', content: 'B', similarity: 0.5 },
        ]),
      };

      const step = new RagEnrichStep({
        stepId: 'test-enrich',
        stepType: StepType.ENRICH,
        enabled: true,
        config: {
          topK: 5,
          minSimilarity: 0.7,
        },
      });

      const context = createMockContext([], { ragService });
      context.threads = [
        {
          id: 'thread-1',
          category: 'troubleshooting',
          messageIds: [0],
          summary: 'Test',
          docValueReason: 'Test',
          ragSearchCriteria: {
            keywords: ['test'],
            semanticQuery: 'test query',
          },
        },
      ];

      const result = await step.execute(context);

      expect(result.ragResults.get('thread-1')).toHaveLength(1);
      expect(result.ragResults.get('thread-1')![0].similarity).toBe(0.9);
    });
  });
});
