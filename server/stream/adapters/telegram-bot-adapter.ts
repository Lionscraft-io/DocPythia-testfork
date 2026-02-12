/**
 * Telegram Bot Stream Adapter
 * Push-based message ingestion from Telegram channels and groups

 * Date: 2025-11-04
 * Reference: /docs/specs/telegram-bot-integration.md
 */

import { Telegraf, Context } from 'telegraf';
import { Message, Update } from 'telegraf/types';
import { BaseStreamAdapter } from './base-adapter.js';
import { StreamMessage, StreamWatermark } from '../types.js';
import { PrismaClient } from '@prisma/client';
import prisma from '../../db.js';
import https from 'https';

export interface TelegramBotConfig {
  botToken: string; // Telegram bot token from @BotFather
  mode: 'webhook' | 'polling'; // Webhook for production, polling for dev
  webhookUrl?: string; // Required if mode=webhook
  webhookPath?: string; // URL path for webhook (default: /telegram-webhook)
  pollingInterval?: number; // Polling interval in ms (default: 3000)
  allowedChats?: string[]; // Whitelist of chat IDs (optional)
  ignoreOldMessages?: boolean; // Ignore messages sent before bot started (default: true)
  processCommands?: boolean; // Process bot commands (default: false)
  saveRawUpdates?: boolean; // Save full Telegram update JSON (default: true)
}

export class TelegramBotAdapter extends BaseStreamAdapter {
  private bot!: Telegraf;
  private botConfig!: TelegramBotConfig;
  private isRunning = false;

  constructor(streamId: string, db: PrismaClient) {
    super(streamId, 'telegram-bot', db);
  }

  /**
   * Validate Telegram bot configuration
   */
  validateConfig(config: any): boolean {
    if (!config.botToken || typeof config.botToken !== 'string') {
      console.error('TelegramBotAdapter: botToken is required');
      return false;
    }

    if (!config.mode || !['webhook', 'polling'].includes(config.mode)) {
      console.error('TelegramBotAdapter: mode must be "webhook" or "polling"');
      return false;
    }

    if (config.mode === 'webhook' && !config.webhookUrl) {
      console.error('TelegramBotAdapter: webhookUrl is required for webhook mode');
      return false;
    }

    this.botConfig = {
      mode: config.mode,
      botToken: config.botToken,
      webhookUrl: config.webhookUrl,
      webhookPath: config.webhookPath || '/telegram-webhook',
      pollingInterval: config.pollingInterval || 3000,
      allowedChats: config.allowedChats || [],
      ignoreOldMessages: config.ignoreOldMessages !== false, // default true
      processCommands: config.processCommands || false,
      saveRawUpdates: config.saveRawUpdates !== false, // default true
    };

    return true;
  }

  /**
   * Initialize Telegram bot and set up message handlers
   */
  async initialize(config: any): Promise<void> {
    await super.initialize(config);

    // Create custom HTTPS agent that forces IPv4 (fixes IPv6 timeout issue)
    const ipv4Agent = new https.Agent({
      family: 4, // Force IPv4
      keepAlive: true,
    });

    // Create Telegraf bot instance with custom agent
    this.bot = new Telegraf(this.botConfig.botToken, {
      telegram: {
        agent: ipv4Agent, // Use IPv4-only agent
      },
    });

    // Set up message handler
    this.bot.on('message', async (ctx) => {
      await this.handleMessage(ctx);
    });

    // Set up channel post handler (for channels where bot is admin)
    this.bot.on('channel_post', async (ctx) => {
      await this.handleMessage(ctx);
    });

    // Optional: Set up commands handler
    if (this.botConfig.processCommands) {
      this.setupCommandHandlers();
    }

    // Start bot based on mode
    if (this.botConfig.mode === 'webhook') {
      await this.startWebhook();
    } else {
      await this.startPolling();
    }

    console.log(`TelegramBotAdapter initialized in ${this.botConfig.mode} mode (IPv4-only)`);
  }

  /**
   * Start webhook mode (production)
   */
  private async startWebhook(): Promise<void> {
    const { webhookUrl, webhookPath } = this.botConfig;

    // Set webhook
    await this.bot.telegram.setWebhook(`${webhookUrl}${webhookPath}`);
    console.log(`Telegram webhook set to: ${webhookUrl}${webhookPath}`);

    // Webhook will be handled by Express middleware (see routes/admin-routes.ts)
    this.isRunning = true;
  }

  /**
   * Start polling mode (development)
   * Note: bot.launch() is not awaited to prevent blocking adapter registration
   */
  private async startPolling(): Promise<void> {
    console.log(`[TelegramAdapter ${this.streamId}] Starting polling mode...`);

    // Don't await bot.launch() - it can hang if there are network issues
    // This allows the adapter to be registered even if polling fails to start
    this.bot
      .launch()
      .then(() => {
        this.isRunning = true;
        console.log(`[TelegramAdapter ${this.streamId}] Polling started successfully`);
      })
      .catch((error) => {
        console.error(`[TelegramAdapter ${this.streamId}] Failed to start polling:`, error.message);
        if (error.message.includes('409') || error.message.includes('terminated')) {
          console.error(
            `[TelegramAdapter ${this.streamId}] 409 CONFLICT: Another bot instance is already polling!`
          );
          console.error(
            `[TelegramAdapter ${this.streamId}] Check for: other App Runner revisions, local dev instances, or duplicate deployments`
          );
        }
        // Bot is still usable for fetchMessages (which returns empty for push-based bot)
        // Polling will not work but the adapter is registered
      });

    // Mark as "attempting to run" so cleanup knows to stop it
    this.isRunning = true;
    console.log(`[TelegramAdapter ${this.streamId}] Polling initiated (non-blocking)`);
  }

  /**
   * Handle incoming Telegram message or channel post
   */
  private async handleMessage(ctx: Context): Promise<void> {
    try {
      const message = ctx.message || ctx.channelPost;
      console.log(`[TelegramAdapter ${this.streamId}] Received update:`, {
        updateId: ctx.update.update_id,
        hasMessage: !!ctx.message,
        hasChannelPost: !!ctx.channelPost,
        chatId: message?.chat?.id,
      });

      if (!message || !('text' in message)) {
        console.log(`[TelegramAdapter ${this.streamId}] Ignoring non-text message`);
        return; // Ignore non-text messages for now
      }

      const chatId = message.chat.id.toString();

      // Check whitelist if configured
      if (
        this.botConfig.allowedChats &&
        this.botConfig.allowedChats.length > 0 &&
        !this.botConfig.allowedChats.includes(chatId)
      ) {
        console.log(`[TelegramAdapter ${this.streamId}] Ignoring non-whitelisted chat: ${chatId}`);
        console.log(
          `[TelegramAdapter ${this.streamId}] Allowed chats: ${this.botConfig.allowedChats.join(', ')}`
        );
        return;
      }

      // Get watermark to check if we should process this message
      const watermark = await this.getWatermark();

      // Check if this update_id has already been processed
      if (watermark.lastProcessedId) {
        const lastUpdateId = parseInt(watermark.lastProcessedId);
        const currentUpdateId = ctx.update.update_id;

        if (currentUpdateId <= lastUpdateId) {
          console.log(`Skipping already processed update: ${currentUpdateId}`);
          return;
        }
      }

      // Normalize message to StreamMessage format
      const streamMessage = this.normalizeMessage(message, ctx.update);

      // Save to database
      const savedIds = await this.saveMessages([streamMessage]);

      if (savedIds.length > 0) {
        // Update watermark
        await this.updateWatermark(streamMessage.timestamp, ctx.update.update_id.toString(), 1);

        console.log(
          `Telegram message saved: ${streamMessage.messageId} from ${streamMessage.author} in ${streamMessage.channel}`
        );
      }
    } catch (error) {
      console.error('Error handling Telegram message:', error);
    }
  }

  /**
   * Normalize Telegram message to StreamMessage format
   */
  private normalizeMessage(message: Message.TextMessage, update: Update): StreamMessage {
    const chatType = message.chat.type; // 'private', 'group', 'supergroup', 'channel'
    const chatTitle = 'title' in message.chat ? message.chat.title : 'Direct Message';

    const author = message.from
      ? `${message.from.first_name}${message.from.last_name ? ' ' + message.from.last_name : ''}` +
        (message.from.username ? ` (@${message.from.username})` : '')
      : 'Unknown';

    return {
      messageId: `${message.chat.id}-${message.message_id}`, // Unique: chatId-messageId
      timestamp: new Date(message.date * 1000),
      author,
      content: message.text,
      channel: chatTitle,
      rawData: this.botConfig.saveRawUpdates ? update : { message_id: message.message_id },
      metadata: {
        chatId: message.chat.id.toString(),
        chatType,
        userId: message.from?.id.toString(),
        username: message.from?.username,
        updateId: update.update_id,
        messageThreadId: 'message_thread_id' in message ? message.message_thread_id : undefined,
        replyToMessageId: message.reply_to_message?.message_id,
      },
    };
  }

  /**
   * Fetch messages (not applicable for push-based bot)
   * This method exists to satisfy StreamAdapter interface
   * Messages are received via handleMessage() instead
   */
  async fetchMessages(_watermark?: StreamWatermark): Promise<StreamMessage[]> {
    // Telegram bot is push-based, not pull-based
    // Messages are automatically processed via webhooks/polling
    console.log('TelegramBotAdapter: fetchMessages() is not used (push-based bot)');
    return [];
  }

  /**
   * Set up optional command handlers
   */
  private setupCommandHandlers(): void {
    // /start command
    this.bot.command('start', async (ctx) => {
      await ctx.reply('Hello! I am listening to messages in this chat for documentation analysis.');
    });

    // /status command
    this.bot.command('status', async (ctx) => {
      const watermark = await this.getWatermark();
      const stats = await this.getStreamStats();

      await ctx.reply(
        `📊 *Stream Status*\n\n` +
          `Last processed: ${watermark.lastProcessedTime?.toISOString() || 'Never'}\n` +
          `Total messages: ${stats.totalMessages}\n` +
          `Pending processing: ${stats.pendingMessages}`,
        { parse_mode: 'Markdown' }
      );
    });
  }

  /**
   * Get stream statistics
   */
  private async getStreamStats(): Promise<{ totalMessages: number; pendingMessages: number }> {
    const totalMessages = await prisma.unifiedMessage.count({
      where: { streamId: this.streamId },
    });

    const pendingMessages = await prisma.unifiedMessage.count({
      where: {
        streamId: this.streamId,
        processingStatus: 'PENDING',
      },
    });

    return { totalMessages, pendingMessages };
  }

  /**
   * Cleanup bot resources
   */
  async cleanup(): Promise<void> {
    if (this.isRunning) {
      console.log(`Stopping Telegram bot ${this.streamId}...`);

      if (this.botConfig.mode === 'webhook') {
        await this.bot.telegram.deleteWebhook();
      } else {
        this.bot.stop();
      }

      this.isRunning = false;
    }

    await super.cleanup();
  }

  /**
   * Get bot instance for Express webhook integration
   */
  public getBotInstance(): Telegraf {
    return this.bot;
  }
}
