/**
 * LLM Components Unit Tests
 * Tests for componentized LLM utilities: SchemaConverter, ResponseParser, RetryHandler, PromptBuilder

 * Date: 2025-12-23
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { SchemaConverter } from '../server/stream/llm/schema-converter.js';
import { ResponseParser } from '../server/stream/llm/response-parser.js';
import { RetryHandler, DEFAULT_RETRY_CONFIG } from '../server/stream/llm/retry-handler.js';
import { PromptBuilder } from '../server/stream/llm/prompt-builder.js';
import { LLMModel } from '../server/stream/types.js';

describe('SchemaConverter', () => {
  describe('toGeminiSchema', () => {
    it('should convert simple Zod object schema', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const result = SchemaConverter.toGeminiSchema(schema);

      expect(result.type).toBe('object');
      expect(result.properties.name.type).toBe('string');
      expect(result.properties.age.type).toBe('number');
    });

    it('should convert nested Zod schema', () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string(),
        }),
      });

      const result = SchemaConverter.toGeminiSchema(schema);

      expect(result.properties.user.type).toBe('object');
      expect(result.properties.user.properties.name.type).toBe('string');
    });

    it('should convert array schema', () => {
      const schema = z.object({
        items: z.array(z.string()),
      });

      const result = SchemaConverter.toGeminiSchema(schema);

      expect(result.properties.items.type).toBe('array');
      expect(result.properties.items.items.type).toBe('string');
    });

    it('should convert optional fields', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      const result = SchemaConverter.toGeminiSchema(schema);

      expect(result.required).toContain('required');
      expect(result.required).not.toContain('optional');
    });

    it('should convert enum schema', () => {
      const schema = z.object({
        status: z.enum(['active', 'inactive', 'pending']),
      });

      const result = SchemaConverter.toGeminiSchema(schema);

      expect(result.properties.status.enum).toEqual(['active', 'inactive', 'pending']);
    });
  });

  describe('cleanSchema', () => {
    it('should remove $schema field', () => {
      const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: { name: { type: 'string' } },
      };

      const result = SchemaConverter.cleanSchema(schema);

      expect(result.$schema).toBeUndefined();
      expect(result.type).toBe('object');
    });

    it('should remove additionalProperties field', () => {
      const schema = {
        type: 'object',
        properties: { name: { type: 'string' } },
        additionalProperties: false,
      };

      const result = SchemaConverter.cleanSchema(schema);

      expect(result.additionalProperties).toBeUndefined();
    });

    it('should remove $ref field', () => {
      const schema = {
        type: 'object',
        properties: {
          child: { $ref: '#/definitions/Child' },
        },
      };

      const result = SchemaConverter.cleanSchema(schema);

      expect(result.properties.child.$ref).toBeUndefined();
    });

    it('should remove definitions field', () => {
      const schema = {
        type: 'object',
        definitions: {
          Child: { type: 'object' },
        },
      };

      const result = SchemaConverter.cleanSchema(schema);

      expect(result.definitions).toBeUndefined();
    });

    it('should handle null input', () => {
      expect(SchemaConverter.cleanSchema(null)).toBeNull();
    });

    it('should handle primitive input', () => {
      expect(SchemaConverter.cleanSchema('string')).toBe('string');
      expect(SchemaConverter.cleanSchema(123)).toBe(123);
      expect(SchemaConverter.cleanSchema(true)).toBe(true);
    });

    it('should handle array input', () => {
      const schema = [
        { type: 'string', $schema: 'test' },
        { type: 'number', additionalProperties: true },
      ];

      const result = SchemaConverter.cleanSchema(schema);

      expect(result).toHaveLength(2);
      expect(result[0].$schema).toBeUndefined();
      expect(result[1].additionalProperties).toBeUndefined();
    });

    it('should recursively clean nested objects', () => {
      const schema = {
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            $schema: 'nested-schema',
            additionalProperties: false,
            properties: {
              deepNested: {
                type: 'string',
                definitions: {},
              },
            },
          },
        },
      };

      const result = SchemaConverter.cleanSchema(schema);

      expect(result.properties.nested.$schema).toBeUndefined();
      expect(result.properties.nested.additionalProperties).toBeUndefined();
      expect(result.properties.nested.properties.deepNested.definitions).toBeUndefined();
    });
  });
});

describe('ResponseParser', () => {
  describe('parseJSON', () => {
    it('should parse valid JSON', () => {
      const result = ResponseParser.parseJSON<{ name: string }>('{"name": "test"}');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test' });
    });

    it('should handle empty string', () => {
      const result = ResponseParser.parseJSON('');

      expect(result.success).toBe(false);
      expect(result.isTransient).toBe(true);
      expect(result.error).toContain('Empty response');
    });

    it('should handle null input', () => {
      const result = ResponseParser.parseJSON(null);

      expect(result.success).toBe(false);
      expect(result.isTransient).toBe(true);
    });

    it('should handle undefined input', () => {
      const result = ResponseParser.parseJSON(undefined);

      expect(result.success).toBe(false);
      expect(result.isTransient).toBe(true);
    });

    it('should handle malformed JSON', () => {
      const result = ResponseParser.parseJSON('{invalid json}');

      expect(result.success).toBe(false);
      expect(result.isTransient).toBe(true);
      expect(result.error).toContain('Malformed JSON');
    });

    it('should parse complex JSON structures', () => {
      const json = JSON.stringify({
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
        metadata: {
          total: 2,
          page: 1,
        },
      });

      const result = ResponseParser.parseJSON(json);

      expect(result.success).toBe(true);
      expect(result.data.users).toHaveLength(2);
      expect(result.data.metadata.total).toBe(2);
    });
  });

  describe('extractJSON', () => {
    it('should extract JSON from markdown code block', () => {
      const text = '```json\n{"name": "test"}\n```';
      const result = ResponseParser.extractJSON(text);

      expect(result).toBe('{"name": "test"}');
    });

    it('should extract JSON from generic code block', () => {
      const text = '```\n{"name": "test"}\n```';
      const result = ResponseParser.extractJSON(text);

      expect(result).toBe('{"name": "test"}');
    });

    it('should extract JSON object from text', () => {
      const text = 'Here is the result: {"name": "test"}';
      const result = ResponseParser.extractJSON(text);

      expect(result).toBe('{"name": "test"}');
    });

    it('should extract JSON array from text', () => {
      const text = 'The items are: [1, 2, 3]';
      const result = ResponseParser.extractJSON(text);

      expect(result).toBe('[1, 2, 3]');
    });

    it('should return trimmed original if no JSON found', () => {
      const text = '   plain text   ';
      const result = ResponseParser.extractJSON(text);

      expect(result).toBe('plain text');
    });

    it('should handle multiline JSON in code block', () => {
      const text = '```json\n{\n  "name": "test",\n  "value": 123\n}\n```';
      const result = ResponseParser.extractJSON(text);

      expect(result).toContain('"name": "test"');
      expect(result).toContain('"value": 123');
    });
  });

  describe('validate', () => {
    it('should validate data against schema successfully', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const result = ResponseParser.validate({ name: 'test', age: 25 }, schema);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', age: 25 });
    });

    it('should fail validation for invalid data', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const result = ResponseParser.validate({ name: 'test', age: 'invalid' }, schema);

      expect(result.success).toBe(false);
      expect(result.isTransient).toBe(false); // Schema validation failures are not transient
      expect(result.error).toContain('Schema validation failed');
    });

    it('should fail for missing required fields', () => {
      const schema = z.object({
        name: z.string(),
        email: z.string(),
      });

      const result = ResponseParser.validate({ name: 'test' }, schema);

      expect(result.success).toBe(false);
    });
  });
});

describe('RetryHandler', () => {
  describe('constructor', () => {
    it('should use default config when none provided', () => {
      const handler = new RetryHandler();
      const delay = handler.calculateDelay(1, false);

      expect(delay).toBe(DEFAULT_RETRY_CONFIG.baseDelayMs);
    });

    it('should merge custom config with defaults', () => {
      const handler = new RetryHandler({ maxRetries: 5 });
      const delay = handler.calculateDelay(1, false);

      expect(delay).toBe(DEFAULT_RETRY_CONFIG.baseDelayMs);
    });
  });

  describe('calculateDelay', () => {
    it('should calculate exponential backoff', () => {
      const handler = new RetryHandler({ baseDelayMs: 1000 });

      expect(handler.calculateDelay(1, false)).toBe(1000);
      expect(handler.calculateDelay(2, false)).toBe(2000);
      expect(handler.calculateDelay(3, false)).toBe(4000);
    });

    it('should apply transient multiplier', () => {
      const handler = new RetryHandler({
        baseDelayMs: 1000,
        transientDelayMultiplier: 2,
      });

      expect(handler.calculateDelay(1, true)).toBe(2000);
      expect(handler.calculateDelay(2, true)).toBe(4000);
    });
  });

  describe('execute', () => {
    it('should return result on first success', async () => {
      const handler = new RetryHandler({}, () => Promise.resolve());
      const operation = vi.fn().mockResolvedValue('success');

      const result = await handler.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient error and succeed', async () => {
      const handler = new RetryHandler({ maxRetries: 3 }, () => Promise.resolve());
      let attempts = 0;
      const operation = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          const err = new Error('transient error');
          (err as any).transient = true;
          throw err;
        }
        return Promise.resolve('success');
      });

      const result = await handler.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should throw immediately on non-transient error', async () => {
      const handler = new RetryHandler({}, () => Promise.resolve());
      const operation = vi.fn().mockRejectedValue(new Error('permanent error'));

      await expect(handler.execute(operation)).rejects.toThrow('permanent error');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should throw after max retries', async () => {
      const handler = new RetryHandler({ maxRetries: 3 }, () => Promise.resolve());
      const error = new Error('always fails');
      (error as any).transient = true;
      const operation = vi.fn().mockRejectedValue(error);

      await expect(handler.execute(operation)).rejects.toThrow('always fails');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should call onRetry callback', async () => {
      const handler = new RetryHandler({ maxRetries: 3 }, () => Promise.resolve());
      const onRetry = vi.fn();
      let attempts = 0;
      const operation = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          const err = new Error('retry me');
          (err as any).transient = true;
          throw err;
        }
        return Promise.resolve('success');
      });

      await handler.execute(operation, onRetry);

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
    });
  });

  describe('transientError', () => {
    it('should create error with transient flag', () => {
      const error = RetryHandler.transientError('test error');

      expect(error.message).toBe('test error');
      expect((error as any).transient).toBe(true);
    });
  });

  describe('permanentError', () => {
    it('should create error without transient flag', () => {
      const error = RetryHandler.permanentError('test error');

      expect(error.message).toBe('test error');
      expect((error as any).transient).toBe(false);
    });
  });
});

describe('PromptBuilder', () => {
  describe('build', () => {
    it('should return user prompt when no system prompt', () => {
      const result = PromptBuilder.build({
        model: LLMModel.FLASH,
        userPrompt: 'Hello world',
      });

      expect(result).toBe('Hello world');
    });

    it('should combine system and user prompts', () => {
      const result = PromptBuilder.build({
        model: LLMModel.FLASH,
        systemPrompt: 'You are helpful.',
        userPrompt: 'Hello world',
      });

      expect(result).toBe('You are helpful.\n\nHello world');
    });

    it('should handle empty system prompt', () => {
      const result = PromptBuilder.build({
        model: LLMModel.FLASH,
        systemPrompt: '',
        userPrompt: 'Hello world',
      });

      expect(result).toBe('Hello world');
    });
  });

  describe('convertHistory', () => {
    it('should convert empty history', () => {
      const result = PromptBuilder.convertHistory([]);
      expect(result).toEqual([]);
    });

    it('should convert undefined history', () => {
      const result = PromptBuilder.convertHistory(undefined);
      expect(result).toEqual([]);
    });

    it('should convert user message', () => {
      const result = PromptBuilder.convertHistory([{ role: 'user', content: 'Hello' }]);

      expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('should convert assistant to model role', () => {
      const result = PromptBuilder.convertHistory([{ role: 'assistant', content: 'Hi there' }]);

      expect(result).toEqual([{ role: 'model', content: 'Hi there' }]);
    });

    it('should convert multiple messages', () => {
      const result = PromptBuilder.convertHistory([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
        { role: 'user', content: 'How are you?' },
      ]);

      expect(result).toHaveLength(3);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('model');
      expect(result[2].role).toBe('user');
    });
  });

  describe('hasHistory', () => {
    it('should return false for no history', () => {
      const result = PromptBuilder.hasHistory({
        model: LLMModel.FLASH,
        userPrompt: 'test',
      });

      expect(result).toBe(false);
    });

    it('should return false for empty history', () => {
      const result = PromptBuilder.hasHistory({
        model: LLMModel.FLASH,
        userPrompt: 'test',
        history: [],
      });

      expect(result).toBe(false);
    });

    it('should return true for non-empty history', () => {
      const result = PromptBuilder.hasHistory({
        model: LLMModel.FLASH,
        userPrompt: 'test',
        history: [{ role: 'user', content: 'previous' }],
      });

      expect(result).toBe(true);
    });
  });

  describe('createCacheKey', () => {
    it('should create cache key from prompt', () => {
      const result = PromptBuilder.createCacheKey({
        model: LLMModel.FLASH,
        systemPrompt: 'System',
        userPrompt: 'User',
      });

      expect(result).toBe('System\n\nUser');
    });
  });
});
