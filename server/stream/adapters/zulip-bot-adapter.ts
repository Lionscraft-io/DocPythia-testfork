/**
 * Zulip Stream Adapter
 * Pull-based polling adapter for Zulip channels

 * Date: 2025-11-17
 * Reference: /docs/specs/zulip-stream-adapter.md
 */

import { BaseStreamAdapter } from './base-adapter.js';
import { StreamMessage, StreamWatermark } from '../types.js';
import { PrismaClient } from '@prisma/client';

export interface ZulipBotConfig {
  email: string; // Bot email for Zulip authentication
  apiKey: string; // API key from Zulip settings
  site: string; // Zulip site URL (e.g., https://example.zulipchat.com)
  channel: string; // Single channel/stream name to monitor
  pollingInterval?: number; // Default: 30000ms (30 seconds)
  batchSize?: number; // Messages per fetch (default: 100)
  ignoreOldMessages?: boolean; // Ignore messages before adapter initialization
  startDate?: string; // ISO date to start fetching from (e.g., "2024-09-01")
}

export interface ZulipMessage {
  id: number;
  sender_id: number;
  sender_full_name: string;
  sender_email: string;
  timestamp: number;
  content: string;
  display_recipient: string | Array<{ id: number; email: string; full_name: string }>;
  subject: string;
  type: 'stream' | 'private';
}

export interface ZulipMessagesResponse {
  messages: ZulipMessage[];
  result: string;
  msg: string;
}

export class ZulipBotAdapter extends BaseStreamAdapter {
  private botConfig!: ZulipBotConfig;
  private pollingTimer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(streamId: string, db: PrismaClient) {
    super(streamId, 'zulip', db);
  }

  /**
   * Validate Zulip bot configuration
   */
  validateConfig(config: any): boolean {
    if (!config.email || typeof config.email !== 'string') {
      console.error('ZulipBotAdapter: email is required');
      return false;
    }

    if (!config.apiKey || typeof config.apiKey !== 'string') {
      console.error('ZulipBotAdapter: apiKey is required');
      return false;
    }

    if (!config.site || typeof config.site !== 'string') {
      console.error('ZulipBotAdapter: site is required');
      return false;
    }

    if (!config.channel || typeof config.channel !== 'string') {
      console.error('ZulipBotAdapter: channel is required');
      return false;
    }

    // Validate site URL
    try {
      new URL(config.site);
    } catch {
      console.error('ZulipBotAdapter: site must be a valid URL');
      return false;
    }

    this.botConfig = {
      email: config.email,
      apiKey: config.apiKey,
      site: config.site,
      channel: config.channel,
      pollingInterval: config.pollingInterval || 30000,
      batchSize: config.batchSize || 100,
      ignoreOldMessages: config.ignoreOldMessages !== false,
    };

    return true;
  }

  /**
   * Initialize Zulip adapter and test connection
   */
  async initialize(config: any): Promise<void> {
    await super.initialize(config);

    // Test connection
    const connectionOk = await this.testConnection();
    if (!connectionOk) {
      throw new Error('Failed to connect to Zulip API. Check credentials.');
    }

    console.log(`ZulipBotAdapter initialized for channel: ${this.botConfig.channel}`);
  }

  /**
   * Fetch messages from Zulip API using watermark
   */
  async fetchMessages(watermark?: StreamWatermark): Promise<StreamMessage[]> {
    this.ensureInitialized();

    const { channel, batchSize, startDate } = this.botConfig;

    let anchor: string | number = 'newest';
    let numBefore = batchSize || 100;
    let numAfter = 0;

    // Incremental fetch if watermark exists
    if (watermark?.lastProcessedId) {
      anchor = watermark.lastProcessedId;
      numBefore = 0;
      numAfter = batchSize || 100;
    }
    // If startDate is specified and no watermark, start from that date
    else if (startDate && !watermark?.lastProcessedId) {
      const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
      anchor = startTimestamp;
      numBefore = 0;
      numAfter = batchSize || 100;
      console.log(`Starting historical fetch from ${startDate} (timestamp: ${startTimestamp})`);
    }

    // Build narrow filter for specific stream/channel
    const narrow = [{ operator: 'stream', operand: channel }];

    const params = new URLSearchParams({
      anchor: anchor.toString(),
      num_before: numBefore.toString(),
      num_after: numAfter.toString(),
      narrow: JSON.stringify(narrow),
      apply_markdown: 'false',
    });

    const url = `${this.botConfig.site}/api/v1/messages?${params}`;

    // Debug logging for Zulip API request
    console.log(`[ZulipAdapter] Fetching messages with params:`, {
      channel,
      anchor,
      numBefore,
      numAfter,
      hasWatermark: !!watermark?.lastProcessedId,
      watermarkId: watermark?.lastProcessedId,
      startDate: startDate || 'none',
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Zulip API error (${response.status}): ${errorText}`);
    }

    const data: ZulipMessagesResponse = await response.json();

    // Debug logging for Zulip API response
    console.log(`[ZulipAdapter] API response:`, {
      result: data.result,
      messageCount: data.messages?.length || 0,
      foundOldest: (data as any).found_oldest,
      foundNewest: (data as any).found_newest,
      anchor: (data as any).anchor,
    });

    if (data.result !== 'success') {
      throw new Error(`Zulip API error: ${data.msg}`);
    }

    let messages = data.messages;

    // Filter out the anchor message if doing incremental fetch
    if (watermark?.lastProcessedId) {
      const beforeFilter = messages.length;
      messages = messages.filter((msg) => msg.id.toString() !== watermark.lastProcessedId);
      if (beforeFilter !== messages.length) {
        console.log(
          `[ZulipAdapter] Filtered out anchor message, ${beforeFilter} -> ${messages.length}`
        );
      }
    }

    // Normalize to StreamMessage format
    const streamMessages = messages.map((msg) => this.normalizeMessage(msg));

    // Save messages to database
    if (streamMessages.length > 0) {
      await this.saveMessages(streamMessages);

      // Update watermark
      const lastMessage = streamMessages[streamMessages.length - 1];
      await this.updateWatermark(
        lastMessage.timestamp,
        lastMessage.messageId,
        streamMessages.length
      );
    }

    console.log(`Fetched ${streamMessages.length} messages from Zulip channel: ${channel}`);

    return streamMessages;
  }

  /**
   * Normalize Zulip message to StreamMessage format
   */
  private normalizeMessage(message: ZulipMessage): StreamMessage {
    const channelName =
      typeof message.display_recipient === 'string' ? message.display_recipient : 'Direct Message';

    return {
      messageId: message.id.toString(),
      timestamp: new Date(message.timestamp * 1000),
      author: message.sender_full_name,
      content: message.content,
      channel: channelName,
      rawData: message,
      metadata: {
        topic: message.subject,
        senderEmail: message.sender_email,
        senderId: message.sender_id.toString(),
        messageType: message.type,
      },
    };
  }

  /**
   * Get Basic Auth header for Zulip API
   */
  private getAuthHeader(): string {
    const credentials = `${this.botConfig.email}:${this.botConfig.apiKey}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  /**
   * Test connection to Zulip API
   */
  private async testConnection(): Promise<boolean> {
    try {
      const url = `${this.botConfig.site}/api/v1/users/me`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(),
        },
      });

      if (!response.ok) {
        console.error(`Zulip connection test failed: ${response.status}`);
        return false;
      }

      const data = await response.json();
      console.log(`Zulip connection successful. Bot: ${data.email}`);
      return true;
    } catch (error) {
      console.error('Zulip connection test failed:', error);
      return false;
    }
  }

  /**
   * Cleanup adapter resources
   */
  async cleanup(): Promise<void> {
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = undefined;
    }

    this.isRunning = false;
    await super.cleanup();
  }
}
