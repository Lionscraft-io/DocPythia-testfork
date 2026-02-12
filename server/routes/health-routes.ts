import { Router, Request, Response } from 'express';
import { storage } from '../storage';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const router = Router();
const prisma = new PrismaClient();

// Health check endpoint
router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Diagnostic endpoint
router.get('/diagnostics', async (req: Request, res: Response) => {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL ? 'Set' : 'Not set',
      WIDGET_DOMAIN: process.env.WIDGET_DOMAIN,
      PORT: process.env.PORT,
    },
    database: 'Unknown',
    static_files: 'Unknown',
  };

  // Test database connection
  try {
    await storage.getDocumentationSections();
    diagnostics.database = 'Connected';
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    diagnostics.database = `Error: ${errorMessage}`;
  }

  // Check static files
  try {
    const fs = await import('fs');
    const path = await import('path');
    const distPath = path.resolve(process.cwd(), 'dist', 'public');
    const exists = fs.existsSync(distPath);
    diagnostics.static_files = exists ? `Found: ${distPath}` : `Missing: ${distPath}`;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    diagnostics.static_files = `Error: ${errorMessage}`;
  }

  res.json(diagnostics);
});

// Migration endpoint - runs pending migrations
// Protected by a secret token to prevent unauthorized access
router.post('/run-migrations', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.MIGRATION_SECRET || process.env.SESSION_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const results: { migration: string; status: string; error?: string }[] = [];
    const migrationsDir = path.resolve(process.cwd(), 'prisma', 'migrations');

    // Get list of migration folders
    const migrationFolders = fs
      .readdirSync(migrationsDir)
      .filter((f) => fs.statSync(path.join(migrationsDir, f)).isDirectory())
      .sort();

    for (const folder of migrationFolders) {
      const migrationPath = path.join(migrationsDir, folder, 'migration.sql');
      if (!fs.existsSync(migrationPath)) continue;

      try {
        const sql = fs.readFileSync(migrationPath, 'utf-8');
        // Split by semicolons but handle PL/pgSQL blocks (DO $$ ... $$)
        const statements = sql
          .split(/;(?![^$]*\$\$)/)
          .map((s) => s.trim())
          .filter((s) => {
            if (s.length === 0) return false;
            // Remove leading comment lines to check if there's actual SQL
            const withoutComments = s
              .split('\n')
              .filter((line) => !line.trim().startsWith('--'))
              .join('\n')
              .trim();
            return withoutComments.length > 0;
          });

        for (const statement of statements) {
          if (statement.length > 0) {
            await prisma.$executeRawUnsafe(statement);
          }
        }
        results.push({ migration: folder, status: 'applied' });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Ignore "already exists" errors
        if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
          results.push({ migration: folder, status: 'skipped (already applied)' });
        } else {
          results.push({ migration: folder, status: 'error', error: errorMessage });
        }
      }
    }

    res.json({
      status: 'completed',
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Migration failed', details: errorMessage });
  }
});

export default router;
