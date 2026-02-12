import * as cron from 'node-cron';
import { createZulipchatScraperFromEnv } from './scraper/zulipchat';
import { createAnalyzerFromEnv } from './analyzer/gemini-analyzer';

interface SchedulerConfig {
  enabled: boolean;
  cronSchedule: string; // Default: "0 2 * * *" - daily at 2 AM
  scrapeLimit: number; // Number of messages to scrape per run
  analysisLimit: number; // Number of messages to analyze per run
  channelName: string; // Zulipchat channel to scrape
}

const defaultConfig: SchedulerConfig = {
  enabled: process.env.SCHEDULER_ENABLED === 'true',
  cronSchedule: process.env.CRON_SCHEDULE || '0 2 * * *', // 2 AM daily
  scrapeLimit: parseInt(process.env.SCRAPE_LIMIT || '100', 10),
  analysisLimit: parseInt(process.env.ANALYSIS_LIMIT || '50', 10),
  channelName: process.env.ZULIP_CHANNEL || 'community-support',
};

let scheduledTask: cron.ScheduledTask | null = null;
let jobRunning = false; // Mutex to prevent overlapping runs

async function runScheduledJob(config: SchedulerConfig) {
  // Check if a job is already running
  if (jobRunning) {
    console.log('⚠ Scheduled job already running. Skipping this execution.');
    return;
  }

  jobRunning = true;
  const timestamp = new Date().toISOString();
  console.log(`\n========================================`);
  console.log(`Scheduled Job Started: ${timestamp}`);
  console.log(`========================================`);

  try {
    // Step 1: Scrape messages from Zulipchat
    console.log('\n1. Scraping messages from Zulipchat...');
    const scraper = createZulipchatScraperFromEnv();

    if (!scraper) {
      console.log('   ⚠ Skipping scraping: Zulipchat credentials not configured');
    } else {
      const newMessages = await scraper.scrapeAndStoreMessages(
        config.channelName,
        config.scrapeLimit
      );
      console.log(`   ✓ ${newMessages} new messages added to database`);
    }

    // Step 2: Analyze unanalyzed messages with AI
    console.log('\n2. Analyzing messages with Gemini AI...');
    const analyzer = createAnalyzerFromEnv();

    if (!analyzer) {
      console.log('   ⚠ Skipping analysis: Gemini API key not configured');
    } else {
      const analysisResult = await analyzer.analyzeUnanalyzedMessages(config.analysisLimit);
      console.log(`   ✓ Analyzed ${analysisResult.analyzed} messages`);
      console.log(`   ✓ Found ${analysisResult.relevant} relevant messages`);
      console.log(`   ✓ Created ${analysisResult.updatesCreated} pending updates`);
    }

    console.log(`\n========================================`);
    console.log(`Scheduled Job Completed: ${new Date().toISOString()}`);
    console.log(`========================================\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`\n❌ Scheduled Job Failed: ${message}`);
    console.error(stack);
  } finally {
    jobRunning = false;
  }
}

export function startScheduler(config: SchedulerConfig = defaultConfig) {
  if (!config.enabled) {
    console.log('Scheduler is disabled. Set SCHEDULER_ENABLED=true to enable.');
    return;
  }

  console.log('\n=== Scheduler Configuration ===');
  console.log(`Enabled: ${config.enabled}`);
  console.log(`Schedule: ${config.cronSchedule}`);
  console.log(`Scrape Limit: ${config.scrapeLimit} messages`);
  console.log(`Analysis Limit: ${config.analysisLimit} messages`);
  console.log('===============================\n');

  // Validate cron expression
  if (!cron.validate(config.cronSchedule)) {
    console.error(`Invalid cron schedule: ${config.cronSchedule}`);
    return;
  }

  scheduledTask = cron.schedule(config.cronSchedule, () => {
    runScheduledJob(config).catch((error) => {
      console.error('Unhandled error in scheduled job:', error);
    });
  });

  console.log(`✓ Scheduler started. Job will run: ${config.cronSchedule}`);
  console.log('  (Use crontab.guru to understand the schedule)\n');
}

export function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('Scheduler stopped.');
  }
}

// Manual trigger for testing
export async function triggerJobManually(config: SchedulerConfig = defaultConfig) {
  console.log('Triggering scheduled job manually...');
  await runScheduledJob(config);
}
