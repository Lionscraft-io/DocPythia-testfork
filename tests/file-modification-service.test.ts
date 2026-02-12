/**
 * FileModificationService Unit Tests
 * Tests for applying DocProposal changes to documentation files

 * Date: 2025-12-23
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FileModificationService } from '../server/stream/services/file-modification-service.js';
import { DocProposal } from '@prisma/client';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import fs from 'fs/promises';

// Helper to create mock proposals
function createMockProposal(overrides: Partial<DocProposal> = {}): DocProposal {
  return {
    id: 1,
    page: 'docs/test.md',
    section: null,
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

describe('FileModificationService', () => {
  let service: FileModificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FileModificationService('/repo');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should store repo path', () => {
      const svc = new FileModificationService('/my/repo');
      expect(svc.getRepoPath()).toBe('/my/repo');
    });
  });

  describe('applyProposalsToFile', () => {
    it('should throw error if file not found', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      await expect(
        service.applyProposalsToFile('missing.md', [createMockProposal()])
      ).rejects.toThrow('File not found: missing.md');
    });

    it('should apply single proposal', async () => {
      const content = '# Title\n\nOld content\n\n## Section';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'New content',
        location: { lineStart: 2, lineEnd: 2 },
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);

      expect(result).toContain('New content');
      expect(result).not.toContain('Old content');
    });

    it('should apply multiple proposals bottom-to-top', async () => {
      const content = 'Line 0\nLine 1\nLine 2\nLine 3\nLine 4';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposals = [
        createMockProposal({
          updateType: 'UPDATE',
          suggestedText: 'Updated 1',
          location: { lineStart: 1, lineEnd: 1 },
        }),
        createMockProposal({
          updateType: 'UPDATE',
          suggestedText: 'Updated 3',
          location: { lineStart: 3, lineEnd: 3 },
        }),
      ];

      const result = await service.applyProposalsToFile('test.md', proposals);
      const lines = result.split('\n');

      expect(lines[1]).toBe('Updated 1');
      expect(lines[3]).toBe('Updated 3');
    });
  });

  describe('INSERT operations', () => {
    it('should insert at specific line', async () => {
      const content = 'Line 0\nLine 1\nLine 2';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'INSERT',
        suggestedText: 'Inserted line',
        location: { lineStart: 1 },
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);
      const lines = result.split('\n');

      expect(lines[0]).toBe('Line 0');
      expect(lines[1]).toBe('Inserted line');
      expect(lines[2]).toBe('Line 1');
    });

    it('should insert at end of section', async () => {
      // Use same-level headers so section boundaries work correctly
      const content = '## Section A\n\nContent A\n\n## Section B\n\nContent B';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'INSERT',
        suggestedText: 'New paragraph',
        section: 'Section A',
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);

      expect(result).toContain('New paragraph');
      // New paragraph should be inserted before Section B
      expect(result.indexOf('New paragraph')).toBeLessThan(result.indexOf('## Section B'));
    });

    it('should append to end if no location or section', async () => {
      const content = 'Line 0\nLine 1';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'INSERT',
        suggestedText: 'Appended line',
        location: null,
        section: null,
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);
      const lines = result.split('\n');

      expect(lines[lines.length - 1]).toBe('Appended line');
    });

    it('should throw error if section not found', async () => {
      const content = '# Title\n\nContent';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'INSERT',
        suggestedText: 'New content',
        section: 'Nonexistent Section',
      });

      await expect(service.applyProposalsToFile('test.md', [proposal])).rejects.toThrow(
        'Section not found: Nonexistent Section'
      );
    });

    it('should insert multi-line content', async () => {
      const content = 'Line 0\nLine 1';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'INSERT',
        suggestedText: 'New line 1\nNew line 2\nNew line 3',
        location: { lineStart: 1 },
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);
      const lines = result.split('\n');

      expect(lines).toHaveLength(5);
      expect(lines[1]).toBe('New line 1');
      expect(lines[2]).toBe('New line 2');
      expect(lines[3]).toBe('New line 3');
    });
  });

  describe('UPDATE operations', () => {
    it('should update line range', async () => {
      const content = 'Line 0\nLine 1\nLine 2\nLine 3';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'Replaced content',
        location: { lineStart: 1, lineEnd: 2 },
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);
      const lines = result.split('\n');

      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe('Line 0');
      expect(lines[1]).toBe('Replaced content');
      expect(lines[2]).toBe('Line 3');
    });

    it('should update section content', async () => {
      // Use same-level headers so section boundaries work correctly
      const content = '## Section A\n\nOld content\n\n## Section B\n\nMore content';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'New section content',
        section: 'Section A',
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);

      expect(result).toContain('## Section A');
      expect(result).toContain('New section content');
      expect(result).not.toContain('Old content');
      expect(result).toContain('## Section B');
    });

    it('should throw error if no location or section', async () => {
      const content = 'Content';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'New content',
        location: null,
        section: null,
      });

      await expect(service.applyProposalsToFile('test.md', [proposal])).rejects.toThrow(
        'UPDATE requires either location or section'
      );
    });

    it('should throw error if section not found', async () => {
      const content = '# Title\n\nContent';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'New content',
        section: 'Missing Section',
      });

      await expect(service.applyProposalsToFile('test.md', [proposal])).rejects.toThrow(
        'Section not found: Missing Section'
      );
    });

    it('should use editedText over suggestedText', async () => {
      const content = 'Line 0\nLine 1';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'Suggested',
        editedText: 'Edited',
        location: { lineStart: 1, lineEnd: 1 },
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);

      expect(result).toContain('Edited');
      expect(result).not.toContain('Suggested');
    });
  });

  describe('DELETE operations', () => {
    it('should delete line range', async () => {
      const content = 'Line 0\nLine 1\nLine 2\nLine 3';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'DELETE',
        location: { lineStart: 1, lineEnd: 2 },
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);
      const lines = result.split('\n');

      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('Line 0');
      expect(lines[1]).toBe('Line 3');
    });

    it('should delete entire section', async () => {
      const content =
        '# Title\n\nContent\n\n## Delete Me\n\nTo be deleted\n\n## Keep Me\n\nKeep this';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'DELETE',
        section: 'Delete Me',
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);

      expect(result).not.toContain('## Delete Me');
      expect(result).not.toContain('To be deleted');
      expect(result).toContain('## Keep Me');
      expect(result).toContain('Keep this');
    });

    it('should throw error if no location or section', async () => {
      const content = 'Content';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'DELETE',
        location: null,
        section: null,
      });

      await expect(service.applyProposalsToFile('test.md', [proposal])).rejects.toThrow(
        'DELETE requires either location or section'
      );
    });

    it('should throw error if section not found', async () => {
      const content = '# Title\n\nContent';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'DELETE',
        section: 'Missing Section',
      });

      await expect(service.applyProposalsToFile('test.md', [proposal])).rejects.toThrow(
        'Section not found: Missing Section'
      );
    });
  });

  describe('Section finding', () => {
    it('should find section with exact match', async () => {
      const content = '# Title\n\nContent\n\n## My Section\n\nSection content';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'Updated',
        section: 'My Section',
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);
      expect(result).toContain('Updated');
    });

    it('should find section case-insensitively', async () => {
      const content = '# Title\n\n## MY SECTION\n\nContent';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'Updated',
        section: 'my section',
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);
      expect(result).toContain('Updated');
    });

    it('should find section with partial match', async () => {
      const content = '# Title\n\n## Installation Guide\n\nContent';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'Updated',
        section: 'Installation',
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);
      expect(result).toContain('Updated');
    });

    it('should handle different header levels', async () => {
      const content = '# H1\n\n## H2\n\n### H3\n\n#### H4';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'INSERT',
        suggestedText: 'New content',
        section: 'H3',
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);
      expect(result).toContain('New content');
    });
  });

  describe('Section end detection', () => {
    it('should find end at same-level header', async () => {
      const content = '## Section 1\n\nContent 1\n\n## Section 2\n\nContent 2';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'Replaced',
        section: 'Section 1',
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);

      expect(result).toContain('Replaced');
      expect(result).toContain('## Section 2');
      expect(result).toContain('Content 2');
    });

    it('should find end at higher-level header', async () => {
      const content = '# Main\n\n## Sub\n\nSub content\n\n# Next Main\n\nNext content';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'Replaced',
        section: 'Sub',
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);

      expect(result).toContain('Replaced');
      expect(result).toContain('# Next Main');
    });

    it('should extend to end of file if no next section', async () => {
      const content = '# Only Section\n\nContent line 1\nContent line 2\nContent line 3';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'All new content',
        section: 'Only Section',
      });

      const result = await service.applyProposalsToFile('test.md', [proposal]);
      const lines = result.split('\n');

      expect(lines[0]).toBe('# Only Section');
      expect(lines[1]).toBe('All new content');
      expect(lines).toHaveLength(2);
    });
  });

  describe('applyProposalWithResult', () => {
    it('should return success on successful apply', async () => {
      const content = 'Line 0\nLine 1';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'Updated',
        location: { lineStart: 1, lineEnd: 1 },
      });

      const result = await service.applyProposalWithResult(proposal);

      expect(result.success).toBe(true);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should return file_not_found error', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const proposal = createMockProposal();

      const result = await service.applyProposalWithResult(proposal);

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('file_not_found');
    });

    it('should return section_not_found error', async () => {
      const content = '# Title\n\nContent';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'New',
        section: 'Missing',
      });

      const result = await service.applyProposalWithResult(proposal);

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('section_not_found');
    });

    it('should return parse_error for other errors', async () => {
      const content = 'Content';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UPDATE',
        suggestedText: 'New',
        location: null,
        section: null,
      });

      const result = await service.applyProposalWithResult(proposal);

      expect(result.success).toBe(false);
      expect(result.errorType).toBe('parse_error');
    });
  });

  describe('Unknown updateType', () => {
    it('should handle unknown updateType gracefully', async () => {
      const content = 'Line 0\nLine 1';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposal = createMockProposal({
        updateType: 'UNKNOWN' as any,
      });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await service.applyProposalsToFile('test.md', [proposal]);

      expect(consoleSpy).toHaveBeenCalledWith('Unknown updateType: UNKNOWN');
      expect(result).toBe(content);

      consoleSpy.mockRestore();
    });
  });

  describe('Proposal sorting', () => {
    it('should sort proposals bottom-to-top', async () => {
      const content = 'Line 0\nLine 1\nLine 2\nLine 3\nLine 4';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      // Create proposals in wrong order (top-to-bottom)
      const proposals = [
        createMockProposal({
          id: 1,
          updateType: 'UPDATE',
          suggestedText: 'First',
          location: { lineStart: 1, lineEnd: 1 },
        }),
        createMockProposal({
          id: 2,
          updateType: 'UPDATE',
          suggestedText: 'Third',
          location: { lineStart: 3, lineEnd: 3 },
        }),
        createMockProposal({
          id: 3,
          updateType: 'UPDATE',
          suggestedText: 'Second',
          location: { lineStart: 2, lineEnd: 2 },
        }),
      ];

      const result = await service.applyProposalsToFile('test.md', proposals);
      const lines = result.split('\n');

      // All updates should be applied correctly regardless of order
      expect(lines[1]).toBe('First');
      expect(lines[2]).toBe('Second');
      expect(lines[3]).toBe('Third');
    });

    it('should put proposals without location last', async () => {
      const content = '# Title\n\nContent\n\n## Section\n\nMore';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const proposals = [
        createMockProposal({
          updateType: 'INSERT',
          suggestedText: 'Appended',
          location: null,
          section: null,
        }),
        createMockProposal({
          updateType: 'UPDATE',
          suggestedText: 'Updated line',
          location: { lineStart: 2, lineEnd: 2 },
        }),
      ];

      const result = await service.applyProposalsToFile('test.md', proposals);

      expect(result).toContain('Updated line');
      expect(result).toContain('Appended');
      expect(result.endsWith('Appended')).toBe(true);
    });
  });
});
