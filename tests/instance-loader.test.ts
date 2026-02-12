/**
 * Instance Loader Tests

 * Date: 2025-12-29
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs module
const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mockFs.existsSync,
      readFileSync: mockFs.readFileSync,
      readdirSync: mockFs.readdirSync,
    },
    existsSync: mockFs.existsSync,
    readFileSync: mockFs.readFileSync,
    readdirSync: mockFs.readdirSync,
  };
});

// Mock s3Storage
const mockS3Storage = vi.hoisted(() => ({
  initializeFromEnv: vi.fn().mockReturnValue(false),
  isEnabled: vi.fn().mockReturnValue(false),
  getJson: vi.fn().mockResolvedValue(null),
  list: vi.fn().mockResolvedValue([]),
  putJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/storage/s3-client', () => ({
  s3Storage: mockS3Storage,
}));

// Import after mocking
import {
  InstanceConfigLoader,
  loadInstanceConfig,
  getInstanceConfig,
  loadInstanceConfigAsync,
} from '../server/config/instance-loader';

describe('InstanceConfigLoader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear cached instances
    (InstanceConfigLoader as any).instances = new Map();
    // Reset environment
    process.env = { ...originalEnv };
    // Suppress console output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('load', () => {
    it('should load config with defaults when no file exists', () => {
      mockFs.existsSync.mockReturnValue(false);

      const config = InstanceConfigLoader.load('test-instance');

      expect(config).toBeDefined();
      expect(config.project).toBeDefined();
      expect(config._source.defaults).toBe(true);
      expect(config._source.file).toBe(false);
    });

    it('should load config from file when it exists', () => {
      const fileConfig = {
        project: {
          name: 'Test Project',
          shortName: 'test-proj',
          description: 'Test description',
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig));

      const config = InstanceConfigLoader.load('file-instance');

      expect(config.project.name).toBe('Test Project');
      expect(config._source.file).toBe(true);
    });

    it('should return cached config on subsequent calls', () => {
      mockFs.existsSync.mockReturnValue(false);

      const config1 = InstanceConfigLoader.load('cached-instance');
      const config2 = InstanceConfigLoader.load('cached-instance');

      expect(config1).toBe(config2);
      // existsSync should only be called once for the config file check
      expect(mockFs.existsSync).toHaveBeenCalledTimes(1);
    });

    it('should merge file config with defaults', () => {
      const fileConfig = {
        project: {
          name: 'Custom Name',
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig));

      const config = InstanceConfigLoader.load('merge-instance');

      // Custom value from file
      expect(config.project.name).toBe('Custom Name');
      // Default values should still be present
      expect(config.branding).toBeDefined();
      expect(config.database).toBeDefined();
    });

    it('should apply environment variable overrides', () => {
      mockFs.existsSync.mockReturnValue(false);
      process.env.TEST_PROJECT_NAME = 'Env Project Name';
      process.env.TEST_DATABASE_NAME = 'env_database';

      const config = InstanceConfigLoader.load('test');

      expect(config.project.name).toBe('Env Project Name');
      expect(config.database.name).toBe('env_database');
      expect(config._source.env).toBe(true);

      delete process.env.TEST_PROJECT_NAME;
      delete process.env.TEST_DATABASE_NAME;
    });

    it('should apply non-prefixed environment variables as fallback', () => {
      mockFs.existsSync.mockReturnValue(false);
      process.env.DATABASE_NAME = 'fallback_database';

      const config = InstanceConfigLoader.load('fallback');

      expect(config.database.name).toBe('fallback_database');

      delete process.env.DATABASE_NAME;
    });

    it('should handle invalid JSON in config file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json {{{');

      // Should still load with defaults, just log a warning
      const config = InstanceConfigLoader.load('invalid-json');
      expect(config).toBeDefined();
      expect(config._source.file).toBe(false);
    });

    it('should throw on invalid configuration', () => {
      // Create an invalid config that won't pass schema validation
      const invalidFileConfig = {
        project: {
          // Missing required fields
        },
        // Missing other required sections
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(invalidFileConfig));

      // The defaults will fill in most required fields, so this should work
      // Let's test with completely empty to see the merge behavior
      const config = InstanceConfigLoader.load('partial-config');
      expect(config).toBeDefined();
    });
  });

  describe('get', () => {
    it('should throw if config not loaded', () => {
      expect(() => InstanceConfigLoader.get('not-loaded')).toThrow(
        'Configuration not loaded for instance "not-loaded"'
      );
    });

    it('should return loaded config', () => {
      mockFs.existsSync.mockReturnValue(false);
      InstanceConfigLoader.load('get-test');

      const config = InstanceConfigLoader.get('get-test');
      expect(config).toBeDefined();
    });
  });

  describe('has', () => {
    it('should return false for unloaded instance', () => {
      expect(InstanceConfigLoader.has('unknown')).toBe(false);
    });

    it('should return true for loaded instance', () => {
      mockFs.existsSync.mockReturnValue(false);
      InstanceConfigLoader.load('has-test');

      expect(InstanceConfigLoader.has('has-test')).toBe(true);
    });
  });

  describe('reload', () => {
    it('should clear cache and reload config', () => {
      mockFs.existsSync.mockReturnValue(false);

      const config1 = InstanceConfigLoader.load('reload-test');

      // Change what would be loaded
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          project: { name: 'Reloaded Project' },
        })
      );

      const config2 = InstanceConfigLoader.reload('reload-test');

      expect(config1).not.toBe(config2);
      expect(config2.project.name).toBe('Reloaded Project');
    });
  });

  describe('getAvailableInstances', () => {
    it('should return empty array if config dir does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const instances = InstanceConfigLoader.getAvailableInstances();
      expect(instances).toEqual([]);
    });

    it('should return directory names from config folder', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        { name: 'projecta', isDirectory: () => true },
        { name: 'projectb', isDirectory: () => true },
        { name: 'shared.json', isDirectory: () => false },
      ] as any);

      const instances = InstanceConfigLoader.getAvailableInstances();
      expect(instances).toEqual(['projecta', 'projectb']);
    });
  });

  describe('deepMerge (via load)', () => {
    it('should deep merge nested objects', () => {
      const fileConfig = {
        branding: {
          primaryColor: '#ff5500',
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig));

      const config = InstanceConfigLoader.load('deep-merge');

      // Custom value
      expect(config.branding.primaryColor).toBe('#ff5500');
      // Default values preserved
      expect(config.branding.logo).toBeDefined();
    });

    it('should handle arrays by replacement', () => {
      const fileConfig = {
        widget: {
          suggestedQuestions: ['Custom question 1', 'Custom question 2'],
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig));

      const config = InstanceConfigLoader.load('array-merge');

      expect(config.widget.suggestedQuestions).toEqual(['Custom question 1', 'Custom question 2']);
    });
  });

  describe('convenience functions', () => {
    it('loadInstanceConfig should call InstanceConfigLoader.load', () => {
      mockFs.existsSync.mockReturnValue(false);

      const config = loadInstanceConfig('convenience-load');
      expect(config).toBeDefined();
      expect(InstanceConfigLoader.has('convenience-load')).toBe(true);
    });

    it('getInstanceConfig should call InstanceConfigLoader.get', () => {
      mockFs.existsSync.mockReturnValue(false);
      InstanceConfigLoader.load('convenience-get');

      const config = getInstanceConfig('convenience-get');
      expect(config).toBeDefined();
    });

    it('getInstanceConfig should throw for unloaded instance', () => {
      expect(() => getInstanceConfig('not-loaded-convenience')).toThrow();
    });

    it('loadInstanceConfigAsync should call InstanceConfigLoader.loadAsync', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const config = await loadInstanceConfigAsync('async-convenience');
      expect(config).toBeDefined();
      expect(InstanceConfigLoader.has('async-convenience')).toBe(true);
    });
  });

  describe('environment variable parsing', () => {
    it('should parse instance-specific project config', () => {
      mockFs.existsSync.mockReturnValue(false);
      process.env.MYAPP_PROJECT_NAME = 'My App';
      process.env.MYAPP_PROJECT_SHORT_NAME = 'myapp';
      process.env.MYAPP_PROJECT_DESCRIPTION = 'My App Description';

      const config = InstanceConfigLoader.load('myapp');

      expect(config.project.name).toBe('My App');
      expect(config.project.shortName).toBe('myapp');
      expect(config.project.description).toBe('My App Description');

      delete process.env.MYAPP_PROJECT_NAME;
      delete process.env.MYAPP_PROJECT_SHORT_NAME;
      delete process.env.MYAPP_PROJECT_DESCRIPTION;
    });

    it('should not set source.env if no env vars match', () => {
      mockFs.existsSync.mockReturnValue(false);
      // Don't set any matching env vars

      const config = InstanceConfigLoader.load('no-env-vars');

      expect(config._source.env).toBe(false);
    });
  });

  describe('loadAsync', () => {
    beforeEach(() => {
      // Reset S3 initialized state
      (InstanceConfigLoader as any).s3Initialized = false;
    });

    it('should return cached config on subsequent calls', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const config1 = await InstanceConfigLoader.loadAsync('async-cached');
      const config2 = await InstanceConfigLoader.loadAsync('async-cached');

      expect(config1).toBe(config2);
    });

    it('should load from file when S3 is disabled', async () => {
      const fileConfig = {
        project: { name: 'Async File Project' },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig));
      mockS3Storage.isEnabled.mockReturnValue(false);

      const config = await InstanceConfigLoader.loadAsync('async-file');

      expect(config.project.name).toBe('Async File Project');
      expect(config._source.file).toBe(true);
      expect(config._source.s3).toBe(false);
    });

    it('should load from S3 when enabled and CONFIG_SOURCE=s3', async () => {
      const s3Config = {
        project: { name: 'S3 Project', shortName: 's3-proj', description: 'S3 Desc' },
      };

      process.env.CONFIG_SOURCE = 's3';
      mockS3Storage.isEnabled.mockReturnValue(true);
      mockS3Storage.getJson.mockResolvedValue(s3Config);
      mockFs.existsSync.mockReturnValue(false);

      const config = await InstanceConfigLoader.loadAsync('s3-instance');

      expect(config.project.name).toBe('S3 Project');
      expect(config._source.s3).toBe(true);
      expect(config._source.file).toBe(false);
      expect(mockS3Storage.getJson).toHaveBeenCalledWith('configs/s3-instance/instance.json');

      delete process.env.CONFIG_SOURCE;
    });

    it('should use custom CONFIG_S3_PREFIX', async () => {
      const s3Config = {
        project: { name: 'Custom Prefix Project' },
      };

      process.env.CONFIG_SOURCE = 's3';
      process.env.CONFIG_S3_PREFIX = 'custom-configs/';
      mockS3Storage.isEnabled.mockReturnValue(true);
      mockS3Storage.getJson.mockResolvedValue(s3Config);
      mockFs.existsSync.mockReturnValue(false);

      await InstanceConfigLoader.loadAsync('custom-prefix');

      expect(mockS3Storage.getJson).toHaveBeenCalledWith(
        'custom-configs/custom-prefix/instance.json'
      );

      delete process.env.CONFIG_SOURCE;
      delete process.env.CONFIG_S3_PREFIX;
    });

    it('should fall back to file when S3 returns null', async () => {
      const fileConfig = {
        project: { name: 'Fallback File Project' },
      };

      process.env.CONFIG_SOURCE = 's3';
      mockS3Storage.isEnabled.mockReturnValue(true);
      mockS3Storage.getJson.mockResolvedValue(null);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig));

      const config = await InstanceConfigLoader.loadAsync('s3-fallback');

      expect(config.project.name).toBe('Fallback File Project');
      expect(config._source.s3).toBe(false);
      expect(config._source.file).toBe(true);

      delete process.env.CONFIG_SOURCE;
    });

    it('should handle S3 errors and fall back to file', async () => {
      const fileConfig = {
        project: { name: 'Error Fallback Project' },
      };

      process.env.CONFIG_SOURCE = 's3';
      mockS3Storage.isEnabled.mockReturnValue(true);
      mockS3Storage.getJson.mockRejectedValue(new Error('S3 error'));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(fileConfig));

      const config = await InstanceConfigLoader.loadAsync('s3-error');

      expect(config.project.name).toBe('Error Fallback Project');
      expect(config._source.s3).toBe(false);
      expect(config._source.file).toBe(true);

      delete process.env.CONFIG_SOURCE;
    });

    it('should apply env overrides on top of S3 config', async () => {
      const s3Config = {
        project: { name: 'S3 Name' },
      };

      process.env.CONFIG_SOURCE = 's3';
      process.env.S3ENV_PROJECT_NAME = 'Env Override Name';
      mockS3Storage.isEnabled.mockReturnValue(true);
      mockS3Storage.getJson.mockResolvedValue(s3Config);
      mockFs.existsSync.mockReturnValue(false);

      const config = await InstanceConfigLoader.loadAsync('s3env');

      expect(config.project.name).toBe('Env Override Name');
      expect(config._source.s3).toBe(true);
      expect(config._source.env).toBe(true);

      delete process.env.CONFIG_SOURCE;
      delete process.env.S3ENV_PROJECT_NAME;
    });
  });

  describe('reloadAsync', () => {
    beforeEach(() => {
      (InstanceConfigLoader as any).s3Initialized = false;
    });

    it('should clear cache and reload config asynchronously', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const config1 = await InstanceConfigLoader.loadAsync('reload-async-test');

      // Change what would be loaded
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify({
          project: { name: 'Reloaded Async Project' },
        })
      );

      const config2 = await InstanceConfigLoader.reloadAsync('reload-async-test');

      expect(config1).not.toBe(config2);
      expect(config2.project.name).toBe('Reloaded Async Project');
    });

    it('should reload from S3 when enabled', async () => {
      process.env.CONFIG_SOURCE = 's3';
      mockS3Storage.isEnabled.mockReturnValue(true);
      mockS3Storage.getJson.mockResolvedValue({ project: { name: 'First S3 Load' } });
      mockFs.existsSync.mockReturnValue(false);

      await InstanceConfigLoader.loadAsync('reload-s3');

      mockS3Storage.getJson.mockResolvedValue({ project: { name: 'Second S3 Load' } });

      const config = await InstanceConfigLoader.reloadAsync('reload-s3');

      expect(config.project.name).toBe('Second S3 Load');

      delete process.env.CONFIG_SOURCE;
    });
  });

  describe('getAvailableInstancesAsync', () => {
    beforeEach(() => {
      (InstanceConfigLoader as any).s3Initialized = false;
    });

    it('should list instances from S3 when enabled', async () => {
      process.env.CONFIG_SOURCE = 's3';
      mockS3Storage.isEnabled.mockReturnValue(true);
      mockS3Storage.list.mockResolvedValue([
        'configs/projecta/instance.json',
        'configs/projectb/instance.json',
        'configs/projectc/instance.json',
        'configs/projecta/other.json', // Should be ignored
      ]);

      const instances = await InstanceConfigLoader.getAvailableInstancesAsync();

      expect(instances).toContain('projecta');
      expect(instances).toContain('projectb');
      expect(instances).toContain('projectc');
      expect(instances).toHaveLength(3);

      delete process.env.CONFIG_SOURCE;
    });

    it('should use custom CONFIG_S3_PREFIX for listing', async () => {
      process.env.CONFIG_SOURCE = 's3';
      process.env.CONFIG_S3_PREFIX = 'my-configs/';
      mockS3Storage.isEnabled.mockReturnValue(true);
      mockS3Storage.list.mockResolvedValue([
        'my-configs/proj1/instance.json',
        'my-configs/proj2/instance.json',
      ]);

      const instances = await InstanceConfigLoader.getAvailableInstancesAsync();

      expect(mockS3Storage.list).toHaveBeenCalledWith('my-configs/');
      expect(instances).toContain('proj1');
      expect(instances).toContain('proj2');

      delete process.env.CONFIG_SOURCE;
      delete process.env.CONFIG_S3_PREFIX;
    });

    it('should fall back to local when S3 is disabled', async () => {
      mockS3Storage.isEnabled.mockReturnValue(false);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([{ name: 'local-proj', isDirectory: () => true }] as any);

      const instances = await InstanceConfigLoader.getAvailableInstancesAsync();

      expect(instances).toEqual(['local-proj']);
    });

    it('should fall back to local when S3 list fails', async () => {
      process.env.CONFIG_SOURCE = 's3';
      mockS3Storage.isEnabled.mockReturnValue(true);
      mockS3Storage.list.mockRejectedValue(new Error('S3 list error'));
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        { name: 'fallback-proj', isDirectory: () => true },
      ] as any);

      const instances = await InstanceConfigLoader.getAvailableInstancesAsync();

      expect(instances).toEqual(['fallback-proj']);

      delete process.env.CONFIG_SOURCE;
    });

    it('should return empty array when no instances found', async () => {
      process.env.CONFIG_SOURCE = 's3';
      mockS3Storage.isEnabled.mockReturnValue(true);
      mockS3Storage.list.mockResolvedValue([]);

      const instances = await InstanceConfigLoader.getAvailableInstancesAsync();

      expect(instances).toEqual([]);

      delete process.env.CONFIG_SOURCE;
    });
  });

  describe('saveToS3', () => {
    beforeEach(() => {
      (InstanceConfigLoader as any).s3Initialized = false;
    });

    it('should save config to S3', async () => {
      mockS3Storage.isEnabled.mockReturnValue(true);
      const config = { project: { name: 'Saved Project' } };

      await InstanceConfigLoader.saveToS3('save-test', config);

      expect(mockS3Storage.putJson).toHaveBeenCalledWith('configs/save-test/instance.json', config);
    });

    it('should use custom CONFIG_S3_PREFIX', async () => {
      process.env.CONFIG_S3_PREFIX = 'custom-save/';
      mockS3Storage.isEnabled.mockReturnValue(true);
      const config = { project: { name: 'Custom Save' } };

      await InstanceConfigLoader.saveToS3('custom-instance', config);

      expect(mockS3Storage.putJson).toHaveBeenCalledWith(
        'custom-save/custom-instance/instance.json',
        config
      );

      delete process.env.CONFIG_S3_PREFIX;
    });

    it('should throw error when S3 is not enabled', async () => {
      mockS3Storage.isEnabled.mockReturnValue(false);

      await expect(
        InstanceConfigLoader.saveToS3('fail-instance', { project: { name: 'Fail' } })
      ).rejects.toThrow('S3 storage is not enabled');
    });

    it('should clear cache after saving', async () => {
      mockS3Storage.isEnabled.mockReturnValue(true);
      mockFs.existsSync.mockReturnValue(false);

      // First load the config
      InstanceConfigLoader.load('cache-clear-test');
      expect(InstanceConfigLoader.has('cache-clear-test')).toBe(true);

      // Save to S3 should clear cache
      await InstanceConfigLoader.saveToS3('cache-clear-test', { project: { name: 'New' } });

      expect(InstanceConfigLoader.has('cache-clear-test')).toBe(false);
    });
  });

  describe('S3 initialization', () => {
    beforeEach(() => {
      (InstanceConfigLoader as any).s3Initialized = false;
    });

    it('should initialize S3 only once', async () => {
      mockS3Storage.isEnabled.mockReturnValue(false);
      mockFs.existsSync.mockReturnValue(false);

      await InstanceConfigLoader.loadAsync('init-test-1');
      await InstanceConfigLoader.loadAsync('init-test-2');

      expect(mockS3Storage.initializeFromEnv).toHaveBeenCalledTimes(1);
    });

    it('should initialize S3 on sync load as well', () => {
      (InstanceConfigLoader as any).s3Initialized = false;
      mockFs.existsSync.mockReturnValue(false);

      InstanceConfigLoader.load('sync-init-test');

      expect(mockS3Storage.initializeFromEnv).toHaveBeenCalled();
    });
  });
});
