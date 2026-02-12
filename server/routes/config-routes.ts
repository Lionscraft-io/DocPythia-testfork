import { Router, Request, Response } from 'express';
import { getConfig } from '../config/loader';
import { createLogger } from '../utils/logger.js';
import type { ResolvedConfig } from '../config/types.js';

const logger = createLogger('ConfigRoutes');
const router = Router();

/**
 * Extract owner/repo from various git URL formats
 * Supports: https://github.com/owner/repo, https://github.com/owner/repo.git,
 *           git@github.com:owner/repo.git, owner/repo
 */
function extractRepoFromGitUrl(gitUrl: string | undefined): string {
  if (!gitUrl) return '';

  // Already in owner/repo format
  if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(gitUrl)) {
    return gitUrl;
  }

  // HTTPS format: https://github.com/owner/repo or https://github.com/owner/repo.git
  const httpsMatch = gitUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return httpsMatch[1];
  }

  // SSH format: git@github.com:owner/repo.git
  const sshMatch = gitUrl.match(/git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return sshMatch[1];
  }

  logger.warn(`Could not extract owner/repo from git URL: ${gitUrl}`);
  return '';
}

/**
 * Build config response from a ResolvedConfig object
 */
function buildConfigResponse(config: ResolvedConfig) {
  return {
    project: config.project,
    branding: config.branding,
    widget: {
      enabled: config.widget.enabled,
      title: config.widget.title,
      welcomeMessage: config.widget.welcomeMessage,
      suggestedQuestions: config.widget.suggestedQuestions,
      position: config.widget.position,
      theme: config.widget.theme,
      primaryColor: config.widget.primaryColor,
    },
    features: {
      chatEnabled: config.features.chatEnabled,
      versionHistoryEnabled: config.features.versionHistoryEnabled,
    },
    repository: {
      // Extract owner/repo from gitUrl (e.g., "https://github.com/owner/repo" -> "owner/repo")
      targetRepo: extractRepoFromGitUrl(config.documentation.gitUrl),
      sourceRepo: extractRepoFromGitUrl(config.documentation.gitUrl),
      baseBranch: config.documentation.branch || 'main',
    },
  };
}

/**
 * Config handler for instance-specific routes
 * Used when instance middleware has already loaded the config
 */
export async function instanceConfigHandler(req: Request, res: Response) {
  try {
    // Instance middleware should have attached the config
    if (req.instance?.config) {
      logger.debug(`Using instance config for "${req.instance.id}" from instance middleware`);
      return res.json(buildConfigResponse(req.instance.config));
    }

    // Fallback to default if no instance (shouldn't happen if middleware is applied)
    logger.warn('Instance config handler called without instance context, falling back to default');
    const config = getConfig();
    res.json(buildConfigResponse(config));
  } catch (error) {
    logger.error('Error fetching instance config:', error);
    res.status(500).json({
      error: 'Failed to load configuration',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

// Public configuration endpoint (instance-aware)
router.get('/', async (req: Request, res: Response) => {
  try {
    let config;

    // Try to detect instance from Referer header (e.g., https://domain.com/projecta/admin)
    const referer = req.get('Referer') || req.get('Referrer');
    let instanceId: string | undefined;

    if (referer) {
      // Extract instance from URL path (e.g., /instance-name/admin)
      // Accepts any instance name pattern (alphanumeric with dashes)
      const match = referer.match(/\/([a-z0-9-]+)\/(?:admin|api|widget)/i);
      if (match) {
        instanceId = match[1].toLowerCase();
        logger.debug(`Detected instance "${instanceId}" from Referer: ${referer}`);
      }
    }

    // Also check query parameter
    if (!instanceId && req.query.instance) {
      instanceId = String(req.query.instance).toLowerCase();
      logger.debug(`Using instance "${instanceId}" from query param`);
    }

    // Load instance-specific config or fall back to default
    if (instanceId) {
      try {
        const { InstanceConfigLoader } = await import('../config/instance-loader.js');
        config = InstanceConfigLoader.get(instanceId);
        logger.debug(`Loaded config for instance "${instanceId}"`);
      } catch {
        logger.warn(`Instance "${instanceId}" not found, falling back to default`);
        config = getConfig();
      }
    } else {
      config = getConfig();
      logger.debug('No instance detected, using default config');
    }

    // Return safe subset (no secrets)
    res.json(buildConfigResponse(config));
  } catch (error) {
    logger.error('Error fetching config:', error);
    res.status(500).json({
      error: 'Failed to load configuration',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
