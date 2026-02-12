import type { Request, Response, NextFunction } from 'express';
import { InstanceConfigLoader } from '../config/instance-loader.js';
import { verifyPassword } from '../auth/password.js';
import { getSessionFromRequest } from '../auth/session.js';

/**
 * Multi-instance admin authentication middleware
 * Validates admin token against instance-specific password hashes
 * Supports both Bearer token (API) and cookie-based (browser) authentication
 */
export const multiInstanceAdminAuth = async (req: Request, res: Response, next: NextFunction) => {
  // Check if admin auth is disabled (for development)
  const disableAuth = process.env.DISABLE_ADMIN_AUTH?.toLowerCase() === 'true';

  if (disableAuth) {
    console.warn('⚠️  ADMIN AUTH DISABLED - This should only be used in development!');
    return next();
  }

  // First, try cookie-based session authentication (browser clients)
  const session = getSessionFromRequest(req);
  if (session?.instanceId) {
    // Valid session cookie - store instance and continue
    (req as any).adminInstance = session.instanceId;
    return next();
  }

  // Fall back to Bearer token authentication (API clients)
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix

  // Try to authenticate against all available instances (async for S3 support)
  const availableInstances = await InstanceConfigLoader.getAvailableInstancesAsync();
  let authenticated = false;

  for (const instanceId of availableInstances) {
    try {
      const config = InstanceConfigLoader.has(instanceId)
        ? InstanceConfigLoader.get(instanceId)
        : await InstanceConfigLoader.loadAsync(instanceId);

      if (await verifyPassword(token, config.admin.passwordHash)) {
        authenticated = true;
        // Store the authenticated instance in the request for later use
        (req as any).adminInstance = instanceId;
        break;
      }
    } catch {
      // Continue checking other instances
      continue;
    }
  }

  if (!authenticated) {
    return res.status(403).json({ error: 'Forbidden: Invalid admin token' });
  }

  next();
};
