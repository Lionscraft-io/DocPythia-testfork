/**
 * Quality System Routes
 *
 * API endpoints for managing prompts, rulesets, and feedback
 * Phase 1: Prompts Overview (read-only) and basic Ruleset Editor
 *

 * @created 2026-01-19
 */

import { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { db } from '../db';
import { getInstanceDb } from '../db/instance-db.js';
import { createPromptRegistry } from '../pipeline/prompts/PromptRegistry.js';
import { createLogger, getErrorMessage } from '../utils/logger.js';
import { llmService } from '../stream/llm/llm-service.js';
import { LLMModel } from '../stream/types.js';
import { getDefaultRulesetTemplate } from '../pipeline/types/ruleset.js';
import { BatchMessageProcessor } from '../stream/processors/batch-message-processor.js';
import path from 'path';

const logger = createLogger('QualitySystemRoutes');

/**
 * Get instance ID from request
 * Checks both instance middleware (for /:instance routes) and admin auth (for non-instance routes)
 */
function getInstanceId(req: Request): string | undefined {
  // First try: Instance middleware (for routes with /:instance prefix)
  if ((req as any).instance?.id) {
    return (req as any).instance.id;
  }

  // Second try: Admin auth middleware (for routes without /:instance prefix)
  const adminInstance = (req as any).adminInstance;
  if (adminInstance) {
    return adminInstance;
  }

  return undefined;
}

/**
 * Get instance-aware database client from request
 * Uses instance middleware db if available, otherwise falls back to getInstanceDb()
 */
function getDb(req: Request): PrismaClient {
  // First try: Instance middleware (for routes with /:instance prefix)
  if ((req as any).instance?.db) {
    return (req as any).instance.db;
  }

  // Second try: Admin auth middleware (for routes without /:instance prefix)
  const adminInstance = (req as any).adminInstance;
  if (adminInstance) {
    return getInstanceDb(adminInstance);
  }

  // Fallback to global db (for non-instance-specific queries like TenantRuleset)
  return db;
}

// Validation schemas
const rulesetContentSchema = z.object({
  content: z.string().min(1, 'Ruleset content cannot be empty'),
});

const feedbackSchema = z.object({
  proposalId: z
    .union([z.string(), z.number()])
    .transform((val) => {
      const num = typeof val === 'string' ? parseInt(val, 10) : val;
      return isNaN(num) ? undefined : num;
    })
    .optional(),
  action: z.enum(['approved', 'rejected', 'ignored']),
  feedbackText: z.string().default(''), // Allow empty feedback text
  useForImprovement: z.boolean().default(true),
});

// Schema for LLM improvement suggestions response
const improvementResponseSchema = z.object({
  suggestions: z.array(
    z.object({
      section: z.enum([
        'PROMPT_CONTEXT',
        'REVIEW_MODIFICATIONS',
        'REJECTION_RULES',
        'QUALITY_GATES',
      ]),
      action: z.enum(['add', 'modify', 'remove']),
      currentRule: z.string().optional(),
      suggestedRule: z.string().optional(),
      reasoning: z.string(),
    })
  ),
  summary: z.string(),
});

/**
 * Create Quality System routes
 */
export function createQualitySystemRoutes(adminAuth: RequestHandler): Router {
  const router = Router();

  // ==================== PROMPTS ROUTES (Read-only) ====================

  /**
   * GET /prompts
   * List all available prompts from the registry
   */
  router.get('/prompts', adminAuth, async (req: Request, res: Response) => {
    try {
      // Get instance ID from request headers (set by multi-instance middleware)
      const instanceId = getInstanceId(req) || undefined;

      // Create and load prompt registry
      const configBasePath = path.join(process.cwd(), 'config');
      const registry = createPromptRegistry(configBasePath, instanceId);
      await registry.load();

      const prompts = registry.list();

      // Return prompts with validation info
      const promptsWithValidation = prompts.map((prompt) => ({
        ...prompt,
        validation: registry.validate(prompt),
      }));

      res.json({
        instanceId: instanceId || 'default',
        count: prompts.length,
        prompts: promptsWithValidation,
      });
    } catch (error) {
      logger.error('Error fetching prompts:', error);
      res.status(500).json({ error: 'Failed to fetch prompts', details: getErrorMessage(error) });
    }
  });

  /**
   * GET /prompts/:promptId
   * Get a specific prompt by ID with full content
   */
  router.get('/prompts/:promptId', adminAuth, async (req: Request, res: Response) => {
    try {
      const { promptId } = req.params;
      const instanceId = getInstanceId(req) || undefined;

      const configBasePath = path.join(process.cwd(), 'config');
      const registry = createPromptRegistry(configBasePath, instanceId);
      await registry.load();

      const prompt = registry.get(promptId);

      if (!prompt) {
        return res.status(404).json({ error: `Prompt not found: ${promptId}` });
      }

      res.json({
        instanceId: instanceId || 'default',
        prompt,
        validation: registry.validate(prompt),
      });
    } catch (error) {
      logger.error('Error fetching prompt:', error);
      res.status(500).json({ error: 'Failed to fetch prompt', details: getErrorMessage(error) });
    }
  });

  // ==================== RULESETS ROUTES ====================

  /**
   * GET /rulesets
   * List all tenant rulesets (or just the current tenant's for instance-specific requests)
   */
  router.get('/rulesets', adminAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = getInstanceId(req) || undefined;

      // If instance-specific, filter to that tenant only
      const where = instanceId ? { tenantId: instanceId } : {};

      const rulesets = await db.tenantRuleset.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
      });

      res.json({
        instanceId: instanceId || 'all',
        count: rulesets.length,
        rulesets,
      });
    } catch (error) {
      logger.error('Error fetching rulesets:', error);
      res.status(500).json({ error: 'Failed to fetch rulesets', details: getErrorMessage(error) });
    }
  });

  /**
   * GET /rulesets/:tenantId
   * Get a specific tenant's ruleset
   */
  router.get('/rulesets/:tenantId', adminAuth, async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.params;

      const ruleset = await db.tenantRuleset.findUnique({
        where: { tenantId },
      });

      if (!ruleset) {
        return res.status(404).json({ error: `Ruleset not found for tenant: ${tenantId}` });
      }

      res.json(ruleset);
    } catch (error) {
      logger.error('Error fetching ruleset:', error);
      res.status(500).json({ error: 'Failed to fetch ruleset', details: getErrorMessage(error) });
    }
  });

  /**
   * PUT /rulesets/:tenantId
   * Create or update a tenant's ruleset
   */
  router.put('/rulesets/:tenantId', adminAuth, async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.params;

      const validation = rulesetContentSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: validation.error.issues,
        });
      }

      const { content } = validation.data;

      // Upsert the ruleset
      const ruleset = await db.tenantRuleset.upsert({
        where: { tenantId },
        update: { content, updatedAt: new Date() },
        create: { tenantId, content },
      });

      logger.info(`Ruleset updated for tenant: ${tenantId}`);
      res.json(ruleset);
    } catch (error) {
      logger.error('Error updating ruleset:', error);
      res.status(500).json({ error: 'Failed to update ruleset', details: getErrorMessage(error) });
    }
  });

  /**
   * DELETE /rulesets/:tenantId
   * Delete a tenant's ruleset
   */
  router.delete('/rulesets/:tenantId', adminAuth, async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.params;

      const existing = await db.tenantRuleset.findUnique({
        where: { tenantId },
      });

      if (!existing) {
        return res.status(404).json({ error: `Ruleset not found for tenant: ${tenantId}` });
      }

      await db.tenantRuleset.delete({
        where: { tenantId },
      });

      logger.info(`Ruleset deleted for tenant: ${tenantId}`);
      res.json({ success: true, message: `Ruleset deleted for tenant: ${tenantId}` });
    } catch (error) {
      logger.error('Error deleting ruleset:', error);
      res.status(500).json({ error: 'Failed to delete ruleset', details: getErrorMessage(error) });
    }
  });

  // ==================== FEEDBACK ROUTES ====================

  /**
   * POST /feedback
   * Submit feedback on a proposal review
   */
  router.post('/feedback', adminAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = getInstanceId(req);

      if (!instanceId) {
        return res.status(400).json({ error: 'Instance ID required for feedback submission' });
      }

      const validation = feedbackSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Invalid request body',
          details: validation.error.issues,
        });
      }

      const { proposalId, action, feedbackText, useForImprovement } = validation.data;

      // Only save if there's actual feedback or user wants it used for improvement
      if (!feedbackText && !useForImprovement) {
        return res.json({ skipped: true, message: 'No feedback to save' });
      }

      // Ensure tenant ruleset exists (create empty if not)
      await db.tenantRuleset.upsert({
        where: { tenantId: instanceId },
        update: {},
        create: { tenantId: instanceId, content: '' },
      });

      const feedback = await db.rulesetFeedback.create({
        data: {
          tenantId: instanceId,
          proposalId,
          actionTaken: action, // Map 'action' to 'actionTaken' for db field
          feedbackText: feedbackText || '',
          useForImprovement,
        },
      });

      logger.info(
        `Feedback submitted for tenant ${instanceId}, action: ${action}, useForImprovement: ${useForImprovement}`
      );
      res.json(feedback);
    } catch (error) {
      logger.error('Error submitting feedback:', error);
      res.status(500).json({ error: 'Failed to submit feedback', details: getErrorMessage(error) });
    }
  });

  /**
   * GET /feedback
   * Get all feedback for the current tenant
   */
  router.get('/feedback', adminAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = getInstanceId(req) || undefined;

      const where = instanceId ? { tenantId: instanceId } : {};

      const feedback = await db.rulesetFeedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          proposal: {
            select: {
              id: true,
              page: true,
              section: true,
              updateType: true,
            },
          },
        },
      });

      res.json({
        instanceId: instanceId || 'all',
        count: feedback.length,
        feedback,
      });
    } catch (error) {
      logger.error('Error fetching feedback:', error);
      res.status(500).json({ error: 'Failed to fetch feedback', details: getErrorMessage(error) });
    }
  });

  // ==================== PIPELINE DEBUGGER ROUTES ====================

  /**
   * GET /pipeline/runs
   * List recent pipeline runs for debugging
   */
  router.get('/pipeline/runs', adminAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = getInstanceId(req);
      const instanceDb = getDb(req);
      const limit = parseInt(req.query.limit as string) || 20;
      const status = req.query.status as string;

      const where: any = {};
      if (instanceId) {
        where.instanceId = instanceId;
      }
      if (status) {
        where.status = status;
      }

      const runs = await instanceDb.pipelineRunLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          instanceId: true,
          batchId: true,
          pipelineId: true,
          status: true,
          inputMessages: true,
          outputThreads: true,
          outputProposals: true,
          totalDurationMs: true,
          llmCalls: true,
          llmTokensUsed: true,
          createdAt: true,
          completedAt: true,
          errorMessage: true,
          steps: true,
        },
      });

      res.json({
        instanceId: instanceId || 'all',
        total: runs.length,
        runs,
      });
    } catch (error) {
      logger.error('Error fetching pipeline runs:', error);
      res
        .status(500)
        .json({ error: 'Failed to fetch pipeline runs', details: getErrorMessage(error) });
    }
  });

  /**
   * GET /pipeline/runs/:id
   * Get detailed pipeline run with step-by-step data
   */
  router.get('/pipeline/runs/:id', adminAuth, async (req: Request, res: Response) => {
    try {
      const instanceDb = getDb(req);
      const runId = parseInt(req.params.id, 10);

      if (isNaN(runId)) {
        return res.status(400).json({ error: 'Invalid run ID' });
      }

      const run = await instanceDb.pipelineRunLog.findUnique({
        where: { id: runId },
      });

      if (!run) {
        return res.status(404).json({ error: 'Pipeline run not found' });
      }

      res.json(run);
    } catch (error) {
      logger.error('Error fetching pipeline run:', error);
      res
        .status(500)
        .json({ error: 'Failed to fetch pipeline run', details: getErrorMessage(error) });
    }
  });

  /**
   * GET /pipeline/prompts
   * Get all prompts with override status for debugging
   */
  router.get('/pipeline/prompts', adminAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = getInstanceId(req) || undefined;
      const configBasePath = path.join(process.cwd(), 'config');
      const registry = createPromptRegistry(configBasePath, instanceId);
      await registry.load();

      const prompts = registry.list();

      // Check for tenant overrides
      const overrides = instanceId
        ? await db.tenantPromptOverride.findMany({
            where: { tenantId: instanceId },
          })
        : [];

      const overrideMap = new Map(overrides.map((o) => [o.promptKey, o]));

      const promptsWithOverrides = prompts.map((prompt) => {
        const rawOverride = overrideMap.get(prompt.id);
        let parsedOverride = null;
        if (rawOverride) {
          try {
            const parsed = JSON.parse(rawOverride.content);
            parsedOverride = {
              system: parsed.system || '',
              user: parsed.user || '',
              createdAt: rawOverride.createdAt,
            };
          } catch {
            // If content is not JSON, treat as system prompt
            parsedOverride = {
              system: rawOverride.content,
              user: '',
              createdAt: rawOverride.createdAt,
            };
          }
        }
        return {
          ...prompt,
          hasOverride: overrideMap.has(prompt.id),
          override: parsedOverride,
          validation: registry.validate(prompt),
        };
      });

      res.json({
        instanceId: instanceId || 'default',
        count: prompts.length,
        overrideCount: overrides.length,
        prompts: promptsWithOverrides,
      });
    } catch (error) {
      logger.error('Error fetching prompts for debugger:', error);
      res.status(500).json({ error: 'Failed to fetch prompts', details: getErrorMessage(error) });
    }
  });

  /**
   * PUT /pipeline/prompts/:promptId/override
   * Create or update a prompt override for the tenant
   */
  router.put(
    '/pipeline/prompts/:promptId/override',
    adminAuth,
    async (req: Request, res: Response) => {
      try {
        const instanceId = getInstanceId(req);
        const { promptId } = req.params;
        const {
          system,
          user,
          content: rawContent,
        } = req.body as {
          system?: string;
          user?: string;
          content?: string;
        };

        if (!instanceId) {
          return res.status(400).json({ error: 'Instance ID required for prompt override' });
        }

        // Accept either { system, user } from frontend or { content } directly
        const content =
          system !== undefined || user !== undefined
            ? JSON.stringify({ system: system || '', user: user || '' })
            : rawContent;

        if (!content || typeof content !== 'string') {
          return res
            .status(400)
            .json({ error: 'Prompt content is required (provide system/user or content)' });
        }

        const override = await db.tenantPromptOverride.upsert({
          where: {
            tenantId_promptKey: {
              tenantId: instanceId,
              promptKey: promptId,
            },
          },
          update: {
            content,
            updatedAt: new Date(),
          },
          create: {
            tenantId: instanceId,
            promptKey: promptId,
            content,
          },
        });

        logger.info(`Prompt override saved for ${instanceId}/${promptId}`);
        res.json(override);
      } catch (error) {
        logger.error('Error saving prompt override:', error);
        res
          .status(500)
          .json({ error: 'Failed to save prompt override', details: getErrorMessage(error) });
      }
    }
  );

  /**
   * DELETE /pipeline/prompts/:promptId/override
   * Delete a prompt override (revert to default)
   */
  router.delete(
    '/pipeline/prompts/:promptId/override',
    adminAuth,
    async (req: Request, res: Response) => {
      try {
        const instanceId = getInstanceId(req);
        const { promptId } = req.params;

        if (!instanceId) {
          return res.status(400).json({ error: 'Instance ID required' });
        }

        await db.tenantPromptOverride.deleteMany({
          where: {
            tenantId: instanceId,
            promptKey: promptId,
          },
        });

        logger.info(`Prompt override deleted for ${instanceId}/${promptId}`);
        res.json({ success: true, message: 'Prompt override deleted, reverted to default' });
      } catch (error) {
        logger.error('Error deleting prompt override:', error);
        res
          .status(500)
          .json({ error: 'Failed to delete prompt override', details: getErrorMessage(error) });
      }
    }
  );

  // ==================== IMPROVEMENT GENERATION ROUTES ====================

  /**
   * POST /improvements/generate
   * Generate ruleset improvement suggestions from unprocessed feedback
   */
  router.post('/improvements/generate', adminAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = getInstanceId(req);

      if (!instanceId) {
        return res.status(400).json({ error: 'Instance ID required for improvement generation' });
      }

      // Load unprocessed feedback (useForImprovement=true and processedAt=null)
      const unprocessedFeedback = await db.rulesetFeedback.findMany({
        where: {
          tenantId: instanceId,
          useForImprovement: true,
          processedAt: null,
        },
        include: {
          proposal: {
            select: {
              id: true,
              page: true,
              section: true,
              updateType: true,
              reasoning: true,
              suggestedText: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50, // Limit to last 50 feedback items
      });

      if (unprocessedFeedback.length === 0) {
        return res.json({
          message: 'No unprocessed feedback available',
          suggestions: [],
          summary: 'No feedback to process',
          feedbackCount: 0,
        });
      }

      // Load current ruleset
      const currentRuleset = await db.tenantRuleset.findUnique({
        where: { tenantId: instanceId },
      });

      const currentContent = currentRuleset?.content || getDefaultRulesetTemplate();

      // Format feedback for LLM
      const feedbackSummary = unprocessedFeedback
        .map((fb, idx) => {
          const proposalInfo = fb.proposal
            ? `Proposal: ${fb.proposal.updateType} on ${fb.proposal.page}${fb.proposal.section ? ` (${fb.proposal.section})` : ''}`
            : 'General feedback';
          return `[${idx + 1}] Action: ${fb.actionTaken.toUpperCase()}\n${proposalInfo}\nFeedback: ${fb.feedbackText || '(no text)'}`;
        })
        .join('\n\n');

      // Generate improvements using LLM
      const systemPrompt = `You are an expert at improving documentation quality rulesets.
Analyze the feedback from documentation proposal reviews and suggest improvements to the ruleset.

The ruleset has 4 sections:
1. PROMPT_CONTEXT - Context injected into generation prompts to guide AI proposal creation
2. REVIEW_MODIFICATIONS - Rules for modifying proposals after enrichment analysis
3. REJECTION_RULES - Rules for auto-rejecting proposals (based on duplication, similarity, patterns)
4. QUALITY_GATES - Rules for flagging proposals for human review without rejecting them

Return JSON with structured suggestions. Each suggestion should identify:
- Which section it applies to
- Whether to add a new rule, modify an existing rule, or remove a rule
- The specific rule text
- Clear reasoning based on the feedback patterns`;

      const userPrompt = `## Current Ruleset

${currentContent}

## Recent Feedback (${unprocessedFeedback.length} items)

${feedbackSummary}

Based on this feedback, suggest improvements to the ruleset. Look for patterns such as:
- Frequently rejected proposals that could be caught by rejection rules
- Commonly needed modifications that could be automated
- Quality concerns that should flag proposals for review
- Context that would help generate better proposals initially

Provide specific, actionable rule suggestions.`;

      try {
        const { data } = await llmService.requestJSON(
          {
            model: LLMModel.FLASH,
            systemPrompt,
            userPrompt,
            temperature: 0.3,
            maxTokens: 4096,
          },
          improvementResponseSchema
        );

        logger.info(
          `Generated ${data.suggestions.length} improvement suggestions for tenant ${instanceId}`
        );

        res.json({
          instanceId,
          feedbackCount: unprocessedFeedback.length,
          feedbackIds: unprocessedFeedback.map((fb) => fb.id),
          suggestions: data.suggestions,
          summary: data.summary,
          currentRuleset: currentContent,
        });
      } catch (llmError) {
        logger.error('LLM error generating improvements:', llmError);
        return res.status(500).json({
          error: 'Failed to generate improvements',
          details: getErrorMessage(llmError),
        });
      }
    } catch (error) {
      logger.error('Error generating improvements:', error);
      res
        .status(500)
        .json({ error: 'Failed to generate improvements', details: getErrorMessage(error) });
    }
  });

  /**
   * POST /improvements/apply
   * Mark feedback as processed after improvements are applied
   */
  router.post('/improvements/apply', adminAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = getInstanceId(req);
      const { feedbackIds } = req.body as { feedbackIds?: number[] };

      if (!instanceId) {
        return res.status(400).json({ error: 'Instance ID required' });
      }

      if (!feedbackIds || !Array.isArray(feedbackIds) || feedbackIds.length === 0) {
        return res.status(400).json({ error: 'feedbackIds array required' });
      }

      // Mark feedback as processed
      const result = await db.rulesetFeedback.updateMany({
        where: {
          id: { in: feedbackIds },
          tenantId: instanceId,
        },
        data: {
          processedAt: new Date(),
        },
      });

      logger.info(`Marked ${result.count} feedback items as processed for tenant ${instanceId}`);

      res.json({
        success: true,
        processedCount: result.count,
      });
    } catch (error) {
      logger.error('Error applying improvements:', error);
      res
        .status(500)
        .json({ error: 'Failed to apply improvements', details: getErrorMessage(error) });
    }
  });

  // ==================== TEST PIPELINE ROUTES ====================

  /**
   * POST /pipeline/test-run
   * Trigger a test pipeline run processing ONLY test messages (streamId = 'pipeline-test')
   * Duplicates messages before processing so originals remain PENDING for reuse
   */
  router.post('/pipeline/test-run', adminAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = getInstanceId(req);

      if (!instanceId) {
        return res.status(400).json({ error: 'Instance ID required' });
      }

      const instanceDb = getDb(req);

      logger.info(`[${instanceId}] Starting test pipeline run (test messages only)...`);

      // Fetch all test messages (from pipeline-test stream) - these are the "template" messages
      const templateStreamId = 'pipeline-test';
      const templateMessages = await instanceDb.unifiedMessage.findMany({
        where: {
          streamId: templateStreamId,
        },
        orderBy: { timestamp: 'asc' },
      });

      if (templateMessages.length === 0) {
        return res.json({
          success: false,
          message: 'No test messages to process',
          pendingMessages: 0,
          suggestion:
            'Use the "Create Test Messages" form above to create simulated messages first',
        });
      }

      // Create a unique stream ID for this run
      const runTimestamp = Date.now();
      const runStreamId = `pipeline-test-run-${runTimestamp}`;

      // Ensure stream config exists for the run stream
      await instanceDb.streamConfig.upsert({
        where: { streamId: runStreamId },
        update: {},
        create: {
          streamId: runStreamId,
          adapterType: 'test',
          config: { description: `Test run ${runTimestamp}`, templateStreamId },
          enabled: true,
        },
      });

      // Duplicate template messages into the run stream
      const duplicatedMessages = [];
      for (const msg of templateMessages) {
        const duplicated = await instanceDb.unifiedMessage.create({
          data: {
            streamId: runStreamId,
            messageId: `${msg.messageId}-run-${runTimestamp}`,
            author: msg.author,
            content: msg.content,
            timestamp: msg.timestamp,
            channel: msg.channel,
            rawData: msg.rawData as any,
            metadata: {
              ...(msg.metadata as any),
              duplicatedFrom: msg.id,
              testRunTimestamp: runTimestamp,
            },
            processingStatus: 'PENDING',
          },
        });
        duplicatedMessages.push(duplicated);
      }

      logger.info(
        `[${instanceId}] Duplicated ${duplicatedMessages.length} messages into ${runStreamId}`
      );

      // Create processor and run batch asynchronously (fire-and-forget)
      // This prevents 504 timeout on long-running pipeline processing
      const processor = new BatchMessageProcessor(instanceId, instanceDb);

      // Start processing in background without waiting - process the duplicated messages
      processor
        .processBatch({ streamIdFilter: runStreamId })
        .then((messagesProcessed) => {
          logger.info(
            `[${instanceId}] Test pipeline complete: ${messagesProcessed} test messages processed`
          );
        })
        .catch((error) => {
          logger.error(`[${instanceId}] Test pipeline failed:`, error);
        });

      // Return immediately - frontend will poll for completion
      res.json({
        success: true,
        message: `Pipeline started processing ${duplicatedMessages.length} test messages`,
        pendingMessages: duplicatedMessages.length,
        runStreamId,
        status: 'processing',
      });
    } catch (error) {
      logger.error('Error running test pipeline:', error);
      res
        .status(500)
        .json({ error: 'Failed to run test pipeline', details: getErrorMessage(error) });
    }
  });

  /**
   * POST /pipeline/simulate
   * Create simulated test messages for pipeline testing
   */
  router.post('/pipeline/simulate', adminAuth, async (req: Request, res: Response) => {
    try {
      const instanceId = getInstanceId(req);

      if (!instanceId) {
        return res.status(400).json({ error: 'Instance ID required' });
      }

      const instanceDb = getDb(req);

      const schema = z.object({
        messages: z
          .array(
            z.object({
              content: z.string().min(1),
              author: z.string().optional().default('Test User'),
            })
          )
          .min(1)
          .max(10),
      });

      const { messages } = schema.parse(req.body);

      logger.info(`[${instanceId}] Creating ${messages.length} simulated test messages...`);

      // Ensure pipeline-test stream config exists
      await instanceDb.streamConfig.upsert({
        where: { streamId: 'pipeline-test' },
        update: {},
        create: {
          streamId: 'pipeline-test',
          adapterType: 'test',
          config: { description: 'Test stream for pipeline debugging' },
          enabled: true,
        },
      });

      // Create simulated unified messages
      const createdMessages = [];
      for (const msg of messages) {
        const unifiedMessage = await instanceDb.unifiedMessage.create({
          data: {
            streamId: 'pipeline-test',
            messageId: `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            author: msg.author,
            content: msg.content,
            timestamp: new Date(),
            channel: 'test-channel',
            rawData: { simulated: true, testRun: true, originalContent: msg.content },
            metadata: { simulated: true, testRun: true },
            processingStatus: 'PENDING',
          },
        });
        createdMessages.push(unifiedMessage);
      }

      logger.info(`[${instanceId}] Created ${createdMessages.length} simulated messages`);

      res.json({
        success: true,
        message: `Created ${createdMessages.length} simulated messages`,
        messageIds: createdMessages.map((m) => m.id),
        nextStep: 'Use POST /pipeline/test-run to process these messages through the pipeline',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: error.errors });
      }
      logger.error('Error creating simulated messages:', error);
      res
        .status(500)
        .json({ error: 'Failed to create simulated messages', details: getErrorMessage(error) });
    }
  });

  /**
   * GET /pipeline/pending-messages
   * Get count and sample of TEST messages only (streamId = 'pipeline-test')
   */
  router.get('/pipeline/pending-messages', adminAuth, async (req: Request, res: Response) => {
    try {
      const instanceDb = getDb(req);

      // Only show test messages (from pipeline-test stream)
      const testStreamFilter = { streamId: 'pipeline-test', processingStatus: 'PENDING' as const };

      const pendingCount = await instanceDb.unifiedMessage.count({
        where: testStreamFilter,
      });

      const sampleMessages = await instanceDb.unifiedMessage.findMany({
        where: testStreamFilter,
        take: 10,
        orderBy: { timestamp: 'desc' },
        select: {
          id: true,
          streamId: true,
          author: true,
          content: true,
          timestamp: true,
          channel: true,
        },
      });

      res.json({
        pendingCount,
        sampleMessages,
      });
    } catch (error) {
      logger.error('Error fetching pending messages:', error);
      res
        .status(500)
        .json({ error: 'Failed to fetch pending messages', details: getErrorMessage(error) });
    }
  });

  /**
   * DELETE /pipeline/test-messages
   * Clear all test messages (from pipeline-test stream)
   */
  router.delete('/pipeline/test-messages', adminAuth, async (req: Request, res: Response) => {
    try {
      const instanceDb = getDb(req);
      const testStreamId = 'pipeline-test';

      // Delete all messages from the test stream
      const result = await instanceDb.unifiedMessage.deleteMany({
        where: { streamId: testStreamId },
      });

      logger.info(`Deleted ${result.count} test messages`);

      res.json({
        success: true,
        message: `Deleted ${result.count} test messages`,
        deletedCount: result.count,
      });
    } catch (error) {
      logger.error('Error deleting test messages:', error);
      res
        .status(500)
        .json({ error: 'Failed to delete test messages', details: getErrorMessage(error) });
    }
  });

  return router;
}

export default createQualitySystemRoutes;
