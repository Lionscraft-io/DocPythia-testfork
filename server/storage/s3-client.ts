/**
 * S3 Client Service
 * Provides a singleton S3 client for storage operations
 * Supports AWS S3 and S3-compatible services (MinIO, etc.)
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string; // For S3-compatible services like MinIO
}

export interface S3StorageOptions {
  prefix?: string;
  contentType?: string;
  metadata?: Record<string, string>;
}

class S3Storage {
  private client: S3Client | null = null;
  private bucket: string = '';
  private enabled: boolean = false;

  /**
   * Initialize the S3 client with configuration
   */
  initialize(config: S3Config): void {
    const clientConfig: S3ClientConfig = {
      region: config.region,
    };

    // Add credentials if provided (otherwise uses default credential chain)
    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    // Add custom endpoint for S3-compatible services
    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = true; // Required for MinIO
    }

    this.client = new S3Client(clientConfig);
    this.bucket = config.bucket;
    this.enabled = true;

    console.log(`S3 Storage initialized: bucket=${config.bucket}, region=${config.region}`);
  }

  /**
   * Initialize from environment variables
   */
  initializeFromEnv(): boolean {
    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION || 'us-east-1';

    if (!bucket) {
      console.log('S3 Storage disabled: S3_BUCKET not configured');
      this.enabled = false;
      return false;
    }

    this.initialize({
      bucket,
      region,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      endpoint: process.env.S3_ENDPOINT,
    });

    return true;
  }

  /**
   * Check if S3 storage is enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  /**
   * Get an object from S3
   */
  async get(key: string): Promise<string | null> {
    if (!this.client) {
      throw new Error('S3 client not initialized');
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.client.send(command);
      const body = await response.Body?.transformToString();
      return body || null;
    } catch (error: any) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get an object as JSON
   */
  async getJson<T>(key: string): Promise<T | null> {
    const content = await this.get(key);
    if (!content) return null;

    try {
      return JSON.parse(content) as T;
    } catch (error) {
      console.error(`Failed to parse JSON from S3 key: ${key}`, error);
      return null;
    }
  }

  /**
   * Put an object to S3
   */
  async put(key: string, content: string, options?: S3StorageOptions): Promise<void> {
    if (!this.client) {
      throw new Error('S3 client not initialized');
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: content,
      ContentType: options?.contentType || 'application/octet-stream',
      Metadata: options?.metadata,
    });

    await this.client.send(command);
  }

  /**
   * Put JSON object to S3
   */
  async putJson(key: string, data: unknown, options?: S3StorageOptions): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    await this.put(key, content, {
      ...options,
      contentType: 'application/json',
    });
  }

  /**
   * Delete an object from S3
   */
  async delete(key: string): Promise<void> {
    if (!this.client) {
      throw new Error('S3 client not initialized');
    }

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  /**
   * Check if an object exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.client) {
      throw new Error('S3 client not initialized');
    }

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * List objects with a prefix
   */
  async list(prefix: string, maxKeys: number = 1000): Promise<string[]> {
    if (!this.client) {
      throw new Error('S3 client not initialized');
    }

    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    const response = await this.client.send(command);
    return response.Contents?.map((obj) => obj.Key || '').filter(Boolean) || [];
  }

  /**
   * Upload a large file using multipart upload
   */
  async uploadLarge(
    key: string,
    content: Buffer | string,
    options?: S3StorageOptions
  ): Promise<void> {
    if (!this.client) {
      throw new Error('S3 client not initialized');
    }

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: options?.contentType || 'application/octet-stream',
        Metadata: options?.metadata,
      },
    });

    await upload.done();
  }

  /**
   * Get the configured bucket name
   */
  getBucket(): string {
    return this.bucket;
  }
}

// Export singleton instance
export const s3Storage = new S3Storage();
