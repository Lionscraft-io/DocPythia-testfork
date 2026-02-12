/**
 * Storage Module
 * Exports all storage services for centralized access
 */

export { s3Storage, type S3Config, type S3StorageOptions } from './s3-client';
export { configStorage, type ConfigStorageOptions } from './config-storage';
export {
  cacheStorage,
  type CacheBackend,
  type CacheStorageOptions,
  type CacheEntry,
} from './cache-storage';

/**
 * Initialize all storage services from environment
 * Call this at application startup
 */
export function initializeStorage(): void {
  // Import s3Storage to initialize it
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { s3Storage } = require('./s3-client');
  s3Storage.initializeFromEnv();
}
