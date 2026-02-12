/**
 * CSV File Stream Adapter
 * Processes CSV files from inbox directory for message ingestion

 * Date: 2025-10-30
 * Reference: /docs/specs/multi-stream-scanner-phase-1.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { PrismaClient } from '@prisma/client';
import { BaseStreamAdapter } from './base-adapter.js';
import { StreamMessage, StreamWatermark } from '../types.js';

export interface CsvFileConfig {
  inboxDir: string; // Directory to watch for CSV files
  processedDir: string; // Directory to move processed files
  columnMapping: {
    timestamp?: string; // Column name for timestamp (default: 'timestamp' or 'date')
    author?: string; // Column name for author (default: 'author' or 'user')
    content: string; // Column name for message content (required)
    channel?: string; // Column name for channel (optional)
    messageId?: string; // Column name for message ID (optional, auto-generated if missing)
  };
  dateFormat?: string; // Date format string (default: ISO 8601)
  skipHeader?: boolean; // Whether to skip first row (default: true)
}

export interface ProcessingReport {
  fileName: string;
  totalRows: number;
  successfulRows: number;
  failedRows: number;
  errors: Array<{ row: number; error: string }>;
  processedAt: Date;
}

export class CsvFileAdapter extends BaseStreamAdapter {
  private csvConfig!: CsvFileConfig;

  constructor(streamId: string, db: PrismaClient) {
    super(streamId, 'csv', db);
  }

  /**
   * Validate CSV adapter configuration
   */
  validateConfig(config: any): boolean {
    if (!config.inboxDir || typeof config.inboxDir !== 'string') {
      console.error('CsvFileAdapter: inboxDir is required and must be a string');
      return false;
    }

    if (!config.processedDir || typeof config.processedDir !== 'string') {
      console.error('CsvFileAdapter: processedDir is required and must be a string');
      return false;
    }

    if (!config.columnMapping || typeof config.columnMapping !== 'object') {
      console.error('CsvFileAdapter: columnMapping is required and must be an object');
      return false;
    }

    if (!config.columnMapping.content || typeof config.columnMapping.content !== 'string') {
      console.error('CsvFileAdapter: columnMapping.content is required and must be a string');
      return false;
    }

    this.csvConfig = config as CsvFileConfig;
    return true;
  }

  /**
   * Initialize adapter and ensure directories exist
   */
  async initialize(config: any): Promise<void> {
    await super.initialize(config);

    // Ensure inbox and processed directories exist
    await fs.mkdir(this.csvConfig.inboxDir, { recursive: true });
    await fs.mkdir(this.csvConfig.processedDir, { recursive: true });

    console.log(
      `CsvFileAdapter initialized: inbox=${this.csvConfig.inboxDir}, processed=${this.csvConfig.processedDir}`
    );
  }

  /**
   * Fetch messages from CSV files in inbox directory
   */
  async fetchMessages(watermark?: StreamWatermark): Promise<StreamMessage[]> {
    this.ensureInitialized();

    const files = await this.getInboxFiles();

    if (files.length === 0) {
      console.log('No CSV files found in inbox');
      return [];
    }

    console.log(`Found ${files.length} CSV files to process`);

    const allMessages: StreamMessage[] = [];

    for (const file of files) {
      try {
        const { messages, report } = await this.processFile(file);

        // Save processing report
        await this.saveProcessingReport(file, report);

        // Move file to processed directory
        await this.moveToProcessed(file);

        allMessages.push(...messages);

        console.log(
          `Processed ${file}: ${report.successfulRows}/${report.totalRows} rows successful`
        );
      } catch (error) {
        console.error(`Error processing file ${file}:`, error);
        // Continue with next file
      }
    }

    // Filter messages based on watermark
    let messagesToProcess = allMessages;
    if (watermark?.lastProcessedTime) {
      messagesToProcess = allMessages.filter((msg) => msg.timestamp > watermark.lastProcessedTime!);
      console.log(
        `Filtered ${allMessages.length} messages to ${messagesToProcess.length} based on watermark`
      );
    }

    // Save messages to database before returning
    if (messagesToProcess.length > 0) {
      await this.saveMessages(messagesToProcess);
    }

    return messagesToProcess;
  }

  /**
   * Get list of CSV files in inbox
   */
  private async getInboxFiles(): Promise<string[]> {
    const entries = await fs.readdir(this.csvConfig.inboxDir, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.csv'))
      .map((entry) => path.join(this.csvConfig.inboxDir, entry.name));
  }

  /**
   * Process a single CSV file
   */
  private async processFile(filePath: string): Promise<{
    messages: StreamMessage[];
    report: ProcessingReport;
  }> {
    const fileName = path.basename(filePath);
    const fileContent = await fs.readFile(filePath, 'utf-8');

    // Parse CSV
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true, // Allow quotes inside fields without strict escaping
      escape: '"', // Standard CSV escape character
    });

    const messages: StreamMessage[] = [];
    const errors: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNumber = i + 1;

      try {
        const message = this.parseRow(row, rowNumber, fileName);
        messages.push(message);
      } catch (error) {
        errors.push({
          row: rowNumber,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const report: ProcessingReport = {
      fileName,
      totalRows: records.length,
      successfulRows: messages.length,
      failedRows: errors.length,
      errors,
      processedAt: new Date(),
    };

    return { messages, report };
  }

  /**
   * Parse a single CSV row into a StreamMessage
   */
  private parseRow(row: any, rowNumber: number, fileName: string): StreamMessage {
    const mapping = this.csvConfig.columnMapping;

    // Extract content (required)
    const content = row[mapping.content];
    if (!content || typeof content !== 'string') {
      throw new Error(`Missing or invalid content field: ${mapping.content}`);
    }

    // Extract timestamp
    let timestamp: Date;
    if (mapping.timestamp && row[mapping.timestamp]) {
      timestamp = new Date(row[mapping.timestamp]);
      if (isNaN(timestamp.getTime())) {
        throw new Error(`Invalid timestamp: ${row[mapping.timestamp]}`);
      }
    } else {
      // Default to file processing time
      timestamp = new Date();
    }

    // Extract author
    const author = mapping.author && row[mapping.author] ? row[mapping.author] : 'unknown';

    // Extract channel
    const channel = mapping.channel && row[mapping.channel] ? row[mapping.channel] : undefined;

    // Extract or generate message ID
    const messageId =
      mapping.messageId && row[mapping.messageId]
        ? row[mapping.messageId]
        : `${fileName}-row-${rowNumber}`;

    return {
      messageId,
      timestamp,
      author,
      content,
      channel,
      rawData: row,
      metadata: {
        source: 'csv',
        fileName,
        rowNumber,
      },
    };
  }

  /**
   * Move processed file to processed directory
   */
  private async moveToProcessed(filePath: string): Promise<void> {
    const fileName = path.basename(filePath);
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const newFileName = `${timestamp}_${fileName}`;
    const newPath = path.join(this.csvConfig.processedDir, newFileName);

    await fs.rename(filePath, newPath);
    console.log(`Moved ${fileName} to ${newPath}`);
  }

  /**
   * Save processing report as JSON
   */
  private async saveProcessingReport(filePath: string, report: ProcessingReport): Promise<void> {
    const fileName = path.basename(filePath, '.csv');
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const reportPath = path.join(
      this.csvConfig.processedDir,
      `${timestamp}_${fileName}_report.json`
    );

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`Saved processing report to ${reportPath}`);
  }
}
