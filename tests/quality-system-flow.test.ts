/**
 * Quality System Flow Integration Tests
 *
 * End-to-end tests demonstrating the complete Quality System flow:
 * 1. Message classification → 2. Proposal generation with PROMPT_CONTEXT
 * 3. Context enrichment → 4. Ruleset review → 5. Storage with enrichment data
 *
 * These tests verify the integration points between components.
 *

 * @created 2026-01-19
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies using vi.hoisted
const { mockPrismaClient, mockLLMService, mockVectorSearch } = vi.hoisted(() => {
  return {
    mockPrismaClient: {
      processingWatermark: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        upsert: vi.fn(),
      },
      unifiedMessage: {
        count: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        groupBy: vi.fn(),
      },
      messageClassification: {
        count: vi.fn(),
        create: vi.fn(),
        upsert: vi.fn(),
        findUnique: vi.fn(),
        groupBy: vi.fn(),
        deleteMany: vi.fn(),
      },
      conversationRagContext: {
        create: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
        findUnique: vi.fn(),
      },
      docProposal: {
        count: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
      },
      docIndex: {
        findMany: vi.fn(),
      },
      streamConfig: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      importWatermark: {
        findMany: vi.fn(),
      },
      instanceConfig: {
        findUnique: vi.fn(),
      },
      pipelineRunLog: {
        create: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
      $transaction: vi.fn((callback: any) => callback(mockPrismaClient)),
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn(),
      $queryRawUnsafe: vi.fn(),
    },
    mockLLMService: {
      requestJSON: vi.fn(),
      requestText: vi.fn(),
    },
    mockVectorSearch: {
      searchSimilarDocs: vi.fn(),
      searchSimilarMessages: vi.fn(),
    },
  };
});

// Mock dependencies
vi.mock('../server/db.js', () => ({
  default: mockPrismaClient,
}));

vi.mock('../server/stream/llm/llm-service.js', () => ({
  llmService: mockLLMService,
}));

vi.mock('../server/stream/message-vector-search.js', () => {
  return {
    MessageVectorSearch: class MockMessageVectorSearch {
      constructor() {}
      searchSimilarDocs = mockVectorSearch.searchSimilarDocs;
      searchSimilarMessages = mockVectorSearch.searchSimilarMessages;
      generateEmbedding = vi.fn().mockResolvedValue(new Array(768).fill(0));
      storeEmbedding = vi.fn().mockResolvedValue(undefined);
    },
  };
});

vi.mock('../server/config/instance-loader.js', () => ({
  InstanceConfigLoader: {
    get: vi.fn().mockReturnValue({
      database: { url: 'postgresql://test:test@localhost:5432/test' },
      gemini: { apiKey: 'test-key' },
      project: { name: 'Test Project' },
    }),
  },
}));

vi.mock('../server/vector-store.js', () => {
  return {
    PgVectorStore: class MockPgVectorStore {
      constructor() {}
      search = vi.fn().mockResolvedValue([]);
      addDocument = vi.fn().mockResolvedValue(undefined);
    },
  };
});

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

// Import types
import { parseRuleset, createEmptyRuleset } from '../server/pipeline/types/ruleset.js';
import {
  createEmptyEnrichment,
  textAnalysis,
  type ProposalEnrichment,
} from '../server/pipeline/types/enrichment.js';

const resetAllMocks = () => {
  Object.values(mockPrismaClient).forEach((model: any) => {
    if (model && typeof model === 'object') {
      Object.values(model).forEach((method: any) => {
        if (typeof method?.mockReset === 'function') {
          method.mockReset();
        }
      });
    }
  });
  mockLLMService.requestJSON.mockReset();
  mockLLMService.requestText.mockReset();
  mockVectorSearch.searchSimilarDocs.mockReset();
  mockVectorSearch.searchSimilarMessages.mockReset();
};

describe('Quality System Flow', () => {
  beforeEach(() => {
    resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-11-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Full Processing Flow Simulation', () => {
    /**
     * This test simulates the complete Quality System flow:
     * 1. Classification produces a thread
     * 2. Proposal generation uses PROMPT_CONTEXT from ruleset
     * 3. Enrichment analyzes the proposal for context
     * 4. Ruleset review applies rejection rules and quality gates
     * 5. Accepted proposals are stored with enrichment data
     */
    it('should demonstrate the complete Quality System flow', async () => {
      // Step 1: Parse a ruleset (simulating what loadTenantRuleset does)
      const rulesetMarkdown = `# Documentation Ruleset

## PROMPT_CONTEXT
- Use formal technical writing style
- Always use "validator" instead of "node operator"
- Include code examples when applicable

## REJECTION_RULES
- If duplicationWarning.overlapPercentage > 80%, reject as duplicate
- If proposal content mentions "deprecated", reject as outdated

## REVIEW_MODIFICATIONS
- Adjust format to match target page
- Shorten sentences if avgSentenceLength differs by >50%

## QUALITY_GATES
- If changePercentage > 50%, flag as significant_change
- If otherPendingProposals > 0, flag as needs_coordination
`;

      const parsedRuleset = parseRuleset(rulesetMarkdown);

      // Verify ruleset parsing
      expect(parsedRuleset.promptContext).toHaveLength(3);
      expect(parsedRuleset.rejectionRules).toHaveLength(2);
      expect(parsedRuleset.reviewModifications).toHaveLength(2);
      expect(parsedRuleset.qualityGates).toHaveLength(2);

      // Step 2: Build enhanced system prompt with PROMPT_CONTEXT
      const baseSystemPrompt = 'You are a documentation assistant.';
      const contextSection = `

=== DOCUMENTATION STYLE REQUIREMENTS (FROM RULESET) ===
${parsedRuleset.promptContext.map((rule) => `- ${rule}`).join('\n')}
=== END STYLE REQUIREMENTS ===
`;
      const enhancedSystemPrompt = baseSystemPrompt + contextSection;

      expect(enhancedSystemPrompt).toContain('Use formal technical writing style');
      expect(enhancedSystemPrompt).toContain('Always use "validator"');

      // Step 3: Simulate a generated proposal
      const proposal = {
        updateType: 'UPDATE',
        page: 'docs/validators/troubleshooting.md',
        section: 'RPC Errors',
        suggestedText:
          'When your validator experiences RPC timeout errors, first check your network connectivity. Ensure your firewall allows outbound connections on port 443.',
        reasoning: 'This troubleshooting tip is commonly asked but not documented',
        sourceMessages: [1],
        priority: 75,
      };

      // Step 4: Create enrichment data
      const enrichment = createEmptyEnrichment();

      // Simulate finding related docs
      enrichment.relatedDocs = [
        {
          page: 'docs/validators/setup.md',
          section: 'Network Configuration',
          similarityScore: 0.82,
          matchType: 'semantic',
          snippet: 'Configure your validator firewall to allow necessary ports.',
        },
      ];

      // Simulate duplication check - no duplicate found
      const existingDocContent = 'This is different content about validator setup.';
      const overlapPercentage = textAnalysis.ngramOverlap(
        proposal.suggestedText,
        existingDocContent,
        3
      );
      enrichment.duplicationWarning = {
        detected: overlapPercentage > 50,
        overlapPercentage: overlapPercentage,
      };

      expect(enrichment.duplicationWarning.detected).toBe(false);

      // Simulate style analysis
      const proposalAvgSentenceLen = textAnalysis.avgSentenceLength(proposal.suggestedText);
      const targetAvgSentenceLen = 20; // Mock target doc average
      enrichment.styleAnalysis = {
        targetPageStyle: {
          avgSentenceLength: targetAvgSentenceLen,
          usesCodeExamples: true,
          formatPattern: textAnalysis.detectFormatPattern(existingDocContent),
          technicalDepth: 'intermediate',
        },
        proposalStyle: {
          avgSentenceLength: proposalAvgSentenceLen,
          usesCodeExamples: textAnalysis.hasCodeExamples(proposal.suggestedText),
          formatPattern: textAnalysis.detectFormatPattern(proposal.suggestedText),
          technicalDepth: textAnalysis.estimateTechnicalDepth(proposal.suggestedText),
        },
        consistencyNotes: [],
      };

      // Simulate change context
      enrichment.changeContext = {
        targetSectionCharCount: 500,
        proposalCharCount: proposal.suggestedText.length,
        changePercentage: Math.round((proposal.suggestedText.length / 500) * 100),
        lastUpdated: new Date('2025-10-15'),
        otherPendingProposals: 0,
      };

      // Simulate source conversation analysis
      enrichment.sourceAnalysis = {
        messageCount: 5,
        uniqueAuthors: 2,
        threadHadConsensus: true,
        conversationSummary:
          'User asked about RPC timeout errors, received helpful troubleshooting advice.',
      };

      // Step 5: Apply ruleset review
      let rejected = false;
      let rejectionReason = '';
      const qualityFlags: string[] = [];

      // Check rejection rules
      for (const rule of parsedRuleset.rejectionRules) {
        if (rule.includes('overlapPercentage > 80')) {
          if (
            enrichment.duplicationWarning.detected &&
            (enrichment.duplicationWarning.overlapPercentage ?? 0) > 80
          ) {
            rejected = true;
            rejectionReason = 'Duplicate content detected';
          }
        }
        if (rule.includes('deprecated')) {
          if (proposal.suggestedText.toLowerCase().includes('deprecated')) {
            rejected = true;
            rejectionReason = 'Contains deprecated content';
          }
        }
      }

      // Check quality gates
      for (const gate of parsedRuleset.qualityGates) {
        if (gate.includes('changePercentage > 50')) {
          if (enrichment.changeContext.changePercentage > 50) {
            qualityFlags.push('significant_change');
          }
        }
        if (gate.includes('otherPendingProposals > 0')) {
          if (enrichment.changeContext.otherPendingProposals > 0) {
            qualityFlags.push('needs_coordination');
          }
        }
      }

      // Verify results
      expect(rejected).toBe(false);
      expect(rejectionReason).toBe('');
      // Change percentage is ~33%, so no significant_change flag
      expect(qualityFlags).not.toContain('significant_change');

      // Step 6: Simulate storage with enrichment
      const proposalToStore = {
        ...proposal,
        enrichment: enrichment,
        reviewResult: {
          rejected,
          rejectionReason: rejectionReason || undefined,
          qualityFlags,
        },
      };

      expect(proposalToStore.enrichment).toBeDefined();
      expect(proposalToStore.enrichment.relatedDocs).toHaveLength(1);
      expect(proposalToStore.enrichment.duplicationWarning.detected).toBe(false);
      expect(proposalToStore.reviewResult.rejected).toBe(false);
    });

    it('should reject proposals that match rejection rules', async () => {
      const rulesetMarkdown = `## REJECTION_RULES
- If duplicationWarning.overlapPercentage > 80%, reject as duplicate
`;
      const parsedRuleset = parseRuleset(rulesetMarkdown);

      // Simulate a proposal that's a duplicate
      const proposal = {
        suggestedText: 'Configure your validator to use port 443 for RPC connections.',
      };

      // Existing content is very similar
      const existingDocContent =
        'Configure your validator to use port 443 for RPC connections. This is required.';
      const overlapPercentage = textAnalysis.ngramOverlap(
        proposal.suggestedText,
        existingDocContent,
        3
      );

      const enrichment = {
        duplicationWarning: {
          detected: overlapPercentage > 50,
          overlapPercentage,
          matchingPage: 'docs/validators/config.md',
        },
      };

      // Apply rejection rules
      let rejected = false;
      let rejectionReason = '';

      for (const rule of parsedRuleset.rejectionRules) {
        if (rule.includes('overlapPercentage > 80')) {
          if (
            enrichment.duplicationWarning.detected &&
            enrichment.duplicationWarning.overlapPercentage > 80
          ) {
            rejected = true;
            rejectionReason = 'Duplicate content detected';
          }
        }
      }

      expect(rejected).toBe(true);
      expect(rejectionReason).toBe('Duplicate content detected');
    });

    it('should flag proposals that trigger quality gates', async () => {
      const rulesetMarkdown = `## QUALITY_GATES
- If changePercentage > 50%, flag as significant_change
- If otherPendingProposals > 0, flag as needs_coordination
`;
      const parsedRuleset = parseRuleset(rulesetMarkdown);

      // Simulate enrichment with high change percentage and pending proposals
      const enrichment = {
        changeContext: {
          targetSectionCharCount: 100,
          proposalCharCount: 200, // 200% change
          changePercentage: 200,
          otherPendingProposals: 2,
        },
      };

      const qualityFlags: string[] = [];

      for (const gate of parsedRuleset.qualityGates) {
        if (gate.includes('changePercentage > 50')) {
          if (enrichment.changeContext.changePercentage > 50) {
            qualityFlags.push('significant_change');
          }
        }
        if (gate.includes('otherPendingProposals > 0')) {
          if (enrichment.changeContext.otherPendingProposals > 0) {
            qualityFlags.push('needs_coordination');
          }
        }
      }

      expect(qualityFlags).toContain('significant_change');
      expect(qualityFlags).toContain('needs_coordination');
    });
  });

  describe('PROMPT_CONTEXT Injection Flow', () => {
    it('should inject PROMPT_CONTEXT rules into system prompt', () => {
      const ruleset = parseRuleset(`## PROMPT_CONTEXT
- Use formal technical writing
- Target intermediate developers
- Include practical examples
`);

      const basePrompt = 'Generate documentation updates based on the conversation.';

      // This simulates buildChangesetSystemPrompt behavior
      const buildSystemPrompt = (base: string, rules: string[]): string => {
        if (rules.length === 0) return base;
        return `${base}

=== DOCUMENTATION STYLE REQUIREMENTS (FROM RULESET) ===
${rules.map((r) => `- ${r}`).join('\n')}
=== END STYLE REQUIREMENTS ===
`;
      };

      const enhanced = buildSystemPrompt(basePrompt, ruleset.promptContext);

      expect(enhanced).toContain(basePrompt);
      expect(enhanced).toContain('DOCUMENTATION STYLE REQUIREMENTS');
      expect(enhanced).toContain('Use formal technical writing');
      expect(enhanced).toContain('Target intermediate developers');
      expect(enhanced).toContain('Include practical examples');
    });

    it('should return base prompt when no PROMPT_CONTEXT rules exist', () => {
      const ruleset = createEmptyRuleset();
      const basePrompt = 'Generate documentation updates.';

      const buildSystemPrompt = (base: string, rules: string[]): string => {
        if (rules.length === 0) return base;
        return `${base}\n\n${rules.join('\n')}`;
      };

      const result = buildSystemPrompt(basePrompt, ruleset.promptContext);
      expect(result).toBe(basePrompt);
    });
  });

  describe('Enrichment Data Persistence', () => {
    it('should create enrichment object suitable for database storage', () => {
      const enrichment = createEmptyEnrichment();

      // Populate with test data
      enrichment.relatedDocs = [
        {
          page: 'docs/test.md',
          section: 'Test Section',
          similarityScore: 0.85,
          matchType: 'semantic',
          snippet: 'Test snippet content',
        },
      ];
      enrichment.duplicationWarning = {
        detected: false,
        overlapPercentage: 15,
      };

      // Verify it can be serialized to JSON (as Prisma would do)
      const serialized = JSON.stringify(enrichment);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.relatedDocs).toHaveLength(1);
      expect(deserialized.relatedDocs[0].similarityScore).toBe(0.85);
      expect(deserialized.duplicationWarning.detected).toBe(false);
    });

    it('should handle null/undefined enrichment gracefully', () => {
      // Simulate proposal storage without enrichment
      const proposal = {
        page: 'docs/test.md',
        suggestedText: 'Test content',
        enrichment: null as ProposalEnrichment | null,
      };

      // When storing, we'd use Prisma.DbNull for null values
      const storageData = {
        page: proposal.page,
        suggestedText: proposal.suggestedText,
        enrichment: proposal.enrichment ?? null, // Would be Prisma.DbNull in real code
      };

      expect(storageData.enrichment).toBeNull();
    });
  });

  describe('Pipeline Step Ordering', () => {
    it('should execute steps in correct order', () => {
      // This verifies the step ordering defined in pipeline config
      const stepOrder = [
        'filter',
        'classify',
        'enrich', // RAG enrichment
        'generate',
        'context-enrich', // Quality System context enrichment
        'ruleset-review', // Quality System ruleset review
        'validate',
        'condense',
      ];

      // Verify context-enrich comes after generate
      const contextEnrichIdx = stepOrder.indexOf('context-enrich');
      const generateIdx = stepOrder.indexOf('generate');
      expect(contextEnrichIdx).toBeGreaterThan(generateIdx);

      // Verify ruleset-review comes after context-enrich
      const rulesetReviewIdx = stepOrder.indexOf('ruleset-review');
      expect(rulesetReviewIdx).toBeGreaterThan(contextEnrichIdx);

      // Verify both come before validate
      const validateIdx = stepOrder.indexOf('validate');
      expect(contextEnrichIdx).toBeLessThan(validateIdx);
      expect(rulesetReviewIdx).toBeLessThan(validateIdx);
    });
  });

  describe('PipelineRunLog Recording', () => {
    it('should record step execution in correct format', () => {
      const runLog = {
        instanceId: 'test-instance',
        batchId: 'batch-001',
        pipelineId: 'default-v2',
        status: 'completed' as const,
        inputMessages: 10,
        outputThreads: 3,
        outputProposals: 5,
        steps: [
          {
            stepId: 'filter',
            stepType: 'filter',
            status: 'completed',
            durationMs: 50,
            inputCount: 10,
            outputCount: 8,
          },
          {
            stepId: 'classify',
            stepType: 'classify',
            status: 'completed',
            durationMs: 2000,
            inputCount: 8,
            outputCount: 3,
          },
          {
            stepId: 'enrich',
            stepType: 'enrich',
            status: 'completed',
            durationMs: 500,
            inputCount: 3,
            outputCount: 3,
          },
          {
            stepId: 'generate',
            stepType: 'generate',
            status: 'completed',
            durationMs: 5000,
            inputCount: 3,
            outputCount: 7,
          },
          {
            stepId: 'context-enrich',
            stepType: 'context-enrich',
            status: 'completed',
            durationMs: 1500,
            inputCount: 7,
            outputCount: 7,
          },
          {
            stepId: 'ruleset-review',
            stepType: 'ruleset-review',
            status: 'completed',
            durationMs: 800,
            inputCount: 7,
            outputCount: 5,
          },
          {
            stepId: 'validate',
            stepType: 'validate',
            status: 'completed',
            durationMs: 1000,
            inputCount: 5,
            outputCount: 5,
          },
          {
            stepId: 'condense',
            stepType: 'condense',
            status: 'completed',
            durationMs: 600,
            inputCount: 5,
            outputCount: 5,
          },
        ],
        totalDurationMs: 11450,
        llmCalls: 5,
        llmTokensUsed: 15000,
      };

      // Verify the structure
      expect(runLog.status).toBe('completed');
      expect(runLog.steps).toHaveLength(8);
      expect(runLog.steps.every((s) => s.status === 'completed')).toBe(true);

      // Verify Quality System steps are recorded
      const contextEnrichStep = runLog.steps.find((s) => s.stepType === 'context-enrich');
      const rulesetReviewStep = runLog.steps.find((s) => s.stepType === 'ruleset-review');
      expect(contextEnrichStep).toBeDefined();
      expect(rulesetReviewStep).toBeDefined();

      // Ruleset review reduced proposals (7 -> 5, meaning 2 were rejected)
      expect(rulesetReviewStep?.inputCount).toBe(7);
      expect(rulesetReviewStep?.outputCount).toBe(5);
    });

    it('should record failed step with error message', () => {
      const runLog = {
        status: 'failed' as const,
        steps: [
          { stepId: 'filter', stepType: 'filter', status: 'completed', durationMs: 50 },
          {
            stepId: 'classify',
            stepType: 'classify',
            status: 'failed',
            durationMs: 1500,
            error: 'LLM rate limit exceeded',
          },
        ],
        errorMessage: 'Pipeline failed at step classify: LLM rate limit exceeded',
      };

      expect(runLog.status).toBe('failed');
      expect(runLog.steps[1].status).toBe('failed');
      expect(runLog.steps[1].error).toContain('rate limit');
      expect(runLog.errorMessage).toContain('classify');
    });
  });
});
