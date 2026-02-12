/**
 * FileModificationService
 *
 * Responsible for applying DocProposal changes to actual documentation files.
 * Handles INSERT, UPDATE, and DELETE operations with section-based and line-based strategies.
 *

 * @created 2025-11-06
 */

import fs from 'fs/promises';
import path from 'path';
import { DocProposal } from '@prisma/client';

interface ProposalLocation {
  lineStart?: number;
  lineEnd?: number;
  sectionName?: string;
}

interface ApplyResult {
  success: boolean;
  error?: string;
  errorType?: 'file_not_found' | 'section_not_found' | 'parse_error' | 'git_error';
}

export class FileModificationService {
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  /**
   * Apply multiple proposals to a single file
   * Sorts proposals bottom-to-top to avoid offset issues
   */
  async applyProposalsToFile(filePath: string, proposals: DocProposal[]): Promise<string> {
    const fullPath = path.join(this.repoPath, filePath);

    // Check if file exists
    try {
      await fs.access(fullPath);
    } catch {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');

    // Sort proposals by location (apply from bottom to top to avoid offset issues)
    const sorted = this.sortProposalsByLocation(proposals);

    let modifiedLines = [...lines];
    for (const proposal of sorted) {
      modifiedLines = await this.applyProposal(modifiedLines, proposal);
    }

    return modifiedLines.join('\n');
  }

  /**
   * Apply a single proposal to the file lines
   */
  private async applyProposal(lines: string[], proposal: DocProposal): Promise<string[]> {
    const text = proposal.editedText || proposal.suggestedText || '';
    const location = proposal.location as ProposalLocation | null;

    switch (proposal.updateType) {
      case 'INSERT':
        return this.applyInsert(lines, text, location, proposal.section);
      case 'UPDATE':
        return this.applyUpdate(lines, text, location, proposal.section);
      case 'DELETE':
        return this.applyDelete(lines, location, proposal.section);
      default:
        console.warn(`Unknown updateType: ${proposal.updateType}`);
        return lines;
    }
  }

  /**
   * INSERT strategy:
   * 1. If location.lineStart exists, insert at that line
   * 2. If section exists, find section and insert at end
   * 3. Otherwise, append to end of file
   */
  private applyInsert(
    lines: string[],
    text: string,
    location: ProposalLocation | null,
    section: string | null
  ): string[] {
    const newLines = text.split('\n');

    // Strategy 1: Insert at specific line
    if (location?.lineStart !== undefined) {
      const insertIndex = location.lineStart;
      return [...lines.slice(0, insertIndex), ...newLines, ...lines.slice(insertIndex)];
    }

    // Strategy 2: Insert under section
    if (section) {
      const sectionIndex = this.findSectionIndex(lines, section);
      if (sectionIndex !== -1) {
        const insertIndex = this.findSectionEnd(lines, sectionIndex);
        return [...lines.slice(0, insertIndex), ...newLines, ...lines.slice(insertIndex)];
      }
      // Section not found - throw error
      throw new Error(`Section not found: ${section}`);
    }

    // Strategy 3: Append to end
    return [...lines, ...newLines];
  }

  /**
   * UPDATE strategy:
   * 1. If location with lineStart/lineEnd exists, replace those lines
   * 2. If section exists, replace entire section content
   * 3. Otherwise, throw error
   */
  private applyUpdate(
    lines: string[],
    text: string,
    location: ProposalLocation | null,
    section: string | null
  ): string[] {
    const newLines = text.split('\n');

    // Strategy 1: Replace line range
    if (location?.lineStart !== undefined && location?.lineEnd !== undefined) {
      return [
        ...lines.slice(0, location.lineStart),
        ...newLines,
        ...lines.slice(location.lineEnd + 1),
      ];
    }

    // Strategy 2: Replace section content
    if (section) {
      const sectionIndex = this.findSectionIndex(lines, section);
      if (sectionIndex !== -1) {
        const sectionEnd = this.findSectionEnd(lines, sectionIndex);
        // Keep the section header, replace content
        return [...lines.slice(0, sectionIndex + 1), ...newLines, ...lines.slice(sectionEnd)];
      }
      throw new Error(`Section not found: ${section}`);
    }

    throw new Error('UPDATE requires either location or section');
  }

  /**
   * DELETE strategy:
   * 1. If location with lineStart/lineEnd exists, delete those lines
   * 2. If section exists, delete entire section
   * 3. Otherwise, throw error
   */
  private applyDelete(
    lines: string[],
    location: ProposalLocation | null,
    section: string | null
  ): string[] {
    // Strategy 1: Delete line range
    if (location?.lineStart !== undefined && location?.lineEnd !== undefined) {
      return [...lines.slice(0, location.lineStart), ...lines.slice(location.lineEnd + 1)];
    }

    // Strategy 2: Delete entire section
    if (section) {
      const sectionIndex = this.findSectionIndex(lines, section);
      if (sectionIndex !== -1) {
        const sectionEnd = this.findSectionEnd(lines, sectionIndex);
        return [...lines.slice(0, sectionIndex), ...lines.slice(sectionEnd)];
      }
      throw new Error(`Section not found: ${section}`);
    }

    throw new Error('DELETE requires either location or section');
  }

  /**
   * Find the index of a section header in the lines array
   * Looks for markdown headers (# Header, ## Header, etc.)
   */
  private findSectionIndex(lines: string[], sectionName: string): number {
    const normalized = sectionName.toLowerCase().trim();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for markdown headers (# Header, ## Header, ### Header, etc.)
      const headerMatch = line.match(/^#+\s+(.+)$/);
      if (headerMatch) {
        const headerText = headerMatch[1].toLowerCase().trim();
        if (headerText === normalized || headerText.includes(normalized)) {
          return i;
        }
      }
    }

    return -1;
  }

  /**
   * Find the end of a section (start of next section or end of file)
   * Looks for the next header at the same or higher level
   */
  private findSectionEnd(lines: string[], sectionStartIndex: number): number {
    const startLine = lines[sectionStartIndex];
    const headerMatch = startLine.match(/^(#+)\s+/);

    if (!headerMatch) {
      // Not a header, return next line
      return sectionStartIndex + 1;
    }

    const headerLevel = headerMatch[1].length;

    // Find next header at same or higher level
    for (let i = sectionStartIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      const nextHeaderMatch = line.match(/^(#+)\s+/);

      if (nextHeaderMatch) {
        const nextLevel = nextHeaderMatch[1].length;
        if (nextLevel <= headerLevel) {
          return i; // Start of next section
        }
      }
    }

    // No next section found, return end of file
    return lines.length;
  }

  /**
   * Sort proposals by location (bottom to top) to avoid offset issues
   * Proposals without locations are applied last
   */
  private sortProposalsByLocation(proposals: DocProposal[]): DocProposal[] {
    return [...proposals].sort((a, b) => {
      const locA = a.location as ProposalLocation | null;
      const locB = b.location as ProposalLocation | null;

      // Proposals without location go last
      if (!locA) return 1;
      if (!locB) return -1;

      // Sort by lineStart descending (bottom to top)
      const lineA = locA.lineStart ?? Infinity;
      const lineB = locB.lineStart ?? Infinity;

      return lineB - lineA;
    });
  }

  /**
   * Apply a single proposal and return result
   */
  async applyProposalWithResult(proposal: DocProposal): Promise<ApplyResult> {
    try {
      const filePath = proposal.page;
      const fullPath = path.join(this.repoPath, filePath);

      // Check if file exists
      try {
        await fs.access(fullPath);
      } catch {
        return {
          success: false,
          error: `File not found: ${filePath}`,
          errorType: 'file_not_found',
        };
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');

      const modifiedLines = await this.applyProposal(lines, proposal);
      const modifiedContent = modifiedLines.join('\n');

      // Write back to file
      await fs.writeFile(fullPath, modifiedContent, 'utf-8');

      return { success: true };
    } catch (error: any) {
      // Classify error type
      let errorType: ApplyResult['errorType'] = 'parse_error';

      if (error.message?.includes('Section not found')) {
        errorType = 'section_not_found';
      } else if (error.message?.includes('File not found')) {
        errorType = 'file_not_found';
      }

      return {
        success: false,
        error: error.message || 'Unknown error',
        errorType,
      };
    }
  }

  /**
   * Get the repository path
   */
  getRepoPath(): string {
    return this.repoPath;
  }
}
