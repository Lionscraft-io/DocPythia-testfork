/**
 * LLM Service Dependency Injection Tests
 * Tests for LLMService with injectable dependencies

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { LLMService, SilentLogger } from '../server/stream/llm/llm-service.js';
import {
  ILLMProvider,
  GenerationResult,
  GenerationOptions,
  ConversationMessage,
} from '../server/stream/llm/llm-provider.js';
import { ILLMCache, CachePurpose, CachedLLMRequest } from '../server/llm/llm-cache.js';
import { LLMModel } from '../server/stream/types.js';

// Mock provider for testing
class MockProvider implements ILLMProvider {
  public generateFn: (prompt: string, options: GenerationOptions) => Promise<GenerationResult>;
  public generateWithHistoryFn: (
    prompt: string,
    history: ConversationMessage[],
    options: GenerationOptions
  ) => Promise<GenerationResult>;

  constructor() {
    this.generateFn = vi.fn().mockResolvedValue({
      text: '{"result": "success"}',
      tokensUsed: 100,
      finishReason: 'STOP',
    });
    this.generateWithHistoryFn = vi.fn().mockResolvedValue({
      text: '{"result": "success"}',
      tokensUsed: 150,
      finishReason: 'STOP',
    });
  }

  async generate(prompt: string, options: GenerationOptions): Promise<GenerationResult> {
    return this.generateFn(prompt, options);
  }

  async generateWithHistory(
    prompt: string,
    history: ConversationMessage[],
    options: GenerationOptions
  ): Promise<GenerationResult> {
    return this.generateWithHistoryFn(prompt, history, options);
  }
}

// Mock cache for testing
class MockCache implements ILLMCache {
  private store: Map<string, CachedLLMRequest> = new Map();
  public getFn = vi.fn();
  public setFn = vi.fn();

  has(prompt: string, purpose: CachePurpose): boolean {
    return this.store.has(`${purpose}:${prompt}`);
  }

  get(prompt: string, purpose: CachePurpose): CachedLLMRequest | null {
    this.getFn(prompt, purpose);
    return this.store.get(`${purpose}:${prompt}`) || null;
  }

  set(prompt: string, response: string, purpose: CachePurpose, metadata?: any): void {
    this.setFn(prompt, response, purpose, metadata);
    this.store.set(`${purpose}:${prompt}`, {
      hash: 'test-hash',
      purpose,
      prompt,
      response,
      timestamp: new Date().toISOString(),
      ...metadata,
    });
  }

  // Test helper
  addCacheEntry(prompt: string, purpose: CachePurpose, response: string, metadata?: any): void {
    this.store.set(`${purpose}:${prompt}`, {
      hash: 'cached-hash',
      purpose,
      prompt,
      response,
      timestamp: new Date().toISOString(),
      ...metadata,
    });
  }
}

describe('LLMService with Dependency Injection', () => {
  let mockProvider: MockProvider;
  let mockCache: MockCache;
  let service: LLMService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider = new MockProvider();
    mockCache = new MockCache();
    service = new LLMService({
      provider: mockProvider,
      cache: mockCache,
      logger: new SilentLogger(),
      delayFn: () => Promise.resolve(), // Instant delay for tests
    });
  });

  describe('Constructor', () => {
    it('should accept config object with provider', () => {
      expect(service).toBeDefined();
    });

    it('should throw error when no API key and no provider', () => {
      const originalKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      expect(() => new LLMService({})).toThrow('GEMINI_API_KEY environment variable is required');

      process.env.GEMINI_API_KEY = originalKey;
    });
  });

  describe('request method', () => {
    it('should call provider.generate with correct parameters', async () => {
      await service.request({
        model: LLMModel.FLASH,
        userPrompt: 'Test prompt',
      });

      expect(mockProvider.generateFn).toHaveBeenCalledWith(
        'Test prompt',
        expect.objectContaining({
          model: LLMModel.FLASH,
        })
      );
    });

    it('should combine system and user prompts', async () => {
      await service.request({
        model: LLMModel.PRO,
        systemPrompt: 'Be helpful.',
        userPrompt: 'Test prompt',
      });

      expect(mockProvider.generateFn).toHaveBeenCalledWith(
        'Be helpful.\n\nTest prompt',
        expect.any(Object)
      );
    });

    it('should return LLMResponse with correct structure', async () => {
      const result = await service.request({
        model: LLMModel.FLASH,
        userPrompt: 'Test',
      });

      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('modelUsed');
      expect(result).toHaveProperty('tokensUsed');
      expect(result).toHaveProperty('finishReason');
    });

    it('should throw transient error for empty response', async () => {
      mockProvider.generateFn = vi.fn().mockResolvedValue({
        text: '',
        tokensUsed: 0,
        finishReason: 'STOP',
      });

      await expect(
        service.request({
          model: LLMModel.FLASH,
          userPrompt: 'Test',
        })
      ).rejects.toThrow('Empty response from LLM');
    });

    it('should retry on transient error and succeed', async () => {
      let attempts = 0;
      mockProvider.generateFn = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          const err = new Error('Temporary failure');
          (err as any).transient = true;
          throw err;
        }
        return { text: '{"ok": true}', tokensUsed: 50, finishReason: 'STOP' };
      });

      const result = await service.request({
        model: LLMModel.FLASH,
        userPrompt: 'Test',
      });

      expect(result.content).toBe('{"ok": true}');
      expect(mockProvider.generateFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('requestJSON method', () => {
    const schema = z.object({
      result: z.string(),
    });

    it('should parse JSON response', async () => {
      const { data, response } = await service.requestJSON(
        {
          model: LLMModel.FLASH,
          userPrompt: 'Return JSON',
        },
        schema
      );

      expect(data).toEqual({ result: 'success' });
      expect(response.content).toBe('{"result": "success"}');
    });

    it('should use cache when available', async () => {
      mockCache.addCacheEntry('Cached prompt', 'analysis', '{"result": "cached"}', {
        model: 'cached-model',
        tokensUsed: 25,
      });

      const { data, response } = await service.requestJSON(
        {
          model: LLMModel.FLASH,
          userPrompt: 'Cached prompt',
        },
        schema,
        'analysis' as CachePurpose
      );

      expect(data).toEqual({ result: 'cached' });
      expect(response.finishReason).toBe('CACHED');
      expect(response.modelUsed).toBe('cached-model');
      expect(mockProvider.generateFn).not.toHaveBeenCalled();
    });

    it('should save to cache when purpose provided', async () => {
      await service.requestJSON(
        {
          model: LLMModel.FLASH,
          userPrompt: 'New request',
        },
        schema,
        'analysis' as CachePurpose
      );

      expect(mockCache.setFn).toHaveBeenCalledWith(
        'New request',
        '{"result": "success"}',
        'analysis',
        expect.objectContaining({
          tokensUsed: 100,
        })
      );
    });

    it('should not save to cache when no purpose provided', async () => {
      await service.requestJSON(
        {
          model: LLMModel.FLASH,
          userPrompt: 'No cache request',
        },
        schema
      );

      expect(mockCache.setFn).not.toHaveBeenCalled();
    });

    it('should use generateWithHistory for requests with history', async () => {
      await service.requestJSON(
        {
          model: LLMModel.FLASH,
          userPrompt: 'Follow up',
          history: [
            { role: 'user', content: 'First message' },
            { role: 'assistant', content: 'First response' },
          ],
        },
        schema
      );

      expect(mockProvider.generateWithHistoryFn).toHaveBeenCalled();
      expect(mockProvider.generateFn).not.toHaveBeenCalled();
    });

    it('should throw on JSON parse error with transient flag', async () => {
      mockProvider.generateFn = vi.fn().mockResolvedValue({
        text: 'invalid json {{{',
        tokensUsed: 50,
        finishReason: 'STOP',
      });

      await expect(
        service.requestJSON(
          {
            model: LLMModel.FLASH,
            userPrompt: 'Test',
          },
          schema
        )
      ).rejects.toThrow('Malformed JSON');
    });

    it('should throw on empty response with transient flag', async () => {
      mockProvider.generateFn = vi.fn().mockResolvedValue({
        text: '',
        tokensUsed: 0,
        finishReason: 'STOP',
      });

      await expect(
        service.requestJSON(
          {
            model: LLMModel.FLASH,
            userPrompt: 'Test',
          },
          schema
        )
      ).rejects.toThrow('Empty response');
    });

    it('should throw transient error on API failure', async () => {
      mockProvider.generateFn = vi.fn().mockRejectedValue(new Error('API rate limit'));

      await expect(
        service.requestJSON(
          {
            model: LLMModel.FLASH,
            userPrompt: 'Test',
          },
          schema
        )
      ).rejects.toThrow('Gemini API error');
    });

    it('should retry on transient JSON errors', async () => {
      let attempts = 0;
      mockProvider.generateFn = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          return { text: '', tokensUsed: 0, finishReason: 'STOP' };
        }
        return { text: '{"result": "ok"}', tokensUsed: 50, finishReason: 'STOP' };
      });

      const { data } = await service.requestJSON(
        {
          model: LLMModel.FLASH,
          userPrompt: 'Test',
        },
        z.object({ result: z.string() })
      );

      expect(data.result).toBe('ok');
      expect(mockProvider.generateFn).toHaveBeenCalledTimes(2);
    });

    it('should regenerate when cached response is invalid JSON', async () => {
      mockCache.addCacheEntry('Bad cache', 'analysis', 'not valid json');

      const { data } = await service.requestJSON(
        {
          model: LLMModel.FLASH,
          userPrompt: 'Bad cache',
        },
        schema,
        'analysis' as CachePurpose
      );

      expect(data).toEqual({ result: 'success' });
      expect(mockProvider.generateFn).toHaveBeenCalled();
    });

    it('should include messageId in cache metadata', async () => {
      await service.requestJSON(
        {
          model: LLMModel.FLASH,
          userPrompt: 'With message ID',
        },
        schema,
        'analysis' as CachePurpose,
        12345
      );

      expect(mockCache.setFn).toHaveBeenCalledWith(
        'With message ID',
        expect.any(String),
        'analysis',
        expect.objectContaining({
          messageId: 12345,
        })
      );
    });
  });

  describe('Static Methods', () => {
    it('getRecommendedModel should return appropriate models', () => {
      expect(LLMService.getRecommendedModel('classification')).toBe(LLMModel.FLASH);
      expect(LLMService.getRecommendedModel('proposal')).toBe(LLMModel.PRO);
      expect(LLMService.getRecommendedModel('review')).toBe(LLMModel.PRO);
    });

    it('estimateTokenCount should calculate tokens', () => {
      expect(LLMService.estimateTokenCount('')).toBe(0);
      expect(LLMService.estimateTokenCount('test')).toBe(1);
      expect(LLMService.estimateTokenCount('hello world test')).toBe(4);
    });

    it('estimateCost should calculate costs correctly', () => {
      const flashCost = LLMService.estimateCost(LLMModel.FLASH, 1000, 500);
      const proCost = LLMService.estimateCost(LLMModel.PRO, 1000, 500);

      expect(flashCost).toBeLessThan(proCost);
    });
  });

  describe('Retry Logic', () => {
    it('should exhaust retries for persistent transient errors', async () => {
      const error = new Error('Always fails');
      (error as any).transient = true;
      mockProvider.generateFn = vi.fn().mockRejectedValue(error);

      await expect(
        service.request({
          model: LLMModel.FLASH,
          userPrompt: 'Test',
        })
      ).rejects.toThrow('Always fails');

      expect(mockProvider.generateFn).toHaveBeenCalledTimes(3); // Default max retries
    });

    it('should not retry non-transient errors', async () => {
      const error = new Error('Permanent failure');
      (error as any).transient = false;
      mockProvider.generateFn = vi.fn().mockRejectedValue(error);

      await expect(
        service.request({
          model: LLMModel.FLASH,
          userPrompt: 'Test',
        })
      ).rejects.toThrow('Permanent failure');

      expect(mockProvider.generateFn).toHaveBeenCalledTimes(1);
    });
  });
});

describe('LLMService Custom Retry Config', () => {
  it('should respect custom max retries', async () => {
    const mockProvider = new MockProvider();
    const error = new Error('Always fails');
    (error as any).transient = true;
    mockProvider.generateFn = vi.fn().mockRejectedValue(error);

    const service = new LLMService({
      provider: mockProvider,
      logger: new SilentLogger(),
      delayFn: () => Promise.resolve(),
      retryConfig: { maxRetries: 5 },
    });

    await expect(
      service.request({
        model: LLMModel.FLASH,
        userPrompt: 'Test',
      })
    ).rejects.toThrow();

    expect(mockProvider.generateFn).toHaveBeenCalledTimes(5);
  });
});
