/**
 * Session-based Authentication Middleware
 *
 * Secure authentication using httpOnly cookies and CSRF protection.
 * Replaces the Bearer token approach with proper session management.
 */

import type { Request, Response, NextFunction } from 'express';
import { getSessionFromRequest, verifyCsrfToken, refreshSession } from '../auth/session.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SessionAuth');

/**
 * Extended request with session information
 */
export interface AuthenticatedRequest extends Request {
  session?: {
    instanceId: string;
    username?: string;
  };
}

/**
 * Session authentication middleware
 *
 * Validates:
 * 1. Access token in httpOnly cookie
 * 2. CSRF token in header (for mutating requests)
 */
export function sessionAuth(req: Request, res: Response, next: NextFunction): void {
  // Check if auth is disabled (development only)
  if (process.env.DISABLE_ADMIN_AUTH?.toLowerCase() === 'true') {
    logger.warn('ADMIN AUTH DISABLED - Development mode only!');
    (req as AuthenticatedRequest).session = {
      instanceId: 'default',
    };
    return next();
  }

  // Get session from cookie
  const session = getSessionFromRequest(req);

  if (!session) {
    // Try to refresh the session
    const refreshResult = refreshSession(req, res);
    if (refreshResult.success && refreshResult.session) {
      (req as AuthenticatedRequest).session = {
        instanceId: refreshResult.session.instanceId,
        username: refreshResult.session.username,
      };
      return next();
    }

    res.status(401).json({
      error: 'Unauthorized',
      message: 'Session expired or invalid. Please log in again.',
    });
    return;
  }

  // CSRF protection for mutating requests
  const mutatingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (mutatingMethods.includes(req.method)) {
    if (!verifyCsrfToken(req)) {
      logger.warn(`CSRF token mismatch for ${req.method} ${req.path}`);
      res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid CSRF token. Please refresh the page and try again.',
      });
      return;
    }
  }

  // Store session in request for later use
  (req as AuthenticatedRequest).session = {
    instanceId: session.instanceId,
    username: session.username,
  };

  // Also set adminInstance for backwards compatibility
  (req as any).adminInstance = session.instanceId;

  next();
}

/**
 * Hybrid authentication middleware
 *
 * Supports both:
 * 1. New session-based auth (httpOnly cookies)
 * 2. Legacy Bearer token auth (for API compatibility)
 *
 * This allows gradual migration from Bearer tokens to session cookies.
 */
export function hybridAuth(req: Request, res: Response, next: NextFunction): void {
  // Check if auth is disabled (development only)
  if (process.env.DISABLE_ADMIN_AUTH?.toLowerCase() === 'true') {
    logger.warn('ADMIN AUTH DISABLED - Development mode only!');
    (req as AuthenticatedRequest).session = {
      instanceId: 'default',
    };
    return next();
  }

  // First, try session-based auth (new method)
  const session = getSessionFromRequest(req);

  if (session) {
    // Verify CSRF for mutating requests
    const mutatingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (mutatingMethods.includes(req.method) && !verifyCsrfToken(req)) {
      logger.warn(`CSRF token mismatch for ${req.method} ${req.path}`);
      res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid CSRF token.',
      });
      return;
    }

    (req as AuthenticatedRequest).session = {
      instanceId: session.instanceId,
      username: session.username,
    };
    (req as any).adminInstance = session.instanceId;
    return next();
  }

  // Fall back to Bearer token auth (legacy method)
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    // Delegate to the existing multi-instance auth middleware
    // This maintains backwards compatibility
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { multiInstanceAdminAuth } = require('./multi-instance-admin-auth.js');
    return multiInstanceAdminAuth(req, res, next);
  }

  // No valid authentication found
  res.status(401).json({
    error: 'Unauthorized',
    message: 'Please log in to access this resource.',
  });
}

/**
 * Optional session middleware
 *
 * Attaches session to request if available, but doesn't require authentication.
 * Useful for routes that have different behavior for authenticated vs anonymous users.
 */
export function optionalSession(req: Request, res: Response, next: NextFunction): void {
  const session = getSessionFromRequest(req);

  if (session) {
    (req as AuthenticatedRequest).session = {
      instanceId: session.instanceId,
      username: session.username,
    };
    (req as any).adminInstance = session.instanceId;
  }

  next();
}
