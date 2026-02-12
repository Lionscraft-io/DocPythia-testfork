/**
 * Multi-Instance Authentication
 * Tries password against all instances and redirects to correct one
 */

import { verifyPassword } from './password.js';
import { InstanceConfigLoader } from '../config/instance-loader.js';

export interface AuthResult {
  success: boolean;
  instanceId?: string;
  error?: string;
}

/**
 * Try password against all available instances
 * Returns the matching instance ID or null
 */
export async function authenticateAnyInstance(password: string): Promise<AuthResult> {
  // Get all available instances (async for S3 support)
  const availableInstances = await InstanceConfigLoader.getAvailableInstancesAsync();

  if (availableInstances.length === 0) {
    return {
      success: false,
      error: 'No instances configured',
    };
  }

  // Try password against each instance
  for (const instanceId of availableInstances) {
    try {
      // Load instance config (async for S3 support)
      const config = InstanceConfigLoader.has(instanceId)
        ? InstanceConfigLoader.get(instanceId)
        : await InstanceConfigLoader.loadAsync(instanceId);

      // Check if password matches
      if (await verifyPassword(password, config.admin.passwordHash)) {
        return {
          success: true,
          instanceId,
        };
      }
    } catch (error) {
      console.warn(`Failed to check auth for instance "${instanceId}":`, error);
      // Continue to next instance
    }
  }

  // No match found
  return {
    success: false,
    error: 'Invalid password',
  };
}

/**
 * Authenticate for specific instance
 */
export async function authenticateInstance(password: string, instanceId: string): Promise<boolean> {
  try {
    const config = InstanceConfigLoader.has(instanceId)
      ? InstanceConfigLoader.get(instanceId)
      : await InstanceConfigLoader.loadAsync(instanceId);

    return await verifyPassword(password, config.admin.passwordHash);
  } catch (error) {
    console.error(`Authentication failed for instance "${instanceId}":`, error);
    return false;
  }
}
