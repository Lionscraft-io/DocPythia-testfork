/**
 * Configuration Storage Service
 * Loads instance configurations from S3 with local file fallback
 * Supports development mode with local files only
 */

import * as fs from 'fs';
import * as path from 'path';
import { s3Storage } from './s3-client';

export interface ConfigStorageOptions {
  s3Prefix?: string;
  localPath?: string;
  useS3?: boolean;
}

const DEFAULT_OPTIONS: ConfigStorageOptions = {
  s3Prefix: 'configs/',
  localPath: path.join(process.cwd(), 'config'),
  useS3: process.env.CONFIG_SOURCE === 's3',
};

class ConfigStorage {
  private options: ConfigStorageOptions;
  private cache: Map<string, unknown> = new Map();

  constructor(options: ConfigStorageOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Check if S3 storage should be used
   */
  private shouldUseS3(): boolean {
    return this.options.useS3 === true && s3Storage.isEnabled();
  }

  /**
   * Get the S3 key for a config file
   */
  private getS3Key(instanceId: string, filename: string): string {
    return `${this.options.s3Prefix}${instanceId}/${filename}`;
  }

  /**
   * Get the local path for a config file
   */
  private getLocalPath(instanceId: string, filename: string): string {
    return path.join(this.options.localPath!, instanceId, filename);
  }

  /**
   * Load a configuration file
   */
  async loadConfig<T>(instanceId: string, filename: string): Promise<T | null> {
    const cacheKey = `${instanceId}/${filename}`;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) as T;
    }

    let config: T | null = null;

    // Try S3 first if enabled
    if (this.shouldUseS3()) {
      try {
        const s3Key = this.getS3Key(instanceId, filename);
        config = await s3Storage.getJson<T>(s3Key);

        if (config) {
          console.log(`Loaded config from S3: ${s3Key}`);
          this.cache.set(cacheKey, config);
          return config;
        }
      } catch (error) {
        console.warn(`Failed to load config from S3, falling back to local: ${error}`);
      }
    }

    // Fallback to local file
    const localPath = this.getLocalPath(instanceId, filename);
    if (fs.existsSync(localPath)) {
      try {
        const content = fs.readFileSync(localPath, 'utf-8');
        config = JSON.parse(content) as T;
        console.log(`Loaded config from local: ${localPath}`);
        this.cache.set(cacheKey, config);
        return config;
      } catch (error) {
        console.error(`Failed to parse local config: ${localPath}`, error);
      }
    }

    return null;
  }

  /**
   * Load instance.json for an instance
   */
  async loadInstanceConfig<T>(instanceId: string): Promise<T | null> {
    return this.loadConfig<T>(instanceId, 'instance.json');
  }

  /**
   * Load doc-index.config.json for an instance
   */
  async loadDocIndexConfig<T>(instanceId: string): Promise<T | null> {
    return this.loadConfig<T>(instanceId, 'doc-index.config.json');
  }

  /**
   * Save a configuration file
   */
  async saveConfig<T>(instanceId: string, filename: string, config: T): Promise<void> {
    const cacheKey = `${instanceId}/${filename}`;

    if (this.shouldUseS3()) {
      const s3Key = this.getS3Key(instanceId, filename);
      await s3Storage.putJson(s3Key, config);
      console.log(`Saved config to S3: ${s3Key}`);
    } else {
      // Save locally
      const localPath = this.getLocalPath(instanceId, filename);
      const dir = path.dirname(localPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(localPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`Saved config locally: ${localPath}`);
    }

    // Update cache
    this.cache.set(cacheKey, config);
  }

  /**
   * Check if a config file exists
   */
  async configExists(instanceId: string, filename: string): Promise<boolean> {
    if (this.shouldUseS3()) {
      const s3Key = this.getS3Key(instanceId, filename);
      return s3Storage.exists(s3Key);
    }

    const localPath = this.getLocalPath(instanceId, filename);
    return fs.existsSync(localPath);
  }

  /**
   * List available instances
   */
  async listInstances(): Promise<string[]> {
    if (this.shouldUseS3()) {
      const prefix = this.options.s3Prefix!;
      const keys = await s3Storage.list(prefix);

      // Extract unique instance IDs from paths like 'configs/projecta/instance.json'
      const instances = new Set<string>();
      for (const key of keys) {
        const match = key.match(new RegExp(`^${prefix}([^/]+)/`));
        if (match) {
          instances.add(match[1]);
        }
      }
      return Array.from(instances);
    }

    // List from local directory
    const configDir = this.options.localPath!;
    if (!fs.existsSync(configDir)) {
      return [];
    }

    const entries = fs.readdirSync(configDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clear cache for a specific instance
   */
  clearInstanceCache(instanceId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${instanceId}/`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Reload a config (clear cache and load fresh)
   */
  async reloadConfig<T>(instanceId: string, filename: string): Promise<T | null> {
    const cacheKey = `${instanceId}/${filename}`;
    this.cache.delete(cacheKey);
    return this.loadConfig<T>(instanceId, filename);
  }
}

// Export singleton instance
export const configStorage = new ConfigStorage();
