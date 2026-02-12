/**
 * LLM Provider Unit Tests
 * Tests for LLM provider factory, types, and Gemini implementation

 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { z } from 'zod';

// Mock the logger
vi.mock('../server/utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  hasErrorMessage: (error: unknown, message: string) =>
    error instanceof Error && error.message === message,
}));

// Mock the llm-cache
vi.mock('../server/llm/llm-cache.js', () => ({
  llmCache: {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
  },
}));

// Mock Google Generative AI
const mockGenerateContent = vi.fn();
const mockEmbedContent = vi.fn();
const mockGetGenerativeModel = vi.fn();

class MockGoogleGenerativeAI {
  constructor(_apiKey: string) {}
  getGenerativeModel = mockGetGenerativeModel;
}

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: MockGoogleGenerativeAI,
}));

describe('LLM Provider Types', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getProviderConfigFromEnv', () => {
    it('should return gemini config by default', async () => {
      delete process.env.LLM_PROVIDER;
      process.env.GEMINI_API_KEY = 'test-gemini-key';

      const { getProviderConfigFromEnv } = await import('../server/llm/providers/types.js');
      const config = getProviderConfigFromEnv();

      expect(config.provider).toBe('gemini');
      expect(config.apiKey).toBe('test-gemini-key');
      expect(config.defaultModel).toBe('gemini-2.5-flash');
      expect(config.embeddingModel).toBe('text-embedding-004');
    });

    it('should use GOOGLE_AI_API_KEY as fallback for gemini', async () => {
      process.env.LLM_PROVIDER = 'gemini';
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_AI_API_KEY = 'google-ai-key';

      const { getProviderConfigFromEnv } = await import('../server/llm/providers/types.js');
      const config = getProviderConfigFromEnv();

      expect(config.apiKey).toBe('google-ai-key');
    });

    it('should return openai config when specified', async () => {
      process.env.LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'test-openai-key';
      process.env.OPENAI_API_BASE = 'https://api.example.com';

      const { getProviderConfigFromEnv } = await import('../server/llm/providers/types.js');
      const config = getProviderConfigFromEnv();

      expect(config.provider).toBe('openai');
      expect(config.apiKey).toBe('test-openai-key');
      expect(config.baseUrl).toBe('https://api.example.com');
      expect(config.defaultModel).toBe('gpt-4-turbo-preview');
    });

    it('should return anthropic config when specified', async () => {
      process.env.LLM_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

      const { getProviderConfigFromEnv } = await import('../server/llm/providers/types.js');
      const config = getProviderConfigFromEnv();

      expect(config.provider).toBe('anthropic');
      expect(config.apiKey).toBe('test-anthropic-key');
      expect(config.defaultModel).toBe('claude-3-sonnet-20240229');
    });

    it('should return ollama config when specified', async () => {
      process.env.LLM_PROVIDER = 'ollama';

      const { getProviderConfigFromEnv } = await import('../server/llm/providers/types.js');
      const config = getProviderConfigFromEnv();

      expect(config.provider).toBe('ollama');
      expect(config.baseUrl).toBe('http://localhost:11434');
      expect(config.defaultModel).toBe('llama3');
      expect(config.embeddingModel).toBe('nomic-embed-text');
    });

    it('should respect custom OLLAMA_API_BASE', async () => {
      process.env.LLM_PROVIDER = 'ollama';
      process.env.OLLAMA_API_BASE = 'http://custom:11434';

      const { getProviderConfigFromEnv } = await import('../server/llm/providers/types.js');
      const config = getProviderConfigFromEnv();

      expect(config.baseUrl).toBe('http://custom:11434');
    });

    it('should use custom LLM_MODEL when set', async () => {
      process.env.LLM_PROVIDER = 'gemini';
      process.env.LLM_MODEL = 'custom-model';

      const { getProviderConfigFromEnv } = await import('../server/llm/providers/types.js');
      const config = getProviderConfigFromEnv();

      expect(config.defaultModel).toBe('custom-model');
    });

    it('should throw for unknown provider', async () => {
      process.env.LLM_PROVIDER = 'unknown-provider';

      const { getProviderConfigFromEnv } = await import('../server/llm/providers/types.js');

      expect(() => getProviderConfigFromEnv()).toThrow('Unknown LLM provider: unknown-provider');
    });
  });
});

describe('LLM Provider Factory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createLLMProvider', () => {
    it('should create Gemini provider with API key', async () => {
      const { createLLMProvider, resetProviders } =
        await import('../server/llm/providers/index.js');
      resetProviders();

      const provider = createLLMProvider({ provider: 'gemini', apiKey: 'test-key' });

      expect(provider.name).toBe('gemini');
    });

    it('should throw when Gemini API key is missing', async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;

      const { createLLMProvider, resetProviders } =
        await import('../server/llm/providers/index.js');
      resetProviders();

      expect(() => createLLMProvider({ provider: 'gemini' })).toThrow('Gemini API key is required');
    });

    it('should throw for OpenAI (not implemented)', async () => {
      const { createLLMProvider } = await import('../server/llm/providers/index.js');

      expect(() => createLLMProvider({ provider: 'openai', apiKey: 'key' })).toThrow(
        'OpenAI provider not yet implemented'
      );
    });

    it('should throw for Anthropic (not implemented)', async () => {
      const { createLLMProvider } = await import('../server/llm/providers/index.js');

      expect(() => createLLMProvider({ provider: 'anthropic', apiKey: 'key' })).toThrow(
        'Anthropic provider not yet implemented'
      );
    });

    it('should throw for Ollama (not implemented)', async () => {
      const { createLLMProvider } = await import('../server/llm/providers/index.js');

      expect(() => createLLMProvider({ provider: 'ollama' })).toThrow(
        'Ollama provider not yet implemented'
      );
    });

    it('should throw for unknown provider', async () => {
      const { createLLMProvider } = await import('../server/llm/providers/index.js');

      expect(() => createLLMProvider({ provider: 'fake' as any })).toThrow(
        'Unknown LLM provider: fake'
      );
    });
  });

  describe('createEmbeddingProvider', () => {
    it('should create Gemini embedding provider with API key', async () => {
      const { createEmbeddingProvider, resetProviders } =
        await import('../server/llm/providers/index.js');
      resetProviders();

      const provider = createEmbeddingProvider({ provider: 'gemini', apiKey: 'test-key' });

      expect(provider.name).toBe('gemini');
      expect(provider.dimensions).toBe(768);
    });

    it('should throw when Gemini API key is missing', async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_AI_API_KEY;

      const { createEmbeddingProvider, resetProviders } =
        await import('../server/llm/providers/index.js');
      resetProviders();

      expect(() => createEmbeddingProvider({ provider: 'gemini' })).toThrow(
        'Gemini API key is required'
      );
    });

    it('should throw for OpenAI embedding (not implemented)', async () => {
      const { createEmbeddingProvider } = await import('../server/llm/providers/index.js');

      expect(() => createEmbeddingProvider({ provider: 'openai', apiKey: 'key' })).toThrow(
        'OpenAI embedding provider not yet implemented'
      );
    });

    it('should throw for Anthropic embedding (no API)', async () => {
      const { createEmbeddingProvider } = await import('../server/llm/providers/index.js');

      expect(() => createEmbeddingProvider({ provider: 'anthropic', apiKey: 'key' })).toThrow(
        'Anthropic does not provide an embedding API'
      );
    });

    it('should throw for Ollama embedding (not implemented)', async () => {
      const { createEmbeddingProvider } = await import('../server/llm/providers/index.js');

      expect(() => createEmbeddingProvider({ provider: 'ollama' })).toThrow(
        'Ollama embedding provider not yet implemented'
      );
    });

    it('should throw for unknown provider', async () => {
      const { createEmbeddingProvider } = await import('../server/llm/providers/index.js');

      expect(() => createEmbeddingProvider({ provider: 'fake' as any })).toThrow(
        'Unknown embedding provider: fake'
      );
    });
  });

  describe('getAvailableProviders', () => {
    it('should return list of available providers', async () => {
      const { getAvailableProviders } = await import('../server/llm/providers/index.js');
      const providers = getAvailableProviders();

      expect(providers).toContain('gemini');
      expect(Array.isArray(providers)).toBe(true);
    });
  });

  describe('isProviderAvailable', () => {
    it('should return true for implemented providers', async () => {
      const { isProviderAvailable } = await import('../server/llm/providers/index.js');

      expect(isProviderAvailable('gemini')).toBe(true);
    });

    it('should return false for unimplemented providers', async () => {
      const { isProviderAvailable } = await import('../server/llm/providers/index.js');

      expect(isProviderAvailable('openai')).toBe(false);
      expect(isProviderAvailable('anthropic')).toBe(false);
      expect(isProviderAvailable('ollama')).toBe(false);
    });
  });

  describe('singleton providers', () => {
    it('should return same instance for getDefaultLLMProvider', async () => {
      const { getDefaultLLMProvider, resetProviders } =
        await import('../server/llm/providers/index.js');
      resetProviders();

      const provider1 = getDefaultLLMProvider();
      const provider2 = getDefaultLLMProvider();

      expect(provider1).toBe(provider2);
    });

    it('should return same instance for getDefaultEmbeddingProvider', async () => {
      const { getDefaultEmbeddingProvider, resetProviders } =
        await import('../server/llm/providers/index.js');
      resetProviders();

      const provider1 = getDefaultEmbeddingProvider();
      const provider2 = getDefaultEmbeddingProvider();

      expect(provider1).toBe(provider2);
    });

    it('should create new instances after resetProviders', async () => {
      const { getDefaultLLMProvider, resetProviders } =
        await import('../server/llm/providers/index.js');

      const provider1 = getDefaultLLMProvider();
      resetProviders();
      const provider2 = getDefaultLLMProvider();

      expect(provider1).not.toBe(provider2);
    });
  });
});

describe('GeminiLLMProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGenerativeModel.mockReturnValue({
      generateContent: mockGenerateContent,
    });
  });

  describe('constructor', () => {
    it('should throw when API key is missing', async () => {
      const { GeminiLLMProvider } = await import('../server/llm/providers/gemini-provider.js');

      expect(() => new GeminiLLMProvider('')).toThrow('Gemini API key is required');
    });

    it('should create provider with default model', async () => {
      const { GeminiLLMProvider } = await import('../server/llm/providers/gemini-provider.js');

      const provider = new GeminiLLMProvider('test-key');

      expect(provider.name).toBe('gemini');
    });

    it('should create provider with custom model', async () => {
      const { GeminiLLMProvider } = await import('../server/llm/providers/gemini-provider.js');

      const provider = new GeminiLLMProvider('test-key', 'custom-model');

      expect(provider.name).toBe('gemini');
    });
  });

  describe('generateText', () => {
    it('should generate text successfully', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Generated response',
          usageMetadata: { totalTokenCount: 100 },
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      const { GeminiLLMProvider } = await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiLLMProvider('test-key');

      const result = await provider.generateText('Test prompt');

      expect(result.text).toBe('Generated response');
      expect(result.tokensUsed).toBe(100);
      expect(result.finishReason).toBe('STOP');
    });

    it('should use system prompt when provided', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Response with system prompt',
          usageMetadata: { totalTokenCount: 50 },
        },
      });

      const { GeminiLLMProvider } = await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiLLMProvider('test-key');

      const result = await provider.generateText('Test prompt', {
        systemPrompt: 'You are helpful',
      });

      expect(result.text).toBe('Response with system prompt');
      expect(mockGenerateContent).toHaveBeenCalledWith({
        contents: expect.arrayContaining([
          expect.objectContaining({ role: 'user', parts: [{ text: 'You are helpful' }] }),
          expect.objectContaining({ role: 'model', parts: [{ text: 'Understood.' }] }),
          expect.objectContaining({ role: 'user', parts: [{ text: 'Test prompt' }] }),
        ]),
      });
    });

    it('should throw on generation error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API Error'));

      const { GeminiLLMProvider } = await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiLLMProvider('test-key');

      await expect(provider.generateText('Test prompt')).rejects.toThrow(
        'Gemini generation failed: API Error'
      );
    });

    it('should use cached response when available', async () => {
      const { llmCache } = await import('../server/llm/llm-cache.js');
      vi.mocked(llmCache.get).mockReturnValue({
        response: 'Cached response',
        timestamp: Date.now(),
        category: 'general',
      });

      const { GeminiLLMProvider } = await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiLLMProvider('test-key');

      const result = await provider.generateText('Test prompt');

      expect(result.text).toBe('Cached response');
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });
  });

  describe('generateWithHistory', () => {
    it('should generate with conversation history', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Response with history',
          usageMetadata: { totalTokenCount: 200 },
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      const { GeminiLLMProvider } = await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiLLMProvider('test-key');

      const history = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
      ];

      const result = await provider.generateWithHistory('Follow up', history);

      expect(result.text).toBe('Response with history');
      expect(mockGenerateContent).toHaveBeenCalledWith({
        contents: expect.arrayContaining([
          expect.objectContaining({ role: 'user', parts: [{ text: 'Hello' }] }),
          expect.objectContaining({ role: 'model', parts: [{ text: 'Hi there!' }] }),
          expect.objectContaining({ role: 'user', parts: [{ text: 'Follow up' }] }),
        ]),
      });
    });

    it('should include system prompt with history', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Response',
          usageMetadata: { totalTokenCount: 100 },
        },
      });

      const { GeminiLLMProvider } = await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiLLMProvider('test-key');

      await provider.generateWithHistory('Prompt', [], {
        systemPrompt: 'Be helpful',
      });

      expect(mockGenerateContent).toHaveBeenCalledWith({
        contents: expect.arrayContaining([
          expect.objectContaining({ role: 'user', parts: [{ text: 'Be helpful' }] }),
          expect.objectContaining({ role: 'model', parts: [{ text: 'Understood.' }] }),
        ]),
      });
    });

    it('should throw on history generation error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('History API Error'));

      const { GeminiLLMProvider } = await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiLLMProvider('test-key');

      await expect(provider.generateWithHistory('Prompt', [])).rejects.toThrow(
        'Gemini generation failed: History API Error'
      );
    });
  });

  describe('generateStructured', () => {
    it('should generate and validate structured output', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      mockGetGenerativeModel.mockReturnValue({
        generateContent: vi.fn().mockResolvedValue({
          response: {
            text: () => JSON.stringify({ name: 'John', age: 30 }),
          },
        }),
      });

      const { GeminiLLMProvider } = await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiLLMProvider('test-key');

      const result = await provider.generateStructured('Generate person', schema);

      expect(result).toEqual({ name: 'John', age: 30 });
    });

    it('should throw on schema validation failure', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      mockGetGenerativeModel.mockReturnValue({
        generateContent: vi.fn().mockResolvedValue({
          response: {
            text: () => JSON.stringify({ name: 'John', age: 'not a number' }),
          },
        }),
      });

      const { GeminiLLMProvider } = await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiLLMProvider('test-key');

      await expect(provider.generateStructured('Generate person', schema)).rejects.toThrow(
        'Response did not match expected schema'
      );
    });

    it('should throw on invalid JSON response', async () => {
      const schema = z.object({ name: z.string() });

      mockGetGenerativeModel.mockReturnValue({
        generateContent: vi.fn().mockResolvedValue({
          response: {
            text: () => 'not valid json',
          },
        }),
      });

      const { GeminiLLMProvider } = await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiLLMProvider('test-key');

      await expect(provider.generateStructured('Generate', schema)).rejects.toThrow(
        'Gemini structured generation failed'
      );
    });
  });
});

describe('GeminiEmbeddingProvider', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetGenerativeModel.mockReturnValue({
      embedContent: mockEmbedContent,
    });

    const { llmCache } = await import('../server/llm/llm-cache.js');
    vi.mocked(llmCache.get).mockReturnValue(null);
  });

  describe('constructor', () => {
    it('should throw when API key is missing', async () => {
      const { GeminiEmbeddingProvider } =
        await import('../server/llm/providers/gemini-provider.js');

      expect(() => new GeminiEmbeddingProvider('')).toThrow('Gemini API key is required');
    });

    it('should create provider with correct dimensions', async () => {
      const { GeminiEmbeddingProvider } =
        await import('../server/llm/providers/gemini-provider.js');

      const provider = new GeminiEmbeddingProvider('test-key');

      expect(provider.name).toBe('gemini');
      expect(provider.dimensions).toBe(768);
    });
  });

  describe('embedText', () => {
    it('should generate embedding successfully', async () => {
      const mockEmbedding = new Array(768).fill(0.1);
      mockEmbedContent.mockResolvedValue({
        embedding: { values: mockEmbedding },
      });

      const { GeminiEmbeddingProvider } =
        await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiEmbeddingProvider('test-key');

      const result = await provider.embedText('Test text');

      expect(result).toEqual(mockEmbedding);
      expect(result.length).toBe(768);
    });

    it('should throw on empty text', async () => {
      const { GeminiEmbeddingProvider } =
        await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiEmbeddingProvider('test-key');

      await expect(provider.embedText('')).rejects.toThrow('Cannot embed empty text');
    });

    it('should throw on whitespace-only text', async () => {
      const { GeminiEmbeddingProvider } =
        await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiEmbeddingProvider('test-key');

      await expect(provider.embedText('   ')).rejects.toThrow('Cannot embed empty text');
    });

    it('should use cached embedding when available', async () => {
      const mockEmbedding = new Array(768).fill(0.5);
      const { llmCache } = await import('../server/llm/llm-cache.js');
      vi.mocked(llmCache.get).mockReturnValue({
        response: JSON.stringify(mockEmbedding),
        timestamp: Date.now(),
        category: 'embeddings',
      });

      const { GeminiEmbeddingProvider } =
        await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiEmbeddingProvider('test-key');

      const result = await provider.embedText('Test text');

      expect(result).toEqual(mockEmbedding);
      expect(mockEmbedContent).not.toHaveBeenCalled();
    });

    it('should regenerate when cached embedding fails to parse', async () => {
      const { llmCache } = await import('../server/llm/llm-cache.js');
      vi.mocked(llmCache.get).mockReturnValue({
        response: 'invalid json',
        timestamp: Date.now(),
        category: 'embeddings',
      });

      const mockEmbedding = new Array(768).fill(0.2);
      mockEmbedContent.mockResolvedValue({
        embedding: { values: mockEmbedding },
      });

      const { GeminiEmbeddingProvider } =
        await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiEmbeddingProvider('test-key');

      const result = await provider.embedText('Test text');

      expect(result).toEqual(mockEmbedding);
      expect(mockEmbedContent).toHaveBeenCalled();
    });

    it('should retry on transient errors', async () => {
      const mockEmbedding = new Array(768).fill(0.3);
      mockEmbedContent
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValueOnce({ embedding: { values: mockEmbedding } });

      const { GeminiEmbeddingProvider } =
        await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiEmbeddingProvider('test-key');

      const result = await provider.embedText('Test text');

      expect(result).toEqual(mockEmbedding);
      expect(mockEmbedContent).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should throw after max retries', async () => {
      mockEmbedContent.mockRejectedValue(new Error('Persistent error'));

      const { GeminiEmbeddingProvider } =
        await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiEmbeddingProvider('test-key');

      await expect(provider.embedText('Test text')).rejects.toThrow(
        'Failed to generate embedding after 3 attempts'
      );
    }, 15000);

    it('should throw on invalid embedding response', async () => {
      mockEmbedContent.mockResolvedValue({
        embedding: { values: null },
      });

      const { GeminiEmbeddingProvider } =
        await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiEmbeddingProvider('test-key');

      await expect(provider.embedText('Test text')).rejects.toThrow(
        'Failed to generate embedding after 3 attempts'
      );
    }, 15000);
  });

  describe('embedBatch', () => {
    it('should embed multiple texts', async () => {
      const mockEmbedding = new Array(768).fill(0.4);
      mockEmbedContent.mockResolvedValue({
        embedding: { values: mockEmbedding },
      });

      const { GeminiEmbeddingProvider } =
        await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiEmbeddingProvider('test-key');

      const texts = ['Text 1', 'Text 2', 'Text 3'];
      const results = await provider.embedBatch(texts);

      expect(results.length).toBe(3);
      expect(results[0]).toEqual(mockEmbedding);
    }, 10000);

    it('should return empty array for empty input', async () => {
      const { GeminiEmbeddingProvider } =
        await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiEmbeddingProvider('test-key');

      const results = await provider.embedBatch([]);

      expect(results).toEqual([]);
    });

    it('should return zero vector for failed embeddings', async () => {
      mockEmbedContent
        .mockResolvedValueOnce({ embedding: { values: new Array(768).fill(0.1) } })
        .mockRejectedValueOnce(new Error('Failed'))
        .mockRejectedValueOnce(new Error('Failed'))
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({ embedding: { values: new Array(768).fill(0.2) } });

      const { GeminiEmbeddingProvider } =
        await import('../server/llm/providers/gemini-provider.js');
      const provider = new GeminiEmbeddingProvider('test-key');

      const texts = ['Success 1', 'Fail', 'Success 2'];
      const results = await provider.embedBatch(texts);

      expect(results.length).toBe(3);
      expect(results[0][0]).toBe(0.1);
      expect(results[1]).toEqual(new Array(768).fill(0)); // Zero vector for failed
      expect(results[2][0]).toBe(0.2);
    }, 30000);
  });
});
