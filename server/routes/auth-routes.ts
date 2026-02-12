/**
 * Authentication Routes
 * Smart login with session-based authentication using httpOnly cookies
 * Updated: Session-based auth with CSRF protection (2025-12)
 */

import { Router, Request, Response } from 'express';
import { authenticateAnyInstance, authenticateInstance } from '../auth/multi-instance-auth';
import { InstanceConfigLoader } from '../config/instance-loader';
import {
  setSessionCookies,
  clearSessionCookies,
  generateCsrfToken,
  getSessionFromRequest,
  COOKIE_NAMES,
  type SessionPayload,
} from '../auth/session.js';
import { createLogger } from '../utils/logger.js';

const router = Router();
const logger = createLogger('AuthRoutes');

/**
 * Smart login endpoint - tries password against all instances
 * Sets httpOnly cookies for session management
 * POST /api/auth/login
 * Body: { password: string }
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { password, instanceId: requestedInstance } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required',
      });
    }

    // Check if auth is disabled (development only)
    if (process.env.DISABLE_ADMIN_AUTH === 'true') {
      logger.warn('ADMIN AUTH DISABLED - Development mode only!');
      const instances = await InstanceConfigLoader.getAvailableInstancesAsync();
      // Use requested instance if provided, otherwise default
      const instanceId = requestedInstance || instances[0] || 'default';

      // Set session cookies even in dev mode for consistency
      const session: SessionPayload = {
        instanceId,
        issuedAt: Date.now(),
      };
      const csrfToken = generateCsrfToken();
      setSessionCookies(res, session, csrfToken);

      return res.json({
        success: true,
        instanceId,
        csrfToken,
        message: 'Authentication disabled (development mode)',
      });
    }

    let result;

    // If a specific instance was requested, try that one first
    if (requestedInstance) {
      const isValid = await authenticateInstance(password, requestedInstance);
      if (isValid) {
        result = { success: true, instanceId: requestedInstance };
      } else {
        // Fall back to trying all instances
        result = await authenticateAnyInstance(password);
      }
    } else {
      // Try password against all instances
      result = await authenticateAnyInstance(password);
    }

    if (result.success && result.instanceId) {
      // Create session and set cookies
      const session: SessionPayload = {
        instanceId: result.instanceId,
        issuedAt: Date.now(),
      };
      const csrfToken = generateCsrfToken();
      setSessionCookies(res, session, csrfToken);

      logger.info(`Login successful for instance: ${result.instanceId}`);

      return res.json({
        success: true,
        instanceId: result.instanceId,
        csrfToken, // Frontend needs this for CSRF protection
        redirectUrl: `/${result.instanceId}/admin`,
      });
    } else {
      logger.warn('Login failed: Invalid credentials');
      return res.status(401).json({
        success: false,
        error: result.error || 'Invalid password',
      });
    }
  } catch (error) {
    logger.error('Login error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * Logout endpoint - clears session cookies
 * POST /api/auth/logout
 */
router.post('/logout', (req: Request, res: Response) => {
  try {
    clearSessionCookies(res);
    logger.info('User logged out');

    return res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * Check current session status
 * GET /api/auth/session
 */
router.get('/session', (req: Request, res: Response) => {
  try {
    const session = getSessionFromRequest(req);

    if (session) {
      return res.json({
        authenticated: true,
        instanceId: session.instanceId,
        username: session.username,
      });
    } else {
      return res.json({
        authenticated: false,
      });
    }
  } catch (error) {
    logger.error('Session check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * Refresh CSRF token
 * POST /api/auth/refresh-csrf
 */
router.post('/refresh-csrf', (req: Request, res: Response) => {
  try {
    const session = getSessionFromRequest(req);

    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
    }

    // Generate new CSRF token and update cookie
    const csrfToken = generateCsrfToken();
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie(COOKIE_NAMES.csrfToken, csrfToken, {
      httpOnly: false, // Must be readable by JavaScript
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return res.json({
      success: true,
      csrfToken,
    });
  } catch (error) {
    logger.error('CSRF refresh error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * Get available instances (for debugging)
 * GET /api/auth/instances
 */
router.get('/instances', async (req: Request, res: Response) => {
  try {
    const instances = await InstanceConfigLoader.getAvailableInstancesAsync();
    res.json({ instances });
  } catch {
    res.status(500).json({ error: 'Failed to get instances' });
  }
});

/**
 * Verify session for specific instance (legacy support)
 * POST /api/auth/verify
 * Body: { password: string, instanceId: string }
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { password, instanceId } = req.body;

    if (!password || !instanceId) {
      return res.status(400).json({
        success: false,
        error: 'Password and instanceId are required',
      });
    }

    // Check if auth is disabled
    if (process.env.DISABLE_ADMIN_AUTH === 'true') {
      return res.json({ success: true });
    }

    const isValid = await authenticateInstance(password, instanceId);

    if (isValid) {
      return res.json({ success: true });
    } else {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }
  } catch (error) {
    logger.error('Verify error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
