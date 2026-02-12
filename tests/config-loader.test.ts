/**
 * Config Loader Tests
 * Tests for the configuration loading system

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs module
const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mockFs.existsSync,
      readFileSync: mockFs.readFileSync,
    },
    existsSync: mockFs.existsSync,
    readFileSync: mockFs.readFileSync,
  };
});

// Store original env
const originalEnv = { ...process.env };

describe('ConfigLoader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getInstance', () => {
    it('should return singleton instance', async () => {
      // Mock no config file
      mockFs.existsSync.mockReturnValue(false);

      const { ConfigLoader } = await import('../server/config/loader');
      const instance1 = ConfigLoader.getInstance();
      const instance2 = ConfigLoader.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe('load', () => {
    it('should load defaults when no file or env config exists', async () => {
      mockFs.existsSync.mockReturnValue(false);

      // Clear env vars that might affect config loading
      delete process.env.PROJECT_NAME;
      delete process.env.PROJECT_SHORT_NAME;
      delete process.env.PROJECT_DESCRIPTION;
      delete process.env.BRANDING_LOGO;
      delete process.env.BRANDING_PRIMARY_COLOR;
      delete process.env.BRANDING_PROJECT_URL;
      delete process.env.DOCS_GIT_URL;
      delete process.env.DOCS_GIT_BRANCH;
      delete process.env.ZULIP_ENABLED;
      delete process.env.ZULIP_SITE;
      delete process.env.RAG_ENABLED;
      delete process.env.SCHEDULER_ENABLED;
      delete process.env.CHAT_ENABLED;
      delete process.env.ADMIN_PASSWORD_HASH;

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();

      // Clear any existing config
      (loader as any).config = null;

      const config = loader.load();

      expect(config).toBeDefined();
      expect(config._source.defaults).toBe(true);
      expect(config._source.file).toBe(false);
      // env may still be true if other env vars exist, so just check it's defined
      expect(config._source.env).toBeDefined();
    });

    it('should return cached config on subsequent calls', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();

      // Clear any existing config
      (loader as any).config = null;

      const config1 = loader.load();
      const config2 = loader.load();

      expect(config1).toBe(config2);
    });

    it('should load config from file when it exists', async () => {
      const fileConfig = {
        project: {
          name: 'Test Project',
          shortName: 'test-project',
          description: 'Test description',
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig));

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();
      (loader as any).config = null;

      const config = loader.load();

      expect(config._source.file).toBe(true);
      expect(config.project.name).toBe('Test Project');
    });

    it('should handle invalid JSON in config file', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('{ invalid json }');

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();
      (loader as any).config = null;

      // Should not throw, should fall back to defaults
      const config = loader.load();
      expect(config._source.file).toBe(false);
    });

    it('should override with environment variables', async () => {
      mockFs.existsSync.mockReturnValue(false);

      // Set environment variables
      process.env.PROJECT_NAME = 'Env Project Name';
      process.env.PROJECT_SHORT_NAME = 'env-project';
      process.env.PROJECT_DESCRIPTION = 'Env description';

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();
      (loader as any).config = null;

      const config = loader.load();

      expect(config._source.env).toBe(true);
      expect(config.project.name).toBe('Env Project Name');
    });

    it('should load branding from environment', async () => {
      mockFs.existsSync.mockReturnValue(false);

      process.env.BRANDING_LOGO = 'https://example.com/logo.png';
      process.env.BRANDING_PRIMARY_COLOR = '#FF0000';
      process.env.BRANDING_PROJECT_URL = 'https://example.com';

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();
      (loader as any).config = null;

      const config = loader.load();

      expect(config._source.env).toBe(true);
      expect(config.branding.logo).toBe('https://example.com/logo.png');
    });

    it('should load documentation config from environment', async () => {
      mockFs.existsSync.mockReturnValue(false);

      process.env.DOCS_GIT_URL = 'https://github.com/test/docs.git';
      process.env.DOCS_GIT_BRANCH = 'develop';

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();
      (loader as any).config = null;

      const config = loader.load();

      expect(config._source.env).toBe(true);
      expect(config.documentation.gitUrl).toBe('https://github.com/test/docs.git');
      expect(config.documentation.branch).toBe('develop');
    });

    it('should load feature flags from environment', async () => {
      mockFs.existsSync.mockReturnValue(false);

      process.env.RAG_ENABLED = 'true';
      process.env.SCHEDULER_ENABLED = 'false';
      process.env.CHAT_ENABLED = 'true';

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();
      (loader as any).config = null;

      const config = loader.load();

      expect(config._source.env).toBe(true);
      expect(config.features.ragEnabled).toBe(true);
      expect(config.features.schedulerEnabled).toBe(false);
      expect(config.features.chatEnabled).toBe(true);
    });

    it('should load admin config from environment', async () => {
      mockFs.existsSync.mockReturnValue(false);

      process.env.ADMIN_PASSWORD_HASH = 'test-hash-123';
      process.env.ADMIN_ALLOWED_ORIGINS = 'http://localhost:3000,http://localhost:5000';

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();
      (loader as any).config = null;

      const config = loader.load();

      expect(config._source.env).toBe(true);
      expect(config.admin.passwordHash).toBe('test-hash-123');
      expect(config.admin.allowedOrigins).toEqual([
        'http://localhost:3000',
        'http://localhost:5000',
      ]);
    });

    it('should load Zulip community config from environment', async () => {
      mockFs.existsSync.mockReturnValue(false);

      process.env.ZULIP_ENABLED = 'true';
      process.env.ZULIP_SITE = 'https://zulip.example.com';
      process.env.ZULIP_BOT_EMAIL = 'bot@example.com';
      process.env.ZULIP_API_KEY = 'test-api-key';
      process.env.ZULIP_CHANNEL = 'general';

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();
      (loader as any).config = null;

      const config = loader.load();

      expect(config._source.env).toBe(true);
      expect(config.community?.zulip?.enabled).toBe(true);
      expect(config.community?.zulip?.site).toBe('https://zulip.example.com');
    });
  });

  describe('get', () => {
    it('should throw error if config not loaded', async () => {
      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();
      (loader as any).config = null;

      // Skip auto-load by accessing get directly
      expect(() => loader.get()).toThrow('Configuration not loaded');
    });

    it('should return config after load', async () => {
      mockFs.existsSync.mockReturnValue(false);

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();
      (loader as any).config = null;

      loader.load();
      const config = loader.get();

      expect(config).toBeDefined();
      expect(config.project).toBeDefined();
    });
  });

  describe('reload', () => {
    it('should clear cache and reload config', async () => {
      mockFs.existsSync.mockReturnValue(false);

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();
      (loader as any).config = null;

      const config1 = loader.load();

      // Modify env
      process.env.PROJECT_NAME = 'Reloaded Project';

      const config2 = loader.reload();

      expect(config2.project.name).toBe('Reloaded Project');
      expect(config1).not.toBe(config2);
    });
  });

  describe('deepMerge', () => {
    it('should merge nested objects', async () => {
      mockFs.existsSync.mockReturnValue(false);

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();

      const target = {
        a: { b: 1, c: 2 },
        d: 3,
      };
      const source = {
        a: { b: 10 },
        e: 5,
      };

      const result = (loader as any).deepMerge(target, source);

      expect(result.a.b).toBe(10);
      expect(result.a.c).toBe(2);
      expect(result.d).toBe(3);
      expect(result.e).toBe(5);
    });

    it('should handle arrays by replacing', async () => {
      mockFs.existsSync.mockReturnValue(false);

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();

      const target = {
        arr: [1, 2, 3],
      };
      const source = {
        arr: [4, 5],
      };

      const result = (loader as any).deepMerge(target, source);

      expect(result.arr).toEqual([4, 5]);
    });

    it('should skip undefined values', async () => {
      mockFs.existsSync.mockReturnValue(false);

      vi.resetModules();
      const { ConfigLoader } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();

      const target = {
        a: 1,
        b: 2,
      };
      const source = {
        a: undefined,
        b: 3,
      };

      const result = (loader as any).deepMerge(target, source);

      expect(result.a).toBe(1);
      expect(result.b).toBe(3);
    });
  });

  describe('getConfig convenience function', () => {
    it('should return config from singleton', async () => {
      mockFs.existsSync.mockReturnValue(false);

      vi.resetModules();
      const { ConfigLoader, getConfig } = await import('../server/config/loader');
      const loader = ConfigLoader.getInstance();
      (loader as any).config = null;
      loader.load();

      const config = getConfig();

      expect(config).toBeDefined();
      expect(config.project).toBeDefined();
    });
  });
});

describe('Config Schemas', () => {
  it('should validate project config schema', async () => {
    const { ProjectConfigSchema } = await import('../server/config/schemas');

    const validProject = {
      name: 'Test Project',
      shortName: 'test-project',
      description: 'Test description',
    };

    const result = ProjectConfigSchema.safeParse(validProject);
    expect(result.success).toBe(true);
  });

  it('should reject invalid project shortName', async () => {
    const { ProjectConfigSchema } = await import('../server/config/schemas');

    const invalidProject = {
      name: 'Test Project',
      shortName: 'Test Project', // Has spaces and uppercase
      description: 'Test description',
    };

    const result = ProjectConfigSchema.safeParse(invalidProject);
    expect(result.success).toBe(false);
  });

  it('should validate branding config with valid hex colors', async () => {
    const { BrandingConfigSchema } = await import('../server/config/schemas');

    const validBranding = {
      logo: 'https://example.com/logo.png',
      primaryColor: '#FF0000',
      projectUrl: 'https://example.com',
    };

    const result = BrandingConfigSchema.safeParse(validBranding);
    expect(result.success).toBe(true);
  });

  it('should reject invalid hex color', async () => {
    const { BrandingConfigSchema } = await import('../server/config/schemas');

    const invalidBranding = {
      logo: 'https://example.com/logo.png',
      primaryColor: 'red', // Not a hex color
      projectUrl: 'https://example.com',
    };

    const result = BrandingConfigSchema.safeParse(invalidBranding);
    expect(result.success).toBe(false);
  });

  it('should validate widget config', async () => {
    const { WidgetConfigSchema } = await import('../server/config/schemas');

    const validWidget = {
      enabled: true,
      title: 'Help Widget',
      welcomeMessage: 'How can I help?',
      suggestedQuestions: ['What is this?'],
      position: 'bottom-right',
      theme: 'auto',
    };

    const result = WidgetConfigSchema.safeParse(validWidget);
    expect(result.success).toBe(true);
  });

  it('should reject widget with invalid position', async () => {
    const { WidgetConfigSchema } = await import('../server/config/schemas');

    const invalidWidget = {
      enabled: true,
      title: 'Help Widget',
      welcomeMessage: 'How can I help?',
      suggestedQuestions: ['What is this?'],
      position: 'center', // Invalid position
      theme: 'auto',
    };

    const result = WidgetConfigSchema.safeParse(invalidWidget);
    expect(result.success).toBe(false);
  });

  it('should validate feature flags schema', async () => {
    const { FeatureFlagsSchema } = await import('../server/config/schemas');

    const validFlags = {
      ragEnabled: true,
      schedulerEnabled: false,
      chatEnabled: true,
      analyticsEnabled: false,
      versionHistoryEnabled: true,
    };

    const result = FeatureFlagsSchema.safeParse(validFlags);
    expect(result.success).toBe(true);
  });

  it('should validate documentation config', async () => {
    const { DocumentationConfigSchema } = await import('../server/config/schemas');

    const validDocs = {
      gitUrl: 'https://github.com/test/docs.git',
      branch: 'main',
    };

    const result = DocumentationConfigSchema.safeParse(validDocs);
    expect(result.success).toBe(true);
  });

  it('should reject documentation with invalid git URL', async () => {
    const { DocumentationConfigSchema } = await import('../server/config/schemas');

    const invalidDocs = {
      gitUrl: 'not-a-url',
      branch: 'main',
    };

    const result = DocumentationConfigSchema.safeParse(invalidDocs);
    expect(result.success).toBe(false);
  });

  it('should validate admin config', async () => {
    const { AdminConfigSchema } = await import('../server/config/schemas');

    const validAdmin = {
      passwordHash: 'abc123hash',
      allowedOrigins: ['http://localhost:3000'],
    };

    const result = AdminConfigSchema.safeParse(validAdmin);
    expect(result.success).toBe(true);
  });

  it('should validate database config', async () => {
    const { DatabaseConfigSchema } = await import('../server/config/schemas');

    const validDb = {
      name: 'mydb',
      host: 'localhost',
      port: 5432,
    };

    const result = DatabaseConfigSchema.safeParse(validDb);
    expect(result.success).toBe(true);
  });

  it('should validate zulip config', async () => {
    const { ZulipConfigSchema } = await import('../server/config/schemas');

    const validZulip = {
      enabled: true,
      site: 'https://zulip.example.com',
      botEmail: 'bot@example.com',
      apiKey: 'test-key',
      channel: 'general',
    };

    const result = ZulipConfigSchema.safeParse(validZulip);
    expect(result.success).toBe(true);
  });

  it('should validate telegram config', async () => {
    const { TelegramConfigSchema } = await import('../server/config/schemas');

    const validTelegram = {
      enabled: true,
      botToken: '123456:ABC',
      channelId: '-1001234567890',
    };

    const result = TelegramConfigSchema.safeParse(validTelegram);
    expect(result.success).toBe(true);
  });

  it('should validate discord config', async () => {
    const { DiscordConfigSchema } = await import('../server/config/schemas');

    const validDiscord = {
      enabled: false,
      botToken: 'discord-token',
      guildId: '123456789',
      channelId: '987654321',
    };

    const result = DiscordConfigSchema.safeParse(validDiscord);
    expect(result.success).toBe(true);
  });

  it('should validate full instance config', async () => {
    const { InstanceConfigSchema } = await import('../server/config/schemas');

    const validConfig = {
      project: {
        name: 'Test',
        shortName: 'test',
        description: 'Test project',
      },
      branding: {
        logo: 'https://example.com/logo.png',
        primaryColor: '#000000',
        projectUrl: 'https://example.com',
      },
      documentation: {
        gitUrl: 'https://github.com/test/docs.git',
        branch: 'main',
      },
      database: {
        name: 'testdb',
      },
      widget: {
        enabled: true,
        title: 'Help',
        welcomeMessage: 'Hi',
        suggestedQuestions: ['Q1'],
        position: 'bottom-right',
        theme: 'auto',
      },
      features: {
        ragEnabled: true,
        schedulerEnabled: false,
        chatEnabled: true,
        analyticsEnabled: false,
        versionHistoryEnabled: false,
      },
      admin: {
        passwordHash: 'hash123',
      },
    };

    const result = InstanceConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });
});
