#!/usr/bin/env node
/**
 * CSV Import Tool
 * Usage: npx tsx scripts/permanent/import-csv.ts <path-to-csv-file>
 *
 * This script:
 * 1. Copies CSV file to inbox directory
 * 2. Triggers processing via API
 * 3. Shows results and processing report
 */

import './../../server/env.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const API_URL = process.env.API_URL || 'http://localhost:3762';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'changeme';
const INBOX_DIR = process.env.CSV_INBOX_DIR || '/tmp/csv-test/inbox';
const PROCESSED_DIR = process.env.CSV_PROCESSED_DIR || '/tmp/csv-test/processed';
const STREAM_ID = process.env.STREAM_ID || 'csv-test';

async function importCSV(csvFilePath: string) {
  console.log('============================================');
  console.log('CSV Import Tool');
  console.log('============================================\n');

  // Check if file exists
  try {
    await fs.access(csvFilePath);
  } catch {
    console.error(`❌ Error: File not found: ${csvFilePath}`);
    process.exit(1);
  }

  console.log(`File: ${csvFilePath}`);
  console.log(`Stream: ${STREAM_ID}`);
  console.log(`Inbox: ${INBOX_DIR}\n`);

  // Ensure inbox directory exists
  await fs.mkdir(INBOX_DIR, { recursive: true });

  // Copy file to inbox
  const filename = path.basename(csvFilePath);
  const targetPath = path.join(INBOX_DIR, filename);

  console.log('📂 Copying file to inbox...');
  await fs.copyFile(csvFilePath, targetPath);
  console.log(`✓ File copied: ${targetPath}\n`);

  // Trigger processing
  console.log('⚙️  Triggering processing via API...');

  try {
    const response = await fetch(`${API_URL}/api/admin/stream/process`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        streamId: STREAM_ID,
        batchSize: 100,
      }),
    });

    const result = await response.json();
    console.log(JSON.stringify(result, null, 2));
    console.log('');

    // Wait for processing to complete
    console.log('⏳ Waiting for processing to complete...');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check if file was moved
    try {
      await fs.access(targetPath);
      console.log('⚠️  File still in inbox - processing may have failed\n');
    } catch {
      console.log('✓ File moved to processed directory\n');

      // Find and display processing report
      try {
        const processedFiles = await fs.readdir(PROCESSED_DIR);
        const reportFiles = processedFiles
          .filter((f) => f.endsWith('.report.json') && f.includes(filename))
          .sort()
          .reverse();

        if (reportFiles.length > 0) {
          const reportPath = path.join(PROCESSED_DIR, reportFiles[0]);
          const report = await fs.readFile(reportPath, 'utf-8');

          console.log('📊 Processing Report:');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log(JSON.stringify(JSON.parse(report), null, 2));
          console.log('');
        }
      } catch (error) {
        console.warn('Could not read processing report:', error);
      }
    }

    // Get overall statistics
    console.log('📈 Overall Statistics:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const statsResponse = await fetch(`${API_URL}/api/admin/stream/stats`, {
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
    });

    const stats = await statsResponse.json();
    console.log(JSON.stringify(stats, null, 2));
    console.log('');

    console.log('============================================');
    console.log('Import Complete!');
    console.log('============================================\n');
    console.log('View results in admin dashboard:');
    console.log(`  ${API_URL}/api/admin/stream/messages\n`);
  } catch (error: any) {
    console.error('❌ Error during import:', error.message);
    process.exit(1);
  }
}

// CLI usage
const csvFile = process.argv[2];

if (!csvFile) {
  console.error('❌ Error: No CSV file provided\n');
  console.log('Usage: npx tsx scripts/permanent/import-csv.ts <path-to-csv-file>\n');
  console.log('Example:');
  console.log('  npx tsx scripts/permanent/import-csv.ts /path/to/messages.csv\n');
  process.exit(1);
}

importCSV(csvFile).catch(console.error);
