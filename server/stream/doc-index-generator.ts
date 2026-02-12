/**
 * Documentation Index Generator
 * Generates structured documentation index from vector store for LLM context

 * Date: 2025-10-30
 * Reference: /docs/specs/multi-stream-scanner-phase-1.md
 */

import { PrismaClient } from '@prisma/client';
import { DocumentationIndex, DocumentationPageIndex, ProjectContext } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DocIndexConfig {
  includePatterns: string[];
  excludePatterns: string[];
  excludeTitles: string[];
  maxPages: number;
  maxSectionsPerPage: number;
  maxSummaryLength: number;
  compactFormat: {
    includeSummaries: boolean;
    includeSections: boolean;
    maxSectionsInCompact: number;
  };
  documentationHierarchy?: Record<string, string[]>;
}

export class DocumentationIndexGenerator {
  private config: DocIndexConfig;
  private configHash: string = '';
  private instanceId: string;

  constructor(instanceId: string = 'default') {
    this.instanceId = instanceId;
    console.log(`DocumentationIndexGenerator initialized for instance: ${instanceId}`);
    this.config = this.loadConfig();
    this.configHash = this.generateConfigHash();
  }

  /**
   * Load configuration from instance-specific file or use defaults
   */
  private loadConfig(): DocIndexConfig {
    try {
      const configPath = path.join(
        __dirname,
        `../../config/${this.instanceId}/doc-index.config.json`
      );
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);
        console.log(
          `Loaded doc-index configuration from config/${this.instanceId}/doc-index.config.json`
        );
        return config;
      } else {
        console.warn(
          `No doc-index config found for instance "${this.instanceId}" at ${configPath}`
        );
      }
    } catch (error) {
      console.warn(
        `Failed to load doc-index config for instance "${this.instanceId}", using defaults:`,
        error
      );
    }

    // Default configuration
    return {
      includePatterns: ['**/*.md'],
      excludePatterns: ['**/node_modules/**', '**/build/**', '**/dist/**'],
      excludeTitles: ['Skip to main content', 'Quick Links', 'Resources', 'Community', 'Copyright'],
      maxPages: 50,
      maxSectionsPerPage: 5,
      maxSummaryLength: 150,
      compactFormat: {
        includeSummaries: false,
        includeSections: true,
        maxSectionsInCompact: 3,
      },
    };
  }

  /**
   * Generate a hash of the configuration to detect changes
   */
  private generateConfigHash(): string {
    const configString = JSON.stringify(this.config, Object.keys(this.config).sort());
    return crypto.createHash('md5').update(configString).digest('hex');
  }

  /**
   * Get the current git commit hash for documentation
   */
  private async getCurrentCommitHash(): Promise<string | null> {
    try {
      const syncState = await prisma.gitSyncState.findFirst({
        where: {
          gitUrl: process.env.DOCS_GIT_URL || '',
        },
      });
      return syncState?.lastCommitHash || null;
    } catch (error) {
      console.error('Failed to get current commit hash:', error);
      return null;
    }
  }

  /**
   * Load index from database cache
   */
  private async loadFromDatabase(commitHash: string): Promise<DocumentationIndex | null> {
    try {
      const cached = await prisma.docIndexCache.findUnique({
        where: {
          commitHash_configHash: {
            commitHash,
            configHash: this.configHash,
          },
        },
      });

      if (cached) {
        console.log(
          `Loaded doc-index from database (commit: ${commitHash.substring(0, 8)}, config: ${this.configHash.substring(0, 8)})`
        );
        return cached.indexData as unknown as DocumentationIndex;
      }

      return null;
    } catch (error) {
      console.error('Failed to load index from database:', error);
      return null;
    }
  }

  /**
   * Save index to database cache
   */
  private async saveToDatabase(commitHash: string, index: DocumentationIndex): Promise<void> {
    try {
      const compactIndex = this.formatCompact(index);

      await prisma.docIndexCache.upsert({
        where: {
          commitHash_configHash: {
            commitHash,
            configHash: this.configHash,
          },
        },
        create: {
          commitHash,
          configHash: this.configHash,
          indexData: index as any,
          compactIndex,
        },
        update: {
          indexData: index as any,
          compactIndex,
          generatedAt: new Date(),
        },
      });

      console.log(
        `Saved doc-index to database (commit: ${commitHash.substring(0, 8)}, config: ${this.configHash.substring(0, 8)})`
      );
    } catch (error) {
      console.error('Failed to save index to database:', error);
    }
  }

  /**
   * Check if a path matches any of the patterns
   */
  private matchesPattern(filePath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      // Simple glob matching for common cases
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\./g, '\\.');

      const regex = new RegExp(`^${regexPattern}$`);
      if (regex.test(filePath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Filter documents based on configuration
   */
  private shouldIncludeDocument(doc: { filePath: string; title: string }): boolean {
    // Check exclude patterns first
    if (this.matchesPattern(doc.filePath, this.config.excludePatterns)) {
      return false;
    }

    // Check excluded titles
    if (
      this.config.excludeTitles.some((excludedTitle) =>
        doc.title.toLowerCase().includes(excludedTitle.toLowerCase())
      )
    ) {
      return false;
    }

    // Check include patterns
    if (this.config.includePatterns.length > 0) {
      return this.matchesPattern(doc.filePath, this.config.includePatterns);
    }

    return true;
  }

  /**
   * Generate documentation index from vector store
   * Uses database cache tied to git commit hash
   */
  async generateIndex(): Promise<DocumentationIndex> {
    // Get current commit hash
    const commitHash = await this.getCurrentCommitHash();

    if (commitHash) {
      // Try to load from database cache
      const cachedIndex = await this.loadFromDatabase(commitHash);
      if (cachedIndex) {
        return cachedIndex;
      }
    }

    console.log('Generating fresh documentation index...');

    // Fetch all documents from vector store
    const documents = await prisma.documentPage.findMany({
      select: {
        id: true,
        filePath: true,
        title: true,
        content: true,
        updatedAt: true,
      },
      orderBy: {
        filePath: 'asc',
      },
    });

    console.log(`Found ${documents.length} documents in vector store`);

    // Filter documents based on configuration
    const filteredDocuments = documents.filter((doc) =>
      this.shouldIncludeDocument({ filePath: doc.filePath, title: doc.title })
    );

    console.log(
      `Filtered to ${filteredDocuments.length} documents (excluded ${documents.length - filteredDocuments.length})`
    );

    // Apply maxPages limit
    const limitedDocuments = filteredDocuments.slice(0, this.config.maxPages);

    if (limitedDocuments.length < filteredDocuments.length) {
      console.log(`Limited to first ${this.config.maxPages} documents`);
    }

    // Build page index entries
    const pages: DocumentationPageIndex[] = await Promise.all(
      limitedDocuments.map(async (doc) => {
        const sections = this.extractSections(doc.content);
        const summary = this.generateSummary(doc.content, doc.title);

        return {
          title: doc.title,
          path: doc.filePath,
          sections: sections.slice(0, this.config.maxSectionsPerPage), // Limit sections
          summary: summary.substring(0, this.config.maxSummaryLength), // Limit summary
          last_updated: doc.updatedAt,
        };
      })
    );

    // Categorize pages by directory structure
    const categories = this.categorizePages(pages);

    const index: DocumentationIndex = {
      pages,
      categories,
      generated_at: new Date(),
    };

    console.log(
      `Documentation index generated: ${pages.length} pages, ${Object.keys(categories).length} categories`
    );

    // Save to database cache if we have a commit hash
    if (commitHash) {
      await this.saveToDatabase(commitHash, index);
    }

    return index;
  }

  /**
   * Extract section headers from markdown content
   */
  private extractSections(content: string): string[] {
    const sections: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      // Match markdown headers (# Header, ## Header, ### Header, etc.)
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const title = match[2].trim();
        sections.push(`${'  '.repeat(level - 1)}${title}`);
      }
    }

    return sections;
  }

  /**
   * Generate a concise summary of the page content
   */
  private generateSummary(content: string, title: string): string {
    // Extract first paragraph after title or first 200 characters
    const lines = content.split('\n').filter((line) => line.trim().length > 0);

    // Skip title line if it matches
    let startIndex = 0;
    if (lines[0] && lines[0].includes(title)) {
      startIndex = 1;
    }

    // Find first substantive paragraph
    for (let i = startIndex; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].trim();
      // Skip headers and short lines
      if (!line.startsWith('#') && line.length > 50) {
        // Clean markdown formatting
        const cleaned = line
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links
          .replace(/`([^`]+)`/g, '$1') // Remove code formatting
          .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1') // Remove bold/italic
          .replace(/^[->]\s+/g, ''); // Remove list markers

        // Truncate to ~200 chars
        if (cleaned.length > 200) {
          return cleaned.substring(0, 197) + '...';
        }
        return cleaned;
      }
    }

    // Fallback: use first 200 chars of content
    const cleaned = content
      .replace(/#+\s+/g, '') // Remove headers
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .trim();

    if (cleaned.length > 200) {
      return cleaned.substring(0, 197) + '...';
    }
    return cleaned;
  }

  /**
   * Categorize pages by directory structure
   */
  private categorizePages(pages: DocumentationPageIndex[]): Record<string, string[]> {
    const categories: Record<string, string[]> = {};

    for (const page of pages) {
      // Extract directory from file path
      const parts = page.path.split('/');

      if (parts.length > 1) {
        // Use first directory as category (e.g., "docs", "guides", "api")
        const category = parts[0];

        if (!categories[category]) {
          categories[category] = [];
        }
        categories[category].push(page.path);

        // Also categorize by subdirectory if it exists
        if (parts.length > 2) {
          const subcategory = `${parts[0]}/${parts[1]}`;
          if (!categories[subcategory]) {
            categories[subcategory] = [];
          }
          categories[subcategory].push(page.path);
        }
      } else {
        // Root level files
        if (!categories['root']) {
          categories['root'] = [];
        }
        categories['root'].push(page.path);
      }
    }

    return categories;
  }

  /**
   * Format documentation index for LLM prompt context
   */
  formatForPrompt(index: DocumentationIndex): string {
    let output = '=== DOCUMENTATION INDEX ===\n\n';
    output += `Generated: ${index.generated_at.toISOString()}\n`;
    output += `Total Pages: ${index.pages.length}\n\n`;

    // Categories summary
    output += '--- Categories ---\n';
    for (const [category, paths] of Object.entries(index.categories)) {
      output += `${category}: ${paths.length} pages\n`;
    }
    output += '\n';

    // Detailed page listing
    output += '--- Documentation Pages ---\n\n';
    for (const page of index.pages) {
      output += `## ${page.title}\n`;
      output += `Path: ${page.path}\n`;
      output += `Summary: ${page.summary}\n`;

      if (page.sections.length > 0) {
        output += `Sections:\n`;
        for (const section of page.sections.slice(0, 10)) {
          // Limit to first 10 sections
          output += `  - ${section}\n`;
        }
        if (page.sections.length > 10) {
          output += `  ... and ${page.sections.length - 10} more sections\n`;
        }
      }

      output += `Last Updated: ${page.last_updated.toISOString()}\n`;
      output += '\n';
    }

    return output;
  }

  /**
   * Get a compact version for LLM context (reduced token usage)
   */
  formatCompact(index: DocumentationIndex): string {
    let output = '=== DOCUMENTATION INDEX (Compact) ===\n';

    // If no pages in database, use static hierarchy from config
    if (index.pages.length === 0 && this.config.documentationHierarchy) {
      output += `Using static documentation hierarchy\n\n`;

      for (const [category, pages] of Object.entries(this.config.documentationHierarchy)) {
        // Format category name (e.g., "core_concepts" -> "Core Concepts")
        const categoryName = category
          .split('_')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');

        output += `${categoryName}:\n`;
        for (const page of pages) {
          output += `  - ${page}\n`;
        }
        output += '\n';
      }

      return output;
    }

    // Use database-generated index if available
    output += `${index.pages.length} pages available\n\n`;

    // Just list pages with titles and paths
    for (const page of index.pages) {
      output += `- ${page.title} (${page.path})\n`;

      // Include sections if configured
      if (this.config.compactFormat.includeSections && page.sections.length > 0) {
        const maxSections = this.config.compactFormat.maxSectionsInCompact;
        const sectionsToShow = page.sections.slice(0, maxSections);
        output += `  Sections: ${sectionsToShow.join(', ')}`;
        if (page.sections.length > maxSections) {
          output += ` +${page.sections.length - maxSections} more`;
        }
        output += '\n';
      }

      // Include summaries if configured
      if (this.config.compactFormat.includeSummaries && page.summary) {
        output += `  ${page.summary}\n`;
      }
    }

    return output;
  }

  /**
   * Invalidate cache (call after documentation sync)
   * Deletes cached index for current commit hash
   */
  async invalidateCache(): Promise<void> {
    const commitHash = await this.getCurrentCommitHash();
    if (commitHash) {
      try {
        await prisma.docIndexCache.deleteMany({
          where: {
            commitHash,
            configHash: this.configHash,
          },
        });
        console.log(
          `Documentation index cache invalidated for commit ${commitHash.substring(0, 8)}`
        );
      } catch (error) {
        console.error('Failed to invalidate cache:', error);
      }
    } else {
      console.log('Documentation index cache invalidation skipped (no commit hash)');
    }
  }

  /**
   * Get cache status
   */
  async getCacheStatus(): Promise<{
    cached: boolean;
    commitHash: string | null;
    expiresAt: Date | null;
  }> {
    const commitHash = await this.getCurrentCommitHash();
    if (!commitHash) {
      return {
        cached: false,
        commitHash: null,
        expiresAt: null,
      };
    }

    try {
      const cached = await prisma.docIndexCache.findUnique({
        where: {
          commitHash_configHash: {
            commitHash,
            configHash: this.configHash,
          },
        },
      });

      return {
        cached: cached !== null,
        commitHash,
        expiresAt: cached?.generatedAt || null,
      };
    } catch (error) {
      console.error('Failed to get cache status:', error);
      return {
        cached: false,
        commitHash,
        expiresAt: null,
      };
    }
  }
}

/**
 * Load or generate project context configuration
 */
export async function loadProjectContext(
  generator: DocumentationIndexGenerator
): Promise<ProjectContext> {
  const docIndex = await generator.generateIndex();

  return {
    project_name: process.env.PROJECT_NAME || 'DocPythia',
    project_description:
      process.env.PROJECT_DESCRIPTION || 'AI-powered documentation management system',
    doc_purpose: process.env.DOC_PURPOSE || 'Technical documentation for developers',
    target_audience:
      process.env.TARGET_AUDIENCE || 'Developers, DevOps engineers, and technical users',
    style_guide: process.env.STYLE_GUIDE || 'Clear, concise, technical writing with code examples',
    doc_index: docIndex,
  };
}

// Export singleton instance
export const docIndexGenerator = new DocumentationIndexGenerator();
