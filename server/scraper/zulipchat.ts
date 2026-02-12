import { storage } from '../storage';
import https from 'https';

export interface ZulipConfig {
  email: string;
  apiKey: string;
  site: string;
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

export class ZulipchatScraper {
  private config: ZulipConfig;
  private agent: https.Agent;

  constructor(config: ZulipConfig) {
    this.config = config;
    // Create custom HTTPS agent that forces IPv4 (fixes IPv6 timeout issue)
    this.agent = new https.Agent({
      family: 4, // Force IPv4
      keepAlive: true,
    });
  }

  private getAuthHeader(): string {
    const credentials = `${this.config.email}:${this.config.apiKey}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  /**
   * Make an HTTPS request using IPv4-only agent
   */
  private async makeRequest(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(),
          'Content-Type': 'application/json',
        },
        agent: this.agent,
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Zulipchat API error (${res.statusCode}): ${data}`));
            return;
          }

          try {
            const jsonData = JSON.parse(data);
            resolve(jsonData);
          } catch (error) {
            reject(new Error(`Failed to parse JSON response: ${error}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.setTimeout(30000); // 30 second timeout
      req.end();
    });
  }

  async fetchMessages(
    channelName: string,
    numBefore: number = 100,
    anchor: string | number = 'newest'
  ): Promise<ZulipMessage[]> {
    // Use "stream" operator (not "channel") per Zulip API docs
    const narrow = [{ operator: 'stream', operand: channelName }];
    const params = new URLSearchParams({
      anchor: anchor.toString(),
      num_before: numBefore.toString(),
      num_after: '0',
      narrow: JSON.stringify(narrow),
      apply_markdown: 'false', // Get raw content for AI analysis
    });

    const url = `${this.config.site}/api/v1/messages?${params.toString()}`;

    const data: ZulipMessagesResponse = await this.makeRequest(url);

    if (data.result !== 'success') {
      throw new Error(`Zulipchat API error: ${data.msg}`);
    }

    return data.messages;
  }

  async scrapeAndStoreMessages(
    channelName: string,
    numMessages: number = 100,
    incremental: boolean = true
  ): Promise<number> {
    console.log(`Scraping messages from channel: ${channelName} (incremental: ${incremental})`);

    let messages: ZulipMessage[];
    const metadata = await storage.getScrapeMetadata('zulipchat', channelName);

    if (incremental && metadata?.lastMessageId) {
      // Incremental scrape: fetch messages since last scrape using message ID
      console.log(`  Last message ID: ${metadata.lastMessageId}`);
      console.log(`  Fetching newer messages...`);

      // Use message ID as anchor and fetch messages after it
      const narrow = [{ operator: 'stream', operand: channelName }];
      const params = new URLSearchParams({
        anchor: metadata.lastMessageId,
        num_before: '0',
        num_after: numMessages.toString(),
        narrow: JSON.stringify(narrow),
        apply_markdown: 'false',
      });

      const url = `${this.config.site}/api/v1/messages?${params.toString()}`;
      const data: ZulipMessagesResponse = await this.makeRequest(url);

      // Filter out the anchor message itself
      messages = data.messages.filter((msg) => msg.id.toString() !== metadata.lastMessageId);
    } else {
      // Full scrape: fetch all messages (paginated)
      console.log(`  Performing full scrape (${numMessages} messages)...`);
      messages = await this.fetchMessages(channelName, numMessages);
    }

    let storedCount = 0;
    let skippedCount = 0;
    let latestTimestamp: Date | null = metadata?.lastScrapeTimestamp || null;
    let latestMessageId: string | null = metadata?.lastMessageId || null;

    for (const message of messages) {
      const msgTimestamp = new Date(message.timestamp * 1000);

      // Check if message already exists
      const existing = await storage.getMessageByMessageId(message.id.toString());

      if (existing) {
        skippedCount++;
        continue;
      }

      // Store message
      await storage.createScrapedMessage({
        messageId: message.id.toString(),
        source: 'zulipchat',
        channelName: channelName,
        topicName: message.subject,
        senderEmail: message.sender_email,
        senderName: message.sender_full_name,
        content: message.content,
        messageTimestamp: msgTimestamp,
        analyzed: false,
      });

      storedCount++;
    }

    // Always track the maximum message ID and timestamp from ALL messages processed
    // This ensures the anchor advances even when messages share timestamps
    for (const message of messages) {
      const msgTimestamp = new Date(message.timestamp * 1000);
      const msgId = message.id.toString();

      // Track latest timestamp
      if (!latestTimestamp || msgTimestamp > latestTimestamp) {
        latestTimestamp = msgTimestamp;
      }

      // Track maximum message ID (Zulip IDs are sequential)
      if (!latestMessageId || parseInt(msgId) > parseInt(latestMessageId)) {
        latestMessageId = msgId;
      }
    }

    // Always update scrape metadata to track last scrape time
    // Even if storedCount is 0, we want to record that we checked
    if (messages.length > 0 || !metadata) {
      await storage.createOrUpdateScrapeMetadata({
        source: 'zulipchat',
        channelName: channelName,
        lastMessageId: latestMessageId,
        lastScrapeTimestamp: latestTimestamp,
        totalMessagesFetched: storedCount,
      });
    }

    console.log(
      `Scraping complete: ${storedCount} new messages stored, ${skippedCount} already existed`
    );
    return storedCount;
  }

  async performFullScrape(channelName: string, batchSize: number = 1000): Promise<number> {
    console.log(`\n=== FULL SCRAPE ===`);
    console.log(`Fetching ALL messages from channel: ${channelName}`);

    let totalStored = 0;
    let anchor: string | number = 'newest';
    let hasMore = true;
    let batchCount = 0;
    let latestMessageId: string | null = null;
    let latestTimestamp: Date | null = null;

    while (hasMore && batchCount < 100) {
      // Safety limit of 100 batches
      batchCount++;
      console.log(`\nBatch ${batchCount}: Fetching ${batchSize} messages (anchor: ${anchor})...`);

      const messages = await this.fetchMessages(channelName, batchSize, anchor);

      if (messages.length === 0) {
        hasMore = false;
        break;
      }

      let storedCount = 0;
      let batchLatestTimestamp: Date | null = null;
      let batchLatestMessageId: string | null = null;

      for (const message of messages) {
        const msgTimestamp = new Date(message.timestamp * 1000);

        const existing = await storage.getMessageByMessageId(message.id.toString());
        if (existing) continue;

        await storage.createScrapedMessage({
          messageId: message.id.toString(),
          source: 'zulipchat',
          channelName: channelName,
          topicName: message.subject,
          senderEmail: message.sender_email,
          senderName: message.sender_full_name,
          content: message.content,
          messageTimestamp: msgTimestamp,
          analyzed: false,
        });

        if (!batchLatestTimestamp || msgTimestamp > batchLatestTimestamp) {
          batchLatestTimestamp = msgTimestamp;
          batchLatestMessageId = message.id.toString();
        }

        storedCount++;
      }

      totalStored += storedCount;
      console.log(`  Batch ${batchCount}: ${storedCount} new messages stored`);

      // Update overall latest timestamp and message ID
      if (batchLatestTimestamp && (!latestTimestamp || batchLatestTimestamp > latestTimestamp)) {
        latestTimestamp = batchLatestTimestamp;
        latestMessageId = batchLatestMessageId;
      }

      // ALWAYS update anchor to the oldest message ID in this batch for next iteration
      // This ensures we move backward through history even when all messages are duplicates
      const oldestMessageId = messages[messages.length - 1].id;
      if (oldestMessageId === anchor) {
        // Anchor didn't change - we're stuck. This means we've reached the end.
        console.log(`  Reached end of message history (anchor unchanged)`);
        hasMore = false;
        break;
      }
      anchor = oldestMessageId;

      // If we got fewer messages than requested, we've reached the end
      if (messages.length < batchSize) {
        hasMore = false;
      }

      // Update metadata after each batch with new messages
      if (storedCount > 0) {
        await storage.createOrUpdateScrapeMetadata({
          source: 'zulipchat',
          channelName: channelName,
          lastMessageId: latestMessageId,
          lastScrapeTimestamp: latestTimestamp,
          totalMessagesFetched: storedCount,
        });
      }
    }

    console.log(`\n=== FULL SCRAPE COMPLETE ===`);
    console.log(`Total messages stored: ${totalStored} across ${batchCount} batches`);
    return totalStored;
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.config.site}/api/v1/users/me`;
      await this.makeRequest(url);
      return true;
    } catch (error) {
      console.error('Zulipchat connection test failed:', error);
      return false;
    }
  }
}

export function createZulipchatScraperFromEnv(): ZulipchatScraper | null {
  const email = process.env.ZULIP_BOT_EMAIL;
  const apiKey = process.env.ZULIP_API_KEY;
  const site = process.env.ZULIP_SITE;

  if (!email || !apiKey) {
    console.warn('Zulipchat credentials not found in environment variables');
    return null;
  }

  if (!site) {
    console.warn('ZULIP_SITE environment variable not set');
    return null;
  }

  return new ZulipchatScraper({ email, apiKey, site });
}
