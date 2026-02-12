/**
 * Stream Manager
 * Central coordinator for all stream adapters with scheduling and concurrency control

 * Date: 2025-10-30
 * Reference: /docs/specs/multi-stream-scanner-phase-1.md
 */

import { PrismaClient } from '@prisma/client';
import cron, { ScheduledTask } from 'node-cron';
import type { StreamAdapter } from './types.js';
import { CsvFileAdapter } from './adapters/csv-file-adapter.js';
import { TelegramBotAdapter } from './adapters/telegram-bot-adapter.js';
import { ZulipBotAdapter } from './adapters/zulip-bot-adapter.js';
import { InstanceConfigLoader } from '../config/instance-loader.js';
import { getInstanceDb } from '../db/instance-db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('StreamManager');

// Create prisma client for stream management operations
const prisma = new PrismaClient();

export interface StreamManagerConfig {
  maxConcurrentStreams?: number;
  defaultBatchSize?: number;
  enableScheduling?: boolean;
  errorRetryAttempts?: number;
  errorRetryDelay?: number;
}

export interface StreamHealth {
  streamId: string;
  isHealthy: boolean;
  lastSuccessfulRun: Date | null;
  lastError: string | null;
  totalProcessed: number;
  errorCount: number;
}

export class StreamManager {
  private adapters: Map<string, StreamAdapter> = new Map();
  private jobs: Map<string, ScheduledTask> = new Map();
  private runningStreams: Set<string> = new Set();
  private config: Required<StreamManagerConfig>;
  private streamToInstance: Map<string, string> = new Map(); // Track which instance each stream belongs to

  constructor(config?: StreamManagerConfig) {
    const schedulingEnabled = process.env.STREAM_SCHEDULING_ENABLED === 'true';

    this.config = {
      maxConcurrentStreams:
        config?.maxConcurrentStreams || parseInt(process.env.MAX_CONCURRENT_STREAMS || '3'),
      defaultBatchSize:
        config?.defaultBatchSize || parseInt(process.env.MESSAGE_BATCH_SIZE || '10'),
      enableScheduling: config?.enableScheduling ?? schedulingEnabled,
      errorRetryAttempts:
        config?.errorRetryAttempts || parseInt(process.env.STREAM_ERROR_RETRY_ATTEMPTS || '3'),
      errorRetryDelay:
        config?.errorRetryDelay || parseInt(process.env.STREAM_ERROR_RETRY_DELAY || '60000'),
    };

    logger.info('StreamManager initialized with config:', this.config);
  }

  /**
   * Initialize the stream manager by loading all configured streams
   * Loads streams from instance config files
   */
  async initialize(): Promise<void> {
    logger.info('Initializing StreamManager...');

    try {
      // Get all available instances (async for S3 support)
      const availableInstances = await InstanceConfigLoader.getAvailableInstancesAsync();
      logger.info(
        `Loading streams from ${availableInstances.length} instances:`,
        availableInstances
      );

      let totalStreams = 0;

      // Load streams from each instance config file
      for (const instanceId of availableInstances) {
        try {
          const instanceDb = getInstanceDb(instanceId);
          const instanceConfig = InstanceConfigLoader.has(instanceId)
            ? InstanceConfigLoader.get(instanceId)
            : await InstanceConfigLoader.loadAsync(instanceId);

          // Get stream configurations from instance config file
          const streamConfigs = (instanceConfig as any).streams || [];

          // Filter to enabled streams only
          const enabledStreams = streamConfigs.filter((s: any) => s.enabled === true);

          logger.info(
            `Found ${enabledStreams.length} active streams for instance "${instanceId}" (${streamConfigs.length} total)`
          );

          // Register adapters for each enabled stream
          for (const streamConfig of enabledStreams) {
            try {
              // Track which instance this stream belongs to
              this.streamToInstance.set(streamConfig.streamId, instanceId);

              await this.registerStream(streamConfig, instanceId, instanceDb);
              totalStreams++;
            } catch (error) {
              logger.error(
                `Failed to register stream ${streamConfig.streamId} for instance ${instanceId}:`,
                error
              );
            }
          }
        } catch (error) {
          logger.error(`Failed to load streams for instance "${instanceId}":`, error);
        }
      }

      logger.info(
        `StreamManager initialized with ${totalStreams} streams across ${availableInstances.length} instances`
      );
    } catch (error) {
      logger.error('Failed to initialize StreamManager:', error);
      throw error;
    }
  }

  /**
   * Register a stream adapter with optional scheduling
   * @param streamConfig - Stream configuration from instance config file
   * @param instanceId - Instance ID this stream belongs to
   * @param instanceDb - Database client for this instance
   */
  async registerStream(
    streamConfig: any,
    instanceId: string,
    instanceDb: PrismaClient
  ): Promise<void> {
    const { streamId, adapterType, config: adapterConfig, schedule } = streamConfig;

    logger.info(`Registering stream: ${streamId} (${adapterType}) for instance: ${instanceId}`);
    logger.debug(`Adapter config:`, JSON.stringify(adapterConfig, null, 2));

    // Enhance adapter config with instance-specific environment variables
    const enhancedConfig = this.injectEnvVars(adapterConfig, adapterType, instanceId);

    // Create adapter instance based on type
    const adapter = this.createAdapter(
      streamId,
      adapterType,
      enhancedConfig,
      instanceId,
      instanceDb
    );

    if (!adapter) {
      throw new Error(`Unknown adapter type: ${adapterType}`);
    }

    // Validate and initialize adapter configuration
    const isValid = adapter.validateConfig(enhancedConfig);
    if (!isValid) {
      throw new Error(`Invalid configuration for stream ${streamId}`);
    }

    // Initialize the adapter
    await adapter.initialize(enhancedConfig);

    // Store adapter
    this.adapters.set(streamId, adapter);

    // Set up scheduled job if schedule is provided
    if (schedule && this.config.enableScheduling) {
      this.scheduleStream(streamId, schedule);
    }

    logger.info(`Stream ${streamId} registered successfully for instance ${instanceId}`);
  }

  /**
   * Inject instance-specific environment variables into adapter config
   * Uses predictable pattern: {INSTANCE_UPPERCASE}_{ADAPTER}_TOKEN
   * Falls back to generic env vars, then to database config
   */
  private injectEnvVars(adapterConfig: any, adapterType: string, instanceId: string): any {
    const config = { ...adapterConfig };
    const instanceUpper = instanceId.toUpperCase();

    switch (adapterType) {
      case 'telegram-bot': {
        // Check for bot token in order of precedence:
        // 1. Instance-specific: PROJECTA_TELEGRAM_BOT_TOKEN
        // 2. Generic: TELEGRAM_BOT_TOKEN
        // 3. Database config: config.botToken
        const instanceTokenKey = `${instanceUpper}_TELEGRAM_BOT_TOKEN`;
        const genericTokenKey = 'TELEGRAM_BOT_TOKEN';

        if (process.env[instanceTokenKey]) {
          config.botToken = process.env[instanceTokenKey];
          logger.debug(`Using Telegram bot token from ${instanceTokenKey} (env)`);
        } else if (process.env[genericTokenKey] && !config.botToken) {
          config.botToken = process.env[genericTokenKey];
          logger.debug(`Using Telegram bot token from ${genericTokenKey} (env)`);
        } else if (config.botToken) {
          logger.debug(`Using Telegram bot token from database config`);
        } else {
          logger.warn(`No Telegram bot token found for instance ${instanceId}`);
        }

        // Inject other Telegram-specific env vars
        if (process.env.TELEGRAM_BOT_MODE && !config.mode) {
          config.mode = process.env.TELEGRAM_BOT_MODE;
        }
        if (process.env.TELEGRAM_WEBHOOK_URL && !config.webhookUrl) {
          config.webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
        }
        if (process.env.TELEGRAM_WEBHOOK_PATH && !config.webhookPath) {
          config.webhookPath = process.env.TELEGRAM_WEBHOOK_PATH;
        }
        if (process.env.TELEGRAM_POLLING_INTERVAL && !config.pollingInterval) {
          config.pollingInterval = parseInt(process.env.TELEGRAM_POLLING_INTERVAL);
        }
        if (process.env.TELEGRAM_ALLOWED_CHATS && !config.allowedChats) {
          config.allowedChats = process.env.TELEGRAM_ALLOWED_CHATS.split(',').map((s) => s.trim());
        }
        if (
          process.env.TELEGRAM_IGNORE_OLD_MESSAGES !== undefined &&
          config.ignoreOldMessages === undefined
        ) {
          config.ignoreOldMessages = process.env.TELEGRAM_IGNORE_OLD_MESSAGES === 'true';
        }
        if (
          process.env.TELEGRAM_PROCESS_COMMANDS !== undefined &&
          config.processCommands === undefined
        ) {
          config.processCommands = process.env.TELEGRAM_PROCESS_COMMANDS === 'true';
        }
        if (
          process.env.TELEGRAM_SAVE_RAW_UPDATES !== undefined &&
          config.saveRawUpdates === undefined
        ) {
          config.saveRawUpdates = process.env.TELEGRAM_SAVE_RAW_UPDATES === 'true';
        }
        break;
      }

      case 'zulipchat': {
        // Check for credentials in order of precedence
        const instanceEmailKey = `${instanceUpper}_ZULIP_BOT_EMAIL`;
        const instanceApiKeyKey = `${instanceUpper}_ZULIP_API_KEY`;

        if (process.env[instanceEmailKey]) {
          config.email = process.env[instanceEmailKey];
          logger.debug(`Using Zulip email from ${instanceEmailKey} (env)`);
        } else if (process.env.ZULIP_BOT_EMAIL && !config.email) {
          config.email = process.env.ZULIP_BOT_EMAIL;
          logger.debug(`Using Zulip email from ZULIP_BOT_EMAIL (env)`);
        } else if (config.email) {
          logger.debug(`Using Zulip email from database config`);
        } else {
          logger.warn(`No Zulip email found for instance ${instanceId}`);
        }

        if (process.env[instanceApiKeyKey]) {
          config.apiKey = process.env[instanceApiKeyKey];
          logger.debug(`Using Zulip API key from ${instanceApiKeyKey} (env)`);
        } else if (process.env.ZULIP_API_KEY && !config.apiKey) {
          config.apiKey = process.env.ZULIP_API_KEY;
          logger.debug(`Using Zulip API key from ZULIP_API_KEY (env)`);
        } else if (config.apiKey) {
          logger.debug(`Using Zulip API key from database config`);
        } else {
          logger.warn(`No Zulip API key found for instance ${instanceId}`);
        }

        // Optional: override config values from env
        if (process.env.ZULIP_SITE && !config.site) {
          config.site = process.env.ZULIP_SITE;
        }
        if (process.env.ZULIP_POLLING_INTERVAL && !config.pollingInterval) {
          config.pollingInterval = parseInt(process.env.ZULIP_POLLING_INTERVAL);
        }
        if (process.env.ZULIP_BATCH_SIZE && !config.batchSize) {
          config.batchSize = parseInt(process.env.ZULIP_BATCH_SIZE);
        }
        if (
          process.env.ZULIP_IGNORE_OLD_MESSAGES !== undefined &&
          config.ignoreOldMessages === undefined
        ) {
          config.ignoreOldMessages = process.env.ZULIP_IGNORE_OLD_MESSAGES === 'true';
        }
        break;
      }

      // Add more adapter types here as needed
      case 'discord': {
        const discordTokenKey = `${instanceUpper}_DISCORD_BOT_TOKEN`;
        if (process.env[discordTokenKey]) {
          config.botToken = process.env[discordTokenKey];
          logger.debug(`Using Discord bot token from ${discordTokenKey} (env)`);
        } else if (process.env.DISCORD_BOT_TOKEN && !config.botToken) {
          config.botToken = process.env.DISCORD_BOT_TOKEN;
          logger.debug(`Using Discord bot token from DISCORD_BOT_TOKEN (env)`);
        }
        break;
      }
    }

    return config;
  }

  /**
   * Create an adapter instance based on type
   */
  private createAdapter(
    streamId: string,
    adapterType: string,
    adapterConfig: any,
    instanceId: string,
    instanceDb: PrismaClient
  ): StreamAdapter | null {
    switch (adapterType) {
      case 'csv':
        return new CsvFileAdapter(streamId, instanceDb);

      case 'telegram-bot':
        return new TelegramBotAdapter(streamId, instanceDb);

      case 'zulipchat':
        return new ZulipBotAdapter(streamId, instanceDb);

      // Add more adapter types here as they're implemented
      // case 'discord':
      //   return new DiscordAdapter(streamId, instanceDb);
      // case 'slack':
      //   return new SlackAdapter(streamId, instanceDb);

      default:
        return null;
    }
  }

  /**
   * Schedule a stream to run on a cron schedule
   */
  private scheduleStream(streamId: string, cronSchedule: string): void {
    logger.info(`Scheduling stream ${streamId} with schedule: ${cronSchedule}`);

    try {
      const job = cron.schedule(
        cronSchedule,
        async () => {
          await this.runStream(streamId);
        },
        {
          timezone: 'UTC',
        }
      );

      this.jobs.set(streamId, job);
      logger.info(`Stream ${streamId} scheduled successfully`);
    } catch (error) {
      logger.error(`Failed to schedule stream ${streamId}:`, error);
      throw error;
    }
  }

  /**
   * Import messages from a stream without processing
   */
  async importStream(streamId: string, batchSize?: number): Promise<number> {
    logger.debug(
      `importStream called for ${streamId}, registered adapters: ${Array.from(this.adapters.keys()).join(', ')}`
    );
    const adapter = this.adapters.get(streamId);
    if (!adapter) {
      throw new Error(`Stream ${streamId} not found`);
    }

    logger.info(`Importing from stream: ${streamId}`);

    // Get current watermark
    const watermark = await adapter.getWatermark();
    logger.debug(`Current watermark:`, watermark);

    // Fetch new messages (this already saves them to the database)
    const messages = await adapter.fetchMessages(
      watermark,
      batchSize || this.config.defaultBatchSize
    );

    if (messages.length === 0) {
      logger.debug(`No new messages for stream ${streamId}`);
      return 0;
    }

    logger.info(`Imported ${messages.length} new messages from ${streamId} (not yet processed)`);

    // Update watermark after successful import
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      await adapter.updateWatermark(lastMessage.timestamp, lastMessage.messageId, messages.length);
    }

    return messages.length;
  }

  /**
   * Run a single stream (fetch and process messages)
   */
  async runStream(streamId: string, batchSize?: number): Promise<void> {
    // Check concurrency limit
    if (this.runningStreams.size >= this.config.maxConcurrentStreams) {
      logger.warn(
        `Max concurrent streams reached (${this.config.maxConcurrentStreams}). Skipping ${streamId}`
      );
      return;
    }

    // Check if stream is already running
    if (this.runningStreams.has(streamId)) {
      logger.warn(`Stream ${streamId} is already running. Skipping.`);
      return;
    }

    const adapter = this.adapters.get(streamId);
    if (!adapter) {
      logger.error(`Stream ${streamId} not found`);
      return;
    }

    this.runningStreams.add(streamId);

    try {
      logger.info(`Running stream: ${streamId}`);

      // Get current watermark
      const watermark = await adapter.getWatermark();
      logger.debug(`Current watermark:`, watermark);

      // Fetch new messages
      const messages = await adapter.fetchMessages(
        watermark,
        batchSize || this.config.defaultBatchSize
      );

      if (messages.length === 0) {
        logger.debug(`No new messages for stream ${streamId}`);
        return;
      }

      logger.info(`Fetched ${messages.length} new messages from ${streamId}`);

      // Messages are now stored in database as PENDING
      // They will be processed in 24-hour batches by the batch processor
      logger.info(
        `Stream ${streamId} import complete - ${messages.length} messages imported (PENDING status)`
      );

      // Update watermark after successful processing
      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        await adapter.updateWatermark(
          lastMessage.timestamp,
          lastMessage.messageId,
          messages.length
        );
      }
    } catch (error: any) {
      logger.error(`Error running stream ${streamId}:`, error);

      // Retry logic
      await this.handleStreamError(streamId, error);
    } finally {
      this.runningStreams.delete(streamId);
    }
  }

  /**
   * Handle stream errors with retry logic
   */
  private async handleStreamError(streamId: string, error: Error): Promise<void> {
    logger.error(`Stream ${streamId} encountered error:`, error.message);
    logger.warn(`Error will be logged but stream will continue on next trigger`);

    // Disable stream after error for manual intervention
    await prisma.streamConfig.update({
      where: {
        streamId,
      },
      data: {
        enabled: false,
        // Error info is logged; config field could be used if needed
      },
    });

    logger.warn(`Stream ${streamId} disabled. Re-enable manually after fixing the issue.`);
  }

  /**
   * Run all registered streams once
   */
  async runAllStreams(): Promise<void> {
    logger.info(`Running all ${this.adapters.size} streams...`);

    const streamIds = Array.from(this.adapters.keys());

    for (const streamId of streamIds) {
      await this.runStream(streamId);
    }

    logger.info('All streams completed');
  }

  /**
   * Get health status for all streams
   */
  async getHealth(): Promise<StreamHealth[]> {
    const health: StreamHealth[] = [];

    for (const [streamId, adapter] of this.adapters.entries()) {
      try {
        const watermark = await adapter.getWatermark();

        health.push({
          streamId,
          isHealthy: true, // Stream is healthy if we can get the watermark
          lastSuccessfulRun: watermark.lastProcessedTime ?? null,
          lastError: null,
          totalProcessed: watermark.totalProcessed,
          errorCount: 0,
        });
      } catch (error: any) {
        health.push({
          streamId,
          isHealthy: false,
          lastSuccessfulRun: null,
          lastError: error.message,
          totalProcessed: 0,
          errorCount: 0,
        });
      }
    }

    return health;
  }

  /**
   * Get overall statistics
   */
  async getStats(): Promise<{
    totalStreams: number;
    activeStreams: number;
    runningStreams: number;
    scheduledStreams: number;
    totalMessagesProcessed: number;
  }> {
    // Count total messages processed from unified_messages table
    const messageCount = await prisma.unifiedMessage.count({
      where: {
        processingStatus: 'COMPLETED',
      },
    });

    return {
      totalStreams: this.adapters.size,
      activeStreams: this.adapters.size,
      runningStreams: this.runningStreams.size,
      scheduledStreams: this.jobs.size,
      totalMessagesProcessed: messageCount,
    };
  }

  /**
   * Stop a scheduled stream
   */
  stopStream(streamId: string): void {
    const job = this.jobs.get(streamId);
    if (job) {
      job.stop();
      this.jobs.delete(streamId);
      logger.info(`Stream ${streamId} stopped`);
    }
  }

  /**
   * Unregister a stream completely
   */
  async unregisterStream(streamId: string): Promise<void> {
    this.stopStream(streamId);

    const adapter = this.adapters.get(streamId);
    if (adapter) {
      await adapter.cleanup();
      this.adapters.delete(streamId);
      logger.info(`Stream ${streamId} unregistered`);
    }
  }

  /**
   * Shutdown the stream manager
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down StreamManager...');

    // Stop all jobs
    for (const [streamId, job] of this.jobs.entries()) {
      job.stop();
      logger.debug(`Stopped job for ${streamId}`);
    }

    // Cleanup all adapters
    for (const [streamId, adapter] of this.adapters.entries()) {
      await adapter.cleanup();
      logger.debug(`Cleaned up adapter for ${streamId}`);
    }

    this.jobs.clear();
    this.adapters.clear();
    this.runningStreams.clear();

    logger.info('StreamManager shutdown complete');
  }

  /**
   * Get all registered adapters
   * Useful for webhook endpoints to access bot instances
   */
  getAdapters(): Map<string, StreamAdapter> {
    return this.adapters;
  }

  /**
   * Get a specific adapter by streamId
   */
  getAdapter(streamId: string): StreamAdapter | undefined {
    return this.adapters.get(streamId);
  }
}

// Export singleton instance
export const streamManager = new StreamManager();
