/**
 * Routes Index - Central route registration
 *
 * This file combines all modular route files for cleaner code organization.
 * Each route module handles a specific domain of functionality.
 */

import type { Express } from 'express';
import { createServer, type Server } from 'http';
import swaggerUi from 'swagger-ui-express';
import { multiInstanceAdminAuth as adminAuth } from '../middleware/multi-instance-admin-auth.js';
import { createLogger } from '../utils/logger.js';
import { swaggerSpec } from '../swagger/config.js';

// Import route modules
import healthRoutes from './health-routes.js';
import authRoutes from './auth-routes.js';
import configRoutes, { instanceConfigHandler } from './config-routes.js';
import widgetRoutes from './widget-routes.js';
import { instanceMiddleware } from '../middleware/instance.js';
import widgetEmbedRoutes from './widget-embed-routes.js';
import { createDocsRoutes, createDocsIndexRoutes } from './docs-routes.js';
import { createAdminPanelRoutes } from './admin-panel-routes.js';
import { createQualitySystemRoutes } from './quality-system-routes.js';

// Import swagger path definitions
import '../swagger/paths/index.js';

const logger = createLogger('Routes');

export async function registerRoutes(app: Express): Promise<Server> {
  logger.info('Registering modular routes...');

  // ==================== API DOCUMENTATION ====================

  // Swagger UI - API documentation
  app.use(
    '/api/docs-ui',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'DocPythia API Documentation',
    })
  );

  // OpenAPI JSON spec endpoint
  app.get('/api/openapi.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // ==================== PUBLIC ROUTES ====================

  // Authentication routes (must be before adminAuth middleware)
  app.use('/api/auth', authRoutes);

  // Health and diagnostics (public)
  app.use('/api', healthRoutes);

  // Public configuration endpoint
  app.use('/api/config', configRoutes);

  // Instance-specific configuration endpoint (for multi-tenant access)
  // Handles requests like /:instance/api/config when frontend is at /:instance/admin
  app.get('/:instance/api/config', instanceMiddleware, instanceConfigHandler);

  // Widget embed assets (widget.js and demo page)
  app.use('/', widgetEmbedRoutes);

  // Widget routes (includes both HTML and ask endpoint)
  app.use('/widget', widgetRoutes);
  app.use('/api/widget', widgetRoutes);

  // Documentation routes (public and admin)
  const docsRoutes = createDocsRoutes(adminAuth);
  app.use('/api/docs', docsRoutes);

  // Section routes (history and rollback - admin only)
  // These are registered on /api/sections/:sectionId path
  app.get('/api/sections/:sectionId/history', adminAuth, async (req, res) => {
    // Forward to docs routes handler
    req.url = `/${req.params.sectionId}/history`;
    docsRoutes(req, res, () => {});
  });

  app.post('/api/sections/:sectionId/rollback', adminAuth, async (req, res) => {
    // Forward to docs routes handler
    req.url = `/${req.params.sectionId}/rollback`;
    docsRoutes(req, res, () => {});
  });

  // Documentation index endpoint
  const docsIndexRoutes = createDocsIndexRoutes();
  app.use('/api/docs-index', docsIndexRoutes);

  // ==================== ADMIN ROUTES ====================

  // Admin panel routes (updates, messages, scraper, analyzer, jobs, LLM cache)
  const adminPanelRoutes = createAdminPanelRoutes(adminAuth);
  app.use('/api', adminPanelRoutes);
  app.use('/api/admin', adminPanelRoutes);

  // Quality System routes (prompts, rulesets, feedback)
  // Registered three times:
  // 1. /api/quality (non-instance)
  // 2. /api/admin/quality (admin path for multi-instance access)
  // 3. /:instance/api/quality (instance-specific)
  // 4. /:instance/api/admin/quality (instance-specific admin path)
  const qualitySystemRoutes = createQualitySystemRoutes(adminAuth);
  app.use('/api/quality', qualitySystemRoutes);
  app.use('/api/admin/quality', qualitySystemRoutes);
  app.use('/:instance/api/quality', instanceMiddleware, qualitySystemRoutes);
  app.use('/:instance/api/admin/quality', instanceMiddleware, qualitySystemRoutes);

  // Register Multi-Stream Scanner admin routes (Phase 1)
  // Routes are now registered with dual registration (instance and non-instance)
  const { registerAdminStreamRoutes } = await import('../stream/routes/admin-routes.js');
  registerAdminStreamRoutes(app, adminAuth);

  logger.info('All routes registered successfully');

  const httpServer = createServer(app);

  return httpServer;
}

export default registerRoutes;
