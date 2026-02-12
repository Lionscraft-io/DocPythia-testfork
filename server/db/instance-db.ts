/**
 * Instance-Aware Database Connection Manager
 * Maintains separate Prisma clients for each instance database
 */

import { PrismaClient } from '@prisma/client';
import { getInstanceConfig } from '../config/instance-loader';

export class InstanceDatabaseManager {
  private static clients: Map<string, PrismaClient> = new Map();

  /**
   * Get or create Prisma client for specific instance
   */
  static getClient(instanceId: string): PrismaClient {
    // Return cached client if available
    const cached = this.clients.get(instanceId);
    if (cached) {
      return cached;
    }

    // Load instance configuration
    const config = getInstanceConfig(instanceId);

    // Build database URL from config
    const baseUrl = process.env.DATABASE_URL || '';
    const databaseUrl = this.buildDatabaseUrl(baseUrl, config.database.name);

    console.log(
      `📦 Creating Prisma client for instance "${instanceId}" with database: ${config.database.name}`
    );

    // Create new Prisma client with instance-specific database
    const client = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

    // Cache the client
    this.clients.set(instanceId, client);

    return client;
  }

  /**
   * Build database URL with specific database name
   */
  private static buildDatabaseUrl(baseUrl: string, databaseName: string): string {
    try {
      const url = new URL(baseUrl);
      // Replace the database name in the pathname
      const pathParts = url.pathname.split('/');
      pathParts[pathParts.length - 1] = databaseName;
      url.pathname = pathParts.join('/');
      return url.toString();
    } catch (error) {
      throw new Error(
        `Invalid DATABASE_URL format: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Disconnect client for specific instance
   */
  static async disconnect(instanceId: string): Promise<void> {
    const client = this.clients.get(instanceId);
    if (client) {
      await client.$disconnect();
      this.clients.delete(instanceId);
      console.log(`🔌 Disconnected Prisma client for instance "${instanceId}"`);
    }
  }

  /**
   * Disconnect all clients
   */
  static async disconnectAll(): Promise<void> {
    const promises = Array.from(this.clients.keys()).map((instanceId) =>
      this.disconnect(instanceId)
    );
    await Promise.all(promises);
    console.log('🔌 Disconnected all Prisma clients');
  }

  /**
   * Check database connection for instance
   */
  static async checkConnection(instanceId: string): Promise<boolean> {
    try {
      const client = this.getClient(instanceId);
      await client.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      console.error(`❌ Database connection failed for instance "${instanceId}":`, error);
      return false;
    }
  }
}

// Export convenience function
export function getInstanceDb(instanceId: string): PrismaClient {
  return InstanceDatabaseManager.getClient(instanceId);
}

// Cleanup on process termination
process.on('beforeExit', async () => {
  await InstanceDatabaseManager.disconnectAll();
});
