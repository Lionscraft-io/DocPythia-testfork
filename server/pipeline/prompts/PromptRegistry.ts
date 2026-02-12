/**
 * Prompt Registry
 *
 * Manages prompt templates with file-based storage, hot-reload capability,
 * and variable interpolation.
 *
 * Prompts are stored as Markdown files with YAML frontmatter:
 * - System prompt: text between "# System Prompt" and "# User Prompt"
 * - User prompt: text after "# User Prompt"
 * - Variables: {{variableName}} syntax
 *

 * @created 2025-12-30
 */

import fs from 'fs/promises';
import path from 'path';
import type {
  IPromptRegistry,
  PromptTemplate,
  RenderedPrompt,
  ValidationResult,
} from '../core/interfaces.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('PromptRegistry');

/**
 * YAML frontmatter regex
 */
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n/;

/**
 * Variable placeholder regex
 */
const VARIABLE_REGEX = /\{\{(\w+)\}\}/g;

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): {
  metadata: Record<string, unknown>;
  body: string;
} {
  const match = content.match(FRONTMATTER_REGEX);

  if (!match) {
    return { metadata: {}, body: content };
  }

  const yamlContent = match[1];
  const body = content.slice(match[0].length);

  // Simple YAML parsing (handles common cases)
  const metadata: Record<string, unknown> = {};
  const lines = yamlContent.split('\n');
  let currentKey = '';
  let inArray = false;
  let arrayValues: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Array item
    if (trimmed.startsWith('- ') && inArray) {
      arrayValues.push(trimmed.slice(2).trim());
      continue;
    }

    // End array if we hit a new key
    if (inArray && !trimmed.startsWith('-')) {
      metadata[currentKey] = arrayValues;
      inArray = false;
      arrayValues = [];
    }

    // Key-value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      if (value === '') {
        // Could be start of array or nested object
        currentKey = key;
        inArray = true;
        arrayValues = [];
      } else {
        // Simple value
        metadata[key] = value.replace(/^["']|["']$/g, ''); // Remove quotes
      }
    }
  }

  // Handle trailing array
  if (inArray && arrayValues.length > 0) {
    metadata[currentKey] = arrayValues;
  }

  return { metadata, body };
}

/**
 * Extract system and user prompts from markdown body
 */
function extractPrompts(body: string): {
  system: string;
  user: string;
} {
  const systemMatch = body.match(/# System Prompt\s*\n([\s\S]*?)(?=# User Prompt|$)/i);
  const userMatch = body.match(/# User Prompt\s*\n([\s\S]*?)$/i);

  const system = systemMatch ? systemMatch[1].trim() : '';
  const user = userMatch ? userMatch[1].trim() : '';

  // If no sections found, use entire body as user prompt
  if (!system && !user) {
    return { system: '', user: body.trim() };
  }

  return { system, user };
}

/**
 * Parse a markdown prompt file into a PromptTemplate
 */
function parsePromptFile(content: string, promptId: string): PromptTemplate | null {
  try {
    const { metadata, body } = parseFrontmatter(content);
    const { system, user } = extractPrompts(body);

    // Extract metadata fields
    const meta = metadata.metadata as Record<string, unknown> | undefined;

    const template: PromptTemplate = {
      id: (metadata.id as string) || promptId,
      version: (metadata.version as string) || '1.0.0',
      metadata: {
        author: meta?.author as string | undefined,
        description: (meta?.description as string) || '',
        requiredVariables: (meta?.requiredVariables as string[]) || [],
        tags: (meta?.tags as string[]) || [],
      },
      system,
      user,
    };

    return template;
  } catch (error) {
    logger.error(`Failed to parse prompt file ${promptId}:`, error);
    return null;
  }
}

/**
 * Render a template string with variables
 */
function renderTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(VARIABLE_REGEX, (match, varName) => {
    const value = variables[varName];
    if (value === undefined) {
      logger.warn(`Variable {{${varName}}} not provided, leaving placeholder`);
      return match;
    }
    return String(value);
  });
}

/**
 * File-based Prompt Registry implementation
 */
export class PromptRegistry implements IPromptRegistry {
  private templates: Map<string, PromptTemplate> = new Map();
  private defaultsPath: string;
  private instancePath: string | null;
  private loaded = false;

  /**
   * Create a new PromptRegistry
   * @param defaultsPath - Path to default prompts directory
   * @param instancePath - Optional path to instance-specific prompts (overrides defaults)
   */
  constructor(defaultsPath: string, instancePath?: string) {
    this.defaultsPath = defaultsPath;
    this.instancePath = instancePath || null;
  }

  /**
   * Load prompts from filesystem
   */
  async load(): Promise<void> {
    this.templates.clear();

    // Load defaults first
    await this.loadFromDirectory(this.defaultsPath);

    // Override with instance-specific prompts
    if (this.instancePath) {
      await this.loadFromDirectory(this.instancePath);
    }

    this.loaded = true;
    logger.info(`Loaded ${this.templates.size} prompt templates`);
  }

  /**
   * Load prompts from a directory
   */
  private async loadFromDirectory(dirPath: string): Promise<void> {
    try {
      const files = await fs.readdir(dirPath);

      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const promptId = file.replace('.md', '');
        const filePath = path.join(dirPath, file);
        const content = await fs.readFile(filePath, 'utf-8');

        const template = parsePromptFile(content, promptId);
        if (template) {
          this.templates.set(template.id, template);
          logger.debug(`Loaded prompt: ${template.id} from ${dirPath}`);
        }
      }
    } catch (error) {
      // Directory may not exist, that's OK
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`Failed to load prompts from ${dirPath}:`, error);
      }
    }
  }

  /**
   * Get prompt template by ID
   */
  get(promptId: string): PromptTemplate | null {
    if (!this.loaded) {
      logger.warn('PromptRegistry not loaded, call load() first');
    }
    return this.templates.get(promptId) || null;
  }

  /**
   * Get rendered prompt with variables filled
   */
  render(promptId: string, variables: Record<string, unknown>): RenderedPrompt {
    const template = this.get(promptId);

    if (!template) {
      throw new Error(`Prompt template not found: ${promptId}`);
    }

    // Validate required variables
    const missing = template.metadata.requiredVariables.filter((v) => variables[v] === undefined);
    if (missing.length > 0) {
      logger.warn(`Missing required variables for ${promptId}: ${missing.join(', ')}`);
    }

    return {
      system: renderTemplate(template.system, variables),
      user: renderTemplate(template.user, variables),
      variables,
    };
  }

  /**
   * List all available prompts
   */
  list(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Reload prompts from storage (hot-reload)
   */
  async reload(): Promise<void> {
    logger.info('Reloading prompt templates...');
    await this.load();
  }

  /**
   * Validate prompt template
   */
  validate(template: PromptTemplate): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!template.id) {
      errors.push('Template missing id');
    }
    if (!template.user) {
      errors.push('Template missing user prompt');
    }

    // Check for undefined variables in template
    const systemVars = (template.system.match(VARIABLE_REGEX) || []).map((m) => m.slice(2, -2));
    const userVars = (template.user.match(VARIABLE_REGEX) || []).map((m) => m.slice(2, -2));
    const allVars = [...new Set([...systemVars, ...userVars])];

    const declaredVars = template.metadata.requiredVariables || [];
    const undeclared = allVars.filter((v) => !declaredVars.includes(v));

    if (undeclared.length > 0) {
      warnings.push(`Variables used but not declared in metadata: ${undeclared.join(', ')}`);
    }

    const unused = declaredVars.filter((v) => !allVars.includes(v));
    if (unused.length > 0) {
      warnings.push(`Variables declared but not used: ${unused.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Add a prompt template programmatically (useful for testing)
   */
  addTemplate(template: PromptTemplate): void {
    this.templates.set(template.id, template);
  }
}

/**
 * Create a PromptRegistry for an instance
 */
export function createPromptRegistry(configBasePath: string, instanceId?: string): PromptRegistry {
  const defaultsPath = path.join(configBasePath, 'defaults', 'prompts');
  const instancePath = instanceId ? path.join(configBasePath, instanceId, 'prompts') : undefined;

  return new PromptRegistry(defaultsPath, instancePath);
}
