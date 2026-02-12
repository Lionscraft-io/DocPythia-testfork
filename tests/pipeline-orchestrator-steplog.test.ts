/**
 * PipelineOrchestrator Step Log Tests
 *
 * Tests that the PipelineOrchestrator writes step log entries
 * using the correct field names expected by the Pipeline Debugger frontend:
 * - stepName (not stepId)
 * - promptUsed (not promptsUsed)
 *

 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../server/utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  getErrorMessage: (e: any) => (e instanceof Error ? e.message : String(e)),
}));

// Mock PipelineContext helpers
vi.mock('../server/pipeline/core/PipelineContext.js', () => ({
  createInitialMetrics: () => ({
    totalDurationMs: 0,
    stepDurations: new Map(),
    llmCalls: 0,
    llmTokensUsed: 0,
    messagesProcessed: 0,
    threadsCreated: 0,
    proposalsGenerated: 0,
  }),
  serializeMetrics: vi.fn().mockReturnValue({}),
}));

// Mock StepFactory
const mockStep = {
  stepId: 'keyword-filter',
  stepType: 'filter',
  execute: vi.fn().mockResolvedValue(undefined),
};

const mockClassifyStep = {
  stepId: 'classify-messages',
  stepType: 'classify',
  execute: vi.fn().mockResolvedValue(undefined),
};

const mockFailingStep = {
  stepId: 'failing-step',
  stepType: 'generate',
  execute: vi.fn().mockRejectedValue(new Error('Step execution failed')),
};

const mockStepFactory = {
  hasStepType: vi.fn().mockReturnValue(true),
  create: vi.fn(),
};

vi.mock('../server/pipeline/core/StepFactory.js', () => ({
  StepFactory: vi.fn(),
  getStepFactory: () => mockStepFactory,
}));

import { PipelineOrchestrator } from '../server/pipeline/core/PipelineOrchestrator.js';
import type {
  PipelineConfig,
  PipelineContext,
  ILLMHandler,
} from '../server/pipeline/core/interfaces.js';

// ==================== Helpers ====================

function createTestConfig(steps: any[] = []): PipelineConfig {
  return {
    pipelineId: 'test-pipeline-v1',
    instanceId: 'test-instance',
    steps:
      steps.length > 0
        ? steps
        : [
            { stepId: 'keyword-filter', stepType: 'filter', enabled: true, config: {} },
            { stepId: 'classify-messages', stepType: 'classify', enabled: true, config: {} },
          ],
    errorHandling: {
      stopOnError: true,
      retryAttempts: 0,
      retryDelayMs: 100,
    },
    performance: {
      batchSize: 50,
      concurrency: 1,
      timeoutMs: 30000,
    },
  } as PipelineConfig;
}

function createTestContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    instanceId: 'test-instance',
    batchId: 'batch-001',
    messages: [{ id: 1, content: 'Test message', author: 'user1' } as any],
    filteredMessages: [],
    threads: [],
    proposals: new Map(),
    ragResults: new Map(),
    classifications: new Map(),
    stepPromptLogs: new Map(),
    errors: [],
    metrics: {
      totalDurationMs: 0,
      stepDurations: new Map(),
      llmCalls: 0,
      llmTokensUsed: 0,
      messagesProcessed: 0,
      threadsCreated: 0,
      proposalsGenerated: 0,
    },
    db: createMockDb(),
    ...overrides,
  } as PipelineContext;
}

function createMockDb() {
  return {
    pipelineRunLog: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

function createMockLLMHandler(): ILLMHandler {
  return {
    name: 'mock-llm',
    requestJSON: vi.fn().mockResolvedValue({
      data: {},
      response: { content: '{}', modelUsed: 'test', tokensUsed: 100 },
    }),
  } as any;
}

// ==================== Tests ====================

describe('PipelineOrchestrator Step Logging', () => {
  let orchestrator: PipelineOrchestrator;
  let config: PipelineConfig;
  let llmHandler: ILLMHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStep.execute.mockResolvedValue(undefined);
    mockClassifyStep.execute.mockResolvedValue(undefined);
    mockFailingStep.execute.mockRejectedValue(new Error('Step execution failed'));

    mockStepFactory.hasStepType.mockReturnValue(true);
    mockStepFactory.create.mockImplementation((stepConfig: any) => {
      switch (stepConfig.stepId) {
        case 'keyword-filter':
          return mockStep;
        case 'classify-messages':
          return mockClassifyStep;
        case 'failing-step':
          return mockFailingStep;
        default:
          return mockStep;
      }
    });

    config = createTestConfig();
    llmHandler = createMockLLMHandler();
    orchestrator = new PipelineOrchestrator(config, llmHandler, mockStepFactory as any);
  });

  describe('Step log field names', () => {
    it('should write stepName field (not stepId) to run log', async () => {
      const context = createTestContext();
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      // Verify the update call includes steps with stepName
      expect(mockDb.pipelineRunLog.update).toHaveBeenCalled();
      const updateCall = mockDb.pipelineRunLog.update.mock.calls[0][0];
      const steps = updateCall.data.steps;

      expect(steps).toBeInstanceOf(Array);
      expect(steps.length).toBeGreaterThan(0);

      // Every step should have stepName, NOT stepId
      for (const step of steps) {
        expect(step).toHaveProperty('stepName');
        expect(step).not.toHaveProperty('stepId');
      }
    });

    it('should use step.stepId value as stepName', async () => {
      const context = createTestContext();
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      const updateCall = mockDb.pipelineRunLog.update.mock.calls[0][0];
      const steps = updateCall.data.steps;

      expect(steps[0].stepName).toBe('keyword-filter');
      expect(steps[1].stepName).toBe('classify-messages');
    });

    it('should include stepType in log entries', async () => {
      const context = createTestContext();
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      const updateCall = mockDb.pipelineRunLog.update.mock.calls[0][0];
      const steps = updateCall.data.steps;

      expect(steps[0].stepType).toBe('filter');
      expect(steps[1].stepType).toBe('classify');
    });
  });

  describe('Step log status tracking', () => {
    it('should record completed status for successful steps', async () => {
      const context = createTestContext({
        filteredMessages: [{ id: 1, content: 'Test message', author: 'user1' } as any],
      });
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      const updateCall = mockDb.pipelineRunLog.update.mock.calls[0][0];
      const steps = updateCall.data.steps;

      expect(steps[0].status).toBe('completed');
      expect(steps[1].status).toBe('completed');
    });

    it('should record failed status for failing steps', async () => {
      config = createTestConfig([
        { stepId: 'failing-step', stepType: 'generate', enabled: true, config: {} },
      ]);
      orchestrator = new PipelineOrchestrator(config, llmHandler, mockStepFactory as any);
      const context = createTestContext({
        threads: [{ id: 'thread-1', category: 'test', messageIds: [0], summary: 'test' } as any],
      });
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      const updateCall = mockDb.pipelineRunLog.update.mock.calls[0][0];
      const steps = updateCall.data.steps;

      expect(steps[0].status).toBe('failed');
      expect(steps[0].error).toBe('Step execution failed');
    });

    it('should record durationMs for each step', async () => {
      const context = createTestContext();
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      const updateCall = mockDb.pipelineRunLog.update.mock.calls[0][0];
      const steps = updateCall.data.steps;

      for (const step of steps) {
        expect(step).toHaveProperty('durationMs');
        expect(typeof step.durationMs).toBe('number');
        expect(step.durationMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Step log I/O counts', () => {
    it('should record inputCount for filter steps', async () => {
      const context = createTestContext({
        messages: [
          { id: 1, content: 'msg1' } as any,
          { id: 2, content: 'msg2' } as any,
          { id: 3, content: 'msg3' } as any,
        ],
      });
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      const updateCall = mockDb.pipelineRunLog.update.mock.calls[0][0];
      const filterStep = updateCall.data.steps.find((s: any) => s.stepName === 'keyword-filter');

      expect(filterStep.inputCount).toBe(3);
    });
  });

  describe('Run log creation', () => {
    it('should create initial run log entry with running status', async () => {
      const context = createTestContext();
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      expect(mockDb.pipelineRunLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          instanceId: 'test-instance',
          batchId: 'batch-001',
          pipelineId: 'test-pipeline-v1',
          status: 'running',
          inputMessages: 1,
          steps: [],
        }),
      });
    });

    it('should update run log with completed status on success', async () => {
      const context = createTestContext();
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      expect(mockDb.pipelineRunLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            status: 'completed',
            completedAt: expect.any(Date),
          }),
        })
      );
    });

    it('should update run log with failed status on error', async () => {
      config = createTestConfig([
        { stepId: 'failing-step', stepType: 'generate', enabled: true, config: {} },
      ]);
      orchestrator = new PipelineOrchestrator(config, llmHandler, mockStepFactory as any);
      const context = createTestContext({
        threads: [{ id: 'thread-1', category: 'test', messageIds: [0], summary: 'test' } as any],
      });
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      expect(mockDb.pipelineRunLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            errorMessage: expect.stringContaining('Step execution failed'),
          }),
        })
      );
    });

    it('should include llm metrics in run log update', async () => {
      const context = createTestContext();
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      expect(mockDb.pipelineRunLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            llmCalls: expect.any(Number),
            llmTokensUsed: expect.any(Number),
            totalDurationMs: expect.any(Number),
          }),
        })
      );
    });

    it('should not create run log when logging is disabled', async () => {
      orchestrator = new PipelineOrchestrator(config, llmHandler, mockStepFactory as any, {
        enableRunLogging: false,
      });
      const context = createTestContext();
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      expect(mockDb.pipelineRunLog.create).not.toHaveBeenCalled();
      expect(mockDb.pipelineRunLog.update).not.toHaveBeenCalled();
    });

    it('should not create run log when db is not available', async () => {
      const context = createTestContext({ db: undefined as any });

      // Should not throw
      const result = await orchestrator.execute(context);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should handle run log creation failure gracefully', async () => {
      const context = createTestContext();
      const mockDb = context.db as any;
      mockDb.pipelineRunLog.create.mockRejectedValue(new Error('DB write failed'));

      // Should not throw — pipeline continues without logging
      const result = await orchestrator.execute(context);
      expect(result).toBeDefined();
    });
  });

  describe('Pipeline execution with no steps', () => {
    it('should handle empty pipeline gracefully', async () => {
      config = createTestConfig([]);
      // Override hasStepType to return false for empty config
      mockStepFactory.hasStepType.mockReturnValue(false);
      orchestrator = new PipelineOrchestrator(config, llmHandler, mockStepFactory as any);

      const context = createTestContext();
      const result = await orchestrator.execute(context);

      expect(result).toBeDefined();
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Multiple steps log ordering', () => {
    it('should log steps in execution order', async () => {
      config = createTestConfig([
        { stepId: 'keyword-filter', stepType: 'filter', enabled: true, config: {} },
        { stepId: 'classify-messages', stepType: 'classify', enabled: true, config: {} },
      ]);
      orchestrator = new PipelineOrchestrator(config, llmHandler, mockStepFactory as any);

      const context = createTestContext();
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      const updateCall = mockDb.pipelineRunLog.update.mock.calls[0][0];
      const steps = updateCall.data.steps;

      expect(steps).toHaveLength(2);
      expect(steps[0].stepName).toBe('keyword-filter');
      expect(steps[1].stepName).toBe('classify-messages');
    });

    it('should stop logging after failed step when stopOnError is true', async () => {
      config = createTestConfig([
        { stepId: 'keyword-filter', stepType: 'filter', enabled: true, config: {} },
        { stepId: 'failing-step', stepType: 'generate', enabled: true, config: {} },
        { stepId: 'classify-messages', stepType: 'classify', enabled: true, config: {} },
      ]);
      config.errorHandling.stopOnError = true;
      orchestrator = new PipelineOrchestrator(config, llmHandler, mockStepFactory as any);

      const context = createTestContext({
        threads: [{ id: 'thread-1', category: 'test', messageIds: [0], summary: 'test' } as any],
      });
      const mockDb = context.db as any;

      await orchestrator.execute(context);

      const updateCall = mockDb.pipelineRunLog.update.mock.calls[0][0];
      const steps = updateCall.data.steps;

      // Only 2 steps logged (filter + failing), not 3 (classify not reached)
      expect(steps).toHaveLength(2);
      expect(steps[0].stepName).toBe('keyword-filter');
      expect(steps[0].status).toBe('completed');
      expect(steps[1].stepName).toBe('failing-step');
      expect(steps[1].status).toBe('failed');
    });
  });

  describe('Progressive run log updates', () => {
    it('should update run log after each completed step', async () => {
      config = createTestConfig([
        { stepId: 'keyword-filter', stepType: 'filter', enabled: true, config: {} },
        { stepId: 'classify-messages', stepType: 'classify', enabled: true, config: {} },
      ]);
      orchestrator = new PipelineOrchestrator(config, llmHandler, mockStepFactory as any);

      const context = createTestContext({
        filteredMessages: [{ id: 1, content: 'Test message', author: 'user1' } as any],
      });
      const mockDb = context.db as any;

      // Capture snapshots of steps array (mock stores reference, not copy)
      const stepSnapshots: { status: string; stepCount: number; stepNames: string[] }[] = [];
      mockDb.pipelineRunLog.update.mockImplementation(async (args: any) => {
        stepSnapshots.push({
          status: args.data.status,
          stepCount: args.data.steps.length,
          stepNames: args.data.steps.map((s: any) => s.stepName),
        });
        return {};
      });

      await orchestrator.execute(context);

      // Should have intermediate updates (one per step) + final update = at least 3 calls
      expect(stepSnapshots.length).toBeGreaterThanOrEqual(3);

      // First intermediate update should have 1 step with status 'running'
      expect(stepSnapshots[0].status).toBe('running');
      expect(stepSnapshots[0].stepCount).toBe(1);
      expect(stepSnapshots[0].stepNames[0]).toBe('keyword-filter');

      // Second intermediate update should have 2 steps with status 'running'
      expect(stepSnapshots[1].status).toBe('running');
      expect(stepSnapshots[1].stepCount).toBe(2);

      // Final update should have status 'completed'
      expect(stepSnapshots[stepSnapshots.length - 1].status).toBe('completed');
    });

    it('should update run log after skipped steps', async () => {
      config = createTestConfig([
        { stepId: 'keyword-filter', stepType: 'filter', enabled: true, config: {} },
        { stepId: 'classify-messages', stepType: 'classify', enabled: true, config: {} },
      ]);
      orchestrator = new PipelineOrchestrator(config, llmHandler, mockStepFactory as any);

      // filteredMessages is empty, so classify step will be skipped
      const context = createTestContext();
      const mockDb = context.db as any;

      // Capture snapshots
      const stepSnapshots: { status: string; steps: any[] }[] = [];
      mockDb.pipelineRunLog.update.mockImplementation(async (args: any) => {
        stepSnapshots.push({
          status: args.data.status,
          steps: args.data.steps.map((s: any) => ({ stepName: s.stepName, status: s.status })),
        });
        return {};
      });

      await orchestrator.execute(context);

      // At least 3 calls: after filter, after classify (skipped), final
      expect(stepSnapshots.length).toBeGreaterThanOrEqual(3);

      // Verify skipped step is included in intermediate update
      const secondSnapshot = stepSnapshots[1];
      expect(secondSnapshot.status).toBe('running');
      const skippedStep = secondSnapshot.steps.find((s: any) => s.stepName === 'classify-messages');
      expect(skippedStep).toBeDefined();
      expect(skippedStep.status).toBe('skipped');
    });

    it('should update run log after failed steps', async () => {
      config = createTestConfig([
        { stepId: 'failing-step', stepType: 'generate', enabled: true, config: {} },
      ]);
      orchestrator = new PipelineOrchestrator(config, llmHandler, mockStepFactory as any);

      const context = createTestContext({
        threads: [{ id: 'thread-1', category: 'test', messageIds: [0], summary: 'test' } as any],
      });
      const mockDb = context.db as any;

      // Capture snapshots
      const stepSnapshots: { status: string; steps: any[] }[] = [];
      mockDb.pipelineRunLog.update.mockImplementation(async (args: any) => {
        stepSnapshots.push({
          status: args.data.status,
          steps: args.data.steps.map((s: any) => ({ stepName: s.stepName, status: s.status })),
        });
        return {};
      });

      await orchestrator.execute(context);

      // At least 2 calls: after failed step, final
      expect(stepSnapshots.length).toBeGreaterThanOrEqual(2);

      // First intermediate update should have the failed step with status 'running'
      expect(stepSnapshots[0].status).toBe('running');
      expect(stepSnapshots[0].steps[0].status).toBe('failed');
    });
  });
});
