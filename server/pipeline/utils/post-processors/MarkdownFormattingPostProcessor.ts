/**
 * Markdown Formatting Post-Processor
 *
 * Fixes markdown-specific formatting issues in LLM-generated content:
 * - Bold/italic headers running into text
 * - Admonition syntax issues
 * - Section titles without proper breaks
 * - Labels (Cause:, Solution:) at content boundaries
 *
 * Note: List formatting issues are handled by ListFormattingPostProcessor.
 *

 * @created 2025-12-31
 */

import {
  BasePostProcessor,
  PostProcessResult,
  PostProcessContext,
  maskCodeSegments,
  unmaskCodeSegments,
} from './types.js';

/**
 * Common sentence starters and labels that indicate the start of new content.
 * Used to distinguish formatting errors from valid CamelCase identifiers.
 *
 * Examples:
 * - "## ConsiderationsThe text" → split ("The" is sentence starter)
 * - "## JavaScript runtime" → no split ("Script" is not sentence starter)
 * - "## RocksDB internals" → no split (DB is uppercase, pattern doesn't match)
 */
const SENTENCE_STARTERS = new Set([
  // Articles and determiners
  'the',
  'a',
  'an',
  'this',
  'that',
  'these',
  'those',
  'some',
  'any',
  'all',
  'each',
  'every',
  'no',
  // Pronouns
  'it',
  'its',
  'we',
  'you',
  'they',
  'he',
  'she',
  'i',
  'my',
  'your',
  'our',
  'their',
  // Common sentence-starting verbs
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'has',
  'have',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'should',
  'could',
  'can',
  'may',
  'might',
  'must',
  'use',
  'run',
  'check',
  'try',
  'make',
  'see',
  'note',
  'ensure',
  'verify',
  'confirm',
  'add',
  'remove',
  'create',
  'delete',
  'update',
  'set',
  'get',
  'start',
  'stop',
  'open',
  'close',
  'install',
  'configure',
  'enable',
  'disable',
  // Prepositions often starting sentences
  'for',
  'from',
  'to',
  'in',
  'on',
  'at',
  'by',
  'with',
  'about',
  'into',
  'onto',
  'upon',
  'during',
  'after',
  'before',
  // Conjunctions and transitions
  'if',
  'when',
  'while',
  'unless',
  'although',
  'though',
  'once',
  'since',
  'because',
  'but',
  'and',
  'or',
  'so',
  'yet',
  'nor',
  'however',
  'therefore',
  'thus',
  'hence',
  'also',
  'additionally',
  'furthermore',
  'moreover',
  'otherwise',
  'then',
  'next',
  'first',
  'second',
  'third',
  'finally',
  'lastly',
  'now',
  'here',
  'there',
  // Adverbs
  'just',
  'only',
  'even',
  'still',
  'already',
  'always',
  'never',
  'often',
  'sometimes',
  // Common documentation labels
  'cause',
  'solution',
  'note',
  'warning',
  'important',
  'example',
  'error',
  'issue',
  'problem',
  'fix',
  'resolution',
  'answer',
  'question',
  'tip',
  'info',
  'details',
  'summary',
  'overview',
  'background',
  'context',
  'result',
  'output',
  'input',
  'step',
  'steps',
  'action',
  'description',
  'reason',
  'explanation',
  'requirement',
  'requirements',
]);

/**
 * Check if a word is a common sentence starter
 */
function isSentenceStarter(word: string): boolean {
  return SENTENCE_STARTERS.has(word.toLowerCase());
}

/**
 * High-confidence sentence starters for boundary detection.
 * Smaller allowlist than SENTENCE_STARTERS to avoid false positives
 * when fixing sentence run-on issues (e.g., `.Word` -> `. Word`).
 */
const SENTENCE_BOUNDARY_STARTERS = new Set([
  'the',
  'this',
  'that',
  'if',
  'when',
  'while',
  'for',
  'to',
  'in',
  'on',
  'at',
  'as',
  'we',
  'you',
  'it',
  'they',
  'there',
  'however',
  'therefore',
  'also',
  'but',
  'or',
  'and',
  'please',
  'note',
  'ensure',
  'see',
  'refer',
  'check',
  'use',
  'after',
  'before',
]);

/**
 * Check if a word is a high-confidence sentence boundary starter
 */
function isSentenceBoundaryStarter(word: string): boolean {
  return SENTENCE_BOUNDARY_STARTERS.has(word.toLowerCase());
}

/**
 * Markdown Formatting Post-Processor
 */
export class MarkdownFormattingPostProcessor extends BasePostProcessor {
  readonly name = 'markdown-formatting';
  readonly description = 'Fixes markdown-specific formatting issues like headers and admonitions';

  /**
   * Only process markdown files
   */
  shouldProcess(context: PostProcessContext): boolean {
    return context.isMarkdown;
  }

  /**
   * Process the text - fix markdown formatting
   */
  process(text: string, _context: PostProcessContext): PostProcessResult {
    if (!text) {
      return { text: '', warnings: [], wasModified: false };
    }

    const originalText = text;
    let result = text;

    // Fix 0a: Bold markers split from their content by newlines (opening)
    // Pattern: **\n\nText:** -> **Text:**
    // e.g., "**\n\nEnable Debug Pages:**" -> "**Enable Debug Pages:**"
    result = result.replace(/\*\*\s*\n+\s*([^*\n]+):\*\*/g, '**$1:**');

    // Fix 0b: Bold markers split from content (without trailing colon)
    // Pattern: **\n\nText** -> **Text**
    result = result.replace(/\*\*\s*\n+\s*([^*\n]+)\*\*/g, '**$1**');

    // Fix 0c: Orphaned ** at start of line followed by content with closing **
    // Pattern: "- **\n\nCommission**:" -> "- **Commission**:"
    result = result.replace(/(-\s*)\*\*\s*\n+\s*([^*\n]+)\*\*(:?)/g, '$1**$2**$3');

    // Fix 0d: Bold with extra newlines before closing colon
    // Pattern: "**Text**\n\n:" -> "**Text:**"
    result = result.replace(/\*\*([^*]+)\*\*\s*\n+\s*:/g, '**$1:**');

    // Fix 0e: Standalone ** followed by newlines then text ending with :**
    // Pattern: "**\n\nCause:**" -> "**Cause:**"
    // Also handles mid-sentence: ". **\n\nSolution:**" -> ". **Solution:**"
    // Run multiple passes to catch all occurrences
    let prevResult = '';
    while (prevResult !== result) {
      prevResult = result;
      // Match ** followed by newlines, then word characters, then :**
      result = result.replace(/\*\*[\s\n]+([A-Za-z][A-Za-z0-9\s]*):\*\*/g, '**$1:**');
    }

    // Fix 0f: Run the fix 0a again to catch any remaining patterns after other fixes
    result = result.replace(/\*\*\s*\n+\s*([^*\n]+):\*\*/g, '**$1:**');

    // Fix 0g: Backtick-enclosed words broken across lines
    // Pattern: `Shadow\nValidator` -> `ShadowValidator`
    // e.g., "Troubleshooting `Shadow\nValidator` Standby" -> "Troubleshooting `ShadowValidator` Standby"
    result = result.replace(/`([A-Za-z]+)\n+([A-Za-z]+)`/g, '`$1$2`');

    // Fix 0h: REMOVED - was too aggressive and stripped legitimate newlines

    // Fix 0i: Simpler approach for known broken compound words
    // Direct replacements for common patterns where LLM inserts newlines mid-word
    result = result.replace(/Mac\s*\n\s*OS/g, 'MacOS');
    // Generic compound word fixes (add domain-specific terms as needed)
    result = result.replace(/Java\s*\n\s*Script/g, 'JavaScript');
    result = result.replace(/Git\s*\n\s*Hub/g, 'GitHub');
    result = result.replace(/Type\s*\n\s*Script/g, 'TypeScript');

    // Fix 0j: Remove space after opening bold/italic markers
    // e.g., "** Check indexer logs**" -> "**Check indexer logs**"
    // Only match at start of line or after whitespace (opening markers, not closing)
    result = result.replace(/(^|[\s(])\*{2,3}[ \t]+(\S)/gm, (match, before, after) => {
      // Reconstruct: keep the prefix, asterisks (from match), remove space, keep first char
      const asterisks = match.slice(before.length).replace(/[ \t]+\S$/, '');
      return before + asterisks + after;
    });

    // Fix 1a: Add line break after markdown headers that run into text
    // e.g., "## ConsiderationsThe text" -> "## Considerations\n\nThe text"
    //
    // Key insight: Only split when the uppercase word is a SENTENCE STARTER.
    // This distinguishes formatting errors from valid CamelCase identifiers:
    // - "## ConsiderationsThe text" → split ("The" is sentence starter)
    // - "## JavaScript runtime" → no split ("Script" is not sentence starter)
    // - "## RocksDB internals" → no split (pattern requires lowercase after uppercase)
    //
    // Uses callback replace for safety (avoids manual index slicing)
    result = result
      .split('\n')
      .map((line) => {
        // Only process header lines
        if (!/^#{1,6}\s/.test(line)) {
          return line;
        }

        // Find ALL CamelCase boundaries and split at sentence starters
        // Pattern: lowercase followed by uppercase+lowercase (potential word start)
        return line.replace(/([a-z])([A-Z][a-z]+)/g, (match, lower, upper) => {
          if (isSentenceStarter(upper)) {
            return `${lower}\n\n${upper}`;
          }
          return match;
        });
      })
      .join('\n');

    // === Apply code masking early to protect code blocks from all content-altering fixes ===
    const masked = maskCodeSegments(result);

    // Fix 1b: Add line break after bold/italic headers that run into text
    // e.g., "***Title***Cause:" -> "***Title***\n\nCause:"
    // Only split when followed by a sentence starter
    // Note: [^\s*\d] excludes digits to prevent matching "**1. **Stop" as bold text
    masked.text = masked.text.replace(
      /(\*{2,3}[^\s*\d][^*\n]*?\*{2,3})([A-Z][a-z]+)/g,
      (match, bold, upper) => {
        if (isSentenceStarter(upper)) {
          return `${bold}\n\n${upper}`;
        }
        return match;
      }
    );

    // Fix 1c: Add line break after bold headers ending with colon that run into text
    // e.g., "**Title:**While" -> "**Title:**\n\nWhile"
    // Colons indicate content follows, so always split (more aggressive than 1b)
    // Note: [^\s*\d] excludes digits to prevent matching "**1. **Stop" as bold text
    masked.text = masked.text.replace(/(\*{2,3}[^\s*\d][^*\n]*?:\*{2,3})([A-Z])/g, '$1\n\n$2');

    // Fix 1d: Add line break after admonition syntax running into text
    // e.g., ":::note Title:::For macOS" -> ":::note Title:::\n\nFor macOS"
    // Only split when followed by a sentence starter
    masked.text = masked.text.replace(
      /(:::[a-z]+[^:]*:::)([A-Z][a-z]+)/gi,
      (match, admonition, upper) => {
        if (isSentenceStarter(upper)) {
          return `${admonition}\n\n${upper}`;
        }
        return match;
      }
    );

    // Fix 1e: Add line break after common section titles running into text
    // e.g., "TroubleshootingIf you" -> "Troubleshooting\n\nIf you"
    // Only split when followed by a sentence starter
    masked.text = masked.text.replace(
      /\b(Troubleshooting|Overview|Prerequisites|Installation|Configuration|Usage|Examples?|Summary|Conclusion|Introduction|Background|Requirements|Setup|Notes?|Tips?|Warnings?|Errors?|Solutions?|Steps|Instructions)([A-Z][a-z]+)/g,
      (match, title, upper) => {
        if (isSentenceStarter(upper)) {
          return `${title}\n\n${upper}`;
        }
        return match;
      }
    );

    // Fix 2: Add line break after labels at the very start of content
    // e.g., "Cause: These errors..." -> "Cause:\n\nThese errors..."
    // Negative lookahead prevents matching when followed by inline code or code placeholder
    masked.text = masked.text.replace(
      /^((?:Cause|Solution|Note|Warning|Important|Example)):[ \t]+(?!`|__)(\S)/gi,
      '$1:\n\n$2'
    );

    // Fix 2b: Handle labels with no space after colon at start
    // e.g., "Cause:The errors..." -> "Cause:\n\nThe errors..."
    masked.text = masked.text.replace(
      /^((?:Cause|Solution|Note|Warning|Important|Example)):([A-Z])/gim,
      '$1:\n\n$2'
    );

    // Fix 3: Add line breaks around labels that follow sentence endings
    // e.g., "corrupt state.Solution:1." -> "corrupt state.\n\nSolution:\n\n1."
    // Also handles numbered labels like "Solution 1:" or "Cause 2:"
    // Note: space after punctuation is optional since LLM often omits it
    // Negative lookahead prevents matching when followed by inline code or code placeholder
    masked.text = masked.text.replace(
      /([.!?])[ \t]*((?:Cause|Solution|Note|Warning|Important|Example)(?:\s*\d+)?):[ \t]*(?!`|__)(\S)/gi,
      '$1\n\n$2:\n\n$3'
    );

    // Fix 3b: Handle labels directly after punctuation (no space)
    // e.g., "occur.Solution:" -> "occur.\n\nSolution:"
    // Also handles "occur.Solution 1:" -> "occur.\n\nSolution 1:"
    // Negative lookahead prevents matching when followed by inline code or code placeholder
    masked.text = masked.text.replace(
      /([.!?])((?:Cause|Solution|Note|Warning|Important|Example)(?:\s*\d+)?):(?!`|__)(\S)/gi,
      '$1\n\n$2:\n\n$3'
    );

    // Fix 3c: Handle labels after colon (not just .!?)
    // e.g., "following:Cause:" -> "following:\n\nCause:"
    // Negative lookahead prevents matching when followed by inline code or code placeholder
    masked.text = masked.text.replace(
      /(:)((?:Cause|Solution|Note|Warning|Important|Example)(?:\s*\d+)?):[ \t]*(?!`|__)(\S)/gi,
      '$1\n\n$2:\n\n$3'
    );

    // Fix 4: Sentence run-on after period (missing space)
    // e.g., "SomeWord.Please refer" -> "SomeWord. Please refer"
    // Only when followed by allowlisted sentence boundary starter + word boundary
    // Guard: requires lowercase before period (excludes versions like 1.0.0)
    masked.text = masked.text.replace(/([a-z])\.([A-Z][a-z]+)\b/g, (match, prevChar, nextWord) => {
      if (isSentenceBoundaryStarter(nextWord)) {
        return `${prevChar}. ${nextWord}`;
      }
      return match;
    });

    // Fix 5: Missing space after markdown link
    // e.g., "](url)This" -> "](url) This"
    // Uses lookahead to insert space when link is followed by word-starting char
    masked.text = masked.text.replace(/(\]\([^)]+\))(?=[A-Za-z0-9("'"])/g, '$1 ');

    // Fix 6: Period before bold (missing space)
    // e.g., "available.**As of" -> "available. **As of"
    // Guard: lowercase letter before period to avoid list items like "1.**Bold**"
    masked.text = masked.text.replace(/([a-z])\.(\*{2,3}[A-Z])/g, '$1. $2');

    // Fix 6b: Escaped double quotes from CSV/JSON serialization
    // e.g., '""archive""' -> '"archive"'
    // Run on masked text to avoid modifying code blocks
    masked.text = masked.text.replace(/""/g, '"');

    // Restore code segments
    result = unmaskCodeSegments(masked);

    // Fix 7: Trailing separator garbage (end of text only)
    // e.g., "content\n========" -> "content"
    // Only at end to preserve setext headings mid-document
    result = result.replace(/\n*={4,}\n*$/g, '');

    // Fix 8: Clean up excessive newlines (more than 2 consecutive)
    result = result.replace(/\n{3,}/g, '\n\n');

    // Fix 9: Trim trailing whitespace on lines
    result = result
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n');

    const wasModified = result !== originalText;

    return {
      text: result,
      warnings: [],
      wasModified,
    };
  }
}

// Export for testing
export {
  isSentenceStarter,
  isSentenceBoundaryStarter,
  SENTENCE_STARTERS,
  SENTENCE_BOUNDARY_STARTERS,
};
