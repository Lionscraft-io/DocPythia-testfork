/**
 * LLM Service
 * Unified service for LLM requests with model tiering and retry logic

 * Date: 2025-10-30
 * Updated: 2025-12-23 - Refactored for testability with dependency injection
 * Reference: /docs/specs/multi-stream-scanner-phase-1.md
 */

import { LLMModel, LLMRequest, LLMResponse } from '../types.js';
import { llmCache as defaultLlmCache, CachePurpose, ILLMCache } from '../../llm/llm-cache.js';
import { ILLMProvider, GeminiProvider } from './llm-provider.js';
import { SchemaConverter } from './schema-converter.js';
import { ResponseParser } from './response-parser.js';
import { PromptBuilder } from './prompt-builder.js';
import { RetryHandler, RetryConfig } from './retry-handler.js';

/**
 * Configuration options for LLMService
 */
export interface LLMServiceConfig {
  provider?: ILLMProvider;
  cache?: ILLMCache;
  retryConfig?: Partial<RetryConfig>;
  delayFn?: (ms: number) => Promise<void>;
  logger?: LLMLogger;
}

/**
 * Logger interface for LLM operations
 */
export interface LLMLogger {
  logRequest(request: LLMRequest, schema?: any): void;
  logResponse(response: LLMResponse, rawJson?: string): void;
  logError(error: Error, context: string): void;
  logRetry(attempt: number, error: Error, delayMs: number): void;
}

/**
 * Production logger - logs metadata only, no prompt/response bodies
 */
export class ProductionLogger implements LLMLogger {
  logRequest(request: LLMRequest): void {
    const promptLength = (request.systemPrompt?.length || 0) + request.userPrompt.length;
    console.log(
      `[LLM] Request: model=${request.model}, temp=${request.temperature || 'default'}, ` +
        `maxTokens=${request.maxTokens || 'default'}, promptChars=${promptLength}`
    );
  }

  logResponse(response: LLMResponse, rawJson?: string): void {
    console.log(
      `[LLM] Response: model=${response.modelUsed}, tokens=${response.tokensUsed || 'unknown'}, ` +
        `finish=${response.finishReason || 'unknown'}, responseChars=${rawJson?.length || 0}`
    );
  }

  logError(error: Error, context: string): void {
    console.error(`[LLM] ERROR (${context}): ${error.message}`);
  }

  logRetry(attempt: number, error: Error, delayMs: number): void {
    console.log(`[LLM] Retry attempt ${attempt}, waiting ${delayMs}ms: ${error.message}`);
  }
}

/**
 * Verbose console logger - logs full prompts and responses (for debugging)
 */
export class VerboseLogger implements LLMLogger {
  logRequest(request: LLMRequest, schema?: any): void {
    console.log('\n' + '='.repeat(80));
    console.log('📤 LLM REQUEST');
    console.log('='.repeat(80));
    console.log('Model:', request.model);
    console.log('Temperature:', request.temperature || 'default');
    console.log('Max Tokens:', request.maxTokens || 'default');
    if (request.history && request.history.length > 0) {
      console.log('Conversation History:', request.history.length, 'messages');
    }
    console.log('\n--- SYSTEM PROMPT ---');
    console.log(request.systemPrompt || '(none)');
    console.log('\n--- USER PROMPT ---');
    console.log(request.userPrompt);
    if (schema) {
      console.log('\n--- RESPONSE SCHEMA ---');
      console.log(JSON.stringify(schema, null, 2));
    }
    console.log('='.repeat(80) + '\n');
  }

  logResponse(response: LLMResponse, rawJson?: string): void {
    console.log('\n' + '='.repeat(80));
    console.log('📥 LLM RESPONSE');
    console.log('='.repeat(80));
    console.log('Model Used:', response.modelUsed);
    console.log('Tokens Used:', response.tokensUsed || 'unknown');
    console.log('Finish Reason:', response.finishReason || 'unknown');
    if (rawJson) {
      console.log('\n--- RAW JSON RESPONSE ---');
      console.log(rawJson || '(empty)');
    }
    console.log('='.repeat(80) + '\n');
  }

  logError(error: Error, context: string): void {
    console.error('\n' + '='.repeat(80));
    console.error(`❌ ${context}`);
    console.error('='.repeat(80));
    console.error('Error:', error);
    console.error('='.repeat(80) + '\n');
  }

  logRetry(attempt: number, error: Error, delayMs: number): void {
    console.log(`⏳ Retry attempt ${attempt}, waiting ${delayMs}ms...`);
  }
}

/**
 * Alias for backwards compatibility
 */
export const ConsoleLogger = VerboseLogger;

/**
 * Get default logger based on environment
 */
function getDefaultLogger(): LLMLogger {
  const verbose = process.env.LLM_VERBOSE_LOGGING === 'true';
  return verbose ? new VerboseLogger() : new ProductionLogger();
}

/**
 * Silent logger for testing
 */
export class SilentLogger implements LLMLogger {
  logRequest(): void {}
  logResponse(): void {}
  logError(): void {}
  logRetry(): void {}
}

export class LLMService {
  private provider: ILLMProvider;
  private cache: ILLMCache;
  private retryHandler: RetryHandler;
  private logger: LLMLogger;

  constructor(apiKeyOrConfig?: string | LLMServiceConfig) {
    // Handle both legacy (apiKey string) and new (config object) signatures
    if (typeof apiKeyOrConfig === 'string' || apiKeyOrConfig === undefined) {
      const apiKey = apiKeyOrConfig || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY environment variable is required');
      }
      this.provider = new GeminiProvider(apiKey);
      this.cache = defaultLlmCache;
      this.retryHandler = new RetryHandler();
      this.logger = getDefaultLogger();
    } else {
      // Config object provided
      const config = apiKeyOrConfig;

      if (!config.provider) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error('GEMINI_API_KEY environment variable is required');
        }
        this.provider = new GeminiProvider(apiKey);
      } else {
        this.provider = config.provider;
      }

      this.cache = config.cache || defaultLlmCache;
      this.retryHandler = new RetryHandler(config.retryConfig, config.delayFn);
      this.logger = config.logger || getDefaultLogger();
    }

    console.log('LLMService initialized');
  }

  /**
   * Make an LLM request with automatic retry logic
   */
  async request(request: LLMRequest): Promise<LLMResponse> {
    return this.retryHandler.execute(
      () => this.makeRequest(request),
      (attempt, error, delay) => {
        this.logger.logRetry(attempt, error, delay);
      }
    );
  }

  /**
   * Make a structured JSON request with schema validation
   */
  async requestJSON<T = any>(
    request: LLMRequest,
    responseSchema: any,
    cachePurpose?: CachePurpose,
    messageId?: number
  ): Promise<{ data: T; response: LLMResponse }> {
    const prompt = PromptBuilder.build(request);

    // Check cache if purpose is provided
    if (cachePurpose) {
      const cached = this.cache.get(prompt, cachePurpose);
      if (cached) {
        const parseResult = ResponseParser.parseJSON<T>(cached.response);
        if (parseResult.success && parseResult.data) {
          const llmResponse: LLMResponse = {
            content: cached.response,
            modelUsed: cached.model || 'cached',
            tokensUsed: cached.tokensUsed,
            finishReason: 'CACHED',
          };
          return { data: parseResult.data, response: llmResponse };
        }
        console.warn('Failed to parse cached response, will regenerate');
      }
    }

    // Execute with retry logic
    return this.retryHandler.execute(
      () => this.makeRequestJSON<T>(request, responseSchema, cachePurpose, messageId, prompt),
      (attempt, error, delay) => {
        this.logger.logRetry(attempt, error, delay);
      }
    );
  }

  /**
   * Core JSON request logic
   */
  private async makeRequestJSON<T = any>(
    request: LLMRequest,
    responseSchema: any,
    cachePurpose: CachePurpose | undefined,
    messageId: number | undefined,
    prompt: string
  ): Promise<{ data: T; response: LLMResponse }> {
    // Convert schema
    const cleanedSchema = SchemaConverter.toGeminiSchema(responseSchema);

    // Log request
    this.logger.logRequest(request, cleanedSchema);

    // Make API request
    let result;
    try {
      const options = {
        model: request.model,
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
        responseMimeType: 'application/json',
        responseSchema: cleanedSchema,
      };

      if (PromptBuilder.hasHistory(request)) {
        const history = PromptBuilder.convertHistory(request.history);
        result = await this.provider.generateWithHistory(prompt, history, options);
      } else {
        result = await this.provider.generate(prompt, options);
      }
    } catch (apiError) {
      this.logger.logError(apiError as Error, 'GEMINI API ERROR');
      throw RetryHandler.transientError(`Gemini API error: ${(apiError as Error).message}`);
    }

    // Parse response
    const parseResult = ResponseParser.parseJSON<T>(result.text);
    if (!parseResult.success) {
      this.logger.logError(new Error(parseResult.error!), 'JSON PARSE ERROR');
      const error = new Error(parseResult.error);
      (error as any).transient = parseResult.isTransient;
      throw error;
    }

    const llmResponse: LLMResponse = {
      content: result.text,
      modelUsed: GeminiProvider.getModelName(request.model),
      tokensUsed: result.tokensUsed,
      finishReason: result.finishReason,
    };

    // Log response
    this.logger.logResponse(llmResponse, result.text);

    // Save to cache if purpose is provided
    if (cachePurpose) {
      this.cache.set(prompt, result.text, cachePurpose, {
        model: llmResponse.modelUsed,
        tokensUsed: llmResponse.tokensUsed,
        messageId,
      });
    }

    return { data: parseResult.data!, response: llmResponse };
  }

  /**
   * Make a simple text request
   */
  private async makeRequest(request: LLMRequest): Promise<LLMResponse> {
    const prompt = PromptBuilder.build(request);

    try {
      const result = await this.provider.generate(prompt, {
        model: request.model,
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
      });

      if (!result.text) {
        throw RetryHandler.transientError('Empty response from LLM');
      }

      return {
        content: result.text,
        modelUsed: GeminiProvider.getModelName(request.model),
        tokensUsed: result.tokensUsed,
        finishReason: result.finishReason,
      };
    } catch (error) {
      console.error('Error in LLM request:', error);
      throw error;
    }
  }

  /**
   * Get recommended model for task type
   */
  static getRecommendedModel(taskType: 'classification' | 'proposal' | 'review'): LLMModel {
    switch (taskType) {
      case 'classification':
        return LLMModel.FLASH;
      case 'proposal':
        return LLMModel.PRO;
      case 'review':
        return LLMModel.PRO;
      default:
        return LLMModel.PRO;
    }
  }

  /**
   * Estimate token count (rough approximation)
   */
  static estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate cost estimate (USD)
   */
  static estimateCost(modelType: LLMModel, inputTokens: number, outputTokens: number): number {
    // Pricing for Gemini 2.5 models
    const pricing: Record<string, { input: number; output: number }> = {
      [LLMModel.FLASH]: { input: 0.075 / 1_000_000, output: 0.3 / 1_000_000 },
      [LLMModel.PRO]: { input: 1.25 / 1_000_000, output: 5.0 / 1_000_000 },
    };

    const rates = pricing[modelType];
    return inputTokens * rates.input + outputTokens * rates.output;
  }
}

// Export singleton instance
export const llmService = new LLMService();
