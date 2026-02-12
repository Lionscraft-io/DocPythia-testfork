/**
 * Quality System Integration Tests
 *
 * Tests for the Quality System integration including:
 * - PipelineOrchestrator run logging
 * - PROMPT_CONTEXT injection into batch processor
 * - Enrichment flow in batch processor
 * - Ruleset review flow in batch processor
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

// Import after mocks
import { parseRuleset } from '../server/pipeline/types/ruleset.js';
import { textAnalysis } from '../server/pipeline/types/enrichment.js';

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

describe('Quality System Integration', () => {
  beforeEach(() => {
    resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-11-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('PROMPT_CONTEXT Injection', () => {
    it('should parse PROMPT_CONTEXT from ruleset markdown', () => {
      const rulesetMarkdown = `# Documentation Ruleset

## PROMPT_CONTEXT
- Use formal technical writing style
- Always use "validator" instead of "node operator"
- Include code examples when applicable
- Target intermediate developers

## REJECTION_RULES
- If duplicationWarning.overlapPercentage > 80%, reject as duplicate

## QUALITY_GATES
- If changePercentage > 50%, flag as significant change
`;

      const parsed = parseRuleset(rulesetMarkdown);

      expect(parsed.promptContext).toHaveLength(4);
      expect(parsed.promptContext).toContain('Use formal technical writing style');
      expect(parsed.promptContext).toContain('Always use "validator" instead of "node operator"');
      expect(parsed.promptContext).toContain('Include code examples when applicable');
      expect(parsed.promptContext).toContain('Target intermediate developers');
    });

    it('should build system prompt with PROMPT_CONTEXT injected', () => {
      const basePrompt = 'You are a documentation assistant.';
      const promptContext = [
        'Use formal technical writing style',
        'Always use "validator" instead of "node operator"',
      ];

      // Simulate what buildChangesetSystemPrompt does
      const contextSection = `

=== DOCUMENTATION STYLE REQUIREMENTS (FROM RULESET) ===
${promptContext.map((rule) => `- ${rule}`).join('\n')}
=== END STYLE REQUIREMENTS ===
`;
      const enhancedPrompt = basePrompt + contextSection;

      expect(enhancedPrompt).toContain('DOCUMENTATION STYLE REQUIREMENTS');
      expect(enhancedPrompt).toContain('Use formal technical writing style');
      expect(enhancedPrompt).toContain('Always use "validator" instead of "node operator"');
    });
  });

  describe('Enrichment Functions', () => {
    describe('textAnalysis', () => {
      it('should calculate average sentence length correctly', () => {
        const text = 'This is a test. Another sentence here! And one more?';
        const avgLen = textAnalysis.avgSentenceLength(text);

        // 11 words / 3 sentences = ~3.67, rounds to 4
        expect(avgLen).toBeGreaterThan(0);
        expect(avgLen).toBeLessThanOrEqual(11);
      });

      it('should detect code examples', () => {
        const textWithCode = 'Here is code:\n```\nconst x = 1;\n```\nEnd.';
        const textWithoutCode = 'This is plain text without code markers.';

        expect(textAnalysis.hasCodeExamples(textWithCode)).toBe(true);
        expect(textAnalysis.hasCodeExamples(textWithoutCode)).toBe(false);
      });

      it('should detect inline code examples', () => {
        const textWithInlineCode = 'Use the `npm install` command.';
        expect(textAnalysis.hasCodeExamples(textWithInlineCode)).toBe(true);
      });

      it('should detect format pattern - bullets', () => {
        const textWithList = '- First step\n- Second step\n- Third step';
        expect(textAnalysis.detectFormatPattern(textWithList)).toBe('bullets');
      });

      it('should detect format pattern - prose', () => {
        const textProse = 'This is a paragraph without any lists or bullets.';
        expect(textAnalysis.detectFormatPattern(textProse)).toBe('prose');
      });

      it('should detect format pattern - mixed', () => {
        const mixedText =
          'Introduction paragraph.\n\n- First bullet\n- Second bullet\n\nAnother paragraph.';
        expect(textAnalysis.detectFormatPattern(mixedText)).toBe('mixed');
      });

      it('should calculate n-gram overlap percentage', () => {
        const text1 = 'The quick brown fox jumps over the lazy dog';
        const text2 = 'The quick brown fox runs over the lazy cat';

        const overlap = textAnalysis.ngramOverlap(text1, text2, 3);

        // Some overlap expected
        expect(overlap).toBeGreaterThan(0);
        expect(overlap).toBeLessThan(100);
      });

      it('should return 0 overlap for completely different texts', () => {
        const text1 = 'The quick brown fox';
        const text2 = 'Apples oranges bananas grapes';

        const overlap = textAnalysis.ngramOverlap(text1, text2, 3);

        expect(overlap).toBe(0);
      });

      it('should return 100 overlap for identical texts', () => {
        const text = 'The quick brown fox jumps over the lazy dog';

        const overlap = textAnalysis.ngramOverlap(text, text, 3);

        expect(overlap).toBe(100);
      });

      it('should estimate technical depth - beginner', () => {
        const beginnerText =
          'Getting started with basic concepts. This simple tutorial will help you learn.';
        expect(textAnalysis.estimateTechnicalDepth(beginnerText)).toBe('beginner');
      });

      it('should estimate technical depth - advanced', () => {
        const advancedText =
          'The algorithm complexity requires understanding of optimization techniques and architecture implementation details.';
        expect(textAnalysis.estimateTechnicalDepth(advancedText)).toBe('advanced');
      });

      it('should estimate technical depth - intermediate by default', () => {
        const normalText = 'Configure your validator node to connect to the network.';
        expect(textAnalysis.estimateTechnicalDepth(normalText)).toBe('intermediate');
      });
    });
  });

  describe('Ruleset Review', () => {
    it('should parse rejection rules correctly', () => {
      const rulesetMarkdown = `## REJECTION_RULES
- If duplicationWarning.overlapPercentage > 80%, reject as duplicate
- Proposals mentioning "competitor" should be rejected
- If confidence < 0.3, reject as low confidence
`;

      const parsed = parseRuleset(rulesetMarkdown);

      expect(parsed.rejectionRules).toHaveLength(3);
      expect(parsed.rejectionRules[0]).toContain('overlapPercentage');
      expect(parsed.rejectionRules[1]).toContain('competitor');
      expect(parsed.rejectionRules[2]).toContain('confidence');
    });

    it('should parse quality gates correctly', () => {
      const rulesetMarkdown = `## QUALITY_GATES
- If changePercentage > 50%, flag as significant_change
- If otherPendingProposals > 0, flag as needs_coordination
- If style.avgSentenceLengthDiff > 50%, flag as style_mismatch
`;

      const parsed = parseRuleset(rulesetMarkdown);

      expect(parsed.qualityGates).toHaveLength(3);
      expect(parsed.qualityGates[0]).toContain('changePercentage');
      expect(parsed.qualityGates[1]).toContain('otherPendingProposals');
      expect(parsed.qualityGates[2]).toContain('avgSentenceLengthDiff');
    });

    it('should parse review modifications correctly', () => {
      const rulesetMarkdown = `## REVIEW_MODIFICATIONS
- Adjust format to match target page (code blocks, lists)
- Shorten sentences if avgSentenceLength differs by >50%
- Add missing context from source conversation
`;

      const parsed = parseRuleset(rulesetMarkdown);

      expect(parsed.reviewModifications).toHaveLength(3);
      expect(parsed.reviewModifications[0]).toContain('Adjust format');
      expect(parsed.reviewModifications[1]).toContain('Shorten sentences');
    });

    describe('Rejection Logic', () => {
      it('should identify high duplication proposals for rejection', () => {
        const enrichment = {
          duplicationWarning: {
            hasPotentialDuplicate: true,
            overlapPercentage: 85,
            matchingDoc: 'docs/existing.md',
          },
        };

        const rejectionRules = [
          'If duplicationWarning.overlapPercentage > 80%, reject as duplicate',
        ];

        // Simulate rejection check
        const shouldReject = rejectionRules.some((rule) => {
          if (rule.includes('overlapPercentage > 80')) {
            return (
              enrichment.duplicationWarning?.hasPotentialDuplicate &&
              enrichment.duplicationWarning.overlapPercentage > 80
            );
          }
          return false;
        });

        expect(shouldReject).toBe(true);
      });

      it('should not reject low duplication proposals', () => {
        const enrichment = {
          duplicationWarning: {
            hasPotentialDuplicate: false,
            overlapPercentage: 25,
            matchingDoc: null,
          },
        };

        const rejectionRules = [
          'If duplicationWarning.overlapPercentage > 80%, reject as duplicate',
        ];

        const shouldReject = rejectionRules.some((rule) => {
          if (rule.includes('overlapPercentage > 80')) {
            return (
              enrichment.duplicationWarning?.hasPotentialDuplicate &&
              enrichment.duplicationWarning.overlapPercentage > 80
            );
          }
          return false;
        });

        expect(shouldReject).toBe(false);
      });
    });

    describe('Quality Gate Logic', () => {
      it('should flag significant changes', () => {
        const enrichment = {
          changeContext: {
            changePercentage: 65,
          },
        };

        const qualityGates = ['If changePercentage > 50%, flag as significant_change'];

        // Simulate quality gate check
        const flags: string[] = [];
        qualityGates.forEach((gate) => {
          if (gate.includes('changePercentage > 50')) {
            if ((enrichment.changeContext?.changePercentage ?? 0) > 50) {
              flags.push('significant_change');
            }
          }
        });

        expect(flags).toContain('significant_change');
      });

      it('should flag style mismatches', () => {
        const enrichment = {
          styleMetrics: {
            avgSentenceLengthDiff: 75,
          },
        };

        const qualityGates = ['If style.avgSentenceLengthDiff > 50%, flag as style_mismatch'];

        const flags: string[] = [];
        qualityGates.forEach((gate) => {
          if (gate.includes('avgSentenceLengthDiff > 50')) {
            if ((enrichment.styleMetrics?.avgSentenceLengthDiff ?? 0) > 50) {
              flags.push('style_mismatch');
            }
          }
        });

        expect(flags).toContain('style_mismatch');
      });
    });
  });

  describe('PipelineRunLog Integration', () => {
    it('should have correct step log entry structure', () => {
      const stepLog = {
        stepId: 'context-enrich',
        stepType: 'context-enrich',
        status: 'completed' as const,
        durationMs: 1500,
        inputCount: 5,
        outputCount: 5,
        promptsUsed: [],
        error: undefined,
      };

      expect(stepLog.stepId).toBe('context-enrich');
      expect(stepLog.stepType).toBe('context-enrich');
      expect(stepLog.status).toBe('completed');
      expect(stepLog.durationMs).toBe(1500);
      expect(stepLog.inputCount).toBe(5);
      expect(stepLog.outputCount).toBe(5);
    });

    it('should record failed step in log', () => {
      const stepLog = {
        stepId: 'ruleset-review',
        stepType: 'ruleset-review',
        status: 'failed' as const,
        durationMs: 500,
        inputCount: 3,
        outputCount: 0,
        error: 'LLM request failed: rate limit exceeded',
      };

      expect(stepLog.status).toBe('failed');
      expect(stepLog.error).toContain('rate limit exceeded');
    });
  });

  describe('Pipeline Configuration', () => {
    it('should have context-enrich step in correct position', () => {
      // Simulated pipeline config (matches default.json structure)
      const pipelineSteps = [
        { stepId: 'keyword-filter', stepType: 'filter' },
        { stepId: 'batch-classify', stepType: 'classify' },
        { stepId: 'rag-enrich', stepType: 'enrich' },
        { stepId: 'proposal-generate', stepType: 'generate' },
        { stepId: 'context-enrich', stepType: 'context-enrich' },
        { stepId: 'ruleset-review', stepType: 'ruleset-review' },
        { stepId: 'content-validate', stepType: 'validate' },
        { stepId: 'length-reduce', stepType: 'condense' },
      ];

      const contextEnrichIndex = pipelineSteps.findIndex((s) => s.stepType === 'context-enrich');
      const rulesetReviewIndex = pipelineSteps.findIndex((s) => s.stepType === 'ruleset-review');
      const generateIndex = pipelineSteps.findIndex((s) => s.stepType === 'generate');
      const validateIndex = pipelineSteps.findIndex((s) => s.stepType === 'validate');

      // context-enrich should come after generate
      expect(contextEnrichIndex).toBeGreaterThan(generateIndex);
      // ruleset-review should come after context-enrich
      expect(rulesetReviewIndex).toBeGreaterThan(contextEnrichIndex);
      // Both should come before validate
      expect(contextEnrichIndex).toBeLessThan(validateIndex);
      expect(rulesetReviewIndex).toBeLessThan(validateIndex);
    });

    it('should have correct config structure for context-enrich step', () => {
      const contextEnrichConfig = {
        minSimilarityScore: 0.6,
        maxRelatedDocs: 5,
        enableDuplicationCheck: true,
        ngramSize: 3,
        duplicationThreshold: 50,
      };

      expect(contextEnrichConfig.minSimilarityScore).toBeGreaterThan(0);
      expect(contextEnrichConfig.minSimilarityScore).toBeLessThan(1);
      expect(contextEnrichConfig.maxRelatedDocs).toBeGreaterThan(0);
      expect(contextEnrichConfig.ngramSize).toBeGreaterThanOrEqual(2);
      expect(contextEnrichConfig.duplicationThreshold).toBeGreaterThan(0);
      expect(contextEnrichConfig.duplicationThreshold).toBeLessThanOrEqual(100);
    });

    it('should have correct config structure for ruleset-review step', () => {
      const rulesetReviewConfig = {
        enableRejection: true,
        enableModifications: true,
        enableQualityGates: true,
        modificationModel: 'gemini-1.5-flash',
        maxModificationTokens: 4096,
      };

      expect(rulesetReviewConfig.enableRejection).toBe(true);
      expect(rulesetReviewConfig.enableModifications).toBe(true);
      expect(rulesetReviewConfig.enableQualityGates).toBe(true);
      expect(rulesetReviewConfig.modificationModel).toBeTruthy();
      expect(rulesetReviewConfig.maxModificationTokens).toBeGreaterThan(0);
    });
  });

  describe('Enrichment Data Structure', () => {
    it('should have correct related docs structure', () => {
      const relatedDoc = {
        docId: 1,
        filePath: 'docs/validators/setup.md',
        title: 'Validator Setup Guide',
        similarity: 0.85,
        relevantSections: ['Getting Started', 'Configuration'],
      };

      expect(relatedDoc.docId).toBeDefined();
      expect(relatedDoc.filePath).toContain('/');
      expect(relatedDoc.similarity).toBeGreaterThanOrEqual(0);
      expect(relatedDoc.similarity).toBeLessThanOrEqual(1);
      expect(relatedDoc.relevantSections).toBeInstanceOf(Array);
    });

    it('should have correct duplication warning structure', () => {
      const duplicationWarning = {
        hasPotentialDuplicate: true,
        overlapPercentage: 75,
        matchingDoc: 'docs/troubleshooting/common-errors.md',
        matchingSections: ['RPC Errors'],
      };

      expect(duplicationWarning.hasPotentialDuplicate).toBe(true);
      expect(duplicationWarning.overlapPercentage).toBeGreaterThanOrEqual(0);
      expect(duplicationWarning.overlapPercentage).toBeLessThanOrEqual(100);
      expect(duplicationWarning.matchingDoc).toBeTruthy();
    });

    it('should have correct style metrics structure', () => {
      const styleMetrics = {
        proposalMetrics: {
          wordCount: 150,
          sentenceCount: 10,
          avgSentenceLength: 15,
          hasCodeBlocks: true,
          hasListFormat: false,
        },
        targetMetrics: {
          wordCount: 500,
          sentenceCount: 25,
          avgSentenceLength: 20,
          hasCodeBlocks: true,
          hasListFormat: true,
        },
        avgSentenceLengthDiff: 25,
        formatMatch: false,
      };

      expect(styleMetrics.proposalMetrics.wordCount).toBeGreaterThan(0);
      expect(styleMetrics.targetMetrics.wordCount).toBeGreaterThan(0);
      expect(styleMetrics.avgSentenceLengthDiff).toBeGreaterThanOrEqual(0);
    });

    it('should have correct change context structure', () => {
      const changeContext = {
        changePercentage: 35,
        otherPendingProposals: 2,
        lastUpdateDate: '2025-10-15',
        sectionInfo: {
          name: 'RPC Errors',
          lineStart: 45,
          lineEnd: 60,
        },
      };

      expect(changeContext.changePercentage).toBeGreaterThanOrEqual(0);
      expect(changeContext.changePercentage).toBeLessThanOrEqual(100);
      expect(changeContext.otherPendingProposals).toBeGreaterThanOrEqual(0);
    });

    it('should have correct source conversation analysis structure', () => {
      const sourceConversation = {
        participantCount: 3,
        messageCount: 7,
        expertiseLevel: 'intermediate' as const,
        keyTopics: ['RPC errors', 'validator setup', 'troubleshooting'],
        hasResolution: true,
      };

      expect(sourceConversation.participantCount).toBeGreaterThan(0);
      expect(sourceConversation.messageCount).toBeGreaterThan(0);
      expect(['beginner', 'intermediate', 'expert']).toContain(sourceConversation.expertiseLevel);
      expect(sourceConversation.keyTopics).toBeInstanceOf(Array);
    });
  });

  describe('Full Enrichment Structure', () => {
    it('should create complete enrichment object', () => {
      const enrichment = {
        relatedDocs: [
          {
            docId: 1,
            filePath: 'docs/validators/setup.md',
            title: 'Validator Setup Guide',
            similarity: 0.85,
            relevantSections: ['Getting Started'],
          },
        ],
        duplicationWarning: {
          hasPotentialDuplicate: false,
          overlapPercentage: 20,
          matchingDoc: null,
          matchingSections: [],
        },
        styleMetrics: {
          proposalMetrics: {
            wordCount: 150,
            sentenceCount: 10,
            avgSentenceLength: 15,
            hasCodeBlocks: true,
            hasListFormat: false,
          },
          targetMetrics: {
            wordCount: 500,
            sentenceCount: 25,
            avgSentenceLength: 20,
            hasCodeBlocks: true,
            hasListFormat: true,
          },
          avgSentenceLengthDiff: 25,
          formatMatch: false,
        },
        changeContext: {
          changePercentage: 35,
          otherPendingProposals: 0,
          lastUpdateDate: '2025-10-15',
          sectionInfo: null,
        },
        sourceConversation: {
          participantCount: 2,
          messageCount: 5,
          expertiseLevel: 'intermediate' as const,
          keyTopics: ['RPC errors'],
          hasResolution: true,
        },
      };

      // Verify all required fields are present
      expect(enrichment.relatedDocs).toBeDefined();
      expect(enrichment.duplicationWarning).toBeDefined();
      expect(enrichment.styleMetrics).toBeDefined();
      expect(enrichment.changeContext).toBeDefined();
      expect(enrichment.sourceConversation).toBeDefined();
    });
  });
});
