/**
 * ProposalGenerateStep Unit Tests
 *
 * Tests that ProposalGenerateStep generates proposals for all valuable threads,
 * including threads without RAG context (for INSERT/new page proposals).
 *

 */

import { describe, it, expect, vi } from 'vitest';
import { ProposalGenerateStep } from '../server/pipeline/steps/generate/ProposalGenerateStep.js';
import {
  StepType,
  type PipelineContext,
  type UnifiedMessage,
  type IDomainConfig,
  type ILLMHandler,
  type IPromptRegistry,
  type ConversationThread,
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
}));

// Mock ProposalPostProcessor
vi.mock('../server/pipeline/utils/ProposalPostProcessor.js', () => ({
  postProcessProposal: (text: string | undefined) => ({
    text,
    wasModified: false,
    warnings: [],
  }),
}));

// Mock ruleset parser
vi.mock('../server/pipeline/types/ruleset.js', () => ({
  parseRuleset: vi.fn().mockReturnValue({ promptContext: [] }),
}));

// ==================== Helpers ====================

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
      { id: 'no-doc-value', label: 'No Value', description: 'No documentation value', priority: 0 },
    ],
    context: {
      projectName: 'Test Project',
      domain: 'Testing',
      targetAudience: 'Developers',
      documentationPurpose: 'Testing',
    },
  };
}

function createMockPromptRegistry(): IPromptRegistry {
  return {
    get: vi.fn().mockReturnValue({
      id: 'changeset-generation',
      version: '1.0.0',
      metadata: { description: 'Test prompt', requiredVariables: [] },
      system: 'System: {{projectName}} {{domain}}',
      user: 'User: {{threadSummary}} {{ragContext}} {{messages}}',
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

function createMockLLMHandler(proposals: any[] = [], rejected = false): ILLMHandler {
  return {
    name: 'mock',
    requestJSON: vi.fn().mockResolvedValue({
      data: {
        proposals,
        proposalsRejected: rejected,
        rejectionReason: rejected ? 'No actionable content' : null,
      },
      response: { text: JSON.stringify({ proposals }), model: 'test', tokensUsed: 100 },
    }),
    requestText: vi.fn(),
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
  } as any;
}

function createThread(id: string, category = 'troubleshooting'): ConversationThread {
  return {
    id,
    category,
    messageIds: [0],
    summary: `Thread ${id} summary`,
    docValueReason: 'Contains useful information',
    ragSearchCriteria: {
      keywords: ['test'],
      semanticQuery: 'test query',
    },
  };
}

function createMockContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  const messages = [createMockMessage(1, 'Test message', 'user1')];
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
    ragService: { searchSimilarDocs: vi.fn() } as any,
    db: {
      tenantRuleset: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as any,
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

function createStep(llmHandler: ILLMHandler): ProposalGenerateStep {
  return new ProposalGenerateStep(
    {
      stepId: 'generate-proposals',
      stepType: StepType.GENERATE,
      enabled: true,
      config: {},
    },
    llmHandler
  );
}

// ==================== Tests ====================

describe('ProposalGenerateStep', () => {
  describe('thread filtering', () => {
    it('should process threads WITH RAG results', async () => {
      const llmHandler = createMockLLMHandler([
        {
          updateType: 'UPDATE',
          page: 'docs/existing.md',
          section: 'Troubleshooting',
          suggestedText: 'Updated content',
          reasoning: 'Based on conversation',
        },
      ]);
      const step = createStep(llmHandler);

      const thread = createThread('thread-1');
      const context = createMockContext({
        threads: [thread],
        ragResults: new Map([
          [
            'thread-1',
            [
              {
                id: 1,
                filePath: 'docs/existing.md',
                title: 'Existing Doc',
                content: 'Content',
                similarity: 0.9,
              },
            ],
          ],
        ]),
        llmHandler,
      });

      await step.execute(context);

      expect(llmHandler.requestJSON).toHaveBeenCalledTimes(1);
      expect(context.proposals.get('thread-1')).toHaveLength(1);
      expect(context.proposals.get('thread-1')![0].updateType).toBe('UPDATE');
    });

    it('should process threads WITHOUT RAG results', async () => {
      const llmHandler = createMockLLMHandler([
        {
          updateType: 'INSERT',
          page: 'docs/new-page.md',
          suggestedText: 'New documentation page content',
          reasoning: 'No existing docs found, creating new page',
        },
      ]);
      const step = createStep(llmHandler);

      const thread = createThread('thread-1');
      const context = createMockContext({
        threads: [thread],
        ragResults: new Map([['thread-1', []]]), // Empty RAG results
        llmHandler,
      });

      await step.execute(context);

      // Should still call LLM even with empty RAG results
      expect(llmHandler.requestJSON).toHaveBeenCalledTimes(1);
      expect(context.proposals.get('thread-1')).toHaveLength(1);
      expect(context.proposals.get('thread-1')![0].updateType).toBe('INSERT');
    });

    it('should process threads with NO ragResults entry at all', async () => {
      const llmHandler = createMockLLMHandler([
        {
          updateType: 'INSERT',
          page: 'docs/new-page.md',
          suggestedText: 'New page content',
          reasoning: 'Creating new documentation',
        },
      ]);
      const step = createStep(llmHandler);

      const thread = createThread('thread-1');
      const context = createMockContext({
        threads: [thread],
        ragResults: new Map(), // No entry for thread-1 at all
        llmHandler,
      });

      await step.execute(context);

      // Should still call LLM
      expect(llmHandler.requestJSON).toHaveBeenCalledTimes(1);
      expect(context.proposals.get('thread-1')).toHaveLength(1);
    });

    it('should skip threads with category no-doc-value', async () => {
      const llmHandler = createMockLLMHandler([]);
      const step = createStep(llmHandler);

      const thread = createThread('thread-1', 'no-doc-value');
      const context = createMockContext({
        threads: [thread],
        llmHandler,
      });

      await step.execute(context);

      // Should NOT call LLM for no-doc-value threads
      expect(llmHandler.requestJSON).not.toHaveBeenCalled();
    });

    it('should process multiple threads with mixed RAG results', async () => {
      const llmHandler = createMockLLMHandler([
        {
          updateType: 'INSERT',
          page: 'docs/new.md',
          suggestedText: 'Content',
          reasoning: 'Reason',
        },
      ]);
      const step = createStep(llmHandler);

      const context = createMockContext({
        threads: [
          createThread('thread-with-rag'),
          createThread('thread-without-rag'),
          createThread('no-value-thread', 'no-doc-value'),
        ],
        ragResults: new Map([
          [
            'thread-with-rag',
            [
              {
                id: 1,
                filePath: 'docs/test.md',
                title: 'Test',
                content: 'Content',
                similarity: 0.9,
              },
            ],
          ],
          ['thread-without-rag', []], // Empty RAG results
        ]),
        llmHandler,
      });

      await step.execute(context);

      // Should call LLM for both valuable threads (2), not the no-doc-value one
      expect(llmHandler.requestJSON).toHaveBeenCalledTimes(2);
      expect(context.proposals.has('thread-with-rag')).toBe(true);
      expect(context.proposals.has('thread-without-rag')).toBe(true);
      expect(context.proposals.has('no-value-thread')).toBe(false);
    });

    it('should skip all threads when all are no-doc-value', async () => {
      const llmHandler = createMockLLMHandler([]);
      const step = createStep(llmHandler);

      const context = createMockContext({
        threads: [
          createThread('thread-1', 'no-doc-value'),
          createThread('thread-2', 'no-doc-value'),
        ],
        llmHandler,
      });

      await step.execute(context);

      expect(llmHandler.requestJSON).not.toHaveBeenCalled();
      expect(context.proposals.size).toBe(0);
    });
  });

  describe('proposal rejection', () => {
    it('should handle LLM rejection gracefully', async () => {
      const llmHandler = createMockLLMHandler([], true);
      const step = createStep(llmHandler);

      const thread = createThread('thread-1');
      const context = createMockContext({
        threads: [thread],
        ragResults: new Map([['thread-1', []]]),
        llmHandler,
      });

      await step.execute(context);

      expect(llmHandler.requestJSON).toHaveBeenCalledTimes(1);
      // Rejected proposals result in empty array
      expect(context.proposals.get('thread-1')).toHaveLength(0);
    });
  });

  describe('metrics tracking', () => {
    it('should increment LLM call count and tokens', async () => {
      const llmHandler = createMockLLMHandler([
        {
          updateType: 'INSERT',
          page: 'docs/test.md',
          suggestedText: 'Content',
          reasoning: 'Reason',
        },
      ]);
      const step = createStep(llmHandler);

      const context = createMockContext({
        threads: [createThread('thread-1'), createThread('thread-2')],
        llmHandler,
      });

      await step.execute(context);

      expect(context.metrics.llmCalls).toBe(2);
      expect(context.metrics.llmTokensUsed).toBe(200); // 100 per call
    });
  });

  describe('error capture in prompt log', () => {
    it('should capture LLM errors in prompt log response field', async () => {
      const llmHandler = createMockLLMHandler([]);
      // Make requestJSON throw an error
      (llmHandler.requestJSON as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Gemini API rate limit exceeded')
      );
      const step = createStep(llmHandler);

      const context = createMockContext({
        threads: [createThread('thread-1')],
        llmHandler,
      });

      await step.execute(context);

      // Should have empty proposals (error caught)
      expect(context.proposals.get('thread-1')).toHaveLength(0);

      // The prompt log entry should have the error captured in the response field
      const entries = context.stepPromptLogs.get('generate-proposals');
      expect(entries).toBeDefined();
      expect(entries).toHaveLength(1);
      expect(entries![0].response).toContain('ERROR:');
      expect(entries![0].response).toContain('Gemini API rate limit exceeded');
      // Template and resolved should still be populated
      expect(entries![0].template).toBeTruthy();
      expect(entries![0].resolved).toBeTruthy();
    });

    it('should capture errors for each failing thread independently', async () => {
      const llmHandler = createMockLLMHandler([]);
      (llmHandler.requestJSON as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Schema validation failed')
      );
      const step = createStep(llmHandler);

      const context = createMockContext({
        threads: [createThread('thread-1'), createThread('thread-2')],
        llmHandler,
      });

      await step.execute(context);

      const entries = context.stepPromptLogs.get('generate-proposals');
      expect(entries).toHaveLength(2);
      expect(entries![0].response).toContain('ERROR:');
      expect(entries![1].response).toContain('ERROR:');
    });
  });

  describe('prompt logging', () => {
    it('should log prompt entries for each thread', async () => {
      const llmHandler = createMockLLMHandler([
        {
          updateType: 'INSERT',
          page: 'docs/test.md',
          suggestedText: 'Content',
          reasoning: 'Reason',
        },
      ]);
      const step = createStep(llmHandler);

      const context = createMockContext({
        threads: [createThread('thread-1'), createThread('thread-2')],
        llmHandler,
      });

      await step.execute(context);

      const entries = context.stepPromptLogs.get('generate-proposals');
      expect(entries).toBeDefined();
      expect(entries).toHaveLength(2);
      expect(entries![0].entryType).toBe('llm-call');
      expect(entries![1].entryType).toBe('llm-call');
      // Each entry should have a response logged with actual content
      expect(entries![0].response).toBeTruthy();
      expect(entries![1].response).toBeTruthy();
      // Verify response contains the stringified proposals
      expect(entries![0].response).toContain('proposals');
      expect(entries![0].response).toContain('INSERT');
    });

    it('should capture exact response text from LLM handler', async () => {
      const expectedProposal = {
        updateType: 'UPDATE',
        page: 'docs/specific.md',
        section: 'Details',
        suggestedText: 'Exact content here',
        reasoning: 'Specific reason',
      };
      const llmHandler = createMockLLMHandler([expectedProposal]);
      const step = createStep(llmHandler);

      const context = createMockContext({
        threads: [createThread('single-thread')],
        llmHandler,
      });

      await step.execute(context);

      const entries = context.stepPromptLogs.get('generate-proposals');
      expect(entries).toHaveLength(1);
      // Verify the response is the exact stringified content
      const responseJson = JSON.parse(entries![0].response as string);
      expect(responseJson.proposals).toBeDefined();
      expect(responseJson.proposals[0].updateType).toBe('UPDATE');
      expect(responseJson.proposals[0].page).toBe('docs/specific.md');
    });
  });
});
