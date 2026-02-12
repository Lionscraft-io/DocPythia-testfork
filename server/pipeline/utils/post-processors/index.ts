/**
 * Post-Processor Framework
 *
 * Modular post-processing pipeline for proposal text.
 * Each processor handles a specific aspect (HTML conversion, spelling, content policy, etc.)
 *

 * @created 2025-12-31
 */

import { createLogger } from '../../../utils/logger.js';
import type { IPostProcessor, PostProcessResult, PostProcessContext } from './types.js';

const logger = createLogger('PostProcessorPipeline');

// Re-export types from types.ts
export type { PostProcessResult, PostProcessContext, IPostProcessor };
export { BasePostProcessor } from './types.js';

/**
 * Pipeline that chains multiple post-processors
 */
export class PostProcessorPipeline {
  private processors: IPostProcessor[] = [];

  constructor(processors: IPostProcessor[] = []) {
    this.processors = processors;
  }

  /**
   * Add a processor to the pipeline
   */
  addProcessor(processor: IPostProcessor): void {
    this.processors.push(processor);
    logger.debug(`Added processor: ${processor.name}`);
  }

  /**
   * Remove a processor by name
   */
  removeProcessor(name: string): boolean {
    const index = this.processors.findIndex((p) => p.name === name);
    if (index >= 0) {
      this.processors.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all registered processors
   */
  getProcessors(): IPostProcessor[] {
    return [...this.processors];
  }

  /**
   * Process text through all enabled processors
   */
  process(text: string | undefined, targetFilePath: string): PostProcessResult {
    if (!text) {
      return { text: '', warnings: [], wasModified: false };
    }

    const ext = targetFilePath.toLowerCase().split('.').pop() || '';
    const context: PostProcessContext = {
      targetFilePath,
      fileExtension: ext,
      isMarkdown: ['md', 'mdx', 'markdown'].includes(ext),
      isHtml: ['html', 'htm'].includes(ext),
      originalText: text,
      previousWarnings: [],
    };

    let processedText = text;
    let wasModified = false;
    const allWarnings: string[] = [];

    for (const processor of this.processors) {
      if (!processor.enabled) {
        continue;
      }

      if (!processor.shouldProcess(context)) {
        continue;
      }

      try {
        const result = processor.process(processedText, {
          ...context,
          previousWarnings: [...allWarnings],
        });

        if (result.wasModified) {
          processedText = result.text;
          wasModified = true;
          logger.debug(`Processor ${processor.name} modified the text`);
        }

        allWarnings.push(...result.warnings);
      } catch (error) {
        logger.error(`Processor ${processor.name} failed:`, error);
        allWarnings.push(`Processor ${processor.name} failed: ${error}`);
      }
    }

    return {
      text: processedText,
      warnings: allWarnings,
      wasModified,
    };
  }
}

// Re-export processor implementations
export { HtmlToMarkdownPostProcessor } from './HtmlToMarkdownPostProcessor.js';
export { MarkdownFormattingPostProcessor } from './MarkdownFormattingPostProcessor.js';
export { ListFormattingPostProcessor } from './ListFormattingPostProcessor.js';
export { CodeBlockFormattingPostProcessor } from './CodeBlockFormattingPostProcessor.js';
