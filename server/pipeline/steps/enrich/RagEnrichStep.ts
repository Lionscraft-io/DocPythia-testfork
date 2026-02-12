/**
 * RAG Enrich Step
 *
 * Enriches conversation threads with relevant documentation context.
 * Uses RAG (Retrieval Augmented Generation) to find related docs.
 *

 * @created 2025-12-30
 */

import { BasePipelineStep } from '../base/BasePipelineStep.js';
import {
  StepType,
  type StepConfig,
  type StepMetadata,
  type PipelineContext,
  type RagDocument,
  type PathFilter,
} from '../../core/interfaces.js';

/**
 * Configuration for RagEnrichStep
 */
interface RagEnrichConfig {
  topK?: number;
  minSimilarity?: number;
  deduplicateTranslations?: boolean;
}

/**
 * Enriches threads with RAG documentation context
 */
export class RagEnrichStep extends BasePipelineStep {
  readonly stepType = StepType.ENRICH;

  private topK: number;
  private minSimilarity: number;
  private deduplicateTranslations: boolean;

  constructor(config: StepConfig) {
    super(config);

    const enrichConfig = config.config as RagEnrichConfig;
    this.topK = enrichConfig.topK || 5;
    this.minSimilarity = enrichConfig.minSimilarity ?? 0.7;
    this.deduplicateTranslations = enrichConfig.deduplicateTranslations ?? true;
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();

    // Only process valuable threads (skip no-doc-value)
    const valuableThreads = context.threads.filter((t) => t.category !== 'no-doc-value');

    if (valuableThreads.length === 0) {
      this.logger.info('No valuable threads to enrich');
      this.recordTiming(context, startTime);
      return context;
    }

    this.logger.info(`Enriching ${valuableThreads.length} threads with RAG context`);

    let totalDocs = 0;

    for (const thread of valuableThreads) {
      try {
        // Build search query from RAG criteria
        const searchQuery =
          thread.ragSearchCriteria.semanticQuery || thread.ragSearchCriteria.keywords.join(' ');

        if (!searchQuery.trim()) {
          this.logger.debug(`Thread ${thread.id} has no search query, skipping`);
          continue;
        }

        // Perform RAG search (fetch more for filtering)
        const results = await context.ragService.searchSimilarDocs(searchQuery, this.topK * 2);

        // Apply similarity threshold
        let filtered = results.filter((doc) => doc.similarity >= this.minSimilarity);

        // Apply path filtering from domain config
        filtered = this.filterByPaths(filtered, context.domainConfig.ragPaths);

        // Deduplicate translations (keep only English versions)
        if (this.deduplicateTranslations) {
          filtered = this.deduplicateI18n(filtered);
        }

        // Take top K results
        const finalDocs = filtered.slice(0, this.topK);

        // Store in context
        context.ragResults.set(thread.id, finalDocs);
        totalDocs += finalDocs.length;

        // Log RAG query for pipeline debugger
        this.appendRagQueryLog(
          context,
          `RAG: ${thread.summary?.substring(0, 60) || thread.id}`,
          searchQuery,
          finalDocs.map((d) => ({
            filePath: d.filePath,
            title: d.title,
            similarity: d.similarity,
          }))
        );

        this.logger.debug(`Thread ${thread.id}: found ${finalDocs.length} relevant docs`, {
          query: searchQuery.slice(0, 100),
          similarityRange:
            finalDocs.length > 0
              ? `${finalDocs[finalDocs.length - 1].similarity.toFixed(3)} - ${finalDocs[0].similarity.toFixed(3)}`
              : 'N/A',
        });
      } catch (error) {
        this.logger.error(`Failed to enrich thread ${thread.id}:`, error);
        // Continue with other threads
        context.ragResults.set(thread.id, []);
      }
    }

    this.recordTiming(context, startTime);

    this.logger.info(
      `RAG enrichment complete: ${totalDocs} docs for ${valuableThreads.length} threads`
    );

    return context;
  }

  /**
   * Filter documents by path patterns from domain config
   */
  private filterByPaths(results: RagDocument[], pathFilter?: PathFilter): RagDocument[] {
    if (!pathFilter) {
      return results;
    }

    return results.filter((doc) => {
      // Check exclusions first
      if (pathFilter.exclude) {
        const isExcluded = pathFilter.exclude.some((pattern) =>
          this.matchGlob(doc.filePath, pattern)
        );
        if (isExcluded) {
          return false;
        }
      }

      // Check inclusions
      if (pathFilter.include && pathFilter.include.length > 0) {
        return pathFilter.include.some((pattern) => this.matchGlob(doc.filePath, pattern));
      }

      return true;
    });
  }

  /**
   * Simple glob pattern matching
   */
  private matchGlob(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars
      .replace(/\*\*/g, '.*') // ** matches any path
      .replace(/\*/g, '[^/]*'); // * matches single path segment

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(path);
  }

  /**
   * Remove duplicate i18n versions, keeping English
   */
  private deduplicateI18n(results: RagDocument[]): RagDocument[] {
    const seen = new Map<string, RagDocument>();

    for (const doc of results) {
      // Extract base path without i18n prefix
      const basePath = doc.filePath
        .replace(/^i18n\/[a-z]{2}(-[A-Z]{2})?\//, '')
        .replace(/^[a-z]{2}(-[A-Z]{2})?\//, '');

      const existing = seen.get(basePath);

      // Prefer English (no i18n prefix) or higher similarity
      if (!existing) {
        seen.set(basePath, doc);
      } else if (!doc.filePath.startsWith('i18n/') && existing.filePath.startsWith('i18n/')) {
        // Replace i18n version with English version
        seen.set(basePath, doc);
      } else if (doc.similarity > existing.similarity) {
        // Replace with higher similarity version
        seen.set(basePath, doc);
      }
    }

    return Array.from(seen.values()).sort((a, b) => b.similarity - a.similarity);
  }

  validateConfig(config: StepConfig): boolean {
    if (!super.validateConfig(config)) {
      return false;
    }

    const enrichConfig = config.config as RagEnrichConfig;

    // Validate topK
    if (enrichConfig.topK !== undefined) {
      if (typeof enrichConfig.topK !== 'number' || enrichConfig.topK < 1) {
        this.logger.error('topK must be a positive number');
        return false;
      }
    }

    // Validate minSimilarity
    if (enrichConfig.minSimilarity !== undefined) {
      if (
        typeof enrichConfig.minSimilarity !== 'number' ||
        enrichConfig.minSimilarity < 0 ||
        enrichConfig.minSimilarity > 1
      ) {
        this.logger.error('minSimilarity must be between 0 and 1');
        return false;
      }
    }

    return true;
  }

  getMetadata(): StepMetadata {
    return {
      name: 'RAG Enrichment',
      description: 'Adds relevant documentation context to threads',
      version: '1.0.0',
      author: 'system',
    };
  }
}

/**
 * Factory function for RagEnrichStep
 */
export function createRagEnrichStep(config: StepConfig): RagEnrichStep {
  return new RagEnrichStep(config);
}
