/**
 * Domain Configuration Loader
 *
 * Loads and validates domain configurations from JSON files.
 * Supports defaults with instance-specific overrides.
 *

 * @created 2025-12-30
 */

import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import type { IDomainConfig } from '../core/interfaces.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('DomainConfigLoader');

/**
 * Zod schema for domain configuration validation
 */
const CategoryDefinitionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  priority: z.number().min(0).max(100),
  examples: z.array(z.string()).optional(),
});

const KeywordFilterSchema = z.object({
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  caseSensitive: z.boolean().optional(),
});

const PathFilterSchema = z.object({
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const SecurityConfigSchema = z.object({
  blockPatterns: z.array(z.string()).optional(),
  requireApproval: z.boolean().optional(),
  maxProposalsPerBatch: z.number().positive().optional(),
});

const DomainContextSchema = z.object({
  projectName: z.string(),
  domain: z.string(),
  targetAudience: z.string(),
  documentationPurpose: z.string(),
});

export const DomainConfigSchema = z.object({
  domainId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  categories: z.array(CategoryDefinitionSchema).min(1),
  keywords: KeywordFilterSchema.nullable().optional(),
  ragPaths: PathFilterSchema.optional(),
  security: SecurityConfigSchema.optional(),
  context: DomainContextSchema,
});

/**
 * Default domain configuration
 */
const DEFAULT_DOMAIN_CONFIG: IDomainConfig = {
  domainId: 'generic',
  name: 'Generic Documentation',
  description: 'Default configuration for general-purpose documentation analysis',
  categories: [
    {
      id: 'troubleshooting',
      label: 'Troubleshooting',
      description: 'Users solving problems',
      priority: 90,
    },
    {
      id: 'question',
      label: 'Question',
      description: 'Users asking how to do something',
      priority: 85,
    },
    {
      id: 'information',
      label: 'Information',
      description: 'Users sharing knowledge/updates',
      priority: 80,
    },
    {
      id: 'update',
      label: 'Update',
      description: 'Technology changes or announcements',
      priority: 75,
    },
    {
      id: 'no-doc-value',
      label: 'No Documentation Value',
      description: 'No documentation value',
      priority: 0,
    },
  ],
  keywords: null,
  ragPaths: {
    exclude: ['i18n/**'],
  },
  security: {
    blockPatterns: ['private[_\\s]?key', 'secret[_\\s]?token'],
    requireApproval: false,
    maxProposalsPerBatch: 100,
  },
  context: {
    projectName: 'Documentation',
    domain: 'General',
    targetAudience: 'All users',
    documentationPurpose: 'Provide comprehensive technical documentation',
  },
};

/**
 * Cache for loaded domain configurations
 */
const configCache = new Map<string, { config: IDomainConfig; loadedAt: number }>();
const CACHE_TTL_MS = 3600000; // 1 hour

/**
 * Load a domain configuration file
 */
async function loadConfigFile(filePath: string): Promise<IDomainConfig | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = DomainConfigSchema.parse(parsed);
    return validated as IDomainConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    logger.error(`Failed to load domain config from ${filePath}:`, error);
    throw error;
  }
}

/**
 * Deep merge two domain configurations (instance overrides defaults)
 */
function mergeConfigs(defaults: IDomainConfig, overrides: Partial<IDomainConfig>): IDomainConfig {
  return {
    ...defaults,
    ...overrides,
    categories: overrides.categories || defaults.categories,
    keywords: overrides.keywords !== undefined ? overrides.keywords : defaults.keywords,
    ragPaths: overrides.ragPaths
      ? { ...defaults.ragPaths, ...overrides.ragPaths }
      : defaults.ragPaths,
    security: overrides.security
      ? { ...defaults.security, ...overrides.security }
      : defaults.security,
    context: overrides.context ? { ...defaults.context, ...overrides.context } : defaults.context,
  };
}

/**
 * Load domain configuration for an instance
 *
 * @param configBasePath - Base path for config files
 * @param instanceId - Instance identifier
 * @param domainId - Optional specific domain ID (defaults to 'generic' or instance default)
 */
export async function loadDomainConfig(
  configBasePath: string,
  instanceId: string,
  domainId?: string
): Promise<IDomainConfig> {
  const cacheKey = `${instanceId}:${domainId || 'default'}`;

  // Check cache
  const cached = configCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    logger.debug(`Using cached domain config: ${cacheKey}`);
    return cached.config;
  }

  logger.info(`Loading domain config for ${instanceId}`, { domainId });

  // Load default config
  const defaultPath = path.join(configBasePath, 'defaults', 'domains', 'generic.json');
  let config = (await loadConfigFile(defaultPath)) || DEFAULT_DOMAIN_CONFIG;

  // Load instance-specific config
  const instanceDomainId = domainId || 'default';
  const instancePath = path.join(configBasePath, instanceId, 'domains', `${instanceDomainId}.json`);

  const instanceConfig = await loadConfigFile(instancePath);
  if (instanceConfig) {
    config = mergeConfigs(config, instanceConfig);
    logger.debug(`Applied instance domain config: ${instancePath}`);
  }

  // Cache the result
  configCache.set(cacheKey, { config, loadedAt: Date.now() });

  return config;
}

/**
 * Clear the domain configuration cache
 */
export function clearDomainConfigCache(): void {
  configCache.clear();
  logger.info('Domain config cache cleared');
}

/**
 * Validate a domain configuration object
 */
export function validateDomainConfig(config: unknown): { valid: boolean; errors: string[] } {
  const result = DomainConfigSchema.safeParse(config);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
  return { valid: false, errors };
}

/**
 * Get all available domain configurations for an instance
 */
export async function listDomainConfigs(
  configBasePath: string,
  instanceId: string
): Promise<string[]> {
  const domains: string[] = [];

  // List default domains
  const defaultsDir = path.join(configBasePath, 'defaults', 'domains');
  try {
    const defaultFiles = await fs.readdir(defaultsDir);
    domains.push(
      ...defaultFiles.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
    );
  } catch {
    // Directory may not exist
  }

  // List instance domains
  const instanceDir = path.join(configBasePath, instanceId, 'domains');
  try {
    const instanceFiles = await fs.readdir(instanceDir);
    domains.push(
      ...instanceFiles.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
    );
  } catch {
    // Directory may not exist
  }

  return [...new Set(domains)];
}
