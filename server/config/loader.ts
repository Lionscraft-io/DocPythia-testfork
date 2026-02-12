// Configuration loader with three-layer precedence
// Multi-instance configuration system

import fs from 'fs';
import path from 'path';
import { defaultConfig } from './defaults';
import { InstanceConfigSchema } from './schemas';
import type { InstanceConfig, ResolvedConfig } from './types';

export class ConfigLoader {
  private static instance: ConfigLoader;
  private config: ResolvedConfig | null = null;

  private constructor() {}

  static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  /**
   * Load configuration with three-layer precedence:
   * 1. Defaults (defaults.ts)
   * 2. File (config/instance.json)
   * 3. Environment variables
   */
  load(): ResolvedConfig {
    if (this.config) {
      return this.config;
    }

    console.log('🔧 Loading instance configuration...');

    // Layer 1: Start with defaults
    let config: InstanceConfig = JSON.parse(JSON.stringify(defaultConfig));
    const source = {
      file: false,
      env: false,
      defaults: true,
    };

    // Layer 2: Override with file config
    const fileConfig = this.loadFromFile();
    if (fileConfig) {
      config = this.deepMerge(config, fileConfig);
      source.file = true;
      console.log('✓ Loaded configuration from file');
    } else {
      console.log('ℹ No config file found, using defaults');
    }

    // Layer 3: Override with environment variables
    const envConfig = this.loadFromEnv();
    if (envConfig) {
      config = this.deepMerge(config, envConfig);
      source.env = true;
      console.log('✓ Applied environment variable overrides');
    }

    // Validate final configuration
    try {
      const validated = InstanceConfigSchema.parse(config);
      this.config = {
        ...validated,
        _source: source,
      };

      console.log(
        `✅ Configuration loaded: ${this.config.project.name} (${this.config.project.shortName})`
      );
      console.log(`   Documentation: ${this.config.documentation.gitUrl}`);
      console.log(`   RAG Enabled: ${this.config.features.ragEnabled}`);
      console.log(`   Widget Enabled: ${this.config.widget.enabled}`);

      return this.config;
    } catch (error) {
      console.error('❌ Configuration validation failed:', error);
      throw new Error(
        `Invalid configuration: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get current configuration (must call load() first)
   */
  get(): ResolvedConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return this.config;
  }

  /**
   * Reload configuration (clears cache)
   */
  reload(): ResolvedConfig {
    this.config = null;
    return this.load();
  }

  /**
   * Load configuration from file
   */
  private loadFromFile(): Partial<InstanceConfig> | null {
    const configPath = path.join(process.cwd(), 'config', 'instance.json');

    if (!fs.existsSync(configPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(
        `⚠️  Failed to parse config file: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnv(): Partial<InstanceConfig> | null {
    const env = process.env;
    const envConfig: Partial<InstanceConfig> = {};

    // Project config
    if (env.PROJECT_NAME || env.PROJECT_SHORT_NAME || env.PROJECT_DESCRIPTION) {
      envConfig.project = {
        ...(env.PROJECT_NAME && { name: env.PROJECT_NAME }),
        ...(env.PROJECT_SHORT_NAME && { shortName: env.PROJECT_SHORT_NAME }),
        ...(env.PROJECT_DESCRIPTION && { description: env.PROJECT_DESCRIPTION }),
        ...(env.PROJECT_DOMAIN && { domain: env.PROJECT_DOMAIN }),
        ...(env.PROJECT_SUPPORT_EMAIL && { supportEmail: env.PROJECT_SUPPORT_EMAIL }),
      } as any;
    }

    // Branding config
    if (env.BRANDING_LOGO || env.BRANDING_PRIMARY_COLOR || env.BRANDING_PROJECT_URL) {
      envConfig.branding = {
        ...(env.BRANDING_LOGO && { logo: env.BRANDING_LOGO }),
        ...(env.BRANDING_FAVICON && { favicon: env.BRANDING_FAVICON }),
        ...(env.BRANDING_PRIMARY_COLOR && { primaryColor: env.BRANDING_PRIMARY_COLOR }),
        ...(env.BRANDING_SECONDARY_COLOR && { secondaryColor: env.BRANDING_SECONDARY_COLOR }),
        ...(env.BRANDING_ACCENT_COLOR && { accentColor: env.BRANDING_ACCENT_COLOR }),
        ...(env.BRANDING_DARK_MODE_PRIMARY_COLOR && {
          darkModePrimaryColor: env.BRANDING_DARK_MODE_PRIMARY_COLOR,
        }),
        ...(env.BRANDING_PROJECT_URL && { projectUrl: env.BRANDING_PROJECT_URL }),
      } as any;
    }

    // Documentation config
    if (env.DOCS_GIT_URL || env.DOCS_GIT_BRANCH) {
      envConfig.documentation = {
        ...(env.DOCS_GIT_URL && { gitUrl: env.DOCS_GIT_URL }),
        ...(env.DOCS_GIT_BRANCH && { branch: env.DOCS_GIT_BRANCH }),
        ...(env.GIT_USERNAME && { gitUsername: env.GIT_USERNAME }),
        ...(env.GIT_TOKEN && { gitToken: env.GIT_TOKEN }),
        ...(env.DOCS_PATH && { docsPath: env.DOCS_PATH }),
      } as any;
    }

    // Community config (Zulip)
    if (env.ZULIP_ENABLED || env.ZULIP_SITE) {
      envConfig.community = {
        zulip: {
          enabled: env.ZULIP_ENABLED === 'true',
          ...(env.ZULIP_SITE && { site: env.ZULIP_SITE }),
          ...(env.ZULIP_BOT_EMAIL && { botEmail: env.ZULIP_BOT_EMAIL }),
          ...(env.ZULIP_API_KEY && { apiKey: env.ZULIP_API_KEY }),
          ...(env.ZULIP_CHANNEL && { channel: env.ZULIP_CHANNEL }),
        },
      };
    }

    // Feature flags
    if (env.RAG_ENABLED || env.SCHEDULER_ENABLED || env.CHAT_ENABLED) {
      envConfig.features = {
        ...(env.RAG_ENABLED !== undefined && { ragEnabled: env.RAG_ENABLED === 'true' }),
        ...(env.SCHEDULER_ENABLED !== undefined && {
          schedulerEnabled: env.SCHEDULER_ENABLED === 'true',
        }),
        ...(env.CHAT_ENABLED !== undefined && { chatEnabled: env.CHAT_ENABLED === 'true' }),
        ...(env.ANALYTICS_ENABLED !== undefined && {
          analyticsEnabled: env.ANALYTICS_ENABLED === 'true',
        }),
        ...(env.VERSION_HISTORY_ENABLED !== undefined && {
          versionHistoryEnabled: env.VERSION_HISTORY_ENABLED === 'true',
        }),
      } as any;
    }

    // Admin config
    if (env.ADMIN_PASSWORD_HASH) {
      envConfig.admin = {
        passwordHash: env.ADMIN_PASSWORD_HASH,
        ...(env.ADMIN_ALLOWED_ORIGINS && { allowedOrigins: env.ADMIN_ALLOWED_ORIGINS.split(',') }),
      };
    }

    return Object.keys(envConfig).length > 0 ? envConfig : null;
  }

  /**
   * Deep merge two objects
   */
  private deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target };

    for (const key in source) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (sourceValue === undefined) {
        continue;
      }

      if (
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        result[key] = this.deepMerge(targetValue, sourceValue);
      } else {
        result[key] = sourceValue as any;
      }
    }

    return result;
  }
}

// Export singleton instance
export const configLoader = ConfigLoader.getInstance();

// Export convenience function
export function getConfig(): ResolvedConfig {
  return configLoader.get();
}

// Load configuration on module import (but allow errors to propagate)
try {
  configLoader.load();
} catch (error) {
  console.error('Failed to load configuration on startup:', error);
  // Don't throw here - let the application decide how to handle it
}
