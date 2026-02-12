/**
 * Pipeline Configuration Loader
 *
 * Loads and validates pipeline configurations from JSON files.
 * Supports defaults with instance-specific overrides.
 * Now supports S3 loading for production deployments.
 *

 * @created 2025-12-30
 * @updated 2026-01-07 - Added S3 storage support
 */

import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { StepType, type PipelineConfig } from '../core/interfaces.js';
import { createLogger } from '../../utils/logger.js';
import { s3Storage } from '../../storage/s3-client.js';

const logger = createLogger('PipelineConfigLoader');

/**
 * Zod schema for step configuration
 */
const StepConfigSchema = z.object({
  stepId: z.string().min(1),
  stepType: z.nativeEnum(StepType),
  enabled: z.boolean(),
  config: z.record(z.unknown()),
});

/**
 * Zod schema for error handling configuration
 */
const ErrorHandlingConfigSchema = z.object({
  stopOnError: z.boolean(),
  retryAttempts: z.number().min(0).max(10),
  retryDelayMs: z.number().min(0),
});

/**
 * Zod schema for performance configuration
 */
const PerformanceConfigSchema = z.object({
  maxConcurrentSteps: z.number().min(1).max(10),
  timeoutMs: z.number().min(1000),
  enableCaching: z.boolean(),
});

/**
 * Zod schema for full pipeline configuration
 */
export const PipelineConfigSchema = z.object({
  instanceId: z.string().min(1),
  pipelineId: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(StepConfigSchema).min(1),
  errorHandling: ErrorHandlingConfigSchema,
  performance: PerformanceConfigSchema,
});

/**
 * Check if S3 storage should be used for configs
 */
function shouldUseS3(): boolean {
  return process.env.CONFIG_SOURCE === 's3' && s3Storage.isEnabled();
}

/**
 * Load pipeline configuration from S3
 */
async function loadConfigFromS3(
  instanceId: string,
  pipelineId: string
): Promise<PipelineConfig | null> {
  const prefix = process.env.CONFIG_S3_PREFIX || 'configs/';
  const s3Key = `${prefix}${instanceId}/pipelines/${pipelineId}.json`;

  try {
    const config = await s3Storage.getJson<PipelineConfig>(s3Key);
    if (config) {
      const validated = PipelineConfigSchema.parse(config);
      logger.info(`Loaded pipeline config from S3: ${s3Key}`);
      return validated as PipelineConfig;
    }
    return null;
  } catch (error) {
    if (
      (error as Error).message?.includes('NoSuchKey') ||
      (error as Error).message?.includes('not found')
    ) {
      logger.debug(`No pipeline config in S3: ${s3Key}`);
      return null;
    }
    logger.warn(`Failed to load pipeline config from S3 (${s3Key}):`, error);
    return null;
  }
}

/**
 * Default pipeline configuration
 */
const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  instanceId: 'default',
  pipelineId: 'default-v1',
  description: 'Default documentation analysis pipeline',
  steps: [
    {
      stepId: 'keyword-filter',
      stepType: StepType.FILTER,
      enabled: true,
      config: {
        includeKeywords: [],
        excludeKeywords: [],
        caseSensitive: false,
      },
    },
    {
      stepId: 'batch-classify',
      stepType: StepType.CLASSIFY,
      enabled: true,
      config: {
        promptId: 'thread-classification',
        model: 'gemini-2.5-flash',
        temperature: 0.2,
        maxTokens: 32768,
      },
    },
    {
      stepId: 'rag-enrich',
      stepType: StepType.ENRICH,
      enabled: true,
      config: {
        topK: 5,
        minSimilarity: 0.7,
        deduplicateTranslations: true,
      },
    },
    {
      stepId: 'proposal-generate',
      stepType: StepType.GENERATE,
      enabled: true,
      config: {
        promptId: 'changeset-generation',
        model: 'gemini-2.5-pro',
        temperature: 0.4,
        maxTokens: 32768,
        maxProposalsPerThread: 5,
      },
    },
    {
      stepId: 'content-validate',
      stepType: StepType.VALIDATE,
      enabled: false, // Optional step - enable when needed
      config: {
        maxRetries: 2,
        promptId: 'content-reformat',
        model: 'gemini-2.5-flash',
        temperature: 0.2,
        maxTokens: 8192,
        skipPatterns: [], // Regex patterns for files to skip validation
      },
    },
    {
      stepId: 'length-reduce',
      stepType: StepType.CONDENSE,
      enabled: false, // Optional step - enable when needed
      config: {
        defaultMaxLength: 3000,
        defaultTargetLength: 2000,
        // Priority-based tiers (higher priority = more space allowed)
        priorityTiers: [
          { minPriority: 70, maxLength: 5000, targetLength: 3500 }, // High priority
          { minPriority: 40, maxLength: 3500, targetLength: 2500 }, // Medium priority
          { minPriority: 0, maxLength: 2000, targetLength: 1500 }, // Low priority
        ],
        promptId: 'content-condense',
        model: 'gemini-2.5-flash',
        temperature: 0.3,
        maxTokens: 8192,
      },
    },
  ],
  errorHandling: {
    stopOnError: false,
    retryAttempts: 3,
    retryDelayMs: 5000,
  },
  performance: {
    maxConcurrentSteps: 1,
    timeoutMs: 300000,
    enableCaching: true,
  },
};

/**
 * Cache for loaded pipeline configurations
 */
const configCache = new Map<string, { config: PipelineConfig; loadedAt: number }>();
const CACHE_TTL_MS = 3600000; // 1 hour

/**
 * Load a pipeline configuration file
 */
async function loadConfigFile(filePath: string): Promise<PipelineConfig | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    const validated = PipelineConfigSchema.parse(parsed);
    return validated as PipelineConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    logger.error(`Failed to load pipeline config from ${filePath}:`, error);
    throw error;
  }
}

/**
 * Merge pipeline configurations (instance overrides defaults)
 */
function mergeConfigs(
  defaults: PipelineConfig,
  overrides: Partial<PipelineConfig>
): PipelineConfig {
  // For steps, if instance provides any steps, use those entirely (no merge)
  const steps = overrides.steps || defaults.steps;

  return {
    instanceId: overrides.instanceId || defaults.instanceId,
    pipelineId: overrides.pipelineId || defaults.pipelineId,
    description: overrides.description || defaults.description,
    steps,
    errorHandling: overrides.errorHandling
      ? { ...defaults.errorHandling, ...overrides.errorHandling }
      : defaults.errorHandling,
    performance: overrides.performance
      ? { ...defaults.performance, ...overrides.performance }
      : defaults.performance,
  };
}

/**
 * Load pipeline configuration for an instance
 *
 * Priority order:
 * 1. S3 instance-specific config (if S3 enabled)
 * 2. Local instance-specific config
 * 3. Local default config
 * 4. Built-in default config
 *
 * @param configBasePath - Base path for config files
 * @param instanceId - Instance identifier
 * @param pipelineId - Optional specific pipeline ID (defaults to 'default')
 */
export async function loadPipelineConfig(
  configBasePath: string,
  instanceId: string,
  pipelineId?: string
): Promise<PipelineConfig> {
  const configId = pipelineId || 'default';
  const cacheKey = `${instanceId}:${configId}`;

  // Check cache
  const cached = configCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    logger.debug(`Using cached pipeline config: ${cacheKey}`);
    return cached.config;
  }

  logger.info(`Loading pipeline config for ${instanceId}`, { pipelineId: configId });

  // Load default config first (local or built-in)
  const defaultPath = path.join(configBasePath, 'defaults', 'pipelines', 'default.json');
  let config = (await loadConfigFile(defaultPath)) || DEFAULT_PIPELINE_CONFIG;
  let loadedFromS3 = false;

  // Try S3 first if enabled
  if (shouldUseS3()) {
    const s3Config = await loadConfigFromS3(instanceId, configId);
    if (s3Config) {
      config = mergeConfigs(config, s3Config);
      loadedFromS3 = true;
      logger.debug(`Applied S3 pipeline config for ${instanceId}/${configId}`);
    }
  }

  // Fallback to local instance-specific config if S3 didn't provide one
  if (!loadedFromS3) {
    const instancePath = path.join(configBasePath, instanceId, 'pipelines', `${configId}.json`);
    const instanceConfig = await loadConfigFile(instancePath);
    if (instanceConfig) {
      config = mergeConfigs(config, instanceConfig);
      logger.debug(`Applied local instance pipeline config: ${instancePath}`);
    }
  }

  // Update instance ID if not set
  config.instanceId = instanceId;

  // Cache the result
  configCache.set(cacheKey, { config, loadedAt: Date.now() });

  return config;
}

/**
 * Clear the pipeline configuration cache
 */
export function clearPipelineConfigCache(): void {
  configCache.clear();
  logger.info('Pipeline config cache cleared');
}

/**
 * Validate a pipeline configuration object
 */
export function validatePipelineConfig(config: unknown): { valid: boolean; errors: string[] } {
  const result = PipelineConfigSchema.safeParse(config);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
  return { valid: false, errors };
}

/**
 * Get all available pipeline configurations for an instance
 */
export async function listPipelineConfigs(
  configBasePath: string,
  instanceId: string
): Promise<string[]> {
  const pipelines: string[] = [];

  // List default pipelines (local)
  const defaultsDir = path.join(configBasePath, 'defaults', 'pipelines');
  try {
    const defaultFiles = await fs.readdir(defaultsDir);
    pipelines.push(
      ...defaultFiles.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
    );
  } catch {
    // Directory may not exist
  }

  // List instance pipelines from S3 if enabled
  if (shouldUseS3()) {
    try {
      const prefix = process.env.CONFIG_S3_PREFIX || 'configs/';
      const s3Prefix = `${prefix}${instanceId}/pipelines/`;
      const keys = await s3Storage.list(s3Prefix);

      for (const key of keys) {
        const match = key.match(/\/pipelines\/([^/]+)\.json$/);
        if (match) {
          pipelines.push(match[1]);
        }
      }
    } catch (error) {
      logger.warn(`Failed to list pipelines from S3 for ${instanceId}:`, error);
    }
  }

  // List instance pipelines (local fallback)
  const instanceDir = path.join(configBasePath, instanceId, 'pipelines');
  try {
    const instanceFiles = await fs.readdir(instanceDir);
    pipelines.push(
      ...instanceFiles.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''))
    );
  } catch {
    // Directory may not exist
  }

  return [...new Set(pipelines)];
}

/**
 * Get the default pipeline configuration
 */
export function getDefaultPipelineConfig(): PipelineConfig {
  return { ...DEFAULT_PIPELINE_CONFIG };
}
