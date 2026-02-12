/**
 * Keyword Filter Step
 *
 * Pre-filters messages based on keyword inclusion/exclusion.
 * No LLM calls - pure text matching for fast filtering.
 *

 * @created 2025-12-30
 */

import { BasePipelineStep } from '../base/BasePipelineStep.js';
import {
  StepType,
  type StepConfig,
  type StepMetadata,
  type PipelineContext,
} from '../../core/interfaces.js';

/**
 * Configuration for KeywordFilterStep
 */
interface KeywordFilterConfig {
  includeKeywords?: string[];
  excludeKeywords?: string[];
  caseSensitive?: boolean;
}

/**
 * Pre-filters messages based on keyword patterns
 */
export class KeywordFilterStep extends BasePipelineStep {
  readonly stepType = StepType.FILTER;

  private includeKeywords: string[];
  private excludeKeywords: string[];
  private caseSensitive: boolean;

  constructor(config: StepConfig) {
    super(config);

    const filterConfig = config.config as KeywordFilterConfig;
    this.includeKeywords = filterConfig.includeKeywords || [];
    this.excludeKeywords = filterConfig.excludeKeywords || [];
    this.caseSensitive = filterConfig.caseSensitive || false;
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();
    const initialCount = context.messages.length;

    // If no filters configured, pass through all messages
    if (this.includeKeywords.length === 0 && this.excludeKeywords.length === 0) {
      this.logger.debug('No keyword filters configured, passing all messages');
      context.filteredMessages = [...context.messages];
      this.recordTiming(context, startTime);
      return context;
    }

    // Apply keyword filtering
    context.filteredMessages = context.messages.filter((msg) => {
      const content = this.caseSensitive ? msg.content : msg.content.toLowerCase();

      // Check exclusion patterns first
      if (this.excludeKeywords.length > 0) {
        const hasExcluded = this.excludeKeywords.some((kw) => {
          const keyword = this.caseSensitive ? kw : kw.toLowerCase();
          return content.includes(keyword);
        });
        if (hasExcluded) {
          this.logger.debug(`Message ${msg.id} excluded by keyword filter`);
          return false;
        }
      }

      // Check inclusion patterns
      if (this.includeKeywords.length > 0) {
        const hasIncluded = this.includeKeywords.some((kw) => {
          const keyword = this.caseSensitive ? kw : kw.toLowerCase();
          return content.includes(keyword);
        });
        if (!hasIncluded) {
          this.logger.debug(`Message ${msg.id} not matching include keywords`);
          return false;
        }
      }

      return true;
    });

    const filtered = initialCount - context.filteredMessages.length;
    this.recordTiming(context, startTime);

    this.logger.info(`Keyword filter: ${filtered}/${initialCount} messages filtered out`, {
      includeKeywords: this.includeKeywords.length,
      excludeKeywords: this.excludeKeywords.length,
      remaining: context.filteredMessages.length,
    });

    return context;
  }

  validateConfig(config: StepConfig): boolean {
    if (!super.validateConfig(config)) {
      return false;
    }

    const filterConfig = config.config as KeywordFilterConfig;

    // At least one filter type should be present
    if (!filterConfig.includeKeywords && !filterConfig.excludeKeywords) {
      this.logger.warn('KeywordFilterStep has no keywords configured');
    }

    // Validate keyword arrays
    if (filterConfig.includeKeywords && !Array.isArray(filterConfig.includeKeywords)) {
      this.logger.error('includeKeywords must be an array');
      return false;
    }

    if (filterConfig.excludeKeywords && !Array.isArray(filterConfig.excludeKeywords)) {
      this.logger.error('excludeKeywords must be an array');
      return false;
    }

    return true;
  }

  getMetadata(): StepMetadata {
    return {
      name: 'Keyword Filter',
      description: 'Pre-filters messages based on keyword patterns',
      version: '1.0.0',
      author: 'system',
    };
  }

  /**
   * Update keywords dynamically (useful for testing or hot-reload)
   */
  updateKeywords(include?: string[], exclude?: string[]): void {
    if (include !== undefined) {
      this.includeKeywords = include;
    }
    if (exclude !== undefined) {
      this.excludeKeywords = exclude;
    }
    this.logger.debug('Keywords updated', {
      includeCount: this.includeKeywords.length,
      excludeCount: this.excludeKeywords.length,
    });
  }
}

/**
 * Factory function for KeywordFilterStep
 */
export function createKeywordFilterStep(config: StepConfig): KeywordFilterStep {
  return new KeywordFilterStep(config);
}
