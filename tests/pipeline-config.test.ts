/**
 * Pipeline Configuration Tests
 *
 * Tests for configuration loaders and prompt registry.
 *

 * @created 2025-12-30
 */

import { describe, it, expect, vi } from 'vitest';
import { PromptRegistry } from '../server/pipeline/prompts/PromptRegistry.js';
import { validateDomainConfig } from '../server/pipeline/config/DomainConfigLoader.js';
import {
  validatePipelineConfig,
  getDefaultPipelineConfig,
} from '../server/pipeline/config/PipelineConfigLoader.js';
import { StepType } from '../server/pipeline/core/interfaces.js';

// Mock the logger
vi.mock('../server/utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

describe('PromptRegistry', () => {
  describe('addTemplate and get', () => {
    it('should store and retrieve templates', () => {
      const registry = new PromptRegistry('/fake/path');

      registry.addTemplate({
        id: 'test-prompt',
        version: '1.0.0',
        metadata: {
          description: 'Test prompt',
          requiredVariables: ['var1'],
        },
        system: 'System: {{var1}}',
        user: 'User: {{var1}}',
      });

      const template = registry.get('test-prompt');
      expect(template).not.toBeNull();
      expect(template!.id).toBe('test-prompt');
      expect(template!.system).toBe('System: {{var1}}');
    });

    it('should return null for unknown prompts', () => {
      const registry = new PromptRegistry('/fake/path');
      expect(registry.get('unknown')).toBeNull();
    });
  });

  describe('render', () => {
    it('should render template with variables', () => {
      const registry = new PromptRegistry('/fake/path');

      registry.addTemplate({
        id: 'test-prompt',
        version: '1.0.0',
        metadata: {
          description: 'Test prompt',
          requiredVariables: ['name', 'action'],
        },
        system: 'Hello {{name}}, you should {{action}}.',
        user: 'Please {{action}} now.',
      });

      const rendered = registry.render('test-prompt', {
        name: 'World',
        action: 'run tests',
      });

      expect(rendered.system).toBe('Hello World, you should run tests.');
      expect(rendered.user).toBe('Please run tests now.');
    });

    it('should throw for unknown prompt', () => {
      const registry = new PromptRegistry('/fake/path');

      expect(() => registry.render('unknown', {})).toThrow('Prompt template not found: unknown');
    });

    it('should leave missing variables as placeholders', () => {
      const registry = new PromptRegistry('/fake/path');

      registry.addTemplate({
        id: 'test-prompt',
        version: '1.0.0',
        metadata: {
          description: 'Test prompt',
          requiredVariables: ['var1'],
        },
        system: 'Value: {{var1}}',
        user: 'Value: {{var1}}',
      });

      const rendered = registry.render('test-prompt', {});
      expect(rendered.system).toBe('Value: {{var1}}');
    });
  });

  describe('list', () => {
    it('should list all templates', () => {
      const registry = new PromptRegistry('/fake/path');

      registry.addTemplate({
        id: 'prompt-1',
        version: '1.0.0',
        metadata: { description: 'First', requiredVariables: [] },
        system: 'S1',
        user: 'U1',
      });

      registry.addTemplate({
        id: 'prompt-2',
        version: '1.0.0',
        metadata: { description: 'Second', requiredVariables: [] },
        system: 'S2',
        user: 'U2',
      });

      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map((t) => t.id)).toContain('prompt-1');
      expect(list.map((t) => t.id)).toContain('prompt-2');
    });
  });

  describe('validate', () => {
    it('should validate valid template', () => {
      const registry = new PromptRegistry('/fake/path');

      const result = registry.validate({
        id: 'test',
        version: '1.0.0',
        metadata: {
          description: 'Test',
          requiredVariables: ['var1'],
        },
        system: 'Hello {{var1}}',
        user: 'World {{var1}}',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing id', () => {
      const registry = new PromptRegistry('/fake/path');

      const result = registry.validate({
        id: '',
        version: '1.0.0',
        metadata: { description: 'Test', requiredVariables: [] },
        system: 'Hello',
        user: 'World',
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Template missing id');
    });

    it('should detect undeclared variables', () => {
      const registry = new PromptRegistry('/fake/path');

      const result = registry.validate({
        id: 'test',
        version: '1.0.0',
        metadata: {
          description: 'Test',
          requiredVariables: [], // Empty but uses var1
        },
        system: 'Hello {{var1}}',
        user: 'World',
      });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('var1');
    });
  });
});

describe('DomainConfigLoader', () => {
  describe('validateDomainConfig', () => {
    it('should validate valid domain config', () => {
      const config = {
        domainId: 'test',
        name: 'Test Domain',
        categories: [
          {
            id: 'cat-1',
            label: 'Category 1',
            description: 'First category',
            priority: 90,
          },
        ],
        context: {
          projectName: 'Test',
          domain: 'Testing',
          targetAudience: 'Devs',
          documentationPurpose: 'Docs',
        },
      };

      const result = validateDomainConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject config without categories', () => {
      const config = {
        domainId: 'test',
        name: 'Test',
        categories: [],
        context: {
          projectName: 'Test',
          domain: 'Testing',
          targetAudience: 'Devs',
          documentationPurpose: 'Docs',
        },
      };

      const result = validateDomainConfig(config);
      expect(result.valid).toBe(false);
    });

    it('should reject category with invalid priority', () => {
      const config = {
        domainId: 'test',
        name: 'Test',
        categories: [
          {
            id: 'cat-1',
            label: 'Category 1',
            description: 'First',
            priority: 150, // Invalid: > 100
          },
        ],
        context: {
          projectName: 'Test',
          domain: 'Testing',
          targetAudience: 'Devs',
          documentationPurpose: 'Docs',
        },
      };

      const result = validateDomainConfig(config);
      expect(result.valid).toBe(false);
    });

    it('should accept config with keywords', () => {
      const config = {
        domainId: 'test',
        name: 'Test',
        categories: [
          {
            id: 'cat-1',
            label: 'Category 1',
            description: 'First',
            priority: 90,
          },
        ],
        keywords: {
          include: ['validator', 'staking'],
          exclude: ['spam'],
          caseSensitive: false,
        },
        context: {
          projectName: 'Test',
          domain: 'Testing',
          targetAudience: 'Devs',
          documentationPurpose: 'Docs',
        },
      };

      const result = validateDomainConfig(config);
      expect(result.valid).toBe(true);
    });
  });
});

describe('PipelineConfigLoader', () => {
  describe('validatePipelineConfig', () => {
    it('should validate valid pipeline config', () => {
      const config = {
        instanceId: 'test',
        pipelineId: 'test-v1',
        steps: [
          {
            stepId: 'step-1',
            stepType: StepType.FILTER,
            enabled: true,
            config: {},
          },
        ],
        errorHandling: {
          stopOnError: false,
          retryAttempts: 3,
          retryDelayMs: 5000,
        },
        performance: {
          maxConcurrentSteps: 1,
          timeoutMs: 300000,
          enableCaching: true,
        },
      };

      const result = validatePipelineConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should reject config without steps', () => {
      const config = {
        instanceId: 'test',
        pipelineId: 'test-v1',
        steps: [],
        errorHandling: {
          stopOnError: false,
          retryAttempts: 3,
          retryDelayMs: 5000,
        },
        performance: {
          maxConcurrentSteps: 1,
          timeoutMs: 300000,
          enableCaching: true,
        },
      };

      const result = validatePipelineConfig(config);
      expect(result.valid).toBe(false);
    });

    it('should reject invalid step type', () => {
      const config = {
        instanceId: 'test',
        pipelineId: 'test-v1',
        steps: [
          {
            stepId: 'step-1',
            stepType: 'invalid-type',
            enabled: true,
            config: {},
          },
        ],
        errorHandling: {
          stopOnError: false,
          retryAttempts: 3,
          retryDelayMs: 5000,
        },
        performance: {
          maxConcurrentSteps: 1,
          timeoutMs: 300000,
          enableCaching: true,
        },
      };

      const result = validatePipelineConfig(config);
      expect(result.valid).toBe(false);
    });

    it('should reject too many retry attempts', () => {
      const config = {
        instanceId: 'test',
        pipelineId: 'test-v1',
        steps: [
          {
            stepId: 'step-1',
            stepType: StepType.FILTER,
            enabled: true,
            config: {},
          },
        ],
        errorHandling: {
          stopOnError: false,
          retryAttempts: 20, // Max is 10
          retryDelayMs: 5000,
        },
        performance: {
          maxConcurrentSteps: 1,
          timeoutMs: 300000,
          enableCaching: true,
        },
      };

      const result = validatePipelineConfig(config);
      expect(result.valid).toBe(false);
    });
  });

  describe('getDefaultPipelineConfig', () => {
    it('should return a valid default config', () => {
      const config = getDefaultPipelineConfig();

      expect(config.instanceId).toBe('default');
      expect(config.steps.length).toBeGreaterThan(0);

      const result = validatePipelineConfig(config);
      expect(result.valid).toBe(true);
    });

    it('should include all step types', () => {
      const config = getDefaultPipelineConfig();
      const stepTypes = config.steps.map((s) => s.stepType);

      expect(stepTypes).toContain(StepType.FILTER);
      expect(stepTypes).toContain(StepType.CLASSIFY);
      expect(stepTypes).toContain(StepType.ENRICH);
      expect(stepTypes).toContain(StepType.GENERATE);
    });
  });
});
