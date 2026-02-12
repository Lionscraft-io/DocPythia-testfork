/**
 * LLM Provider Types
 *
 * Unified type definitions for LLM provider abstraction.
 * These types enable switching between different LLM providers.
 */

import type { z } from 'zod';

/**
 * Supported LLM providers
 */
export type LLMProviderType = 'gemini' | 'openai' | 'anthropic' | 'ollama';

/**
 * Result from text generation
 */
export interface GenerationResult {
  text: string;
  tokensUsed?: number;
  finishReason?: string;
  model?: string;
}

/**
 * Options for text generation
 */
export interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

/**
 * Options for structured generation with schema validation
 */
export interface StructuredGenerateOptions<T> extends GenerateOptions {
  schema: z.ZodSchema<T>;
}

/**
 * Conversation message for multi-turn requests
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Unified LLM Provider Interface
 *
 * All LLM providers must implement this interface to be interchangeable.
 */
export interface ILLMProvider {
  /**
   * Provider identifier
   */
  readonly name: LLMProviderType;

  /**
   * Generate text from a prompt
   */
  generateText(prompt: string, options?: GenerateOptions): Promise<GenerationResult>;

  /**
   * Generate text with conversation history
   */
  generateWithHistory(
    prompt: string,
    history: ConversationMessage[],
    options?: GenerateOptions
  ): Promise<GenerationResult>;

  /**
   * Generate structured output with schema validation
   * Falls back to generateText + JSON parsing if not natively supported
   */
  generateStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: GenerateOptions
  ): Promise<T>;
}

/**
 * Embedding Service Interface
 */
export interface IEmbeddingProvider {
  /**
   * Provider identifier
   */
  readonly name: LLMProviderType;

  /**
   * Embedding model dimensions
   */
  readonly dimensions: number;

  /**
   * Generate embedding for a single text
   */
  embedText(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * Configuration for LLM providers
 */
export interface LLMProviderConfig {
  provider: LLMProviderType;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  embeddingModel?: string;
}

/**
 * Get provider configuration from environment variables
 */
export function getProviderConfigFromEnv(): LLMProviderConfig {
  const provider = (process.env.LLM_PROVIDER || 'gemini') as LLMProviderType;

  switch (provider) {
    case 'gemini':
      return {
        provider: 'gemini',
        apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY,
        defaultModel: process.env.LLM_MODEL || 'gemini-2.5-flash',
        embeddingModel: process.env.GEMINI_EMBED_MODEL || 'text-embedding-004',
      };

    case 'openai':
      return {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: process.env.OPENAI_API_BASE,
        defaultModel: process.env.LLM_MODEL || 'gpt-4-turbo-preview',
        embeddingModel: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
      };

    case 'anthropic':
      return {
        provider: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
        defaultModel: process.env.LLM_MODEL || 'claude-3-sonnet-20240229',
      };

    case 'ollama':
      return {
        provider: 'ollama',
        baseUrl: process.env.OLLAMA_API_BASE || 'http://localhost:11434',
        defaultModel: process.env.LLM_MODEL || 'llama3',
        embeddingModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
      };

    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
