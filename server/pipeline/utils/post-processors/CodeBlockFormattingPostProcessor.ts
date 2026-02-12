/**
 * Code Block Formatting Post-Processor
 *
 * Fixes formatting issues INSIDE code blocks:
 * - CLI commands concatenated on single line
 * - Random "O" characters between commands (encoding corruption)
 * - JSON that should be multi-line
 *
 * Unlike other post-processors that mask code blocks, this one
 * specifically targets code block content.
 *

 * @created 2026-01-07
 */

import { BasePostProcessor, PostProcessResult, PostProcessContext } from './types.js';

/**
 * Known CLI command prefixes that indicate the start of a new command
 */
const CLI_COMMANDS = [
  'curl',
  'echo',
  'cat',
  'grep',
  'awk',
  'sed',
  'cd',
  'ls',
  'mkdir',
  'rm',
  'cp',
  'mv',
  'chmod',
  'chown',
  'sudo',
  'apt',
  'yum',
  'npm',
  'yarn',
  'pnpm',
  'node',
  'python',
  'pip',
  'docker',
  'git',
  'ssh',
  'scp',
  'wget',
  'tar',
  'unzip',
  'systemctl',
  'service',
  'journalctl',
  'export',
  'source',
  'bash',
  'sh',
  'zsh',
];

/**
 * Code Block Formatting Post-Processor
 */
export class CodeBlockFormattingPostProcessor extends BasePostProcessor {
  readonly name = 'code-block-formatting';
  readonly description = 'Fixes formatting issues inside code blocks like concatenated commands';

  /**
   * Process all file types (code blocks can appear anywhere)
   */
  shouldProcess(_context: PostProcessContext): boolean {
    return true;
  }

  /**
   * Process the text - fix code block formatting
   */
  process(text: string, _context: PostProcessContext): PostProcessResult {
    if (!text) {
      return { text: '', warnings: [], wasModified: false };
    }

    const originalText = text;
    let result = text;

    // Process fenced code blocks
    result = result.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, content) => {
      let processedContent = content;

      // Only process bash/shell code blocks for command splitting
      const isShellBlock =
        !lang || lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === 'console';

      if (isShellBlock) {
        processedContent = this.splitConcatenatedCommands(processedContent);
        processedContent = this.fixRandomOCharacters(processedContent);
      }

      // Process JSON code blocks for formatting
      if (lang === 'json') {
        processedContent = this.formatJson(processedContent);
      }

      return '```' + lang + '\n' + processedContent + '```';
    });

    const wasModified = result !== originalText;

    return {
      text: result,
      warnings: [],
      wasModified,
    };
  }

  /**
   * Split concatenated CLI commands onto separate lines
   * e.g., "curl http://api echo done" -> "curl http://api\necho done"
   */
  private splitConcatenatedCommands(content: string): string {
    let result = content;

    // Process each line
    result = result
      .split('\n')
      .map((line) => {
        // Skip empty lines or lines that are just whitespace
        if (!line.trim()) return line;

        // Find positions where commands start mid-line
        let processedLine = line;

        for (const cmd of CLI_COMMANDS) {
          // Pattern: word or closing quote/paren, then space, then command
          // This avoids splitting at the start of a line
          const pattern = new RegExp(`(\\S)\\s+(${cmd})\\s+`, 'g');

          processedLine = processedLine.replace(pattern, (match, prevChar, command) => {
            // Don't split if previous char is a pipe or semicolon (valid command chaining)
            if (prevChar === '|' || prevChar === ';' || prevChar === '&') {
              return match;
            }
            // Don't split if this is an argument to another command (like `grep foo`)
            // Check if the previous content looks like a command with this as an argument
            // This is a heuristic - we split when the previous char looks like end of command output
            if (
              prevChar === "'" ||
              prevChar === '"' ||
              prevChar === ')' ||
              /[a-z0-9_-]$/i.test(prevChar)
            ) {
              // Check if this looks like a standalone command (followed by typical command args)
              return `${prevChar}\n${command} `;
            }
            return match;
          });
        }

        return processedLine;
      })
      .join('\n');

    return result;
  }

  /**
   * Fix random "O" characters that appear between commands
   * This is likely an encoding corruption where newlines become "O"
   * Pattern: command_outputO command_start -> command_output\ncommand_start
   */
  private fixRandomOCharacters(content: string): string {
    let result = content;

    for (const cmd of CLI_COMMANDS) {
      // Pattern: wordO followed by a command
      // The "O" is likely a corrupted newline
      const pattern = new RegExp(`([a-z0-9_\\-])O\\s*(${cmd})\\s`, 'gi');
      result = result.replace(pattern, `$1\n$2 `);
    }

    return result;
  }

  /**
   * Format single-line JSON to be multi-line for readability
   */
  private formatJson(content: string): string {
    const trimmed = content.trim();

    // Only process if it looks like a single-line JSON object/array
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return content;
    }

    // Check if it's already multi-line
    if (trimmed.includes('\n')) {
      return content;
    }

    try {
      const parsed = JSON.parse(trimmed);
      const formatted = JSON.stringify(parsed, null, 2);
      // Preserve original leading/trailing whitespace pattern
      const leadingSpace = content.match(/^\s*/)?.[0] || '';
      const trailingSpace = content.match(/\s*$/)?.[0] || '';
      return leadingSpace + formatted + trailingSpace;
    } catch {
      // If JSON parsing fails, return original content
      return content;
    }
  }
}
