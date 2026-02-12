/**
 * Stream LLM Utilities Tests
 * Tests for ResponseParser, SchemaConverter, RetryHandler, and PromptBuilder

 * Date: 2025-12-23
 */

import { describe, it, expect, vi } from 'vitest';
import { ResponseParser } from '../server/stream/llm/response-parser';
import { SchemaConverter } from '../server/stream/llm/schema-converter';
import { RetryHandler, DEFAULT_RETRY_CONFIG } from '../server/stream/llm/retry-handler';
import { PromptBuilder } from '../server/stream/llm/prompt-builder';

describe('ResponseParser', () => {
  describe('parseJSON', () => {
    it('should return error for empty response', () => {
      const result = ResponseParser.parseJSON(null);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Empty response');
      expect(result.isTransient).toBe(true);
    });

    it('should return error for undefined response', () => {
      const result = ResponseParser.parseJSON(undefined);

      expect(result.success).toBe(false);
      expect(result.isTransient).toBe(true);
    });

    it('should return error for empty string', () => {
      const result = ResponseParser.parseJSON('');

      expect(result.success).toBe(false);
      expect(result.isTransient).toBe(true);
    });

    it('should parse valid JSON', () => {
      const json = '{"name": "test", "value": 42}';
      const result = ResponseParser.parseJSON<{ name: string; value: number }>(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test', value: 42 });
    });

    it('should return error for invalid JSON', () => {
      const result = ResponseParser.parseJSON('{ invalid json }');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Malformed JSON');
      expect(result.isTransient).toBe(true);
    });

    it('should parse JSON arrays', () => {
      const json = '[1, 2, 3]';
      const result = ResponseParser.parseJSON<number[]>(json);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([1, 2, 3]);
    });
  });

  describe('extractJSON', () => {
    it('should extract JSON from markdown code block', () => {
      const text = 'Here is the result:\n```json\n{"key": "value"}\n```';
      const result = ResponseParser.extractJSON(text);

      expect(result).toBe('{"key": "value"}');
    });

    it('should extract JSON from code block without language', () => {
      const text = '```\n{"key": "value"}\n```';
      const result = ResponseParser.extractJSON(text);

      expect(result).toBe('{"key": "value"}');
    });

    it('should extract JSON object from text', () => {
      const text = 'Some text before {"key": "value"} some text after';
      const result = ResponseParser.extractJSON(text);

      expect(result).toBe('{"key": "value"}');
    });

    it('should extract JSON array from text', () => {
      const text = 'Result: [1, 2, 3]';
      const result = ResponseParser.extractJSON(text);

      expect(result).toBe('[1, 2, 3]');
    });

    it('should return trimmed original text if no JSON found', () => {
      const text = '  plain text  ';
      const result = ResponseParser.extractJSON(text);

      expect(result).toBe('plain text');
    });

    it('should handle nested objects', () => {
      const text = '```json\n{"outer": {"inner": "value"}}\n```';
      const result = ResponseParser.extractJSON(text);

      expect(result).toBe('{"outer": {"inner": "value"}}');
    });
  });

  describe('validate', () => {
    it('should return success for valid data', () => {
      const mockSchema = {
        safeParse: (data: unknown) => ({ success: true, data: data as { name: string } }),
      };

      const result = ResponseParser.validate({ name: 'test' }, mockSchema);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test' });
    });

    it('should return error for invalid data', () => {
      const mockSchema = {
        safeParse: () => ({
          success: false,
          error: { message: 'Invalid type' },
        }),
      };

      const result = ResponseParser.validate({ name: 123 }, mockSchema);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Schema validation failed');
      expect(result.isTransient).toBe(false);
    });

    it('should handle schema with no error message', () => {
      const mockSchema = {
        safeParse: () => ({
          success: false,
          error: null,
        }),
      };

      const result = ResponseParser.validate({}, mockSchema);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown validation error');
    });
  });
});

describe('SchemaConverter', () => {
  describe('cleanSchema', () => {
    it('should remove $schema field', () => {
      const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
      };

      const result = SchemaConverter.cleanSchema(schema);

      expect(result.$schema).toBeUndefined();
      expect(result.type).toBe('object');
    });

    it('should remove additionalProperties field', () => {
      const schema = {
        type: 'object',
        additionalProperties: false,
        properties: { name: { type: 'string' } },
      };

      const result = SchemaConverter.cleanSchema(schema);

      expect(result.additionalProperties).toBeUndefined();
      expect(result.properties).toBeDefined();
    });

    it('should remove definitions and $ref fields', () => {
      const schema = {
        type: 'object',
        definitions: { Foo: { type: 'string' } },
        properties: { ref: { $ref: '#/definitions/Foo' } },
      };

      const result = SchemaConverter.cleanSchema(schema);

      expect(result.definitions).toBeUndefined();
      expect(result.properties.ref.$ref).toBeUndefined();
    });

    it('should recursively clean nested objects', () => {
      const schema = {
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: { type: 'string' },
            },
          },
        },
      };

      const result = SchemaConverter.cleanSchema(schema);

      expect(result.properties.nested.additionalProperties).toBeUndefined();
      expect(result.properties.nested.properties.value.type).toBe('string');
    });

    it('should handle arrays', () => {
      const schema = [
        { type: 'string', additionalProperties: true },
        { type: 'number', $schema: 'test' },
      ];

      const result = SchemaConverter.cleanSchema(schema);

      expect(Array.isArray(result)).toBe(true);
      expect(result[0].additionalProperties).toBeUndefined();
      expect(result[1].$schema).toBeUndefined();
    });

    it('should return primitives unchanged', () => {
      expect(SchemaConverter.cleanSchema('string')).toBe('string');
      expect(SchemaConverter.cleanSchema(42)).toBe(42);
      expect(SchemaConverter.cleanSchema(null)).toBe(null);
    });
  });

  describe('toGeminiSchema', () => {
    it('should convert Zod-like schema to cleaned JSON schema', () => {
      // Mock a simple Zod-like schema by testing cleanSchema behavior
      const mockJsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
        $schema: 'http://json-schema.org/draft-07/schema#',
      };

      const result = SchemaConverter.cleanSchema(mockJsonSchema);

      expect(result.type).toBe('object');
      expect(result.properties.name.type).toBe('string');
      expect(result.$schema).toBeUndefined();
      expect(result.additionalProperties).toBeUndefined();
    });
  });
});

describe('RetryHandler', () => {
  describe('DEFAULT_RETRY_CONFIG', () => {
    it('should have expected defaults', () => {
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.baseDelayMs).toBe(2000);
      expect(DEFAULT_RETRY_CONFIG.transientDelayMultiplier).toBe(2);
    });
  });

  describe('constructor', () => {
    it('should use default config', () => {
      const handler = new RetryHandler();
      const delay = handler.calculateDelay(1, false);

      expect(delay).toBe(2000);
    });

    it('should merge custom config with defaults', () => {
      const handler = new RetryHandler({ maxRetries: 5, baseDelayMs: 1000 });
      const delay = handler.calculateDelay(1, false);

      expect(delay).toBe(1000);
    });
  });

  describe('calculateDelay', () => {
    it('should calculate base delay for first attempt', () => {
      const handler = new RetryHandler({ baseDelayMs: 1000 });

      const delay = handler.calculateDelay(1, false);

      expect(delay).toBe(1000);
    });

    it('should apply exponential backoff', () => {
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

      const delay = handler.calculateDelay(1, true);

      expect(delay).toBe(2000);
    });

    it('should combine exponential backoff with transient multiplier', () => {
      const handler = new RetryHandler({
        baseDelayMs: 1000,
        transientDelayMultiplier: 3,
      });

      // Attempt 2, transient: 1000 * 2^1 * 3 = 6000
      expect(handler.calculateDelay(2, true)).toBe(6000);
    });
  });

  describe('execute', () => {
    it('should succeed on first attempt', async () => {
      const handler = new RetryHandler();
      const operation = vi.fn().mockResolvedValue('success');

      const result = await handler.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient error', async () => {
      const mockDelay = vi.fn().mockResolvedValue(undefined);
      const handler = new RetryHandler({}, mockDelay);

      const transientError = RetryHandler.transientError('Temporary failure');
      const operation = vi.fn().mockRejectedValueOnce(transientError).mockResolvedValue('success');

      const result = await handler.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
      expect(mockDelay).toHaveBeenCalledTimes(1);
    });

    it('should not retry on permanent error', async () => {
      const mockDelay = vi.fn().mockResolvedValue(undefined);
      const handler = new RetryHandler({}, mockDelay);

      const permanentError = RetryHandler.permanentError('Fatal error');

      await expect(handler.execute(() => Promise.reject(permanentError))).rejects.toThrow(
        'Fatal error'
      );
      expect(mockDelay).not.toHaveBeenCalled();
    });

    it('should call onRetry callback', async () => {
      const mockDelay = vi.fn().mockResolvedValue(undefined);
      const handler = new RetryHandler({ baseDelayMs: 1000 }, mockDelay);
      const onRetry = vi.fn();

      const transientError = RetryHandler.transientError('Retry me');
      const operation = vi.fn().mockRejectedValueOnce(transientError).mockResolvedValue('done');

      await handler.execute(operation, onRetry);

      expect(onRetry).toHaveBeenCalledWith(1, transientError, expect.any(Number));
    });

    it('should throw after max retries', async () => {
      const mockDelay = vi.fn().mockResolvedValue(undefined);
      const handler = new RetryHandler({ maxRetries: 2 }, mockDelay);

      const transientError = RetryHandler.transientError('Always fails');

      await expect(handler.execute(() => Promise.reject(transientError))).rejects.toThrow(
        'Always fails'
      );
      expect(mockDelay).toHaveBeenCalledTimes(1); // Only 1 delay between 2 attempts
    });
  });

  describe('transientError', () => {
    it('should create error with transient flag true', () => {
      const error = RetryHandler.transientError('Temp failure');

      expect(error.message).toBe('Temp failure');
      expect(error.transient).toBe(true);
    });
  });

  describe('permanentError', () => {
    it('should create error with transient flag false', () => {
      const error = RetryHandler.permanentError('Fatal failure');

      expect(error.message).toBe('Fatal failure');
      expect(error.transient).toBe(false);
    });
  });

  describe('defaultDelay', () => {
    it('should resolve after timeout', async () => {
      vi.useFakeTimers();

      const delayPromise = RetryHandler.defaultDelay(1000);
      vi.advanceTimersByTime(1000);
      await delayPromise;

      vi.useRealTimers();
    });
  });
});

describe('PromptBuilder', () => {
  describe('build', () => {
    it('should return only user prompt when no system prompt', () => {
      const request = { userPrompt: 'Hello' };

      const result = PromptBuilder.build(request);

      expect(result).toBe('Hello');
    });

    it('should combine system and user prompts', () => {
      const request = {
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'What is 2+2?',
      };

      const result = PromptBuilder.build(request);

      expect(result).toBe('You are a helpful assistant.\n\nWhat is 2+2?');
    });
  });

  describe('convertHistory', () => {
    it('should return empty array for undefined history', () => {
      const result = PromptBuilder.convertHistory(undefined);

      expect(result).toEqual([]);
    });

    it('should return empty array for empty history', () => {
      const result = PromptBuilder.convertHistory([]);

      expect(result).toEqual([]);
    });

    it('should convert assistant role to model', () => {
      const history = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const result = PromptBuilder.convertHistory(history);

      expect(result).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'model', content: 'Hi there!' },
      ]);
    });

    it('should keep user role unchanged', () => {
      const history = [{ role: 'user', content: 'Test' }];

      const result = PromptBuilder.convertHistory(history);

      expect(result[0].role).toBe('user');
    });
  });

  describe('hasHistory', () => {
    it('should return false for undefined history', () => {
      const result = PromptBuilder.hasHistory({ userPrompt: 'test' });

      expect(result).toBe(false);
    });

    it('should return false for empty history', () => {
      const result = PromptBuilder.hasHistory({ userPrompt: 'test', history: [] });

      expect(result).toBe(false);
    });

    it('should return true for non-empty history', () => {
      const result = PromptBuilder.hasHistory({
        userPrompt: 'test',
        history: [{ role: 'user', content: 'previous' }],
      });

      expect(result).toBe(true);
    });
  });

  describe('createCacheKey', () => {
    it('should create cache key from built prompt', () => {
      const request = {
        systemPrompt: 'System',
        userPrompt: 'User',
      };

      const result = PromptBuilder.createCacheKey(request);

      expect(result).toBe('System\n\nUser');
    });
  });
});
