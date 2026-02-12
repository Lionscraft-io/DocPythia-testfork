/**
 * Cache Storage Service
 * Provides a unified cache storage interface with S3 and local file backends
 * Used for LLM response caching and other ephemeral data
 */

import * as fs from 'fs';
import * as path from 'path';
import { s3Storage } from './s3-client';

export type CacheBackend = 's3' | 'local';

export interface CacheStorageOptions {
  backend: CacheBackend;
  s3Prefix?: string;
  localPath?: string;
}

export interface CacheEntry<T = unknown> {
  key: string;
  data: T;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const DEFAULT_OPTIONS: CacheStorageOptions = {
  backend: (process.env.CACHE_STORAGE as CacheBackend) || 'local',
  s3Prefix: process.env.CACHE_S3_PREFIX || 'cache/',
  localPath: path.join(process.cwd(), 'cache'),
};

class CacheStorage {
  private options: CacheStorageOptions;

  constructor(options: Partial<CacheStorageOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Check if S3 backend should be used
   */
  private shouldUseS3(): boolean {
    return this.options.backend === 's3' && s3Storage.isEnabled();
  }

  /**
   * Get the S3 key for a cache entry
   */
  private getS3Key(category: string, key: string): string {
    return `${this.options.s3Prefix}${category}/${key}.json`;
  }

  /**
   * Get the local path for a cache entry
   */
  private getLocalPath(category: string, key: string): string {
    return path.join(this.options.localPath!, category, `${key}.json`);
  }

  /**
   * Ensure local directory exists
   */
  private ensureLocalDir(category: string): void {
    const dir = path.join(this.options.localPath!, category);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Get a cached entry
   */
  async get<T>(category: string, key: string): Promise<CacheEntry<T> | null> {
    if (this.shouldUseS3()) {
      const s3Key = this.getS3Key(category, key);
      return s3Storage.getJson<CacheEntry<T>>(s3Key);
    }

    // Local storage
    const localPath = this.getLocalPath(category, key);
    if (!fs.existsSync(localPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(localPath, 'utf-8');
      return JSON.parse(content) as CacheEntry<T>;
    } catch (error) {
      console.error(`Failed to read cache file: ${localPath}`, error);
      return null;
    }
  }

  /**
   * Set a cached entry
   */
  async set<T>(
    category: string,
    key: string,
    data: T,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const entry: CacheEntry<T> = {
      key,
      data,
      timestamp: new Date().toISOString(),
      metadata,
    };

    if (this.shouldUseS3()) {
      const s3Key = this.getS3Key(category, key);
      await s3Storage.putJson(s3Key, entry);
      return;
    }

    // Local storage
    this.ensureLocalDir(category);
    const localPath = this.getLocalPath(category, key);
    fs.writeFileSync(localPath, JSON.stringify(entry, null, 2), 'utf-8');
  }

  /**
   * Check if a cached entry exists
   */
  async has(category: string, key: string): Promise<boolean> {
    if (this.shouldUseS3()) {
      const s3Key = this.getS3Key(category, key);
      return s3Storage.exists(s3Key);
    }

    const localPath = this.getLocalPath(category, key);
    return fs.existsSync(localPath);
  }

  /**
   * Delete a cached entry
   */
  async delete(category: string, key: string): Promise<void> {
    if (this.shouldUseS3()) {
      const s3Key = this.getS3Key(category, key);
      await s3Storage.delete(s3Key);
      return;
    }

    const localPath = this.getLocalPath(category, key);
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  }

  /**
   * List all keys in a category
   */
  async list(category: string): Promise<string[]> {
    if (this.shouldUseS3()) {
      const prefix = `${this.options.s3Prefix}${category}/`;
      const keys = await s3Storage.list(prefix);

      // Extract key names from full paths
      return keys
        .map((key) => {
          const match = key.match(new RegExp(`^${prefix}(.+)\\.json$`));
          return match ? match[1] : null;
        })
        .filter((key): key is string => key !== null);
    }

    // Local storage
    const dir = path.join(this.options.localPath!, category);
    if (!fs.existsSync(dir)) {
      return [];
    }

    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  }

  /**
   * Clear all entries in a category
   */
  async clearCategory(category: string): Promise<number> {
    const keys = await this.list(category);
    let deleted = 0;

    for (const key of keys) {
      await this.delete(category, key);
      deleted++;
    }

    return deleted;
  }

  /**
   * Get all entries in a category
   */
  async listEntries<T>(category: string): Promise<CacheEntry<T>[]> {
    const keys = await this.list(category);
    const entries: CacheEntry<T>[] = [];

    for (const key of keys) {
      const entry = await this.get<T>(category, key);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Get statistics for a category
   */
  async getStats(category: string): Promise<{ count: number; totalSize: number }> {
    if (this.shouldUseS3()) {
      const keys = await this.list(category);
      // For S3, we'd need to get object metadata for sizes
      // For simplicity, just return count
      return { count: keys.length, totalSize: 0 };
    }

    // Local storage
    const dir = path.join(this.options.localPath!, category);
    if (!fs.existsSync(dir)) {
      return { count: 0, totalSize: 0 };
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    let totalSize = 0;

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      totalSize += stats.size;
    }

    return { count: files.length, totalSize };
  }

  /**
   * Delete entries older than a certain age
   */
  async clearOlderThan(category: string, maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const keys = await this.list(category);
    let deleted = 0;

    for (const key of keys) {
      const entry = await this.get(category, key);
      if (entry) {
        const entryTime = new Date(entry.timestamp).getTime();
        if (entryTime < cutoff) {
          await this.delete(category, key);
          deleted++;
        }
      }
    }

    return deleted;
  }

  /**
   * Get the current backend type
   */
  getBackend(): CacheBackend {
    return this.shouldUseS3() ? 's3' : 'local';
  }
}

// Export singleton instance
export const cacheStorage = new CacheStorage();
