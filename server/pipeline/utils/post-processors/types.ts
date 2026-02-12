/**
 * Post-Processor Types and Interfaces
 *

 * @created 2025-12-31
 */

/**
 * Result from a single post-processor
 */
export interface PostProcessResult {
  /** The processed text */
  text: string;
  /** Warnings about content that couldn't be auto-processed */
  warnings: string[];
  /** Whether any modification was applied */
  wasModified: boolean;
}

/**
 * Context passed to post-processors
 */
export interface PostProcessContext {
  /** Target file path (e.g., "docs/api/errors.md") */
  targetFilePath: string;
  /** File extension without dot (e.g., "md", "mdx") */
  fileExtension: string;
  /** Whether the target is a markdown file */
  isMarkdown: boolean;
  /** Whether the target is an HTML file */
  isHtml: boolean;
  /** Original text before any processing */
  originalText: string;
  /** Accumulated warnings from previous processors */
  previousWarnings: string[];
}

/**
 * Base interface for all post-processors
 */
export interface IPostProcessor {
  /** Unique identifier for this processor */
  readonly name: string;

  /** Description of what this processor does */
  readonly description: string;

  /** Whether this processor is enabled */
  enabled: boolean;

  /**
   * Check if this processor should run for the given context
   */
  shouldProcess(context: PostProcessContext): boolean;

  /**
   * Process the text and return the result
   */
  process(text: string, context: PostProcessContext): PostProcessResult;
}

/**
 * Abstract base class for post-processors with common functionality
 */
export abstract class BasePostProcessor implements IPostProcessor {
  abstract readonly name: string;
  abstract readonly description: string;
  enabled: boolean = true;

  /**
   * Override to customize when this processor should run
   * Default: only process markdown files
   */
  shouldProcess(context: PostProcessContext): boolean {
    return context.isMarkdown;
  }

  /**
   * Main processing logic - must be implemented by subclasses
   */
  abstract process(text: string, context: PostProcessContext): PostProcessResult;
}

/**
 * Result of masking code segments in text
 */
export interface MaskedText {
  /** Text with code segments replaced by placeholders */
  text: string;
  /** Map of placeholder -> original code segment */
  masks: Map<string, string>;
}

/**
 * Mask code segments (fenced blocks and inline code) to prevent
 * formatting fixes from modifying code content.
 *
 * @param text - The text to mask
 * @returns MaskedText with placeholders and original segments
 */
export function maskCodeSegments(text: string): MaskedText {
  const masks = new Map<string, string>();
  let counter = 0;
  let result = text;

  // Mask fenced code blocks first (```...```)
  // Use a pattern that matches opening ```, optional language, content, and closing ```
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    const placeholder = `__CODE_BLOCK_${counter++}__`;
    masks.set(placeholder, match);
    return placeholder;
  });

  // Mask inline code (`...`) - non-greedy, single backticks only
  result = result.replace(/`[^`\n]+`/g, (match) => {
    const placeholder = `__INLINE_CODE_${counter++}__`;
    masks.set(placeholder, match);
    return placeholder;
  });

  return { text: result, masks };
}

/**
 * Restore masked code segments to their original content
 *
 * @param masked - The masked text result from maskCodeSegments
 * @returns Original text with code segments restored
 */
export function unmaskCodeSegments(masked: MaskedText): string {
  let result = masked.text;
  for (const [placeholder, original] of masked.masks) {
    result = result.replace(placeholder, original);
  }
  return result;
}
