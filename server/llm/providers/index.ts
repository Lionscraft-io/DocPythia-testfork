/**
 * LLM Provider Factory
 *
 * Creates LLM and embedding providers based on configuration.
 * Supports switching providers via environment variables.
 *
 * Usage:
 * ```typescript
 * // Use default provider from environment
 * const llm = createLLMProvider();
 * const embedder = createEmbeddingProvider();
 *
 * // Or specify a provider
 * const llm = createLLMProvider({ provider: 'gemini', apiKey: '...' });
 * ```
 */

import type {
  ILLMProvider,
  IEmbeddingProvider,
  LLMProviderConfig,
  LLMProviderType,
} from './types.js';
import { getProviderConfigFromEnv } from './types.js';
import { GeminiLLMProvider, GeminiEmbeddingProvider } from './gemini-provider.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('LLMProviderFactory');

// Re-export types
export * from './types.js';
export { GeminiLLMProvider, GeminiEmbeddingProvider } from './gemini-provider.js';

/**
 * Create an LLM provider based on configuration
 */
export function createLLMProvider(config?: Partial<LLMProviderConfig>): ILLMProvider {
  const finalConfig = {
    ...getProviderConfigFromEnv(),
    ...config,
  };

  logger.info(`Creating LLM provider: ${finalConfig.provider}`);

  switch (finalConfig.provider) {
    case 'gemini':
      if (!finalConfig.apiKey) {
        throw new Error('Gemini API key is required. Set GEMINI_API_KEY environment variable.');
      }
      return new GeminiLLMProvider(finalConfig.apiKey, finalConfig.defaultModel);

    case 'openai':
      // OpenAI provider can be implemented when needed
      throw new Error('OpenAI provider not yet implemented. Contributions welcome!');

    case 'anthropic':
      // Anthropic provider can be implemented when needed
      throw new Error('Anthropic provider not yet implemented. Contributions welcome!');

    case 'ollama':
      // Ollama provider can be implemented when needed
      throw new Error('Ollama provider not yet implemented. Contributions welcome!');

    default:
      throw new Error(`Unknown LLM provider: ${finalConfig.provider}`);
  }
}

/**
 * Create an embedding provider based on configuration
 */
export function createEmbeddingProvider(config?: Partial<LLMProviderConfig>): IEmbeddingProvider {
  const finalConfig = {
    ...getProviderConfigFromEnv(),
    ...config,
  };

  logger.info(`Creating embedding provider: ${finalConfig.provider}`);

  switch (finalConfig.provider) {
    case 'gemini':
      if (!finalConfig.apiKey) {
        throw new Error('Gemini API key is required. Set GEMINI_API_KEY environment variable.');
      }
      return new GeminiEmbeddingProvider(finalConfig.apiKey, finalConfig.embeddingModel);

    case 'openai':
      throw new Error('OpenAI embedding provider not yet implemented. Contributions welcome!');

    case 'anthropic':
      throw new Error(
        'Anthropic does not provide an embedding API. Use a different provider for embeddings.'
      );

    case 'ollama':
      throw new Error('Ollama embedding provider not yet implemented. Contributions welcome!');

    default:
      throw new Error(`Unknown embedding provider: ${finalConfig.provider}`);
  }
}

/**
 * Get a list of available providers
 */
export function getAvailableProviders(): LLMProviderType[] {
  return ['gemini']; // Only Gemini is currently implemented
}

/**
 * Check if a provider is available
 */
export function isProviderAvailable(provider: LLMProviderType): boolean {
  return getAvailableProviders().includes(provider);
}

// Singleton instances (lazy-loaded)
let defaultLLMProvider: ILLMProvider | null = null;
let defaultEmbeddingProvider: IEmbeddingProvider | null = null;

/**
 * Get the default LLM provider (singleton)
 */
export function getDefaultLLMProvider(): ILLMProvider {
  if (!defaultLLMProvider) {
    defaultLLMProvider = createLLMProvider();
  }
  return defaultLLMProvider;
}

/**
 * Get the default embedding provider (singleton)
 */
export function getDefaultEmbeddingProvider(): IEmbeddingProvider {
  if (!defaultEmbeddingProvider) {
    defaultEmbeddingProvider = createEmbeddingProvider();
  }
  return defaultEmbeddingProvider;
}

/**
 * Reset singleton instances (useful for testing)
 */
export function resetProviders(): void {
  defaultLLMProvider = null;
  defaultEmbeddingProvider = null;
}
