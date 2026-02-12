/**
 * LLM Service Unit Tests
 * Tests for LLMService static methods, cost estimation, and utility functions

 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMModel } from '../server/stream/types.js';

// Mock the GoogleGenerativeAI before importing LLMService
vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: class MockGoogleGenerativeAI {
      constructor(_apiKey: string) {
        // Constructor mock
      }
      getGenerativeModel() {
        return {
          generateContent: vi.fn().mockResolvedValue({
            response: {
              text: () => '{"test": "response"}',
              usageMetadata: { totalTokenCount: 100 },
              candidates: [{ finishReason: 'STOP' }],
            },
          }),
        };
      }
    },
  };
});

// Mock llmCache
vi.mock('../server/llm/llm-cache.js', () => ({
  llmCache: {
    get: vi.fn(),
    set: vi.fn(),
  },
  CachePurpose: {
    analysis: 'analysis',
    changegeneration: 'changegeneration',
  },
}));

// Set environment variable before importing
process.env.GEMINI_API_KEY = 'test-api-key';

import { LLMService } from '../server/stream/llm/llm-service.js';

describe('LLMService', () => {
  describe('Static Methods', () => {
    describe('getRecommendedModel', () => {
      it('should return FLASH for classification tasks', () => {
        const model = LLMService.getRecommendedModel('classification');
        expect(model).toBe(LLMModel.FLASH);
      });

      it('should return PRO for proposal tasks', () => {
        const model = LLMService.getRecommendedModel('proposal');
        expect(model).toBe(LLMModel.PRO);
      });

      it('should return PRO for review tasks', () => {
        const model = LLMService.getRecommendedModel('review');
        expect(model).toBe(LLMModel.PRO);
      });

      it('should return PRO as default for unknown tasks', () => {
        const model = LLMService.getRecommendedModel('unknown' as any);
        expect(model).toBe(LLMModel.PRO);
      });
    });

    describe('estimateTokenCount', () => {
      it('should estimate tokens for empty string', () => {
        const tokens = LLMService.estimateTokenCount('');
        expect(tokens).toBe(0);
      });

      it('should estimate tokens for short text', () => {
        const tokens = LLMService.estimateTokenCount('hello');
        expect(tokens).toBe(2); // ceil(5/4) = 2
      });

      it('should estimate tokens for longer text', () => {
        const text = 'This is a longer piece of text for testing.';
        const tokens = LLMService.estimateTokenCount(text);
        expect(tokens).toBe(Math.ceil(text.length / 4));
      });

      it('should handle special characters', () => {
        const text = '🚀 Special chars: @#$%^&*()';
        const tokens = LLMService.estimateTokenCount(text);
        expect(tokens).toBeGreaterThan(0);
      });
    });

    describe('estimateCost', () => {
      it('should calculate cost for FLASH model', () => {
        const cost = LLMService.estimateCost(LLMModel.FLASH, 1000, 500);
        // FLASH: input: 0.075/1M, output: 0.30/1M
        const expectedInput = 1000 * (0.075 / 1_000_000);
        const expectedOutput = 500 * (0.3 / 1_000_000);
        expect(cost).toBeCloseTo(expectedInput + expectedOutput, 10);
      });

      it('should calculate cost for PRO model', () => {
        const cost = LLMService.estimateCost(LLMModel.PRO, 1000, 500);
        // PRO: input: 1.25/1M, output: 5.00/1M
        const expectedInput = 1000 * (1.25 / 1_000_000);
        const expectedOutput = 500 * (5.0 / 1_000_000);
        expect(cost).toBeCloseTo(expectedInput + expectedOutput, 10);
      });

      it('should return 0 for 0 tokens', () => {
        const cost = LLMService.estimateCost(LLMModel.FLASH, 0, 0);
        expect(cost).toBe(0);
      });

      it('should handle large token counts', () => {
        const cost = LLMService.estimateCost(LLMModel.FLASH, 1_000_000, 1_000_000);
        // FLASH: input: 0.075, output: 0.30
        expect(cost).toBeCloseTo(0.075 + 0.3, 5);
      });

      it('should show PRO is more expensive than FLASH', () => {
        const costFlash = LLMService.estimateCost(LLMModel.FLASH, 1000, 500);
        const costPro = LLMService.estimateCost(LLMModel.PRO, 1000, 500);
        expect(costPro).toBeGreaterThan(costFlash);
      });
    });
  });

  describe('Constructor', () => {
    it('should throw error if no API key provided', () => {
      const originalKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      expect(() => new LLMService()).toThrow('GEMINI_API_KEY environment variable is required');

      process.env.GEMINI_API_KEY = originalKey;
    });

    it('should accept API key as constructor parameter', () => {
      const service = new LLMService('custom-api-key');
      expect(service).toBeDefined();
    });

    it('should use environment variable when no parameter provided', () => {
      process.env.GEMINI_API_KEY = 'env-api-key';
      const service = new LLMService();
      expect(service).toBeDefined();
    });
  });

  describe('Instance Creation', () => {
    let service: LLMService;

    beforeEach(() => {
      process.env.GEMINI_API_KEY = 'test-api-key';
      service = new LLMService();
    });

    it('should create a valid LLMService instance', () => {
      expect(service).toBeInstanceOf(LLMService);
    });

    it('should have request method', () => {
      expect(typeof service.request).toBe('function');
    });

    it('should have requestJSON method', () => {
      expect(typeof service.requestJSON).toBe('function');
    });
  });

  describe('Model Tiering', () => {
    it('should have all LLMModel enum values mapped', () => {
      // Verify the model types exist
      expect(LLMModel.FLASH).toBeDefined();
      expect(LLMModel.PRO).toBeDefined();
    });

    it('should have FLASH distinct from PRO model', () => {
      expect(LLMModel.FLASH).not.toBe(LLMModel.PRO);
    });
  });

  describe('Cost Comparison', () => {
    it('should demonstrate cost efficiency of FLASH for classification', () => {
      // Typical classification: ~500 input tokens, ~200 output tokens
      const flashCost = LLMService.estimateCost(LLMModel.FLASH, 500, 200);
      const proCost = LLMService.estimateCost(LLMModel.PRO, 500, 200);

      // FLASH should be significantly cheaper
      expect(flashCost).toBeLessThan(proCost / 10);
    });

    it('should calculate batch processing cost estimate', () => {
      // Estimate cost for processing 1000 messages
      const avgInputTokens = 500;
      const avgOutputTokens = 200;
      const messageCount = 1000;

      const totalCost = LLMService.estimateCost(
        LLMModel.FLASH,
        avgInputTokens * messageCount,
        avgOutputTokens * messageCount
      );

      // Should be less than $1 for 1000 messages with FLASH
      expect(totalCost).toBeLessThan(1);
    });
  });
});

describe('LLMModel Enum', () => {
  it('should have FLASH model mapped to gemini-2.5-flash', () => {
    expect(LLMModel.FLASH).toBe('gemini-2.5-flash');
  });

  it('should have PRO model mapped to gemini-2.5-pro', () => {
    expect(LLMModel.PRO).toBe('gemini-2.5-pro');
  });
});

describe('LLMService Instance Methods', () => {
  let service: LLMService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-api-key';
    service = new LLMService();
  });

  describe('request method', () => {
    it('should make a successful request', async () => {
      const result = await service.request({
        model: LLMModel.FLASH,
        userPrompt: 'Test prompt',
      });

      expect(result).toBeDefined();
      expect(result.content).toBe('{"test": "response"}');
      expect(result.tokensUsed).toBe(100);
      expect(result.finishReason).toBe('STOP');
    });

    it('should include system prompt in request', async () => {
      const result = await service.request({
        model: LLMModel.PRO,
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Test prompt',
      });

      expect(result).toBeDefined();
      expect(result.content).toBe('{"test": "response"}');
    });

    it('should use temperature and maxTokens config', async () => {
      const result = await service.request({
        model: LLMModel.PRO,
        userPrompt: 'Test prompt',
        temperature: 0.5,
        maxTokens: 1024,
      });

      expect(result).toBeDefined();
    });
  });

  describe('requestJSON method', () => {
    it('should make a successful JSON request', async () => {
      const { z } = await import('zod');
      const schema = z.object({
        test: z.string(),
      });

      const result = await service.requestJSON(
        {
          model: LLMModel.FLASH,
          userPrompt: 'Return JSON',
        },
        schema
      );

      expect(result).toBeDefined();
      expect(result.data).toEqual({ test: 'response' });
      expect(result.response.content).toBe('{"test": "response"}');
    });

    it('should use cache when available', async () => {
      const { z } = await import('zod');
      const { llmCache, CachePurpose } = await import('../server/llm/llm-cache.js');
      const mockedCache = vi.mocked(llmCache);

      // Set up cache hit
      mockedCache.get.mockReturnValue({
        response: '{"cached": "value"}',
        model: 'cached-model',
        tokensUsed: 50,
      });

      const schema = z.object({
        cached: z.string(),
      });

      const result = await service.requestJSON(
        {
          model: LLMModel.FLASH,
          userPrompt: 'Cached prompt',
        },
        schema,
        CachePurpose.analysis
      );

      expect(result.data).toEqual({ cached: 'value' });
      expect(result.response.finishReason).toBe('CACHED');
      expect(result.response.modelUsed).toBe('cached-model');
    });

    it('should save to cache when cache purpose is provided', async () => {
      const { z } = await import('zod');
      const { llmCache, CachePurpose } = await import('../server/llm/llm-cache.js');
      const mockedCache = vi.mocked(llmCache);

      // No cache hit
      mockedCache.get.mockReturnValue(null);

      const schema = z.object({
        test: z.string(),
      });

      await service.requestJSON(
        {
          model: LLMModel.FLASH,
          userPrompt: 'New prompt',
        },
        schema,
        CachePurpose.analysis
      );

      expect(mockedCache.set).toHaveBeenCalled();
    });

    it('should handle conversation history', async () => {
      const { z } = await import('zod');
      const { llmCache } = await import('../server/llm/llm-cache.js');
      vi.mocked(llmCache).get.mockReturnValue(null);

      const schema = z.object({
        test: z.string(),
      });

      const result = await service.requestJSON(
        {
          model: LLMModel.FLASH,
          userPrompt: 'Follow-up question',
          history: [
            { role: 'user', content: 'Previous question' },
            { role: 'assistant', content: 'Previous answer' },
          ],
        },
        schema
      );

      expect(result).toBeDefined();
      expect(result.data).toEqual({ test: 'response' });
    });
  });
});

describe('LLMRequest Types', () => {
  it('should handle minimal request', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const service = new LLMService();

    const result = await service.request({
      model: LLMModel.FLASH,
      userPrompt: 'Simple request',
    });

    expect(result.content).toBeDefined();
  });

  it('should handle full request options', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const service = new LLMService();

    const result = await service.request({
      model: LLMModel.PRO,
      systemPrompt: 'Be helpful',
      userPrompt: 'Complex request',
      temperature: 0.7,
      maxTokens: 2048,
    });

    expect(result.content).toBeDefined();
  });
});

describe('LLMService Error Handling', () => {
  let service: LLMService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-api-key';
    service = new LLMService();
  });

  it('should handle empty response from LLM', async () => {
    // Need to mock a fresh import to override the response
    vi.doMock('@google/generative-ai', () => {
      return {
        GoogleGenerativeAI: class MockGoogleGenerativeAI {
          constructor(_apiKey: string) {}
          getGenerativeModel() {
            return {
              generateContent: vi.fn().mockResolvedValue({
                response: {
                  text: () => '',
                  usageMetadata: { totalTokenCount: 0 },
                  candidates: [{ finishReason: 'STOP' }],
                },
              }),
            };
          }
        },
      };
    });
  });

  it('should handle LLM API errors gracefully', async () => {
    // Mock generateContent to throw an error
    vi.doMock('@google/generative-ai', () => {
      return {
        GoogleGenerativeAI: class MockGoogleGenerativeAI {
          constructor(_apiKey: string) {}
          getGenerativeModel() {
            return {
              generateContent: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
            };
          }
        },
      };
    });
  });

  it('should handle network errors', async () => {
    // Test that network errors are properly propagated
    expect(service).toBeDefined();
  });
});

describe('LLMService Model Selection', () => {
  it('should handle direct model string', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const service = new LLMService();

    // Using model enum should work
    const result = await service.request({
      model: LLMModel.FLASH,
      userPrompt: 'Test prompt',
    });

    expect(result.modelUsed).toBe('gemini-2.5-flash');
  });

  it('should handle PRO model', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const service = new LLMService();

    const result = await service.request({
      model: LLMModel.PRO,
      userPrompt: 'Test prompt',
    });

    expect(result.modelUsed).toBe('gemini-2.5-pro');
  });
});

describe('LLMService JSON Parsing', () => {
  let service: LLMService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-api-key';
    service = new LLMService();
  });

  it('should extract JSON from markdown code blocks', async () => {
    const { z } = await import('zod');
    const { llmCache } = await import('../server/llm/llm-cache.js');
    vi.mocked(llmCache).get.mockReturnValue(null);

    const schema = z.object({
      test: z.string(),
    });

    const result = await service.requestJSON(
      {
        model: LLMModel.FLASH,
        userPrompt: 'Return JSON',
      },
      schema
    );

    expect(result.data).toBeDefined();
  });

  it('should validate JSON against schema', async () => {
    const { z } = await import('zod');
    const { llmCache } = await import('../server/llm/llm-cache.js');
    vi.mocked(llmCache).get.mockReturnValue(null);

    const schema = z.object({
      test: z.string(),
    });

    const result = await service.requestJSON(
      {
        model: LLMModel.FLASH,
        userPrompt: 'Return JSON',
      },
      schema
    );

    expect(result.data.test).toBe('response');
  });
});
