/**
 * Instance-Aware Configuration Loader
 * Supports multi-tenant configuration with per-instance databases
 * Loads configuration from S3 (production) or local files (development)
 * Updated: 2025-12-29 - Added S3 storage support
 */

import fs from 'fs';
import path from 'path';
import { defaultConfig } from './defaults';
import { InstanceConfigSchema } from './schemas';
import type { InstanceConfig, ResolvedConfig } from './types';
import { s3Storage } from '../storage/s3-client';

export class InstanceConfigLoader {
  private static instances: Map<string, ResolvedConfig> = new Map();
  private static s3Initialized: boolean = false;

  /**
   * Initialize S3 storage if configured
   */
  private static initS3(): void {
    if (!this.s3Initialized) {
      s3Storage.initializeFromEnv();
      this.s3Initialized = true;
    }
  }

  /**
   * Check if S3 storage should be used
   */
  private static shouldUseS3(): boolean {
    return process.env.CONFIG_SOURCE === 's3' && s3Storage.isEnabled();
  }

  /**
   * Load configuration for a specific instance (sync version for backward compatibility)
   * @param instanceId - Instance identifier (e.g., "projecta", "projectb")
   */
  static load(instanceId: string): ResolvedConfig {
    // Return cached config if available
    const cached = this.instances.get(instanceId);
    if (cached) {
      return cached;
    }

    this.initS3();

    console.log(`Loading configuration for instance: ${instanceId}`);

    // Layer 1: Start with defaults
    let config: InstanceConfig = JSON.parse(JSON.stringify(defaultConfig));
    const source = {
      file: false,
      env: false,
      defaults: true,
      s3: false,
    };

    // Layer 2: Override with instance-specific file (local only in sync mode)
    const fileConfig = this.loadFromFile(instanceId);
    if (fileConfig) {
      config = this.deepMerge(config, fileConfig);
      source.file = true;
      console.log(`Loaded configuration from config/${instanceId}/instance.json`);
    } else {
      console.log(`No config file found for instance "${instanceId}", using defaults`);
    }

    // Layer 3: Override with environment variables (instance-specific)
    const envConfig = this.loadFromEnv(instanceId);
    if (envConfig) {
      config = this.deepMerge(config, envConfig);
      source.env = true;
      console.log('Applied environment variable overrides');
    }

    // Validate final configuration
    return this.validateAndCache(instanceId, config, source);
  }

  /**
   * Load configuration for a specific instance (async version with S3 support)
   * @param instanceId - Instance identifier (e.g., "projecta", "projectb")
   */
  static async loadAsync(instanceId: string): Promise<ResolvedConfig> {
    // Return cached config if available
    const cached = this.instances.get(instanceId);
    if (cached) {
      return cached;
    }

    this.initS3();

    console.log(`Loading configuration for instance: ${instanceId}`);

    // Layer 1: Start with defaults
    let config: InstanceConfig = JSON.parse(JSON.stringify(defaultConfig));
    const source = {
      file: false,
      env: false,
      defaults: true,
      s3: false,
    };

    // Layer 2a: Try S3 first if enabled
    if (this.shouldUseS3()) {
      const s3Config = await this.loadFromS3(instanceId);
      if (s3Config) {
        config = this.deepMerge(config, s3Config);
        source.s3 = true;
        console.log(`Loaded configuration from S3: configs/${instanceId}/instance.json`);
      }
    }

    // Layer 2b: Fallback to local file if S3 didn't provide config
    if (!source.s3) {
      const fileConfig = this.loadFromFile(instanceId);
      if (fileConfig) {
        config = this.deepMerge(config, fileConfig);
        source.file = true;
        console.log(`Loaded configuration from config/${instanceId}/instance.json`);
      } else {
        console.log(`No config file found for instance "${instanceId}", using defaults`);
      }
    }

    // Layer 3: Override with environment variables (instance-specific)
    const envConfig = this.loadFromEnv(instanceId);
    if (envConfig) {
      config = this.deepMerge(config, envConfig);
      source.env = true;
      console.log('Applied environment variable overrides');
    }

    // Validate final configuration
    return this.validateAndCache(instanceId, config, source);
  }

  /**
   * Validate and cache configuration
   */
  private static validateAndCache(
    instanceId: string,
    config: InstanceConfig,
    source: { file: boolean; env: boolean; defaults: boolean; s3?: boolean }
  ): ResolvedConfig {
    try {
      const validated = InstanceConfigSchema.parse(config);
      const resolvedConfig: ResolvedConfig = {
        ...validated,
        _source: source,
      };

      // Cache the configuration
      this.instances.set(instanceId, resolvedConfig);

      console.log(`Configuration loaded for ${instanceId}: ${resolvedConfig.project.name}`);
      console.log(`   Database: ${resolvedConfig.database.name}`);
      console.log(`   Documentation: ${resolvedConfig.documentation.gitUrl}`);

      return resolvedConfig;
    } catch (error) {
      console.error(`Configuration validation failed for instance "${instanceId}":`, error);
      throw new Error(
        `Invalid configuration for instance "${instanceId}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get configuration for instance (must be loaded first)
   */
  static get(instanceId: string): ResolvedConfig {
    const config = this.instances.get(instanceId);
    if (!config) {
      throw new Error(`Configuration not loaded for instance "${instanceId}". Call load() first.`);
    }
    return config;
  }

  /**
   * Check if instance configuration exists
   */
  static has(instanceId: string): boolean {
    return this.instances.has(instanceId);
  }

  /**
   * Reload configuration for instance (clears cache)
   */
  static reload(instanceId: string): ResolvedConfig {
    this.instances.delete(instanceId);
    return this.load(instanceId);
  }

  /**
   * Reload configuration for instance (async with S3 support)
   */
  static async reloadAsync(instanceId: string): Promise<ResolvedConfig> {
    this.instances.delete(instanceId);
    return this.loadAsync(instanceId);
  }

  /**
   * Get list of available instances
   */
  static getAvailableInstances(): string[] {
    const configDir = path.join(process.cwd(), 'config');
    if (!fs.existsSync(configDir)) {
      return [];
    }

    const entries = fs.readdirSync(configDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }

  /**
   * Get list of available instances (async with S3 support)
   */
  static async getAvailableInstancesAsync(): Promise<string[]> {
    this.initS3();

    if (this.shouldUseS3()) {
      try {
        const prefix = process.env.CONFIG_S3_PREFIX || 'configs/';
        const keys = await s3Storage.list(prefix);

        // Extract unique instance IDs from paths like 'configs/projecta/instance.json'
        const instances = new Set<string>();
        for (const key of keys) {
          const match = key.match(new RegExp(`^${prefix}([^/]+)/instance\\.json$`));
          if (match) {
            instances.add(match[1]);
          }
        }
        return Array.from(instances);
      } catch (error) {
        console.warn('Failed to list instances from S3, falling back to local:', error);
      }
    }

    return this.getAvailableInstances();
  }

  /**
   * Load configuration from S3
   */
  private static async loadFromS3(instanceId: string): Promise<Partial<InstanceConfig> | null> {
    const prefix = process.env.CONFIG_S3_PREFIX || 'configs/';
    const s3Key = `${prefix}${instanceId}/instance.json`;

    try {
      const config = await s3Storage.getJson<Partial<InstanceConfig>>(s3Key);
      return config;
    } catch (error) {
      console.warn(`Failed to load config from S3 for "${instanceId}":`, error);
      return null;
    }
  }

  /**
   * Load configuration from instance-specific file
   */
  private static loadFromFile(instanceId: string): Partial<InstanceConfig> | null {
    const configPath = path.join(process.cwd(), 'config', instanceId, 'instance.json');

    if (!fs.existsSync(configPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(
        `Failed to parse config file for "${instanceId}":`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }

  /**
   * Load instance-specific environment variables
   */
  private static loadFromEnv(instanceId: string): Partial<InstanceConfig> | null {
    const env = process.env;
    const envPrefix = instanceId.toUpperCase();
    const envConfig: Partial<InstanceConfig> = {};

    // Instance-specific env vars have format: INSTANCE_PROJECT_NAME, etc.
    // But we also support non-prefixed for backward compatibility

    // Database config
    const dbName = env[`${envPrefix}_DATABASE_NAME`] || env.DATABASE_NAME;
    if (dbName) {
      envConfig.database = { name: dbName };
    }

    // Project config
    if (env[`${envPrefix}_PROJECT_NAME`] || env.PROJECT_NAME) {
      envConfig.project = {
        ...(env[`${envPrefix}_PROJECT_NAME`] && { name: env[`${envPrefix}_PROJECT_NAME`] }),
        ...(env[`${envPrefix}_PROJECT_SHORT_NAME`] && {
          shortName: env[`${envPrefix}_PROJECT_SHORT_NAME`],
        }),
        ...(env[`${envPrefix}_PROJECT_DESCRIPTION`] && {
          description: env[`${envPrefix}_PROJECT_DESCRIPTION`],
        }),
      } as any;
    }

    return Object.keys(envConfig).length > 0 ? envConfig : null;
  }

  /**
   * Save configuration to S3
   */
  static async saveToS3(instanceId: string, config: Partial<InstanceConfig>): Promise<void> {
    this.initS3();

    if (!s3Storage.isEnabled()) {
      throw new Error('S3 storage is not enabled');
    }

    const prefix = process.env.CONFIG_S3_PREFIX || 'configs/';
    const s3Key = `${prefix}${instanceId}/instance.json`;

    await s3Storage.putJson(s3Key, config);
    console.log(`Saved configuration to S3: ${s3Key}`);

    // Clear cache to force reload on next access
    this.instances.delete(instanceId);
  }

  /**
   * Deep merge two objects
   */
  private static deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key in source) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (sourceValue === undefined) {
        continue;
      }

      if (
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        result[key] = this.deepMerge(targetValue, sourceValue);
      } else {
        result[key] = sourceValue as any;
      }
    }

    return result;
  }
}

// Export convenience functions
export function loadInstanceConfig(instanceId: string): ResolvedConfig {
  return InstanceConfigLoader.load(instanceId);
}

export function getInstanceConfig(instanceId: string): ResolvedConfig {
  return InstanceConfigLoader.get(instanceId);
}

export async function loadInstanceConfigAsync(instanceId: string): Promise<ResolvedConfig> {
  return InstanceConfigLoader.loadAsync(instanceId);
}
