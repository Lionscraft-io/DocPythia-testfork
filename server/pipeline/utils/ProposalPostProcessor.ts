/**
 * Proposal Post-Processor
 *
 * Main entry point for post-processing proposals.
 * Uses a modular pipeline architecture with pluggable processors.
 *

 * @created 2025-12-31
 */

import { PostProcessorPipeline } from './post-processors/index.js';
import type { PostProcessResult } from './post-processors/types.js';
import { HtmlToMarkdownPostProcessor } from './post-processors/HtmlToMarkdownPostProcessor.js';
import { ListFormattingPostProcessor } from './post-processors/ListFormattingPostProcessor.js';
import { MarkdownFormattingPostProcessor } from './post-processors/MarkdownFormattingPostProcessor.js';
import { CodeBlockFormattingPostProcessor } from './post-processors/CodeBlockFormattingPostProcessor.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ProposalPostProcessor');

// Create default pipeline with processors in order:
// 1. Code Block Formatting - fix code block issues first (before masking)
// 2. HTML to Markdown - convert HTML elements
// 3. Markdown Formatting - fix labels (Cause:/Solution:) and headers
// 4. List Formatting - fix numbered/bullet list issues last
const defaultPipeline = new PostProcessorPipeline([
  new CodeBlockFormattingPostProcessor(),
  new HtmlToMarkdownPostProcessor(),
  new MarkdownFormattingPostProcessor(),
  new ListFormattingPostProcessor(),
]);

// Create instance of HTML processor for direct access
const htmlProcessor = new HtmlToMarkdownPostProcessor();

/**
 * Check if a file path indicates a markdown file
 */
export function isMarkdownFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop() || '';
  return ['md', 'mdx', 'markdown'].includes(ext);
}

/**
 * Check if a file path indicates an HTML file
 */
export function isHtmlFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop() || '';
  return ['html', 'htm'].includes(ext);
}

/**
 * Detect if text contains HTML elements
 */
export function containsHtml(text: string): boolean {
  return htmlProcessor.containsHtml(text);
}

/**
 * Convert HTML elements to markdown
 * @deprecated Use PostProcessorPipeline instead for full processing
 */
export function convertHtmlToMarkdown(text: string): string {
  return htmlProcessor.convertHtmlToMarkdown(text);
}

/**
 * Detect complex HTML structures and return warnings
 */
export function detectComplexHtml(text: string): string[] {
  if (!text) return [];

  const warnings: string[] = [];

  // Complex patterns that can't be auto-converted
  const complexPatterns = [
    {
      pattern: /<table[\s\S]*?<\/table>/gi,
      message: 'Contains HTML table - manual conversion to markdown table may be needed',
    },
    { pattern: /<svg[\s\S]*?<\/svg>/gi, message: 'Contains SVG element - needs manual review' },
    { pattern: /<iframe[\s\S]*?<\/iframe>/gi, message: 'Contains iframe - needs manual review' },
    {
      pattern: /<script[\s\S]*?<\/script>/gi,
      message: 'Contains script tag - should be removed or converted',
    },
    { pattern: /<style[\s\S]*?<\/style>/gi, message: 'Contains style tag - should be removed' },
    { pattern: /style=["'][^"']+["']/gi, message: 'Contains inline styles - may need cleanup' },
    { pattern: /<form[\s\S]*?<\/form>/gi, message: 'Contains form element - needs manual review' },
    { pattern: /<input[\s\S]*?>/gi, message: 'Contains input element - needs manual review' },
    {
      pattern: /<button[\s\S]*?<\/button>/gi,
      message: 'Contains button element - needs manual review',
    },
    { pattern: /<sub[^>]*>.*?<\/sub>/gi, message: 'Contains subscript - no markdown equivalent' },
    { pattern: /<sup[^>]*>.*?<\/sup>/gi, message: 'Contains superscript - no markdown equivalent' },
  ];

  for (const { pattern, message } of complexPatterns) {
    if (pattern.test(text)) {
      warnings.push(message);
    }
  }

  // Check for remaining HTML tags
  const remainingHtmlPattern = /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?\/?>/gi;
  const remainingTags = text.match(remainingHtmlPattern);
  if (remainingTags && remainingTags.length > 0) {
    const uniqueTags = [...new Set(remainingTags.map((t) => t.replace(/<\/?|\s.*|>/g, '')))];
    warnings.push(`Contains unconverted HTML elements: ${uniqueTags.join(', ')}`);
  }

  return warnings;
}

/**
 * Post-process a proposal's suggested text using the default pipeline
 *
 * @param text - The suggested text from LLM
 * @param targetFilePath - The target file path (e.g., "docs/api/rpc/errors.md")
 * @returns PostProcessResult with cleaned text and any warnings
 */
export function postProcessProposal(
  text: string | undefined,
  targetFilePath: string
): PostProcessResult {
  if (!text) {
    return { text: '', warnings: [], wasModified: false };
  }

  logger.debug(`Post-processing proposal for: ${targetFilePath}`);
  return defaultPipeline.process(text, targetFilePath);
}

/**
 * Batch post-process multiple proposals
 */
export function postProcessProposals(
  proposals: Array<{ suggestedText?: string; page: string; warnings?: string[] }>
): Array<{ suggestedText?: string; page: string; warnings?: string[] }> {
  return proposals.map((proposal) => {
    const result = postProcessProposal(proposal.suggestedText, proposal.page);

    return {
      ...proposal,
      suggestedText: result.text || proposal.suggestedText,
      warnings: [...(proposal.warnings || []), ...result.warnings],
    };
  });
}

/**
 * Get the default post-processor pipeline
 */
export function getDefaultPipeline(): PostProcessorPipeline {
  return defaultPipeline;
}

/**
 * Create a custom post-processor pipeline
 */
export function createPipeline(): PostProcessorPipeline {
  return new PostProcessorPipeline();
}

// Export types and classes for extensibility
export { PostProcessorPipeline };
export type { PostProcessResult };
export type {
  IPostProcessor,
  PostProcessContext,
  BasePostProcessor,
} from './post-processors/index.js';
export { HtmlToMarkdownPostProcessor } from './post-processors/HtmlToMarkdownPostProcessor.js';
export { ListFormattingPostProcessor } from './post-processors/ListFormattingPostProcessor.js';
export { MarkdownFormattingPostProcessor } from './post-processors/MarkdownFormattingPostProcessor.js';
export { CodeBlockFormattingPostProcessor } from './post-processors/CodeBlockFormattingPostProcessor.js';

export default {
  postProcessProposal,
  postProcessProposals,
  isMarkdownFile,
  isHtmlFile,
  containsHtml,
  convertHtmlToMarkdown,
  detectComplexHtml,
  getDefaultPipeline,
  createPipeline,
};
