/**
 * LLM Response Cache Service
 * Supports both local file-based and S3-based caching

 * Date: 2025-10-30
 * Updated: 2025-12-29 - Added S3 storage support
 * Purpose: Reduce redundant LLM API calls by caching prompt/response pairs
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';
import { cacheStorage } from '../storage/cache-storage';
import { createLogger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('LLMCache');

export type CachePurpose =
  | 'index'
  | 'embeddings'
  | 'analysis'
  | 'changegeneration'
  | 'review'
  | 'general';

export interface CachedLLMRequest {
  hash: string;
  purpose: CachePurpose;
  prompt: string;
  response: string;
  timestamp: string;
  model?: string;
  tokensUsed?: number;
  messageId?: number; // Link to UnifiedMessage for grouping related LLM calls
}

/**
 * Interface for LLM cache - enables dependency injection and testing
 */
export interface ILLMCache {
  has(prompt: string, purpose: CachePurpose): boolean;
  get(prompt: string, purpose: CachePurpose): CachedLLMRequest | null;
  set(
    prompt: string,
    response: string,
    purpose: CachePurpose,
    metadata?: { model?: string; tokensUsed?: number; messageId?: number }
  ): void;
}

type CacheBackendType = 'local' | 's3';

export class LLMCache implements ILLMCache {
  private cacheRootDir: string;
  private enabled: boolean;
  private backend: CacheBackendType;
  private readonly purposes: CachePurpose[] = [
    'index',
    'embeddings',
    'analysis',
    'changegeneration',
    'review',
    'general',
  ];

  constructor() {
    // Cache directory at project root: /cache/llm/
    this.cacheRootDir = path.join(__dirname, '../../cache/llm');
    this.enabled = process.env.LLM_CACHE_ENABLED !== 'false'; // Enabled by default
    this.backend = (process.env.CACHE_STORAGE as CacheBackendType) || 'local';

    if (this.enabled) {
      if (this.backend === 'local') {
        this.ensureDirectories();
      }
      logger.info(`Initialized: backend=${this.backend}, enabled=${this.enabled}`);
    } else {
      logger.info('Disabled');
    }
  }

  /**
   * Get the current backend type
   */
  getBackend(): CacheBackendType {
    return this.backend;
  }

  /**
   * Ensure cache directory structure exists (local only)
   */
  private ensureDirectories(): void {
    if (this.backend !== 'local') return;

    // Create root cache directory
    if (!fs.existsSync(this.cacheRootDir)) {
      fs.mkdirSync(this.cacheRootDir, { recursive: true });
    }

    // Create subdirectories for each purpose
    for (const purpose of this.purposes) {
      const purposeDir = path.join(this.cacheRootDir, purpose);
      if (!fs.existsSync(purposeDir)) {
        fs.mkdirSync(purposeDir, { recursive: true });
      }
    }
  }

  /**
   * Generate hash from prompt for cache key
   */
  private hashPrompt(prompt: string): string {
    return crypto.createHash('sha256').update(prompt).digest('hex');
  }

  /**
   * Get cache file path for a given prompt and purpose (local only)
   */
  private getCacheFilePath(prompt: string, purpose: CachePurpose): string {
    const hash = this.hashPrompt(prompt);
    return path.join(this.cacheRootDir, purpose, `${hash}.json`);
  }

  /**
   * Get S3 cache key for a given prompt and purpose
   */
  private getS3CacheKey(prompt: string, purpose: CachePurpose): string {
    const hash = this.hashPrompt(prompt);
    return `llm/${purpose}/${hash}`;
  }

  /**
   * Check if a cached response exists for the given prompt
   */
  has(prompt: string, purpose: CachePurpose): boolean {
    if (!this.enabled) return false;

    if (this.backend === 's3') {
      // S3 has() is async, so we can't use it in sync context
      // Return false and let get() handle the async check
      return false;
    }

    const filePath = this.getCacheFilePath(prompt, purpose);
    return fs.existsSync(filePath);
  }

  /**
   * Async version of has() for S3 support
   */
  async hasAsync(prompt: string, purpose: CachePurpose): Promise<boolean> {
    if (!this.enabled) return false;

    if (this.backend === 's3') {
      return cacheStorage.has(`llm/${purpose}`, this.hashPrompt(prompt));
    }

    const filePath = this.getCacheFilePath(prompt, purpose);
    return fs.existsSync(filePath);
  }

  /**
   * Get cached response for the given prompt
   */
  get(prompt: string, purpose: CachePurpose): CachedLLMRequest | null {
    if (!this.enabled) return null;

    if (this.backend === 's3') {
      // S3 get is async, return null for sync version
      return null;
    }

    try {
      const filePath = this.getCacheFilePath(prompt, purpose);

      if (!fs.existsSync(filePath)) {
        return null;
      }

      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const cached = JSON.parse(fileContent) as CachedLLMRequest;

      logger.debug(`HIT: ${purpose}/${cached.hash.substring(0, 8)}`);
      return cached;
    } catch (error) {
      logger.error('Error reading cache:', error);
      return null;
    }
  }

  /**
   * Async version of get() for S3 support
   */
  async getAsync(prompt: string, purpose: CachePurpose): Promise<CachedLLMRequest | null> {
    if (!this.enabled) return null;

    if (this.backend === 's3') {
      try {
        const hash = this.hashPrompt(prompt);
        const entry = await cacheStorage.get<CachedLLMRequest>(`llm/${purpose}`, hash);
        if (entry) {
          logger.debug(`HIT (S3): ${purpose}/${hash.substring(0, 8)}`);
          return entry.data;
        }
        return null;
      } catch (error) {
        logger.error('Error reading cache from S3:', error);
        return null;
      }
    }

    return this.get(prompt, purpose);
  }

  /**
   * Save LLM request and response to cache
   */
  set(
    prompt: string,
    response: string,
    purpose: CachePurpose,
    metadata?: {
      model?: string;
      tokensUsed?: number;
      messageId?: number;
    }
  ): void {
    if (!this.enabled) return;

    const hash = this.hashPrompt(prompt);
    const cacheEntry: CachedLLMRequest = {
      hash,
      purpose,
      prompt,
      response,
      timestamp: new Date().toISOString(),
      model: metadata?.model,
      tokensUsed: metadata?.tokensUsed,
      messageId: metadata?.messageId,
    };

    if (this.backend === 's3') {
      // Fire and forget for S3 to maintain sync interface
      this.setAsync(prompt, response, purpose, metadata).catch((err) => {
        logger.error('Error writing cache to S3:', err);
      });
      return;
    }

    try {
      const filePath = this.getCacheFilePath(prompt, purpose);
      fs.writeFileSync(filePath, JSON.stringify(cacheEntry, null, 2), 'utf-8');
      logger.debug(`SAVED: ${purpose}/${hash.substring(0, 8)}`);
    } catch (error) {
      logger.error('Error writing cache:', error);
    }
  }

  /**
   * Async version of set() for S3 support
   */
  async setAsync(
    prompt: string,
    response: string,
    purpose: CachePurpose,
    metadata?: {
      model?: string;
      tokensUsed?: number;
      messageId?: number;
    }
  ): Promise<void> {
    if (!this.enabled) return;

    const hash = this.hashPrompt(prompt);
    const cacheEntry: CachedLLMRequest = {
      hash,
      purpose,
      prompt,
      response,
      timestamp: new Date().toISOString(),
      model: metadata?.model,
      tokensUsed: metadata?.tokensUsed,
      messageId: metadata?.messageId,
    };

    if (this.backend === 's3') {
      try {
        await cacheStorage.set(`llm/${purpose}`, hash, cacheEntry, {
          model: metadata?.model,
          tokensUsed: metadata?.tokensUsed,
          messageId: metadata?.messageId,
        });
        logger.debug(`SAVED (S3): ${purpose}/${hash.substring(0, 8)}`);
      } catch (error) {
        logger.error('Error writing cache to S3:', error);
      }
      return;
    }

    this.set(prompt, response, purpose, metadata);
  }

  /**
   * Get all cached requests for a specific purpose
   */
  listByPurpose(purpose: CachePurpose): CachedLLMRequest[] {
    if (!this.enabled || this.backend === 's3') return [];

    try {
      const purposeDir = path.join(this.cacheRootDir, purpose);

      if (!fs.existsSync(purposeDir)) {
        return [];
      }

      const files = fs.readdirSync(purposeDir).filter((f) => f.endsWith('.json'));
      const cached: CachedLLMRequest[] = [];

      for (const file of files) {
        try {
          const filePath = path.join(purposeDir, file);
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          cached.push(JSON.parse(fileContent));
        } catch (error) {
          logger.error(`Error reading cache file ${file}:`, error);
        }
      }

      // Sort by timestamp descending (newest first)
      cached.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return cached;
    } catch (error) {
      logger.error('Error listing cache by purpose:', error);
      return [];
    }
  }

  /**
   * Async version of listByPurpose() for S3 support
   */
  async listByPurposeAsync(purpose: CachePurpose): Promise<CachedLLMRequest[]> {
    if (!this.enabled) return [];

    if (this.backend === 's3') {
      try {
        const entries = await cacheStorage.listEntries<CachedLLMRequest>(`llm/${purpose}`);
        const cached = entries.map((e) => e.data);
        cached.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return cached;
      } catch (error) {
        logger.error('Error listing cache from S3:', error);
        return [];
      }
    }

    return this.listByPurpose(purpose);
  }

  /**
   * Get all cached requests across all purposes
   */
  listAll(): { purpose: CachePurpose; requests: CachedLLMRequest[] }[] {
    if (!this.enabled || this.backend === 's3') return [];

    const results: { purpose: CachePurpose; requests: CachedLLMRequest[] }[] = [];

    for (const purpose of this.purposes) {
      const requests = this.listByPurpose(purpose);
      if (requests.length > 0) {
        results.push({ purpose, requests });
      }
    }

    return results;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    totalCached: number;
    byPurpose: Record<CachePurpose, number>;
    totalSizeBytes: number;
    backend: CacheBackendType;
  } {
    const emptyStats = {
      totalCached: 0,
      byPurpose: {
        index: 0,
        embeddings: 0,
        analysis: 0,
        changegeneration: 0,
        review: 0,
        general: 0,
      },
      totalSizeBytes: 0,
      backend: this.backend,
    };

    if (!this.enabled || this.backend === 's3') {
      return emptyStats;
    }

    const byPurpose: Record<CachePurpose, number> = { ...emptyStats.byPurpose };
    let totalSizeBytes = 0;

    for (const purpose of this.purposes) {
      const purposeDir = path.join(this.cacheRootDir, purpose);

      if (fs.existsSync(purposeDir)) {
        const files = fs.readdirSync(purposeDir).filter((f) => f.endsWith('.json'));
        byPurpose[purpose] = files.length;

        // Calculate total size
        for (const file of files) {
          const filePath = path.join(purposeDir, file);
          try {
            const stats = fs.statSync(filePath);
            totalSizeBytes += stats.size;
          } catch {
            // Ignore errors
          }
        }
      }
    }

    const totalCached = Object.values(byPurpose).reduce((sum, count) => sum + count, 0);

    return {
      totalCached,
      byPurpose,
      totalSizeBytes,
      backend: this.backend,
    };
  }

  /**
   * Async version of getStats() for S3 support
   */
  async getStatsAsync(): Promise<{
    totalCached: number;
    byPurpose: Record<CachePurpose, number>;
    totalSizeBytes: number;
    backend: CacheBackendType;
  }> {
    if (!this.enabled) {
      return this.getStats();
    }

    if (this.backend === 's3') {
      const byPurpose: Record<CachePurpose, number> = {
        index: 0,
        embeddings: 0,
        analysis: 0,
        changegeneration: 0,
        review: 0,
        general: 0,
      };
      let totalSizeBytes = 0;

      for (const purpose of this.purposes) {
        try {
          const stats = await cacheStorage.getStats(`llm/${purpose}`);
          byPurpose[purpose] = stats.count;
          totalSizeBytes += stats.totalSize;
        } catch (error) {
          logger.error(`Error getting stats for ${purpose}:`, error);
        }
      }

      const totalCached = Object.values(byPurpose).reduce((sum, count) => sum + count, 0);

      return {
        totalCached,
        byPurpose,
        totalSizeBytes,
        backend: this.backend,
      };
    }

    return this.getStats();
  }

  /**
   * Clear cache for a specific purpose
   */
  clearPurpose(purpose: CachePurpose): number {
    if (!this.enabled || this.backend === 's3') return 0;

    try {
      const purposeDir = path.join(this.cacheRootDir, purpose);

      if (!fs.existsSync(purposeDir)) {
        return 0;
      }

      const files = fs.readdirSync(purposeDir).filter((f) => f.endsWith('.json'));
      let deletedCount = 0;

      for (const file of files) {
        try {
          fs.unlinkSync(path.join(purposeDir, file));
          deletedCount++;
        } catch (error) {
          logger.error(`Error deleting cache file ${file}:`, error);
        }
      }

      logger.info(`Cleared ${deletedCount} cached requests from ${purpose}`);
      return deletedCount;
    } catch (error) {
      logger.error('Error clearing cache purpose:', error);
      return 0;
    }
  }

  /**
   * Async version of clearPurpose() for S3 support
   */
  async clearPurposeAsync(purpose: CachePurpose): Promise<number> {
    if (!this.enabled) return 0;

    if (this.backend === 's3') {
      try {
        const deleted = await cacheStorage.clearCategory(`llm/${purpose}`);
        logger.info(`Cleared ${deleted} cached requests from ${purpose} (S3)`);
        return deleted;
      } catch (error) {
        logger.error('Error clearing cache from S3:', error);
        return 0;
      }
    }

    return this.clearPurpose(purpose);
  }

  /**
   * Clear all cache
   */
  clearAll(): number {
    if (!this.enabled || this.backend === 's3') return 0;

    let totalDeleted = 0;

    for (const purpose of this.purposes) {
      totalDeleted += this.clearPurpose(purpose);
    }

    logger.info(`Cleared total of ${totalDeleted} cached requests`);
    return totalDeleted;
  }

  /**
   * Async version of clearAll() for S3 support
   */
  async clearAllAsync(): Promise<number> {
    if (!this.enabled) return 0;

    let totalDeleted = 0;

    for (const purpose of this.purposes) {
      totalDeleted += await this.clearPurposeAsync(purpose);
    }

    logger.info(`Cleared total of ${totalDeleted} cached requests`);
    return totalDeleted;
  }

  /**
   * Search cache entries by text in prompt or response
   */
  search(searchText: string, purpose?: CachePurpose): CachedLLMRequest[] {
    if (!this.enabled || this.backend === 's3') return [];

    const results: CachedLLMRequest[] = [];
    const searchLower = searchText.toLowerCase();
    const searchPurposes = purpose ? [purpose] : this.purposes;

    for (const p of searchPurposes) {
      const purposeDir = path.join(this.cacheRootDir, p);

      if (!fs.existsSync(purposeDir)) {
        continue;
      }

      const files = fs.readdirSync(purposeDir).filter((f) => f.endsWith('.json'));

      for (const file of files) {
        try {
          const filePath = path.join(purposeDir, file);
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          const cached = JSON.parse(fileContent) as CachedLLMRequest;

          if (
            cached.prompt.toLowerCase().includes(searchLower) ||
            cached.response.toLowerCase().includes(searchLower)
          ) {
            results.push(cached);
          }
        } catch (error) {
          logger.error(`Error processing cache file ${file}:`, error);
        }
      }
    }

    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return results;
  }

  /**
   * Find all cache entries related to a specific message ID
   */
  findByMessageId(messageId: number): { purpose: CachePurpose; request: CachedLLMRequest }[] {
    if (!this.enabled || this.backend === 's3') return [];

    const results: { purpose: CachePurpose; request: CachedLLMRequest }[] = [];

    for (const purpose of this.purposes) {
      const purposeDir = path.join(this.cacheRootDir, purpose);

      if (!fs.existsSync(purposeDir)) {
        continue;
      }

      const files = fs.readdirSync(purposeDir).filter((f) => f.endsWith('.json'));

      for (const file of files) {
        try {
          const filePath = path.join(purposeDir, file);
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          const cached = JSON.parse(fileContent) as CachedLLMRequest;

          if (cached.messageId === messageId) {
            results.push({ purpose, request: cached });
          }
        } catch (error) {
          logger.error(`Error processing cache file ${file}:`, error);
        }
      }
    }

    results.sort(
      (a, b) => new Date(a.request.timestamp).getTime() - new Date(b.request.timestamp).getTime()
    );
    return results;
  }

  /**
   * Search cache and include all related entries for matching messages
   */
  searchWithRelated(
    searchText: string,
    purpose?: CachePurpose
  ): {
    messageId: number | null;
    entries: { purpose: CachePurpose; request: CachedLLMRequest }[];
  }[] {
    if (!this.enabled || this.backend === 's3') return [];

    const searchResults = this.search(searchText, purpose);
    const messageGroups = new Map<number | null, Set<string>>();
    const allEntries = new Map<string, { purpose: CachePurpose; request: CachedLLMRequest }>();

    for (const result of searchResults) {
      const msgId = result.messageId ?? null;
      if (!messageGroups.has(msgId)) {
        messageGroups.set(msgId, new Set());
      }
      messageGroups.get(msgId)!.add(result.hash);
      allEntries.set(result.hash, { purpose: result.purpose, request: result });
    }

    for (const [msgId] of messageGroups) {
      if (msgId !== null) {
        const relatedEntries = this.findByMessageId(msgId);
        for (const entry of relatedEntries) {
          if (!messageGroups.get(msgId)!.has(entry.request.hash)) {
            messageGroups.get(msgId)!.add(entry.request.hash);
            allEntries.set(entry.request.hash, entry);
          }
        }
      }
    }

    const results: {
      messageId: number | null;
      entries: { purpose: CachePurpose; request: CachedLLMRequest }[];
    }[] = [];

    for (const [msgId, hashes] of messageGroups) {
      const entries = Array.from(hashes)
        .map((hash) => allEntries.get(hash)!)
        .sort(
          (a, b) =>
            new Date(a.request.timestamp).getTime() - new Date(b.request.timestamp).getTime()
        );

      results.push({ messageId: msgId, entries });
    }

    results.sort((a, b) => {
      const aTime = Math.max(...a.entries.map((e) => new Date(e.request.timestamp).getTime()));
      const bTime = Math.max(...b.entries.map((e) => new Date(e.request.timestamp).getTime()));
      return bTime - aTime;
    });

    return results;
  }

  /**
   * Delete cache entries older than the specified age in days
   */
  clearOlderThan(days: number): number {
    if (!this.enabled || this.backend === 's3') return 0;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffTime = cutoffDate.getTime();
    let deletedCount = 0;

    for (const purpose of this.purposes) {
      const purposeDir = path.join(this.cacheRootDir, purpose);

      if (!fs.existsSync(purposeDir)) {
        continue;
      }

      const files = fs.readdirSync(purposeDir).filter((f) => f.endsWith('.json'));

      for (const file of files) {
        try {
          const filePath = path.join(purposeDir, file);
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          const cached = JSON.parse(fileContent) as CachedLLMRequest;

          const timestamp = new Date(cached.timestamp).getTime();
          if (timestamp < cutoffTime) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch (error) {
          logger.error(`Error processing cache file ${file}:`, error);
        }
      }
    }

    logger.info(`Deleted ${deletedCount} cached requests older than ${days} days`);
    return deletedCount;
  }

  /**
   * Async version of clearOlderThan() for S3 support
   */
  async clearOlderThanAsync(days: number): Promise<number> {
    if (!this.enabled) return 0;

    if (this.backend === 's3') {
      const maxAgeMs = days * 24 * 60 * 60 * 1000;
      let totalDeleted = 0;

      for (const purpose of this.purposes) {
        try {
          const deleted = await cacheStorage.clearOlderThan(`llm/${purpose}`, maxAgeMs);
          totalDeleted += deleted;
        } catch (error) {
          logger.error(`Error clearing old cache for ${purpose}:`, error);
        }
      }

      logger.info(`Deleted ${totalDeleted} cached requests older than ${days} days (S3)`);
      return totalDeleted;
    }

    return this.clearOlderThan(days);
  }
}

// Export singleton instance
export const llmCache = new LLMCache();
