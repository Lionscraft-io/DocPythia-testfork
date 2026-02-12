/**
 * Gemini LLM Provider Implementation
 *
 * Implements the unified LLM provider interface for Google's Gemini API.
 */

import { GoogleGenerativeAI, GenerativeModel, GenerationConfig } from '@google/generative-ai';
import type { z } from 'zod';
import type {
  ILLMProvider,
  IEmbeddingProvider,
  GenerationResult,
  GenerateOptions,
  ConversationMessage,
  LLMProviderType,
} from './types.js';
import { createLogger, getErrorMessage } from '../../utils/logger.js';
import { llmCache } from '../llm-cache.js';

const logger = createLogger('GeminiProvider');

/**
 * Gemini LLM Provider
 */
export class GeminiLLMProvider implements ILLMProvider {
  readonly name: LLMProviderType = 'gemini';
  private genAI: GoogleGenerativeAI;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel: string = 'gemini-2.5-flash') {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.defaultModel = defaultModel;
  }

  async generateText(prompt: string, options?: GenerateOptions): Promise<GenerationResult> {
    const modelName = options?.model || this.defaultModel;
    const model = this.getModel(modelName, options);

    try {
      // Check cache first
      const cacheKey = `${modelName}:${prompt}`;
      const cached = llmCache.get(cacheKey, 'general');
      if (cached) {
        logger.debug('Using cached response');
        return {
          text: cached.response,
          model: modelName,
        };
      }

      const result = options?.systemPrompt
        ? await model.generateContent({
            contents: [
              { role: 'user', parts: [{ text: options.systemPrompt }] },
              { role: 'model', parts: [{ text: 'Understood.' }] },
              { role: 'user', parts: [{ text: prompt }] },
            ],
          })
        : await model.generateContent(prompt);
      const text = result.response.text();

      // Cache the response
      llmCache.set(cacheKey, text, 'general', { model: modelName });

      return {
        text,
        tokensUsed: result.response.usageMetadata?.totalTokenCount,
        finishReason: result.response.candidates?.[0]?.finishReason,
        model: modelName,
      };
    } catch (error) {
      logger.error('Generation failed:', getErrorMessage(error));
      throw new Error(`Gemini generation failed: ${getErrorMessage(error)}`);
    }
  }

  async generateWithHistory(
    prompt: string,
    history: ConversationMessage[],
    options?: GenerateOptions
  ): Promise<GenerationResult> {
    const modelName = options?.model || this.defaultModel;
    const model = this.getModel(modelName, options);

    try {
      const contents = [
        ...(options?.systemPrompt
          ? [
              { role: 'user' as const, parts: [{ text: options.systemPrompt }] },
              { role: 'model' as const, parts: [{ text: 'Understood.' }] },
            ]
          : []),
        ...history.map((msg) => ({
          role: msg.role === 'assistant' ? ('model' as const) : ('user' as const),
          parts: [{ text: msg.content }],
        })),
        { role: 'user' as const, parts: [{ text: prompt }] },
      ];

      const result = await model.generateContent({ contents });

      return {
        text: result.response.text(),
        tokensUsed: result.response.usageMetadata?.totalTokenCount,
        finishReason: result.response.candidates?.[0]?.finishReason,
        model: modelName,
      };
    } catch (error) {
      logger.error('Generation with history failed:', getErrorMessage(error));
      throw new Error(`Gemini generation failed: ${getErrorMessage(error)}`);
    }
  }

  async generateStructured<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    options?: GenerateOptions
  ): Promise<T> {
    const modelName = options?.model || this.defaultModel;

    // Build JSON schema from Zod schema description
    const structuredPrompt = `${prompt}

Respond with valid JSON only. No markdown code blocks, just the raw JSON object.`;

    const model = this.genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: options?.temperature ?? 0.1,
        maxOutputTokens: options?.maxTokens ?? 4096,
        responseMimeType: 'application/json',
      },
    });

    try {
      const result = options?.systemPrompt
        ? await model.generateContent({
            contents: [
              { role: 'user', parts: [{ text: options.systemPrompt }] },
              { role: 'model', parts: [{ text: 'Understood.' }] },
              { role: 'user', parts: [{ text: structuredPrompt }] },
            ],
          })
        : await model.generateContent(structuredPrompt);
      const text = result.response.text();

      // Parse and validate with Zod
      const parsed = JSON.parse(text);
      return schema.parse(parsed);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        logger.error('Schema validation failed:', (error as { errors?: unknown }).errors);
        throw new Error(`Response did not match expected schema: ${getErrorMessage(error)}`);
      }
      logger.error('Structured generation failed:', getErrorMessage(error));
      throw new Error(`Gemini structured generation failed: ${getErrorMessage(error)}`);
    }
  }

  private getModel(modelName: string, options?: GenerateOptions): GenerativeModel {
    const generationConfig: GenerationConfig = {
      temperature: options?.temperature ?? 0.2,
      maxOutputTokens: options?.maxTokens ?? 2048,
    };

    return this.genAI.getGenerativeModel({
      model: modelName,
      generationConfig,
    });
  }
}

/**
 * Gemini Embedding Provider
 */
export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  readonly name: LLMProviderType = 'gemini';
  readonly dimensions = 768;
  private genAI: GoogleGenerativeAI;
  private embedModel: string;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000;

  constructor(apiKey: string, embedModel: string = 'text-embedding-004') {
    if (!apiKey) {
      throw new Error('Gemini API key is required');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.embedModel = embedModel;
  }

  async embedText(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot embed empty text');
    }

    // Check cache first
    const cached = llmCache.get(text, 'embeddings');
    if (cached) {
      try {
        const embedding = JSON.parse(cached.response) as number[];
        logger.debug(`Using cached embedding (${embedding.length} dimensions)`);
        return embedding;
      } catch {
        logger.warn('Failed to parse cached embedding, will regenerate');
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        const model = this.genAI.getGenerativeModel({ model: this.embedModel });
        const result = await model.embedContent(text);
        const embedding = result.embedding.values;

        if (!embedding) {
          throw new Error('Invalid embedding response');
        }

        // Cache the embedding
        llmCache.set(text, JSON.stringify(embedding), 'embeddings', {
          model: this.embedModel,
        });

        return embedding;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(getErrorMessage(error));
        logger.warn(`Embedding attempt ${attempt + 1} failed:`, getErrorMessage(error));

        if (attempt < this.MAX_RETRIES - 1) {
          const delay = this.RETRY_DELAY * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(
      `Failed to generate embedding after ${this.MAX_RETRIES} attempts: ${lastError?.message}`
    );
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const embeddings: number[][] = [];

    for (const text of texts) {
      try {
        const embedding = await this.embedText(text);
        embeddings.push(embedding);
        await this.sleep(100); // Rate limiting
      } catch (error) {
        logger.error('Failed to embed text in batch:', error);
        embeddings.push(new Array(this.dimensions).fill(0));
      }
    }

    return embeddings;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
