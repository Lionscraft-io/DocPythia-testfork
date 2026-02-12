/**
 * Base Stream Adapter
 * Abstract base class for all stream adapters

 * Date: 2025-10-30
 * Reference: /docs/specs/multi-stream-scanner-phase-1.md
 */

import { PrismaClient } from '@prisma/client';
import { StreamAdapter, StreamMessage, StreamWatermark } from '../types.js';

export abstract class BaseStreamAdapter implements StreamAdapter {
  public readonly streamId: string;
  public readonly adapterType: string;
  protected config: any;
  protected initialized = false;
  protected db: PrismaClient; // Instance-specific database client

  constructor(streamId: string, adapterType: string, db: PrismaClient) {
    this.streamId = streamId;
    this.adapterType = adapterType;
    this.db = db;
  }

  /**
   * Initialize the adapter with configuration
   */
  async initialize(config: any): Promise<void> {
    if (!this.validateConfig(config)) {
      throw new Error(`Invalid configuration for adapter ${this.streamId}`);
    }

    this.config = config;

    // Ensure stream config exists in database
    await this.ensureStreamConfig();

    // Ensure watermark exists in database
    await this.ensureWatermark();

    this.initialized = true;
    console.log(`StreamAdapter ${this.streamId} (${this.adapterType}) initialized`);
  }

  /**
   * Fetch messages since the last watermark
   * Must be implemented by concrete adapters
   */
  abstract fetchMessages(watermark?: StreamWatermark, batchSize?: number): Promise<StreamMessage[]>;

  /**
   * Validate adapter configuration
   * Must be implemented by concrete adapters
   */
  abstract validateConfig(config: any): boolean;

  /**
   * Clean up resources
   * Can be overridden by concrete adapters
   */
  async cleanup(): Promise<void> {
    console.log(`StreamAdapter ${this.streamId} cleaned up`);
  }

  /**
   * Get current watermark from database
   */
  public async getWatermark(): Promise<StreamWatermark> {
    const watermark = await this.db.importWatermark.findFirst({
      where: {
        streamId: this.streamId,
        resourceId: null,
      },
    });

    if (!watermark) {
      return {
        lastProcessedTime: undefined,
        lastProcessedId: undefined,
        totalProcessed: 0,
      };
    }

    return {
      lastProcessedTime: watermark.lastImportedTime || undefined,
      lastProcessedId: watermark.lastImportedId || undefined,
      totalProcessed: 0, // No longer tracked in database
    };
  }

  /**
   * Update watermark in database
   */
  public async updateWatermark(
    lastProcessedTime: Date,
    lastProcessedId: string,
    messagesProcessed: number
  ): Promise<void> {
    await this.db.importWatermark.updateMany({
      where: {
        streamId: this.streamId,
        resourceId: null,
      },
      data: {
        lastImportedTime: lastProcessedTime,
        lastImportedId: lastProcessedId,
        // totalProcessed is no longer tracked in the database
      },
    });

    console.log(
      `Watermark updated for ${this.streamId}: ${lastProcessedTime.toISOString()}, ID: ${lastProcessedId}, +${messagesProcessed} messages`
    );
  }

  /**
   * Ensure stream config exists in database
   */
  private async ensureStreamConfig(): Promise<void> {
    const existing = await this.db.streamConfig.findUnique({
      where: { streamId: this.streamId },
    });

    if (!existing) {
      await this.db.streamConfig.create({
        data: {
          streamId: this.streamId,
          adapterType: this.adapterType,
          config: this.config,
          enabled: true,
        },
      });
      console.log(`Created stream config for ${this.streamId}`);
    } else {
      // Update config if changed
      await this.db.streamConfig.update({
        where: { streamId: this.streamId },
        data: {
          config: this.config,
          adapterType: this.adapterType,
        },
      });
      console.log(`Updated stream config for ${this.streamId}`);
    }
  }

  /**
   * Ensure watermark exists in database
   */
  private async ensureWatermark(): Promise<void> {
    const existing = await this.db.importWatermark.findFirst({
      where: {
        streamId: this.streamId,
        resourceId: null,
      },
    });

    if (!existing) {
      await this.db.importWatermark.create({
        data: {
          streamId: this.streamId,
          streamType: this.adapterType,
          resourceId: null,
        },
      });
      console.log(`Created watermark for ${this.streamId}`);
    }

    // Safety: sync watermark with actual latest message in database
    await this.syncWatermarkWithLatestMessage();
  }

  /**
   * Safety mechanism: Sync watermark to match the actual latest message in database.
   * This prevents watermark drift if updates fail or messages are imported out of order.
   */
  private async syncWatermarkWithLatestMessage(): Promise<void> {
    try {
      // Get the actual latest message from the database for this stream
      const latestMessage = await this.db.unifiedMessage.findFirst({
        where: { streamId: this.streamId },
        orderBy: { timestamp: 'desc' },
        select: { messageId: true, timestamp: true },
      });

      if (!latestMessage) {
        console.log(`[${this.streamId}] No messages in database, watermark unchanged`);
        return;
      }

      // Get current watermark
      const currentWatermark = await this.getWatermark();

      // Compare: if DB has newer message than watermark, sync it
      if (
        !currentWatermark.lastProcessedId ||
        latestMessage.messageId !== currentWatermark.lastProcessedId
      ) {
        // Check if the latest message is actually newer (by timestamp)
        const isNewer =
          !currentWatermark.lastProcessedTime ||
          latestMessage.timestamp > currentWatermark.lastProcessedTime;

        if (isNewer) {
          console.log(
            `[${this.streamId}] Syncing watermark: ${currentWatermark.lastProcessedId || 'none'} -> ${latestMessage.messageId}`
          );
          await this.updateWatermark(latestMessage.timestamp, latestMessage.messageId, 0);
        }
      }
    } catch (error) {
      console.error(`[${this.streamId}] Failed to sync watermark with latest message:`, error);
      // Don't throw - this is a safety mechanism, not critical path
    }
  }

  /**
   * Save messages to database
   */
  protected async saveMessages(messages: StreamMessage[]): Promise<number[]> {
    const savedIds: number[] = [];

    for (const message of messages) {
      try {
        // Check if message already exists
        const existing = await this.db.unifiedMessage.findUnique({
          where: {
            streamId_messageId: {
              streamId: this.streamId,
              messageId: message.messageId,
            },
          },
        });

        if (existing) {
          console.log(`Message ${message.messageId} already exists, skipping`);
          savedIds.push(existing.id);
          continue;
        }

        // Insert new message
        const saved = await this.db.unifiedMessage.create({
          data: {
            streamId: this.streamId,
            messageId: message.messageId,
            timestamp: message.timestamp,
            author: message.author,
            content: message.content,
            channel: message.channel,
            rawData: message.rawData,
            metadata: message.metadata,
          },
        });

        savedIds.push(saved.id);
      } catch (error) {
        console.error(`Error saving message ${message.messageId}:`, error);
        // Continue with next message
      }
    }

    console.log(`Saved ${savedIds.length}/${messages.length} messages for ${this.streamId}`);
    return savedIds;
  }

  /**
   * Helper to check if adapter is initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Adapter ${this.streamId} is not initialized. Call initialize() first.`);
    }
  }
}
