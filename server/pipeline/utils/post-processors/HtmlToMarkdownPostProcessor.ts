/**
 * HTML to Markdown Post-Processor
 *
 * Converts HTML elements in proposals to their markdown equivalents.
 * Handles nested HTML, MDX admonitions, and complex structures.
 *

 * @created 2025-12-31
 */

import { BasePostProcessor, PostProcessResult, PostProcessContext } from './types.js';

/**
 * Inline HTML to Markdown rules (applied first, multiple passes)
 * These handle inline elements that can be nested
 *
 * Note: <br/> conversion is handled separately to preserve it in table contexts
 */
const INLINE_HTML_RULES: Array<{
  pattern: RegExp;
  replacement: string;
}> = [
  // Bold and italic (inline, process first)
  { pattern: /<strong[^>]*>([\s\S]*?)<\/strong>/gi, replacement: '**$1**' },
  { pattern: /<b[^>]*>([\s\S]*?)<\/b>/gi, replacement: '**$1**' },
  { pattern: /<em[^>]*>([\s\S]*?)<\/em>/gi, replacement: '*$1*' },
  { pattern: /<i[^>]*>([\s\S]*?)<\/i>/gi, replacement: '*$1*' },

  // Inline code
  { pattern: /<code[^>]*>([\s\S]*?)<\/code>/gi, replacement: '`$1`' },

  // Links
  { pattern: /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, replacement: '[$2]($1)' },

  // Line breaks - only convert when NOT inside a table row
  // Table rows start with | and <br/> inside them should be preserved
  // This pattern only matches <br/> that are NOT preceded by | on the same line
  // Handled separately in convertHtmlToMarkdown method

  // Strikethrough
  { pattern: /<del[^>]*>([\s\S]*?)<\/del>/gi, replacement: '~~$1~~' },
  { pattern: /<s[^>]*>([\s\S]*?)<\/s>/gi, replacement: '~~$1~~' },

  // Spans (just remove tags, keep content)
  { pattern: /<span[^>]*>([\s\S]*?)<\/span>/gi, replacement: '$1' },
];

/**
 * Block-level HTML to Markdown rules (applied after inline rules)
 */
const BLOCK_HTML_RULES: Array<{
  pattern: RegExp;
  replacement: string;
}> = [
  // Headers
  { pattern: /<h1[^>]*>([\s\S]*?)<\/h1>/gi, replacement: '\n# $1\n' },
  { pattern: /<h2[^>]*>([\s\S]*?)<\/h2>/gi, replacement: '\n## $1\n' },
  { pattern: /<h3[^>]*>([\s\S]*?)<\/h3>/gi, replacement: '\n### $1\n' },
  { pattern: /<h4[^>]*>([\s\S]*?)<\/h4>/gi, replacement: '\n#### $1\n' },
  { pattern: /<h5[^>]*>([\s\S]*?)<\/h5>/gi, replacement: '\n##### $1\n' },
  { pattern: /<h6[^>]*>([\s\S]*?)<\/h6>/gi, replacement: '\n###### $1\n' },

  // Images
  {
    pattern: /<img\s+[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi,
    replacement: '![$2]($1)',
  },
  {
    pattern: /<img\s+[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*\/?>/gi,
    replacement: '![$1]($2)',
  },
  { pattern: /<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?>/gi, replacement: '![]($1)' },

  // Paragraphs
  { pattern: /<p[^>]*>([\s\S]*?)<\/p>/gi, replacement: '\n$1\n' },

  // Horizontal rules
  { pattern: /<hr\s*\/?>/gi, replacement: '\n---\n' },

  // Simple unordered lists
  { pattern: /<ul[^>]*>([\s\S]*?)<\/ul>/gi, replacement: '\n$1\n' },
  { pattern: /<li[^>]*>([\s\S]*?)<\/li>/gi, replacement: '- $1\n' },

  // Simple ordered lists
  { pattern: /<ol[^>]*>([\s\S]*?)<\/ol>/gi, replacement: '\n$1\n' },

  // Clean up leftover divs (remove tags, keep content)
  { pattern: /<div[^>]*>([\s\S]*?)<\/div>/gi, replacement: '\n$1\n' },
];

/**
 * MDX Admonition types mapping from HTML class names
 */
const ADMONITION_CLASS_MAP: Record<string, string> = {
  info: 'info',
  note: 'note',
  tip: 'tip',
  warning: 'warning',
  caution: 'caution',
  danger: 'danger',
  important: 'warning',
  success: 'tip',
};

/**
 * Patterns that indicate complex HTML structures that can't be auto-converted
 */
const COMPLEX_HTML_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /<table[\s\S]*?<\/table>/gi,
    message: 'Contains HTML table - manual conversion to markdown table may be needed',
  },
  {
    pattern: /<svg[\s\S]*?<\/svg>/gi,
    message: 'Contains SVG element - needs manual review',
  },
  {
    pattern: /<iframe[\s\S]*?<\/iframe>/gi,
    message: 'Contains iframe - needs manual review',
  },
  {
    pattern: /<script[\s\S]*?<\/script>/gi,
    message: 'Contains script tag - should be removed or converted',
  },
  {
    pattern: /<style[\s\S]*?<\/style>/gi,
    message: 'Contains style tag - should be removed',
  },
  {
    pattern: /style=["'][^"']+["']/gi,
    message: 'Contains inline styles - may need cleanup',
  },
  {
    pattern: /<form[\s\S]*?<\/form>/gi,
    message: 'Contains form element - needs manual review',
  },
  {
    pattern: /<input[\s\S]*?>/gi,
    message: 'Contains input element - needs manual review',
  },
  {
    pattern: /<button[\s\S]*?<\/button>/gi,
    message: 'Contains button element - needs manual review',
  },
  {
    pattern: /<sub[^>]*>.*?<\/sub>/gi,
    message: 'Contains subscript - no markdown equivalent',
  },
  {
    pattern: /<sup[^>]*>.*?<\/sup>/gi,
    message: 'Contains superscript - no markdown equivalent',
  },
];

/**
 * HTML to Markdown Post-Processor
 */
export class HtmlToMarkdownPostProcessor extends BasePostProcessor {
  readonly name = 'html-to-markdown';
  readonly description = 'Converts HTML elements to markdown format';

  /**
   * Only process markdown files that contain HTML
   */
  shouldProcess(context: PostProcessContext): boolean {
    return context.isMarkdown && this.containsHtml(context.originalText);
  }

  /**
   * Process the text - convert HTML to markdown
   */
  process(text: string, _context: PostProcessContext): PostProcessResult {
    const warnings: string[] = [];

    // Detect complex structures first
    warnings.push(...this.detectComplexHtml(text));

    // Convert HTML to markdown
    const processedText = this.convertHtmlToMarkdown(text);
    const wasModified = processedText !== text;

    // Check for remaining HTML after conversion
    if (this.containsHtml(processedText)) {
      const remainingWarnings = this.detectComplexHtml(processedText);
      for (const w of remainingWarnings) {
        if (!warnings.includes(w)) {
          warnings.push(w);
        }
      }
    }

    return { text: processedText, warnings, wasModified };
  }

  /**
   * Detect if text contains HTML elements
   */
  containsHtml(text: string): boolean {
    if (!text) return false;
    const htmlTagPattern = /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?\/?>/i;
    return htmlTagPattern.test(text);
  }

  /**
   * Convert HTML to markdown
   */
  convertHtmlToMarkdown(text: string): string {
    let result = text;

    // Step 1: Convert blockquotes with classes to MDX admonitions
    result = this.convertBlockquotesToAdmonitions(result);

    // Step 2: Convert code blocks BEFORE inline processing
    result = result.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
    result = result.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');

    // Step 3: Apply inline rules until stable
    result = this.applyRulesUntilStable(result, INLINE_HTML_RULES);

    // Step 4: Convert <br/> tags - preserve in table rows, convert elsewhere
    result = this.convertLineBreaks(result);

    // Step 5: Apply block-level rules
    for (const rule of BLOCK_HTML_RULES) {
      rule.pattern.lastIndex = 0;
      result = result.replace(rule.pattern, rule.replacement);
    }

    // Step 6: Convert remaining simple blockquotes
    result = this.convertSimpleBlockquotes(result);

    // Step 7: Clean up
    result = result.replace(/\n{3,}/g, '\n\n');
    result = result.replace(/\n\s*:::/g, '\n:::');
    result = result.replace(/:::\s*\n/g, ':::\n');
    result = result.trim();

    return result;
  }

  /**
   * Convert <br/> tags to newlines everywhere
   * Previously preserved in tables, but frontend doesn't render HTML so convert all
   */
  private convertLineBreaks(text: string): string {
    return text.replace(/<br\s*\/?>/gi, '\n');
  }

  /**
   * Convert blockquotes with class to MDX admonitions
   */
  private convertBlockquotesToAdmonitions(text: string): string {
    const pattern = /<blockquote\s+[^>]*class=["']([^"']+)["'][^>]*>([\s\S]*?)<\/blockquote>/gi;

    return text.replace(pattern, (_match, classAttr, content) => {
      const classes = classAttr.toLowerCase().split(/\s+/);
      let admonitionType = 'note';

      for (const cls of classes) {
        if (ADMONITION_CLASS_MAP[cls]) {
          admonitionType = ADMONITION_CLASS_MAP[cls];
          break;
        }
      }

      const cleanContent = content.trim().replace(/\n{3,}/g, '\n\n');
      return `\n:::${admonitionType}\n${cleanContent}\n:::\n`;
    });
  }

  /**
   * Convert simple blockquotes
   */
  private convertSimpleBlockquotes(text: string): string {
    const pattern = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;

    return text.replace(pattern, (_match, content) => {
      const cleanContent = content.trim();
      const lines = cleanContent.split('\n');
      const quotedLines = lines.map((line: string) => `> ${line}`).join('\n');
      return `\n${quotedLines}\n`;
    });
  }

  /**
   * Apply rules until no more changes
   */
  private applyRulesUntilStable(
    text: string,
    rules: Array<{ pattern: RegExp; replacement: string }>,
    maxPasses = 5
  ): string {
    let result = text;
    let previousResult = '';
    let passes = 0;

    while (result !== previousResult && passes < maxPasses) {
      previousResult = result;
      for (const rule of rules) {
        rule.pattern.lastIndex = 0;
        result = result.replace(rule.pattern, rule.replacement);
      }
      passes++;
    }

    return result;
  }

  /**
   * Detect complex HTML that can't be auto-converted
   */
  private detectComplexHtml(text: string): string[] {
    if (!text) return [];

    const warnings: string[] = [];

    for (const { pattern, message } of COMPLEX_HTML_PATTERNS) {
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
}
