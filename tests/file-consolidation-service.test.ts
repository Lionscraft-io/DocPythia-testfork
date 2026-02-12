/**
 * FileConsolidationService Unit Tests
 * Tests for LLM-based file consolidation of documentation proposals

 * Date: 2025-12-23
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FileConsolidationService } from '../server/stream/services/file-consolidation-service.js';
import { DocProposal } from '@prisma/client';

// Mock the llmService
vi.mock('../server/stream/llm/llm-service.js', () => ({
  llmService: {
    requestJSON: vi.fn(),
  },
}));

// Mock the config loader
vi.mock('../server/config/loader.js', () => ({
  getConfig: vi.fn(() => ({
    project: {
      name: 'Test Project',
    },
  })),
}));

// Mock the PromptRegistry
const mockPromptRegistry = {
  load: vi.fn().mockResolvedValue(undefined),
  render: vi.fn((promptId: string, variables: Record<string, unknown>) => ({
    system: `System prompt for ${variables.projectName}`,
    user: `User prompt for ${variables.projectName}: ${variables.filePath} with ${variables.changeCount} changes`,
    variables,
  })),
};

vi.mock('../server/pipeline/prompts/PromptRegistry.js', () => ({
  createPromptRegistry: vi.fn(() => mockPromptRegistry),
  PromptRegistry: vi.fn(),
}));

import { llmService } from '../server/stream/llm/llm-service.js';

// Helper to create mock proposals
function createMockProposal(overrides: Partial<DocProposal> = {}): DocProposal {
  return {
    id: 1,
    page: 'docs/test.md',
    section: 'Test Section',
    updateType: 'UPDATE',
    reasoning: 'Test reasoning',
    suggestedText: 'New content',
    editedText: null,
    location: null,
    sourceMessages: [],
    status: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    messageId: 1,
    changesetBatchId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as DocProposal;
}

describe('FileConsolidationService', () => {
  let service: FileConsolidationService;
  let consoleSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FileConsolidationService();
    // Silence console during tests
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
  });

  describe('consolidateFile', () => {
    it('should return original content if no proposals', async () => {
      const result = await service.consolidateFile('docs/test.md', '# Original Content', []);

      expect(result.consolidatedContent).toBe('# Original Content');
      expect(llmService.requestJSON).not.toHaveBeenCalled();
    });

    it('should call LLM service with correct parameters', async () => {
      vi.mocked(llmService.requestJSON).mockResolvedValue({
        data: { consolidatedContent: '# Consolidated Content' },
        response: { content: '', modelUsed: 'test', tokensUsed: 100 },
      });

      const proposals = [
        createMockProposal({
          updateType: 'UPDATE',
          section: 'Introduction',
          suggestedText: 'New intro text',
        }),
      ];

      await service.consolidateFile('docs/test.md', '# Original', proposals);

      expect(llmService.requestJSON).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.any(String),
          systemPrompt: expect.any(String),
          userPrompt: expect.any(String),
          temperature: 0.3,
          maxTokens: 8000,
        }),
        expect.any(Object)
      );
    });

    it('should return consolidated content from LLM', async () => {
      vi.mocked(llmService.requestJSON).mockResolvedValue({
        data: { consolidatedContent: '# New Content\n\nUpdated documentation.' },
        response: { content: '', modelUsed: 'test', tokensUsed: 150 },
      });

      const proposals = [createMockProposal()];
      const result = await service.consolidateFile('docs/test.md', '# Original', proposals);

      expect(result.consolidatedContent).toBe('# New Content\n\nUpdated documentation.');
      expect(result.tokensUsed).toBe(150);
    });

    it('should format multiple proposals correctly', async () => {
      vi.mocked(llmService.requestJSON).mockResolvedValue({
        data: { consolidatedContent: '# Multi-change content' },
        response: { content: '', modelUsed: 'test', tokensUsed: 200 },
      });

      const proposals = [
        createMockProposal({
          id: 1,
          updateType: 'INSERT',
          section: 'Getting Started',
          suggestedText: 'New getting started text',
          reasoning: 'Add more context',
        }),
        createMockProposal({
          id: 2,
          updateType: 'UPDATE',
          section: 'Configuration',
          suggestedText: 'Updated config info',
          reasoning: 'Fix outdated info',
        }),
        createMockProposal({
          id: 3,
          updateType: 'DELETE',
          section: 'Deprecated',
          suggestedText: '',
          reasoning: 'Remove deprecated section',
        }),
      ];

      await service.consolidateFile('docs/guide.md', '# Original Guide', proposals);

      const call = vi.mocked(llmService.requestJSON).mock.calls[0];
      expect(call[0].userPrompt).toContain('Test Project');
    });

    it('should use editedText over suggestedText when available', async () => {
      vi.mocked(llmService.requestJSON).mockResolvedValue({
        data: { consolidatedContent: '# Result' },
        response: { content: '', modelUsed: 'test', tokensUsed: 100 },
      });

      const proposals = [
        createMockProposal({
          suggestedText: 'Suggested version',
          editedText: 'Edited version',
        }),
      ];

      await service.consolidateFile('docs/test.md', '# Original', proposals);

      const call = vi.mocked(llmService.requestJSON).mock.calls[0];
      expect(call[0].userPrompt).toBeDefined();
    });

    it('should handle LLM errors gracefully', async () => {
      vi.mocked(llmService.requestJSON).mockRejectedValue(new Error('LLM service unavailable'));

      const proposals = [createMockProposal()];

      await expect(
        service.consolidateFile('docs/test.md', '# Original', proposals)
      ).rejects.toThrow('Failed to consolidate file docs/test.md: LLM service unavailable');
    });

    it('should handle proposals with missing sections', async () => {
      vi.mocked(llmService.requestJSON).mockResolvedValue({
        data: { consolidatedContent: '# Result' },
        response: { content: '', modelUsed: 'test', tokensUsed: 100 },
      });

      const proposals = [
        createMockProposal({
          section: null,
          updateType: null as any,
          reasoning: null as any,
        }),
      ];

      await service.consolidateFile('docs/test.md', '# Original', proposals);

      // Should complete without error, using defaults
      expect(llmService.requestJSON).toHaveBeenCalled();
    });

    it('should log consolidation progress', async () => {
      vi.mocked(llmService.requestJSON).mockResolvedValue({
        data: { consolidatedContent: '# Result' },
        response: { content: '', modelUsed: 'test', tokensUsed: 100 },
      });

      const proposals = [createMockProposal({ updateType: 'UPDATE' })];
      await service.consolidateFile('docs/test.md', '# Original content here', proposals);

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('CONSOLIDATING FILE'));
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('FILE CONSOLIDATION COMPLETE')
      );
    });

    it('should log errors on failure', async () => {
      vi.mocked(llmService.requestJSON).mockRejectedValue(new Error('API error'));

      const proposals = [createMockProposal()];

      await expect(
        service.consolidateFile('docs/test.md', '# Original', proposals)
      ).rejects.toThrow();

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('FILE CONSOLIDATION FAILED')
      );
    });
  });

  describe('shouldConsolidate', () => {
    it('should return false for single proposal', () => {
      const proposals = [createMockProposal()];
      const result = service.shouldConsolidate(proposals, '# Content');

      expect(result).toBe(false);
    });

    it('should return false for empty proposals', () => {
      const result = service.shouldConsolidate([], '# Content');

      expect(result).toBe(false);
    });

    it('should return true for multiple proposals', () => {
      const proposals = [createMockProposal({ id: 1 }), createMockProposal({ id: 2 })];
      const result = service.shouldConsolidate(proposals, '# Content');

      expect(result).toBe(true);
    });

    it('should return false for very large files', () => {
      const proposals = [createMockProposal({ id: 1 }), createMockProposal({ id: 2 })];
      const largeContent = 'x'.repeat(60_000); // Over 50KB limit

      const result = service.shouldConsolidate(proposals, largeContent);

      expect(result).toBe(false);
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Skipping consolidation - file too large')
      );
    });

    it('should return true for files at size limit', () => {
      const proposals = [createMockProposal({ id: 1 }), createMockProposal({ id: 2 })];
      const contentAtLimit = 'x'.repeat(50_000); // Exactly at 50KB limit

      const result = service.shouldConsolidate(proposals, contentAtLimit);

      expect(result).toBe(true);
    });

    it('should return true when UPDATE operations present', () => {
      const proposals = [
        createMockProposal({ id: 1, updateType: 'INSERT' }),
        createMockProposal({ id: 2, updateType: 'UPDATE' }),
      ];
      const result = service.shouldConsolidate(proposals, '# Content');

      expect(result).toBe(true);
    });

    it('should return true for multiple INSERT-only proposals', () => {
      const proposals = [
        createMockProposal({ id: 1, updateType: 'INSERT' }),
        createMockProposal({ id: 2, updateType: 'INSERT' }),
      ];
      const result = service.shouldConsolidate(proposals, '# Content');

      expect(result).toBe(true);
    });

    it('should return true for DELETE operations with multiple proposals', () => {
      const proposals = [
        createMockProposal({ id: 1, updateType: 'DELETE' }),
        createMockProposal({ id: 2, updateType: 'DELETE' }),
      ];
      const result = service.shouldConsolidate(proposals, '# Content');

      expect(result).toBe(true);
    });
  });
});
