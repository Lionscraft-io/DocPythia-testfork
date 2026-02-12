/**
 * Instance Detection Middleware
 * Extracts instance ID from URL prefix and loads configuration
 */

import { Request, Response, NextFunction } from 'express';
import { InstanceConfigLoader } from '../config/instance-loader';
import { getInstanceDb } from '../db/instance-db';
import type { ResolvedConfig } from '../config/types';
import type { PrismaClient } from '@prisma/client';

// Extend Express Request type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      instance?: {
        id: string;
        config: ResolvedConfig;
        db: PrismaClient;
      };
    }
  }
}

/**
 * Instance detection middleware
 * Expects URL format: /{instanceId}/... (e.g., /projecta/admin, /projectb/api/...)
 */
export async function instanceMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    console.log(
      '[Instance Middleware] Hit! req.url:',
      req.url,
      'req.path:',
      req.path,
      'req.params:',
      req.params
    );

    // Extract instance ID from route parameters (set by Express mount point)
    const instanceId = req.params.instance?.toLowerCase();

    console.log('[Instance Middleware] Extracted instanceId from params:', instanceId);

    if (!instanceId) {
      // No instance in params, skip this middleware
      console.log('[Instance Middleware] No instance found, skipping');
      return next('route');
    }

    // Check if this is a recognized instance (async for S3 support)
    const availableInstances = await InstanceConfigLoader.getAvailableInstancesAsync();
    if (!availableInstances.includes(instanceId)) {
      // Not a recognized instance, skip this middleware (it might be /api or another route)
      console.log('[Instance Middleware] Not a recognized instance, skipping');
      return next('route');
    }

    // Load or get cached configuration for instance
    let config: ResolvedConfig;
    try {
      if (!InstanceConfigLoader.has(instanceId)) {
        config = await InstanceConfigLoader.loadAsync(instanceId);
      } else {
        config = InstanceConfigLoader.get(instanceId);
      }
    } catch {
      const instances = await InstanceConfigLoader.getAvailableInstancesAsync();
      return res.status(404).json({
        error: 'Instance not found',
        message: `Configuration not found for instance "${instanceId}"`,
        availableInstances: instances,
      });
    }

    // Get database connection for instance
    const db = getInstanceDb(instanceId);

    // Attach instance context to request
    req.instance = {
      id: instanceId,
      config,
      db,
    };

    console.log('[Instance Middleware] Instance context attached, calling next()');
    next();
  } catch (error) {
    console.error('Instance middleware error:', error);
    res.status(500).json({
      error: 'Instance initialization failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Require instance middleware - ensures instance context exists
 */
export function requireInstance(req: Request, res: Response, next: NextFunction) {
  if (!req.instance) {
    return res.status(400).json({
      error: 'No instance context',
      message: 'This endpoint requires instance context. Ensure instanceMiddleware is applied.',
    });
  }
  next();
}

/**
 * Get instance info endpoint
 */
export function getInstanceInfo(req: Request, res: Response) {
  if (!req.instance) {
    return res.status(400).json({ error: 'No instance context' });
  }

  res.json({
    instanceId: req.instance.id,
    project: req.instance.config.project,
    branding: req.instance.config.branding,
    features: req.instance.config.features,
    widget: req.instance.config.widget,
  });
}
