/**
 * Main Routes File
 *
 * This file now delegates to modular route files in /server/routes/
 * See /server/routes/index.ts for the route registration logic.
 *
 * Route modules:
 * - health-routes.ts   - Health check and diagnostics
 * - auth-routes.ts     - Authentication endpoints
 * - config-routes.ts   - Public configuration endpoint
 * - docs-routes.ts     - Documentation CRUD and sync
 * - widget-routes.ts   - Widget HTML and ask endpoints
 * - widget-embed-routes.ts - Widget JS library and demo page
 * - admin-panel-routes.ts  - Admin operations (updates, messages, cache)
 */

export { registerRoutes } from './routes/index.js';
