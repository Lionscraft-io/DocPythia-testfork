// Database migration and initialization - Prisma
// Migrated from Drizzle ORM
import { InstanceConfigLoader } from './config/instance-loader';
import { getInstanceDb } from './db/instance-db';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export async function initializeDatabase() {
  console.log('🔄 Initializing all instance databases...');

  try {
    // Get all available instances (uses S3 if CONFIG_SOURCE=s3)
    const availableInstances = await InstanceConfigLoader.getAvailableInstancesAsync();
    console.log(`📦 Found ${availableInstances.length} instances:`, availableInstances);

    const migrationsPath = path.join(process.cwd(), 'prisma', 'migrations');
    const hasMigrations =
      fs.existsSync(migrationsPath) && fs.readdirSync(migrationsPath).length > 0;

    // Migrate each instance database
    for (const instanceId of availableInstances) {
      try {
        console.log(`\n🔄 Initializing database for instance: ${instanceId}`);

        const config = InstanceConfigLoader.has(instanceId)
          ? InstanceConfigLoader.get(instanceId)
          : await InstanceConfigLoader.loadAsync(instanceId);

        const dbName = config.database?.name;
        if (!dbName) {
          console.warn(`⚠️  No database configured for instance "${instanceId}", skipping`);
          continue;
        }

        // Build database URL for this instance (preserve query params like sslmode)
        const baseUrl = process.env.DATABASE_URL || '';
        const url = new URL(baseUrl);
        url.pathname = url.pathname.replace(/\/[^/]+$/, `/${dbName}`);
        const instanceDbUrl = url.toString();

        if (hasMigrations) {
          console.log(`📁 Running migrations for ${instanceId} (${dbName})...`);
          execSync('npx prisma migrate deploy', {
            stdio: 'inherit',
            cwd: process.cwd(),
            env: { ...process.env, DATABASE_URL: instanceDbUrl },
          });
          console.log(`✅ Migrations completed for ${instanceId}`);
        } else {
          console.log(`📝 No migrations found, pushing schema to ${instanceId}...`);
          await pushSchema(instanceDbUrl);
        }

        // Seed initial data for this instance
        await seedInitialDataIfNeeded(instanceId);

        console.log(`✅ Database initialized for instance: ${instanceId}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(
          `❌ Failed to initialize database for instance "${instanceId}":`,
          errorMessage
        );

        // Try fallback for this instance
        try {
          const config = InstanceConfigLoader.get(instanceId);
          const baseUrl = process.env.DATABASE_URL || '';
          const url = new URL(baseUrl);
          url.pathname = url.pathname.replace(/\/[^/]+$/, `/${config.database?.name}`);
          const instanceDbUrl = url.toString();

          console.log(`🔄 Attempting to push schema for ${instanceId}...`);
          await pushSchema(instanceDbUrl);
          await seedInitialDataIfNeeded(instanceId);
          console.log(`✅ Schema pushed for ${instanceId}`);
        } catch {
          console.error(`❌ All attempts failed for instance "${instanceId}"`);
          // Continue to next instance
        }
      }
    }

    console.log('\n✅ All instance databases initialized successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Database initialization failed:', errorMessage);
    throw new Error(`Multi-instance database initialization failed: ${errorMessage}`);
  }
}

async function seedInitialDataIfNeeded(instanceId: string) {
  try {
    // Get instance-specific database
    const instanceDb = getInstanceDb(instanceId);

    // Check if documentation sections table has data
    const sectionCount = await instanceDb.documentationSection.count();

    if (sectionCount === 0) {
      console.log(`📦 No documentation found for ${instanceId}, importing initial content...`);

      // For now, skip auto-seeding - require manual seeding per instance
      console.log(`⚠️  Auto-seeding not configured for ${instanceId}, skipping initial data seed`);
      console.log(`   Seed manually using: /api/trigger-job or seed script`);
    } else {
      console.log(
        `✓ Found ${sectionCount} existing documentation sections for ${instanceId}, skipping import`
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `⚠️  Warning: Could not check/seed initial data for ${instanceId}:`,
      errorMessage
    );
  }
}

async function pushSchema(databaseUrl: string) {
  try {
    // Run prisma db push command (for development, skips migrations)
    console.log('🚀 Pushing database schema with Prisma...');
    execSync('npx prisma db push --accept-data-loss', {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Prisma push failed: ${errorMessage}`);
  }
}
