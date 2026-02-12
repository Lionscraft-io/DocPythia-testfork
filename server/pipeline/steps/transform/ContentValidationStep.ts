/**
 * Content Validation Step
 *
 * Validates file content format and uses LLM to reformat on failure.
 * Supports markdown, yaml, json, and other file types.
 *

 * @created 2026-01-07
 */

import { z } from 'zod';
import { BasePipelineStep } from '../base/BasePipelineStep.js';
import {
  StepType,
  type StepConfig,
  type StepMetadata,
  type PipelineContext,
  type Proposal,
  type ILLMHandler,
} from '../../core/interfaces.js';
import yaml from 'js-yaml';

/**
 * Configuration for ContentValidationStep
 */
interface ContentValidationConfig {
  maxRetries?: number;
  promptId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Skip validation for certain file patterns */
  skipPatterns?: string[];
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  error?: string;
  fileType: string;
}

/**
 * LLM response schema for content reformatting
 */
const ReformatResponseSchema = z.object({
  reformattedContent: z.string(),
  changesDescription: z.string().optional(),
});

type ReformatResponse = z.infer<typeof ReformatResponseSchema>;

/**
 * Validates file content and uses LLM to reformat on failure
 */
export class ContentValidationStep extends BasePipelineStep {
  readonly stepType = StepType.VALIDATE;

  private maxRetries: number;
  private promptId: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private skipPatterns: RegExp[];

  constructor(config: StepConfig, llmHandler: ILLMHandler) {
    super(config, llmHandler);

    const validationConfig = config.config as ContentValidationConfig;
    this.maxRetries = validationConfig.maxRetries ?? 2;
    this.promptId = validationConfig.promptId || 'content-reformat';
    this.model = validationConfig.model || 'gemini-2.5-flash';
    this.temperature = validationConfig.temperature ?? 0.2;
    this.maxTokens = validationConfig.maxTokens ?? 8192;
    this.skipPatterns = (validationConfig.skipPatterns || []).map((p) => new RegExp(p, 'i'));
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();
    const llmHandler = this.requireLLMHandler();

    let validatedCount = 0;
    let reformattedCount = 0;
    let failedCount = 0;

    // Process each thread's proposals
    for (const [threadId, proposals] of context.proposals) {
      const validatedProposals: Proposal[] = [];

      for (const proposal of proposals) {
        // Skip proposals without content or DELETE/NONE types
        if (
          !proposal.suggestedText ||
          proposal.updateType === 'DELETE' ||
          proposal.updateType === 'NONE'
        ) {
          validatedProposals.push(proposal);
          continue;
        }

        // Skip if matches skip patterns
        if (this.shouldSkip(proposal.page)) {
          this.logger.debug(`Skipping validation for ${proposal.page} (matches skip pattern)`);
          validatedProposals.push(proposal);
          continue;
        }

        const fileType = this.getFileType(proposal.page);
        const validated = await this.validateAndReformat(proposal, fileType, llmHandler, context);

        validatedProposals.push(validated.proposal);
        validatedCount++;

        if (validated.wasReformatted) {
          reformattedCount++;
        }
        if (validated.failed) {
          failedCount++;
        }
      }

      context.proposals.set(threadId, validatedProposals);
    }

    this.recordTiming(context, startTime);

    this.logger.info(
      `Content validation complete: ${validatedCount} validated, ${reformattedCount} reformatted, ${failedCount} failed`
    );

    return context;
  }

  /**
   * Check if a file path matches skip patterns
   */
  private shouldSkip(filePath: string): boolean {
    return this.skipPatterns.some((pattern) => pattern.test(filePath));
  }

  /**
   * Determine file type from path
   */
  private getFileType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';

    switch (ext) {
      case 'md':
      case 'mdx':
        return 'markdown';
      case 'yaml':
      case 'yml':
        return 'yaml';
      case 'json':
        return 'json';
      case 'html':
      case 'htm':
        return 'html';
      case 'xml':
        return 'xml';
      case 'txt':
        return 'text';
      default:
        // Check if content looks like markdown
        return 'markdown';
    }
  }

  /**
   * Validate content and reformat if needed
   */
  private async validateAndReformat(
    proposal: Proposal,
    fileType: string,
    llmHandler: ILLMHandler,
    context: PipelineContext
  ): Promise<{ proposal: Proposal; wasReformatted: boolean; failed: boolean }> {
    let content = proposal.suggestedText!;
    let lastError: string | undefined;
    let wasReformatted = false;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const validation = this.validateContent(content, fileType);

      if (validation.valid) {
        return {
          proposal: {
            ...proposal,
            suggestedText: content,
            warnings: wasReformatted
              ? [...(proposal.warnings || []), 'Content was reformatted by LLM']
              : proposal.warnings,
          },
          wasReformatted,
          failed: false,
        };
      }

      lastError = validation.error;

      // If we haven't exceeded max retries, try reformatting
      if (attempt < this.maxRetries) {
        this.logger.debug(
          `Validation failed for ${proposal.page} (attempt ${attempt + 1}/${this.maxRetries + 1}): ${validation.error}`
        );

        try {
          content = await this.reformatWithLLM(
            content,
            fileType,
            validation.error || 'Invalid format',
            llmHandler,
            context
          );
          wasReformatted = true;
        } catch (error) {
          this.logger.error(`LLM reformat failed for ${proposal.page}:`, error);
          break;
        }
      }
    }

    // Max retries exceeded - return with validation error warning
    this.logger.warn(
      `Content validation failed for ${proposal.page} after ${this.maxRetries + 1} attempts: ${lastError}`
    );

    return {
      proposal: {
        ...proposal,
        warnings: [
          ...(proposal.warnings || []),
          `Validation failed after ${this.maxRetries + 1} attempts: ${lastError}`,
        ],
      },
      wasReformatted,
      failed: true,
    };
  }

  /**
   * Validate content based on file type
   */
  private validateContent(content: string, fileType: string): ValidationResult {
    switch (fileType) {
      case 'markdown':
        return this.validateMarkdown(content);
      case 'yaml':
        return this.validateYaml(content);
      case 'json':
        return this.validateJson(content);
      case 'html':
      case 'xml':
        return this.validateXml(content, fileType);
      default:
        return { valid: true, fileType };
    }
  }

  /**
   * Validate markdown content
   */
  private validateMarkdown(content: string): ValidationResult {
    const errors: string[] = [];

    // Check for unbalanced code blocks
    const codeBlockMatches = content.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
      errors.push('Unbalanced code blocks (odd number of ``` markers)');
    }

    // Check for unbalanced inline code
    const inlineCodeCount = (content.match(/(?<!\\)`(?!``)/g) || []).length;
    if (inlineCodeCount % 2 !== 0) {
      // More sophisticated check - mask fenced blocks first
      const withoutFenced = content.replace(/```[\s\S]*?```/g, '');
      const cleanInlineCount = (withoutFenced.match(/(?<!\\)`/g) || []).length;
      if (cleanInlineCount % 2 !== 0) {
        errors.push('Unbalanced inline code markers');
      }
    }

    // Check for broken links (obvious cases)
    const brokenLinks = content.match(/\]\([^)]*$/gm);
    if (brokenLinks) {
      errors.push('Incomplete markdown links detected');
    }

    // Check for broken bold/italic markers
    const boldItalicPattern = /\*{1,3}[^*\n]{1,200}\*{1,3}/g;
    const allBoldItalic = content.match(boldItalicPattern) || [];
    for (const match of allBoldItalic) {
      const starts = (match.match(/^\*+/) || [''])[0].length;
      const ends = (match.match(/\*+$/) || [''])[0].length;
      if (starts !== ends) {
        errors.push('Unbalanced bold/italic markers');
        break;
      }
    }

    // === Semantic markdown checks ===
    // These catch "technically valid" markdown that is semantically broken

    // Check for overly long headings (likely concatenated with paragraph text)
    // e.g., "## Sync info pageDisplays a page with tracked shards..."
    const headingPattern = /^(#{1,6})\s+(.+)$/gm;
    let headingMatch;
    while ((headingMatch = headingPattern.exec(content)) !== null) {
      const headingText = headingMatch[2];
      const wordCount = headingText.split(/\s+/).length;

      // Headings with more than 6 words are suspicious
      if (wordCount > 6) {
        errors.push(
          `Heading too long (${wordCount} words) - may have paragraph text concatenated: "${headingText.substring(0, 50)}..."`
        );
        break; // One error is enough to trigger reformat
      }

      // Headings that contain sentence-ending punctuation followed by more text
      // e.g., "## Title. More text here" or "## Title: Description text here that goes on"
      if (/[.!?]\s+[A-Z]/.test(headingText)) {
        errors.push(
          `Heading appears to contain paragraph text (sentence break detected): "${headingText.substring(0, 50)}..."`
        );
        break;
      }

      // Headings with camelCase mid-word (e.g., "pageDisplays" - concatenated)
      // Look for lowercase followed immediately by uppercase without space
      if (/[a-z][A-Z]/.test(headingText)) {
        // Exclude common exceptions like "JavaScript", "TypeScript", "GitHub"
        const withoutExceptions = headingText.replace(
          /\b(JavaScript|TypeScript|GitHub|GitLab|LinkedIn|YouTube|iOS|macOS|PostgreSQL|MongoDB|MySQL|NoSQL|GraphQL|WebSocket|IntelliJ|PyCharm|DevOps|OAuth|FastAPI|NumPy|DataFrame|DataFrame)\b/gi,
          ''
        );
        if (/[a-z][A-Z]/.test(withoutExceptions)) {
          errors.push(
            `Heading contains possible concatenation (missing space before capital): "${headingText.substring(0, 50)}..."`
          );
          break;
        }
      }
    }

    // Check for list items or paragraph text directly after heading on same line
    // (heading should be on its own line)
    const headingWithContent = /^(#{1,6})\s+[^\n]+[a-z]\s*[-*1-9]\.\s/gm;
    if (headingWithContent.test(content)) {
      errors.push('Heading appears to have list content on the same line');
    }

    // Check for orphan table rows (table data without proper header/separator structure)
    // A valid markdown table requires: header row, separator row (|---|), then data rows
    const tableRowPattern = /^\|[^|]+\|/gm;
    const tableRows = content.match(tableRowPattern);
    if (tableRows && tableRows.length > 0) {
      // Check if there's a separator row (|---|---|) which indicates proper table structure
      const separatorPattern = /^\|[\s-:]+\|/gm;
      const hasSeparator = separatorPattern.test(content);

      if (!hasSeparator) {
        // Content has table-like rows but no separator - likely orphan rows
        errors.push(
          'Table rows detected without proper table structure (missing header/separator row). ' +
            'Tables require: header row, separator row (|---|---|), then data rows'
        );
      }
    }

    return {
      valid: errors.length === 0,
      error: errors.join('; '),
      fileType: 'markdown',
    };
  }

  /**
   * Validate YAML content
   */
  private validateYaml(content: string): ValidationResult {
    try {
      yaml.load(content);
      return { valid: true, fileType: 'yaml' };
    } catch (error) {
      return {
        valid: false,
        error: `YAML parse error: ${(error as Error).message}`,
        fileType: 'yaml',
      };
    }
  }

  /**
   * Validate JSON content
   */
  private validateJson(content: string): ValidationResult {
    try {
      JSON.parse(content);
      return { valid: true, fileType: 'json' };
    } catch (error) {
      return {
        valid: false,
        error: `JSON parse error: ${(error as Error).message}`,
        fileType: 'json',
      };
    }
  }

  /**
   * Validate XML/HTML content (basic check)
   */
  private validateXml(content: string, fileType: string): ValidationResult {
    // Basic tag balance check
    // Match open tags that don't end with /> (self-closing)
    // The negative lookbehind (?<!\/) ensures we don't match self-closing tags
    const openTags = content.match(/<[a-zA-Z][^>]*(?<!\/)\s*>/g) || [];
    const closeTags = content.match(/<\/[a-zA-Z][^>]*>/g) || [];

    // Open tags regex already excludes self-closing via lookbehind,
    // so we just compare open vs close counts directly
    if (openTags.length !== closeTags.length) {
      return {
        valid: false,
        error: `Unbalanced tags: ${openTags.length} open tags, ${closeTags.length} close tags`,
        fileType,
      };
    }

    return { valid: true, fileType };
  }

  /**
   * Use LLM to reformat content
   */
  private async reformatWithLLM(
    content: string,
    fileType: string,
    validationError: string,
    llmHandler: ILLMHandler,
    context: PipelineContext
  ): Promise<string> {
    // Try to get the prompt template, fall back to inline prompt
    let systemPrompt: string;
    let userPrompt: string;

    try {
      const rendered = context.prompts.render(this.promptId, {
        fileType,
        validationError,
        content,
      });
      systemPrompt = rendered.system;
      userPrompt = rendered.user;
    } catch {
      // Fallback to inline prompt if template not found
      systemPrompt = `You are a content formatter specializing in ${fileType} files.
Your job is to fix formatting errors in the provided content while preserving the meaning and structure.
Only fix the specific validation error mentioned - do not make unnecessary changes.
Return the corrected content without any explanation.`;

      userPrompt = `The following ${fileType} content has a validation error:

**Validation Error:** ${validationError}

**Content:**
${content}

Please fix the formatting error and return only the corrected content.`;
    }

    const { data, response } = await llmHandler.requestJSON<ReformatResponse>(
      {
        model: this.model,
        systemPrompt,
        userPrompt,
        temperature: this.temperature,
        maxTokens: this.maxTokens,
      },
      ReformatResponseSchema,
      {
        instanceId: context.instanceId,
        batchId: context.batchId,
        purpose: 'content-reformat',
      }
    );

    // Update metrics
    context.metrics.llmCalls++;
    if (response.tokensUsed) {
      context.metrics.llmTokensUsed += response.tokensUsed;
    }

    return data.reformattedContent;
  }

  validateConfig(config: StepConfig): boolean {
    if (!super.validateConfig(config)) {
      return false;
    }

    const validationConfig = config.config as ContentValidationConfig;

    if (
      validationConfig.maxRetries !== undefined &&
      (validationConfig.maxRetries < 0 || validationConfig.maxRetries > 5)
    ) {
      this.logger.error('maxRetries must be between 0 and 5');
      return false;
    }

    return true;
  }

  getMetadata(): StepMetadata {
    return {
      name: 'Content Validator',
      description: 'Validates file content format and uses LLM to reformat on failure',
      version: '1.0.0',
      author: 'system',
    };
  }
}

/**
 * Factory function for ContentValidationStep
 */
export function createContentValidationStep(
  config: StepConfig,
  llmHandler: ILLMHandler
): ContentValidationStep {
  return new ContentValidationStep(config, llmHandler);
}
