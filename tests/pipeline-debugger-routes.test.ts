/**
 * Pipeline Debugger Routes Unit Tests
 *
 * Tests for pipeline debugger API endpoints:
 * - GET /pipeline/runs — list pipeline runs
 * - GET /pipeline/runs/:id — get run details
 * - GET /pipeline/prompts — list prompts with parsed overrides
 * - PUT /pipeline/prompts/:promptId/override — save override (system/user format)
 * - DELETE /pipeline/prompts/:promptId/override — delete override
 *

 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';

// ==================== Mocks ====================

const mockPrismaClient = {
  pipelineRunLog: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  tenantPromptOverride: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  rulesetFeedback: {
    findMany: vi.fn(),
  },
  tenantRuleset: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn((callback: any) => callback(mockPrismaClient)),
};

vi.mock('../server/db.js', () => ({
  db: mockPrismaClient,
}));

vi.mock('../server/db/instance-db.js', () => ({
  getInstanceDb: vi.fn().mockReturnValue(mockPrismaClient),
}));

// Mock PromptRegistry
const mockPromptTemplates = [
  {
    id: 'classify-messages',
    version: '1.0.0',
    system: 'You are a message classifier.',
    user: 'Classify these messages: {{messages}}',
    metadata: {
      description: 'Classifies incoming messages into categories',
      tags: ['classification', 'pipeline'],
    },
  },
  {
    id: 'generate-proposals',
    version: '1.0.0',
    system: 'You are a documentation assistant.',
    user: 'Generate proposals from: {{threads}}',
    metadata: {
      description: 'Generates doc proposals from threads',
      tags: ['generation', 'pipeline'],
    },
  },
];

const mockPromptRegistry = {
  load: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockReturnValue(mockPromptTemplates),
  validate: vi.fn().mockReturnValue({ valid: true, errors: [] }),
};

vi.mock('../server/pipeline/prompts/PromptRegistry.js', () => ({
  createPromptRegistry: vi.fn().mockReturnValue(mockPromptRegistry),
}));

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

// Mock llmService (needed by improvement routes, not tested here but required for import)
vi.mock('../server/stream/llm/llm-service.js', () => ({
  llmService: {
    requestJSON: vi.fn(),
  },
}));

// Mock pipeline types
vi.mock('../server/pipeline/types/ruleset.js', () => ({
  getDefaultRulesetTemplate: vi.fn().mockReturnValue('# Default Ruleset'),
}));

// ==================== Test Setup ====================

let app: Express;

const mockAdminAuth = (req: any, _res: any, next: any) => {
  req.instance = { id: 'test-instance', db: mockPrismaClient };
  req.adminInstance = 'test-instance';
  next();
};

const resetMocks = () => {
  Object.values(mockPrismaClient).forEach((model: any) => {
    if (model && typeof model === 'object') {
      Object.values(model).forEach((method: any) => {
        if (typeof method?.mockReset === 'function') {
          method.mockReset();
        }
      });
    }
  });
  mockPromptRegistry.load.mockResolvedValue(undefined);
  mockPromptRegistry.list.mockReturnValue(mockPromptTemplates);
  mockPromptRegistry.validate.mockReturnValue({ valid: true, errors: [] });
};

describe('Pipeline Debugger Routes', () => {
  beforeEach(async () => {
    resetMocks();
    vi.clearAllMocks();

    app = express();
    app.use(express.json());

    const { createQualitySystemRoutes } = await import('../server/routes/quality-system-routes.js');
    const router = createQualitySystemRoutes(mockAdminAuth);
    app.use('/api/admin/quality', router);
  });

  // ==================== GET /pipeline/runs ====================

  describe('GET /api/admin/quality/pipeline/runs', () => {
    it('should return pipeline runs with total field', async () => {
      const mockRuns = [
        {
          id: 1,
          instanceId: 'test-instance',
          batchId: 'batch-001',
          pipelineId: 'pipeline-v1',
          status: 'completed',
          inputMessages: 50,
          outputThreads: 10,
          outputProposals: 5,
          totalDurationMs: 12000,
          llmCalls: 3,
          llmTokensUsed: 15000,
          createdAt: new Date('2026-01-20T10:00:00Z'),
          completedAt: new Date('2026-01-20T10:00:12Z'),
          errorMessage: null,
        },
        {
          id: 2,
          instanceId: 'test-instance',
          batchId: 'batch-002',
          pipelineId: 'pipeline-v1',
          status: 'failed',
          inputMessages: 30,
          outputThreads: 0,
          outputProposals: 0,
          totalDurationMs: 5000,
          llmCalls: 1,
          llmTokensUsed: 3000,
          createdAt: new Date('2026-01-20T11:00:00Z'),
          completedAt: new Date('2026-01-20T11:00:05Z'),
          errorMessage: 'LLM call failed',
        },
      ];

      mockPrismaClient.pipelineRunLog.findMany.mockResolvedValue(mockRuns);

      const response = await request(app).get('/api/admin/quality/pipeline/runs');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('total', 2);
      expect(response.body).toHaveProperty('runs');
      expect(response.body.runs).toHaveLength(2);
      // Verify 'count' key is NOT present (renamed to 'total')
      expect(response.body).not.toHaveProperty('count');
    });

    it('should include llmTokensUsed in selected fields', async () => {
      const mockRun = {
        id: 1,
        instanceId: 'test-instance',
        batchId: 'batch-001',
        pipelineId: 'pipeline-v1',
        status: 'completed',
        inputMessages: 50,
        outputThreads: 10,
        outputProposals: 5,
        totalDurationMs: 12000,
        llmCalls: 3,
        llmTokensUsed: 25000,
        createdAt: new Date('2026-01-20T10:00:00Z'),
        completedAt: new Date('2026-01-20T10:00:12Z'),
        errorMessage: null,
      };

      mockPrismaClient.pipelineRunLog.findMany.mockResolvedValue([mockRun]);

      const response = await request(app).get('/api/admin/quality/pipeline/runs');

      expect(response.status).toBe(200);
      expect(response.body.runs[0]).toHaveProperty('llmTokensUsed', 25000);
    });

    it('should respect limit query parameter', async () => {
      mockPrismaClient.pipelineRunLog.findMany.mockResolvedValue([]);

      await request(app).get('/api/admin/quality/pipeline/runs?limit=5');

      expect(mockPrismaClient.pipelineRunLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
        })
      );
    });

    it('should filter by status when provided', async () => {
      mockPrismaClient.pipelineRunLog.findMany.mockResolvedValue([]);

      await request(app).get('/api/admin/quality/pipeline/runs?status=failed');

      expect(mockPrismaClient.pipelineRunLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'failed',
          }),
        })
      );
    });

    it('should filter by instanceId from auth context', async () => {
      mockPrismaClient.pipelineRunLog.findMany.mockResolvedValue([]);

      await request(app).get('/api/admin/quality/pipeline/runs');

      expect(mockPrismaClient.pipelineRunLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            instanceId: 'test-instance',
          }),
        })
      );
    });

    it('should return empty runs array when no runs exist', async () => {
      mockPrismaClient.pipelineRunLog.findMany.mockResolvedValue([]);

      const response = await request(app).get('/api/admin/quality/pipeline/runs');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(0);
      expect(response.body.runs).toEqual([]);
    });

    it('should default limit to 20 when not specified', async () => {
      mockPrismaClient.pipelineRunLog.findMany.mockResolvedValue([]);

      await request(app).get('/api/admin/quality/pipeline/runs');

      expect(mockPrismaClient.pipelineRunLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
        })
      );
    });

    it('should order runs by createdAt descending', async () => {
      mockPrismaClient.pipelineRunLog.findMany.mockResolvedValue([]);

      await request(app).get('/api/admin/quality/pipeline/runs');

      expect(mockPrismaClient.pipelineRunLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.pipelineRunLog.findMany.mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app).get('/api/admin/quality/pipeline/runs');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Failed to fetch pipeline runs');
    });
  });

  // ==================== GET /pipeline/runs/:id ====================

  describe('GET /api/admin/quality/pipeline/runs/:id', () => {
    it('should return a specific pipeline run with steps', async () => {
      const mockRun = {
        id: 1,
        instanceId: 'test-instance',
        batchId: 'batch-001',
        pipelineId: 'pipeline-v1',
        status: 'completed',
        inputMessages: 50,
        steps: [
          {
            stepName: 'keyword-filter',
            stepType: 'filter',
            status: 'completed',
            durationMs: 150,
            inputCount: 50,
            outputCount: 30,
          },
          {
            stepName: 'classify-messages',
            stepType: 'classify',
            status: 'completed',
            durationMs: 5000,
            inputCount: 30,
            outputCount: 10,
            promptUsed: 'classify-messages',
          },
        ],
        outputThreads: 10,
        outputProposals: 5,
        totalDurationMs: 12000,
        llmCalls: 3,
        llmTokensUsed: 15000,
        createdAt: new Date('2026-01-20T10:00:00Z'),
        completedAt: new Date('2026-01-20T10:00:12Z'),
        errorMessage: null,
      };

      mockPrismaClient.pipelineRunLog.findUnique.mockResolvedValue(mockRun);

      const response = await request(app).get('/api/admin/quality/pipeline/runs/1');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(1);
      expect(response.body.steps).toHaveLength(2);
      expect(response.body.steps[0]).toHaveProperty('stepName', 'keyword-filter');
      expect(response.body.steps[1]).toHaveProperty('promptUsed', 'classify-messages');
    });

    it('should return 404 for non-existent run', async () => {
      mockPrismaClient.pipelineRunLog.findUnique.mockResolvedValue(null);

      const response = await request(app).get('/api/admin/quality/pipeline/runs/999');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Pipeline run not found');
    });

    it('should return 400 for invalid run ID', async () => {
      const response = await request(app).get('/api/admin/quality/pipeline/runs/abc');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Invalid run ID');
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.pipelineRunLog.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/admin/quality/pipeline/runs/1');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Failed to fetch pipeline run');
    });
  });

  // ==================== GET /pipeline/prompts ====================

  describe('GET /api/admin/quality/pipeline/prompts', () => {
    it('should return prompts with no overrides', async () => {
      mockPrismaClient.tenantPromptOverride.findMany.mockResolvedValue([]);

      const response = await request(app).get('/api/admin/quality/pipeline/prompts');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('prompts');
      expect(response.body.prompts).toHaveLength(2);
      expect(response.body.prompts[0]).toHaveProperty('id', 'classify-messages');
      expect(response.body.prompts[0]).toHaveProperty('hasOverride', false);
      expect(response.body.prompts[0]).toHaveProperty('override', null);
    });

    it('should parse JSON override content into system/user fields', async () => {
      const overrideContent = JSON.stringify({
        system: 'Custom system prompt',
        user: 'Custom user prompt: {{messages}}',
      });

      mockPrismaClient.tenantPromptOverride.findMany.mockResolvedValue([
        {
          id: 1,
          tenantId: 'test-instance',
          promptKey: 'classify-messages',
          content: overrideContent,
          createdAt: new Date('2026-01-20T12:00:00Z'),
          updatedAt: new Date('2026-01-20T12:00:00Z'),
        },
      ]);

      const response = await request(app).get('/api/admin/quality/pipeline/prompts');

      expect(response.status).toBe(200);
      const classifyPrompt = response.body.prompts.find((p: any) => p.id === 'classify-messages');
      expect(classifyPrompt.hasOverride).toBe(true);
      expect(classifyPrompt.override).toEqual({
        system: 'Custom system prompt',
        user: 'Custom user prompt: {{messages}}',
        createdAt: expect.any(String),
      });
    });

    it('should handle non-JSON override content as system prompt', async () => {
      mockPrismaClient.tenantPromptOverride.findMany.mockResolvedValue([
        {
          id: 1,
          tenantId: 'test-instance',
          promptKey: 'classify-messages',
          content: 'Plain text override content',
          createdAt: new Date('2026-01-20T12:00:00Z'),
          updatedAt: new Date('2026-01-20T12:00:00Z'),
        },
      ]);

      const response = await request(app).get('/api/admin/quality/pipeline/prompts');

      expect(response.status).toBe(200);
      const classifyPrompt = response.body.prompts.find((p: any) => p.id === 'classify-messages');
      expect(classifyPrompt.hasOverride).toBe(true);
      expect(classifyPrompt.override).toEqual({
        system: 'Plain text override content',
        user: '',
        createdAt: expect.any(String),
      });
    });

    it('should handle override with empty system/user fields', async () => {
      const overrideContent = JSON.stringify({
        system: '',
        user: 'Only user prompt override',
      });

      mockPrismaClient.tenantPromptOverride.findMany.mockResolvedValue([
        {
          id: 1,
          tenantId: 'test-instance',
          promptKey: 'generate-proposals',
          content: overrideContent,
          createdAt: new Date('2026-01-20T12:00:00Z'),
          updatedAt: new Date('2026-01-20T12:00:00Z'),
        },
      ]);

      const response = await request(app).get('/api/admin/quality/pipeline/prompts');

      expect(response.status).toBe(200);
      const generatePrompt = response.body.prompts.find((p: any) => p.id === 'generate-proposals');
      expect(generatePrompt.override).toEqual({
        system: '',
        user: 'Only user prompt override',
        createdAt: expect.any(String),
      });
    });

    it('should mark prompts without overrides correctly', async () => {
      const overrideContent = JSON.stringify({
        system: 'Override',
        user: 'Override user',
      });

      mockPrismaClient.tenantPromptOverride.findMany.mockResolvedValue([
        {
          id: 1,
          tenantId: 'test-instance',
          promptKey: 'classify-messages',
          content: overrideContent,
          createdAt: new Date('2026-01-20T12:00:00Z'),
          updatedAt: new Date('2026-01-20T12:00:00Z'),
        },
      ]);

      const response = await request(app).get('/api/admin/quality/pipeline/prompts');

      expect(response.status).toBe(200);
      const noOverridePrompt = response.body.prompts.find(
        (p: any) => p.id === 'generate-proposals'
      );
      expect(noOverridePrompt.hasOverride).toBe(false);
      expect(noOverridePrompt.override).toBeNull();
    });

    it('should include override and prompt counts in response', async () => {
      mockPrismaClient.tenantPromptOverride.findMany.mockResolvedValue([
        {
          id: 1,
          tenantId: 'test-instance',
          promptKey: 'classify-messages',
          content: JSON.stringify({ system: 's', user: 'u' }),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const response = await request(app).get('/api/admin/quality/pipeline/prompts');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('count', 2);
      expect(response.body).toHaveProperty('overrideCount', 1);
    });

    it('should handle prompt registry errors gracefully', async () => {
      mockPromptRegistry.load.mockRejectedValue(new Error('Failed to load prompts'));

      const response = await request(app).get('/api/admin/quality/pipeline/prompts');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Failed to fetch prompts');
    });
  });

  // ==================== PUT /pipeline/prompts/:promptId/override ====================

  describe('PUT /api/admin/quality/pipeline/prompts/:promptId/override', () => {
    it('should accept system and user fields from frontend', async () => {
      const mockOverride = {
        id: 1,
        tenantId: 'test-instance',
        promptKey: 'classify-messages',
        content: JSON.stringify({ system: 'New system', user: 'New user' }),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.tenantPromptOverride.upsert.mockResolvedValue(mockOverride);

      const response = await request(app)
        .put('/api/admin/quality/pipeline/prompts/classify-messages/override')
        .send({ system: 'New system', user: 'New user' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.tenantPromptOverride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            content: JSON.stringify({ system: 'New system', user: 'New user' }),
          }),
          create: expect.objectContaining({
            content: JSON.stringify({ system: 'New system', user: 'New user' }),
          }),
        })
      );
    });

    it('should accept only system field (empty user)', async () => {
      const expectedContent = JSON.stringify({ system: 'System only', user: '' });
      const mockOverride = {
        id: 1,
        tenantId: 'test-instance',
        promptKey: 'classify-messages',
        content: expectedContent,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.tenantPromptOverride.upsert.mockResolvedValue(mockOverride);

      const response = await request(app)
        .put('/api/admin/quality/pipeline/prompts/classify-messages/override')
        .send({ system: 'System only' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.tenantPromptOverride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            content: expectedContent,
          }),
        })
      );
    });

    it('should accept only user field (empty system)', async () => {
      const expectedContent = JSON.stringify({ system: '', user: 'User only' });
      const mockOverride = {
        id: 1,
        tenantId: 'test-instance',
        promptKey: 'classify-messages',
        content: expectedContent,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.tenantPromptOverride.upsert.mockResolvedValue(mockOverride);

      const response = await request(app)
        .put('/api/admin/quality/pipeline/prompts/classify-messages/override')
        .send({ user: 'User only' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.tenantPromptOverride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            content: expectedContent,
          }),
        })
      );
    });

    it('should still accept raw content field for backward compatibility', async () => {
      const mockOverride = {
        id: 1,
        tenantId: 'test-instance',
        promptKey: 'classify-messages',
        content: 'Raw content string',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.tenantPromptOverride.upsert.mockResolvedValue(mockOverride);

      const response = await request(app)
        .put('/api/admin/quality/pipeline/prompts/classify-messages/override')
        .send({ content: 'Raw content string' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.tenantPromptOverride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            content: 'Raw content string',
          }),
        })
      );
    });

    it('should prefer system/user over content when both provided', async () => {
      const expectedContent = JSON.stringify({ system: 'Sys', user: 'Usr' });
      const mockOverride = {
        id: 1,
        tenantId: 'test-instance',
        promptKey: 'classify-messages',
        content: expectedContent,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.tenantPromptOverride.upsert.mockResolvedValue(mockOverride);

      const response = await request(app)
        .put('/api/admin/quality/pipeline/prompts/classify-messages/override')
        .send({ system: 'Sys', user: 'Usr', content: 'Should be ignored' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.tenantPromptOverride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            content: expectedContent,
          }),
        })
      );
    });

    it('should return 400 when no content provided', async () => {
      const response = await request(app)
        .put('/api/admin/quality/pipeline/prompts/classify-messages/override')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should use correct tenantId and promptKey in upsert', async () => {
      mockPrismaClient.tenantPromptOverride.upsert.mockResolvedValue({
        id: 1,
        tenantId: 'test-instance',
        promptKey: 'generate-proposals',
        content: '{}',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await request(app)
        .put('/api/admin/quality/pipeline/prompts/generate-proposals/override')
        .send({ system: 'test', user: 'test' });

      expect(mockPrismaClient.tenantPromptOverride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId_promptKey: {
              tenantId: 'test-instance',
              promptKey: 'generate-proposals',
            },
          },
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.tenantPromptOverride.upsert.mockRejectedValue(
        new Error('Unique constraint violation')
      );

      const response = await request(app)
        .put('/api/admin/quality/pipeline/prompts/classify-messages/override')
        .send({ system: 'test', user: 'test' });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Failed to save prompt override');
    });
  });

  // ==================== DELETE /pipeline/prompts/:promptId/override ====================

  describe('DELETE /api/admin/quality/pipeline/prompts/:promptId/override', () => {
    it('should delete a prompt override', async () => {
      mockPrismaClient.tenantPromptOverride.deleteMany.mockResolvedValue({ count: 1 });

      const response = await request(app).delete(
        '/api/admin/quality/pipeline/prompts/classify-messages/override'
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(mockPrismaClient.tenantPromptOverride.deleteMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'test-instance',
          promptKey: 'classify-messages',
        },
      });
    });

    it('should succeed even when no override exists', async () => {
      mockPrismaClient.tenantPromptOverride.deleteMany.mockResolvedValue({ count: 0 });

      const response = await request(app).delete(
        '/api/admin/quality/pipeline/prompts/nonexistent/override'
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.tenantPromptOverride.deleteMany.mockRejectedValue(
        new Error('Database error')
      );

      const response = await request(app).delete(
        '/api/admin/quality/pipeline/prompts/classify-messages/override'
      );

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Failed to delete prompt override');
    });
  });

  // ==================== Instance ID handling ====================

  describe('Instance ID handling', () => {
    it('should return 400 for PUT override without instance context', async () => {
      // Create app with auth that doesn't set instance
      const noInstanceApp = express();
      noInstanceApp.use(express.json());

      const noInstanceAuth = (req: any, _res: any, next: any) => {
        // No instance set
        next();
      };

      const { createQualitySystemRoutes } =
        await import('../server/routes/quality-system-routes.js');
      const router = createQualitySystemRoutes(noInstanceAuth);
      noInstanceApp.use('/api/admin/quality', router);

      const response = await request(noInstanceApp)
        .put('/api/admin/quality/pipeline/prompts/classify-messages/override')
        .send({ system: 'test', user: 'test' });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Instance ID required for prompt override');
    });

    it('should return 400 for DELETE override without instance context', async () => {
      const noInstanceApp = express();
      noInstanceApp.use(express.json());

      const noInstanceAuth = (req: any, _res: any, next: any) => next();

      const { createQualitySystemRoutes } =
        await import('../server/routes/quality-system-routes.js');
      const router = createQualitySystemRoutes(noInstanceAuth);
      noInstanceApp.use('/api/admin/quality', router);

      const response = await request(noInstanceApp).delete(
        '/api/admin/quality/pipeline/prompts/classify-messages/override'
      );

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Instance ID required');
    });
  });
});
