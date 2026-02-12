/**
 * Prompt Templates Tests
 * Tests for prompt template utilities and template validation

 * Date: 2025-12-23
 */

import { describe, it, expect } from 'vitest';
import {
  PROMPT_TEMPLATES,
  fillTemplate,
  hasUnfilledVariables,
  extractVariables,
} from '../server/stream/llm/prompt-templates';

describe('fillTemplate', () => {
  it('should replace single variable', () => {
    const template = 'Hello {{name}}!';
    const result = fillTemplate(template, { name: 'World' });

    expect(result).toBe('Hello World!');
  });

  it('should replace multiple variables', () => {
    const template = '{{greeting}}, {{name}}!';
    const result = fillTemplate(template, { greeting: 'Hello', name: 'User' });

    expect(result).toBe('Hello, User!');
  });

  it('should replace same variable multiple times', () => {
    const template = '{{name}} said: Hello {{name}}!';
    const result = fillTemplate(template, { name: 'Alice' });

    expect(result).toBe('Alice said: Hello Alice!');
  });

  it('should handle null values as empty string', () => {
    const template = 'Value: {{value}}';
    const result = fillTemplate(template, { value: null });

    expect(result).toBe('Value: ');
  });

  it('should handle undefined values as empty string', () => {
    const template = 'Value: {{value}}';
    const result = fillTemplate(template, { value: undefined });

    expect(result).toBe('Value: ');
  });

  it('should convert numbers to strings', () => {
    const template = 'Count: {{count}}';
    const result = fillTemplate(template, { count: 42 });

    expect(result).toBe('Count: 42');
  });

  it('should convert booleans to strings', () => {
    const template = 'Active: {{active}}';
    const result = fillTemplate(template, { active: true });

    expect(result).toBe('Active: true');
  });

  it('should leave unfilled variables unchanged', () => {
    const template = '{{filled}} and {{unfilled}}';
    const result = fillTemplate(template, { filled: 'value' });

    expect(result).toBe('value and {{unfilled}}');
  });

  it('should handle empty variables object', () => {
    const template = 'No replacements {{here}}';
    const result = fillTemplate(template, {});

    expect(result).toBe('No replacements {{here}}');
  });

  it('should handle special regex characters in variable names', () => {
    const template = 'Test {{var.name}} works';
    const result = fillTemplate(template, { 'var.name': 'value' });

    expect(result).toBe('Test value works');
  });
});

describe('hasUnfilledVariables', () => {
  it('should return true for text with unfilled variables', () => {
    const text = 'Hello {{name}}!';

    expect(hasUnfilledVariables(text)).toBe(true);
  });

  it('should return false for text without variables', () => {
    const text = 'Hello World!';

    expect(hasUnfilledVariables(text)).toBe(false);
  });

  it('should return true for multiple unfilled variables', () => {
    const text = '{{greeting}}, {{name}}!';

    expect(hasUnfilledVariables(text)).toBe(true);
  });

  it('should return false for empty string', () => {
    expect(hasUnfilledVariables('')).toBe(false);
  });

  it('should handle partial variable syntax', () => {
    const text = 'Single brace { not a variable';

    expect(hasUnfilledVariables(text)).toBe(false);
  });
});

describe('extractVariables', () => {
  it('should extract single variable', () => {
    const template = 'Hello {{name}}!';
    const variables = extractVariables(template);

    expect(variables).toEqual(['name']);
  });

  it('should extract multiple variables', () => {
    const template = '{{greeting}}, {{name}}!';
    const variables = extractVariables(template);

    expect(variables).toEqual(['greeting', 'name']);
  });

  it('should return empty array for no variables', () => {
    const template = 'No variables here';
    const variables = extractVariables(template);

    expect(variables).toEqual([]);
  });

  it('should extract duplicate variables', () => {
    const template = '{{name}} meets {{name}}';
    const variables = extractVariables(template);

    expect(variables).toEqual(['name', 'name']);
  });

  it('should handle complex variable names', () => {
    const template = '{{project_name}} and {{userName123}}';
    const variables = extractVariables(template);

    expect(variables).toEqual(['project_name', 'userName123']);
  });
});

describe('PROMPT_TEMPLATES', () => {
  describe('threadClassification', () => {
    it('should have system and user prompts', () => {
      expect(PROMPT_TEMPLATES.threadClassification.system).toBeDefined();
      expect(PROMPT_TEMPLATES.threadClassification.user).toBeDefined();
    });

    it('should contain projectName placeholder in system', () => {
      const vars = extractVariables(PROMPT_TEMPLATES.threadClassification.system);

      expect(vars).toContain('projectName');
    });

    it('should contain expected placeholders in user', () => {
      const vars = extractVariables(PROMPT_TEMPLATES.threadClassification.user);

      expect(vars).toContain('projectName');
      expect(vars).toContain('contextText');
      expect(vars).toContain('messagesToAnalyze');
    });
  });

  describe('changesetGeneration', () => {
    it('should have system and user prompts', () => {
      expect(PROMPT_TEMPLATES.changesetGeneration.system).toBeDefined();
      expect(PROMPT_TEMPLATES.changesetGeneration.user).toBeDefined();
    });

    it('should contain expected placeholders in user', () => {
      const vars = extractVariables(PROMPT_TEMPLATES.changesetGeneration.user);

      expect(vars).toContain('projectName');
      expect(vars).toContain('messageCount');
      expect(vars).toContain('channel');
      expect(vars).toContain('conversationContext');
      expect(vars).toContain('ragContext');
    });
  });

  describe('messageAnalysis', () => {
    it('should have prompt template', () => {
      expect(PROMPT_TEMPLATES.messageAnalysis.prompt).toBeDefined();
    });

    it('should contain expected placeholders', () => {
      const vars = extractVariables(PROMPT_TEMPLATES.messageAnalysis.prompt);

      expect(vars).toContain('documentationContext');
      expect(vars).toContain('projectName');
      expect(vars).toContain('topic');
      expect(vars).toContain('senderName');
      expect(vars).toContain('messageTimestamp');
      expect(vars).toContain('content');
    });
  });

  describe('documentationAnswer', () => {
    it('should have system prompt', () => {
      expect(PROMPT_TEMPLATES.documentationAnswer.system).toBeDefined();
    });

    it('should contain projectName placeholder', () => {
      const vars = extractVariables(PROMPT_TEMPLATES.documentationAnswer.system);

      expect(vars).toContain('projectName');
    });
  });

  // NOTE: fileConsolidation tests removed - template moved to PromptRegistry
  // Tests for the new externalized template are in tests/file-consolidation-service.test.ts

  describe('template filling', () => {
    it('should fill threadClassification user template', () => {
      const filled = fillTemplate(PROMPT_TEMPLATES.threadClassification.user, {
        projectName: 'ProjectA',
        contextText: 'Previous messages here',
        messagesToAnalyze: 'Current messages here',
      });

      expect(filled).toContain('ProjectA');
      expect(filled).toContain('Previous messages here');
      expect(filled).toContain('Current messages here');
      expect(hasUnfilledVariables(filled)).toBe(false);
    });

    it('should fill changesetGeneration user template', () => {
      const filled = fillTemplate(PROMPT_TEMPLATES.changesetGeneration.user, {
        projectName: 'ProjectA',
        messageCount: '5',
        channel: 'general',
        conversationContext: 'Conversation context',
        ragContext: 'Documentation context',
      });

      expect(filled).toContain('ProjectA');
      expect(filled).toContain('5 messages');
      expect(hasUnfilledVariables(filled)).toBe(false);
    });
  });
});
