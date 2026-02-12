import { Router, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { db as prisma } from '../db';
import { GitFetcher } from '../git-fetcher.js';
import { PgVectorStore } from '../vector-store.js';
import { getInstanceDb } from '../db/instance-db.js';
import { docIndexGenerator } from '../stream/doc-index-generator.js';
import { geminiEmbedder, GeminiEmbedder } from '../embeddings/gemini-embedder.js';
import { createLogger, getErrorMessage } from '../utils/logger.js';
import { InstanceConfigLoader } from '../config/instance-loader.js';

const logger = createLogger('DocsRoutes');

// Validation schemas
const sectionIdSchema = z.object({
  sectionId: z.string().min(1),
});

const rollbackBodySchema = z.object({
  versionId: z.string().uuid(),
  performedBy: z.string().optional(),
});

// Create default vectorStore for public endpoints
let vectorStore: PgVectorStore;
try {
  vectorStore = new PgVectorStore('default', prisma);
} catch {
  logger.warn('Failed to initialize default vectorStore');
}

export function createDocsRoutes(adminAuth: RequestHandler): Router {
  const router = Router();

  // Documentation routes (public)
  router.get('/', async (req: Request, res: Response) => {
    try {
      // Check if DATABASE_URL is set
      if (!process.env.DATABASE_URL) {
        return res.status(500).json({
          error: 'Database not configured',
          message: 'DATABASE_URL environment variable is not set',
        });
      }

      const sections = await storage.getDocumentationSections();
      res.json(sections);
    } catch (error) {
      logger.error('Error fetching documentation:', error);

      // Provide more specific error messages
      const details = error instanceof Error ? getErrorMessage(error) : String(error);
      let errorMessage = 'Failed to fetch documentation';
      if (details.includes('connect')) {
        errorMessage = 'Database connection failed';
      } else if (details.includes('relation') || details.includes('table')) {
        errorMessage = 'Database tables not found - run migrations';
      }

      res.status(500).json({
        error: errorMessage,
        details,
      });
    }
  });

  // Public Git documentation stats endpoint (must be before :sectionId wildcard)
  // Supports both instance-specific and default configs
  router.get('/git-stats', async (req: Request, res: Response) => {
    try {
      // Get instance from request (set by middleware) or use 'default'
      const instanceId = (req as any).instance?.id || 'default';

      // Try to get config from instance config first, fallback to env var
      let gitUrl: string;
      let branch: string;

      try {
        const instanceConfig = InstanceConfigLoader.get(instanceId);
        gitUrl = instanceConfig.documentation.gitUrl;
        branch = instanceConfig.documentation.branch || 'main';
        logger.debug(`Using instance config for ${instanceId}: ${gitUrl}`);
      } catch {
        // Fallback to env var if instance config not available
        gitUrl = process.env.DOCS_GIT_URL || '';
        branch = process.env.DOCS_GIT_BRANCH || 'main';
        logger.debug(`Using env var config: ${gitUrl}`);
      }

      const syncState = await prisma.gitSyncState.findFirst({
        where: {
          gitUrl: gitUrl,
        },
      });

      if (!syncState) {
        return res.json({
          gitUrl: gitUrl,
          branch: branch,
          lastSyncAt: null,
          lastCommitHash: null,
          status: 'idle',
          totalDocuments: 0,
          documentsWithEmbeddings: 0,
        });
      }

      // Get document counts
      const stats = await vectorStore.getStats();

      res.json({
        gitUrl: syncState.gitUrl,
        branch: syncState.branch,
        lastSyncAt: syncState.lastSyncAt,
        lastCommitHash: syncState.lastCommitHash,
        status: syncState.syncStatus,
        totalDocuments: stats.totalDocuments,
        documentsWithEmbeddings: stats.documentsWithEmbeddings,
      });
    } catch (error) {
      logger.error('Error fetching git stats:', error);
      res.status(500).json({ error: 'Failed to fetch git stats' });
    }
  });

  // Get single section/document by ID or file path
  router.get('/:sectionId(*)', async (req: Request, res: Response) => {
    try {
      const sectionId = req.params.sectionId;
      if (!sectionId || sectionId.length < 1) {
        return res.status(400).json({ error: 'Invalid section ID' });
      }

      // First try the legacy documentation_sections table
      const section = await storage.getDocumentationSection(sectionId);
      if (section) {
        return res.json(section);
      }

      // If not found, try the RAG vector store (document_pages) by file path
      // Get instance from request or use default
      const instanceId = (req as any).instance?.id || 'default';
      const instanceDb = getInstanceDb(instanceId);
      const instanceVectorStore = new PgVectorStore(instanceId, instanceDb);

      const document = await instanceVectorStore.getDocumentByPath(sectionId);
      if (document) {
        return res.json({
          sectionId: document.filePath,
          title: document.title,
          content: document.content,
          gitHash: document.gitHash,
          gitUrl: document.gitUrl,
        });
      }

      return res.status(404).json({ error: 'Section not found' });
    } catch (error) {
      logger.error('Error fetching section:', error);
      res.status(500).json({ error: 'Failed to fetch section' });
    }
  });

  // RAG Documentation Sync endpoint (admin only)
  router.post('/sync', adminAuth, async (req: Request, res: Response) => {
    try {
      const bodyValidation = z
        .object({
          force: z.boolean().optional().default(false),
        })
        .safeParse(req.body);

      if (!bodyValidation.success) {
        return res
          .status(400)
          .json({ error: 'Invalid request body', details: bodyValidation.error });
      }

      const { force } = bodyValidation.data;
      const startTime = Date.now();

      // Get instance from authenticated admin
      const adminInstance = (req as any).adminInstance;
      if (!adminInstance) {
        return res.status(401).json({ error: 'No instance associated with admin' });
      }

      logger.info(`[${adminInstance}] Starting documentation sync (force: ${force})...`);

      // Create instance-specific gitFetcher and vectorStore
      const instanceDb = getInstanceDb(adminInstance);
      const gitFetcher = new GitFetcher(adminInstance, instanceDb);
      const instanceVectorStore = new PgVectorStore(adminInstance, instanceDb);

      // Get instance config for gitUrl
      const { InstanceConfigLoader } = await import('../config/instance-loader.js');
      const instanceConfig = InstanceConfigLoader.get(adminInstance);
      const gitUrl = instanceConfig.documentation.gitUrl;

      // Update sync status to 'syncing'
      await gitFetcher.updateSyncStatus('syncing');

      try {
        // Check for updates
        const updateInfo = await gitFetcher.checkForUpdates();

        if (!updateInfo.hasUpdates && !force) {
          // Even if no updates, mark sync as completed and update hash
          await gitFetcher.updateCommitHash(updateInfo.currentHash);
          await gitFetcher.updateSyncStatus('success');

          // Invalidate doc-index cache to regenerate with current filter config
          await docIndexGenerator.invalidateCache();

          // Get total document count
          const stats = await instanceVectorStore.getStats();

          return res.json({
            success: true,
            hadUpdates: false,
            currentHash: updateInfo.currentHash,
            previousHash: updateInfo.storedHash,
            summary: { added: 0, modified: 0, deleted: 0, filesProcessed: [] },
            totalDocuments: stats.totalDocuments,
            duration: Date.now() - startTime,
          });
        }

        // Fetch changed files
        const changedFiles = await gitFetcher.fetchChangedFiles(
          updateInfo.storedHash || 'HEAD~1',
          updateInfo.currentHash
        );

        const summary = {
          added: 0,
          modified: 0,
          deleted: 0,
          filesProcessed: [] as string[],
        };

        // Process deletions
        for (const file of changedFiles.filter((f) => f.changeType === 'deleted')) {
          await instanceVectorStore.deleteDocument(file.path);
          summary.deleted++;
          summary.filesProcessed.push(file.path);
        }

        // Process additions and modifications
        for (const file of changedFiles.filter((f) => f.changeType !== 'deleted')) {
          try {
            // Check if file already has embedding for this commit (resume logic)
            const existing = await instanceVectorStore.getDocument(file.path, file.commitHash);
            if (existing && !force) {
              logger.debug(`Skipping ${file.path} - already embedded for this commit`);
              summary.filesProcessed.push(file.path);
              continue;
            }

            // Prepare content with more aggressive truncation for large files
            const preparedContent = GeminiEmbedder.prepareText(file.content, 6000); // ~24KB to be safe
            const embedding = await geminiEmbedder.embedText(preparedContent);
            const title = GeminiEmbedder.extractTitle(file.content);

            await instanceVectorStore.upsertDocument({
              filePath: file.path,
              title,
              content: file.content,
              gitHash: file.commitHash,
              gitUrl,
              embedding,
            });

            if (file.changeType === 'added') summary.added++;
            else summary.modified++;
            summary.filesProcessed.push(file.path);
          } catch (fileError: any) {
            logger.error(`Failed to process file ${file.path}:`, fileError.message);
            // Log error but continue with next file
            summary.filesProcessed.push(`${file.path} (FAILED: ${fileError.message})`);
          }
        }

        // Update sync state
        await gitFetcher.updateCommitHash(updateInfo.currentHash);
        await gitFetcher.updateSyncStatus('success');

        // Invalidate doc-index cache to regenerate with current filter config
        await docIndexGenerator.invalidateCache();

        // Get total document count
        const stats = await instanceVectorStore.getStats();

        logger.info(`Documentation sync completed in ${Date.now() - startTime}ms`);

        res.json({
          success: true,
          hadUpdates: true,
          currentHash: updateInfo.currentHash,
          previousHash: updateInfo.storedHash,
          summary,
          totalDocuments: stats.totalDocuments,
          duration: Date.now() - startTime,
        });
      } catch (syncError) {
        await gitFetcher.updateSyncStatus('error', getErrorMessage(syncError));
        throw syncError;
      }
    } catch (error) {
      logger.error('Documentation sync failed:', error);
      res.status(500).json({
        success: false,
        error: getErrorMessage(error) || 'Unknown error during documentation sync',
      });
    }
  });

  // Get sync status endpoint
  router.get('/sync/status', adminAuth, async (req: Request, res: Response) => {
    try {
      // Get instance from authenticated admin
      const adminInstance = (req as any).adminInstance;
      if (!adminInstance) {
        return res.status(401).json({ error: 'No instance associated with admin' });
      }

      // Get instance config for gitUrl
      const { InstanceConfigLoader } = await import('../config/instance-loader.js');
      const instanceConfig = InstanceConfigLoader.get(adminInstance);
      const gitUrl = instanceConfig.documentation.gitUrl;

      // Create instance-specific db and vectorStore
      const instanceDb = getInstanceDb(adminInstance);
      const instanceVectorStore = new PgVectorStore(adminInstance, instanceDb);

      const syncState = await instanceDb.gitSyncState.findFirst({
        where: { gitUrl },
      });

      if (!syncState) {
        return res.json({
          status: 'idle',
          lastSyncAt: null,
          lastCommitHash: null,
          totalDocuments: 0,
          documentsWithEmbeddings: 0,
        });
      }

      // Get document counts
      const stats = await instanceVectorStore.getStats();

      res.json({
        status: syncState.syncStatus,
        lastSyncAt: syncState.lastSyncAt,
        lastCommitHash: syncState.lastCommitHash,
        branch: syncState.branch,
        gitUrl: syncState.gitUrl,
        errorMessage: syncState.errorMessage,
        totalDocuments: stats.totalDocuments,
        documentsWithEmbeddings: stats.documentsWithEmbeddings,
      });
    } catch (error) {
      logger.error('Error fetching sync status:', error);
      res.status(500).json({ error: 'Failed to fetch sync status' });
    }
  });

  // Section version history routes (admin only)
  router.get('/:sectionId/history', adminAuth, async (req: Request, res: Response) => {
    try {
      const validation = sectionIdSchema.safeParse(req.params);
      if (!validation.success) {
        return res.status(400).json({ error: 'Invalid section ID' });
      }

      const history = await storage.getSectionHistory(validation.data.sectionId);
      res.json(history);
    } catch (error) {
      logger.error('Error fetching section history:', error);
      res.status(500).json({ error: 'Failed to fetch section history' });
    }
  });

  router.post('/:sectionId/rollback', adminAuth, async (req: Request, res: Response) => {
    try {
      const paramsValidation = sectionIdSchema.safeParse(req.params);
      if (!paramsValidation.success) {
        return res.status(400).json({ error: 'Invalid section ID' });
      }

      const bodyValidation = rollbackBodySchema.safeParse(req.body);
      if (!bodyValidation.success) {
        return res.status(400).json({ error: 'Invalid request body' });
      }

      const result = await storage.rollbackSection(
        paramsValidation.data.sectionId,
        bodyValidation.data.versionId,
        bodyValidation.data.performedBy
      );

      res.json(result);
    } catch (error) {
      logger.error('Error rolling back section:', error);
      if (getErrorMessage(error) === 'Version not found') {
        return res.status(404).json({ error: getErrorMessage(error) });
      }
      if (getErrorMessage(error) === 'Version does not belong to this section') {
        return res.status(400).json({ error: getErrorMessage(error) });
      }
      res.status(500).json({ error: 'Failed to rollback section' });
    }
  });

  return router;
}

// Documentation Index endpoint (public, separate router)
export function createDocsIndexRoutes(): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      const { docIndexGenerator } = await import('../stream/doc-index-generator.js');

      const format = (req.query.format as string) || 'json';
      const index = await docIndexGenerator.generateIndex();

      if (format === 'compact') {
        const compactText = docIndexGenerator.formatCompact(index);
        res.type('text/plain').send(compactText);
      } else if (format === 'formatted') {
        const formattedText = docIndexGenerator.formatForPrompt(index);
        res.type('text/plain').send(formattedText);
      } else {
        // Default JSON format
        res.json({
          totalPages: index.pages.length,
          totalCategories: Object.keys(index.categories).length,
          generatedAt: index.generated_at,
          categories: Object.entries(index.categories).map(([name, paths]) => ({
            name,
            pageCount: paths.length,
            paths: paths.slice(0, 10), // Limit to first 10 paths for brevity
          })),
          pages: index.pages.slice(0, 50), // Limit to first 50 pages for brevity
          cacheStatus: docIndexGenerator.getCacheStatus(),
        });
      }
    } catch (error) {
      logger.error('Error generating documentation index:', error);
      res.status(500).json({ error: 'Failed to generate documentation index' });
    }
  });

  return router;
}

export default createDocsRoutes;
