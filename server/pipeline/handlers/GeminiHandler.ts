/**
 * Gemini LLM Handler
 *
 * Adapts the existing GeminiLLMProvider to the pipeline's ILLMHandler interface.
 * Provides JSON generation with schema validation and cost estimation.
 *

 * @created 2025-12-30
 */

import type { z } from 'zod';
import type {
  ILLMHandler,
  LLMRequest,
  LLMContext,
  LLMResponse,
  ModelInfo,
  CostEstimate,
} from '../core/interfaces.js';
import { GeminiLLMProvider } from '../../llm/providers/gemini-provider.js';
import { createLogger, getErrorMessage } from '../../utils/logger.js';

const logger = createLogger('GeminiHandler');

/**
 * Model pricing (per 1K tokens) as of Dec 2024
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.000075, output: 0.0003 },
  'gemini-2.5-pro': { input: 0.00125, output: 0.005 },
  'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
  'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
};

/**
 * Model context window sizes
 */
const MODEL_INFO: Record<string, ModelInfo> = {
  'gemini-2.5-flash': {
    provider: 'gemini',
    maxInputTokens: 1048576,
    maxOutputTokens: 8192,
    supportsFunctionCalling: true,
    supportsStreaming: true,
  },
  'gemini-2.5-pro': {
    provider: 'gemini',
    maxInputTokens: 2097152,
    maxOutputTokens: 8192,
    supportsFunctionCalling: true,
    supportsStreaming: true,
  },
  'gemini-1.5-flash': {
    provider: 'gemini',
    maxInputTokens: 1048576,
    maxOutputTokens: 8192,
    supportsFunctionCalling: true,
    supportsStreaming: true,
  },
  'gemini-1.5-pro': {
    provider: 'gemini',
    maxInputTokens: 2097152,
    maxOutputTokens: 8192,
    supportsFunctionCalling: true,
    supportsStreaming: true,
  },
};

/**
 * Default model info for unknown models
 */
const DEFAULT_MODEL_INFO: ModelInfo = {
  provider: 'gemini',
  maxInputTokens: 128000,
  maxOutputTokens: 4096,
  supportsFunctionCalling: false,
  supportsStreaming: true,
};

/**
 * Gemini LLM Handler implementation
 */
export class GeminiHandler implements ILLMHandler {
  readonly name = 'gemini';
  private provider: GeminiLLMProvider;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel: string = 'gemini-2.5-flash') {
    this.provider = new GeminiLLMProvider(apiKey, defaultModel);
    this.defaultModel = defaultModel;
  }

  /**
   * Generate structured JSON response with schema validation
   */
  async requestJSON<T>(
    request: LLMRequest,
    responseSchema: z.ZodSchema<T>,
    context: LLMContext
  ): Promise<{ data: T; response: LLMResponse }> {
    const model = request.model || this.defaultModel;
    const startTime = Date.now();

    logger.debug('Requesting JSON from Gemini', {
      model,
      purpose: context.purpose,
      batchId: context.batchId,
    });

    try {
      const result = await this.provider.generateStructured(
        `${request.systemPrompt}\n\n${request.userPrompt}`,
        responseSchema,
        {
          model,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
        }
      );

      // Stringify result for response text - ensure non-empty
      const responseText = JSON.stringify(result);

      const response: LLMResponse = {
        text: responseText || '{}',
        model,
        cached: false, // Could check cache status from provider
      };

      logger.debug('JSON request completed', {
        model,
        purpose: context.purpose,
        durationMs: Date.now() - startTime,
        responseTextLength: responseText?.length || 0,
      });

      return { data: result, response };
    } catch (error) {
      logger.error('JSON request failed', {
        model,
        purpose: context.purpose,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Generate text response
   */
  async requestText(request: LLMRequest, context: LLMContext): Promise<LLMResponse> {
    const model = request.model || this.defaultModel;
    const startTime = Date.now();

    logger.debug('Requesting text from Gemini', {
      model,
      purpose: context.purpose,
      batchId: context.batchId,
    });

    try {
      let result;

      if (request.history && request.history.length > 0) {
        result = await this.provider.generateWithHistory(request.userPrompt, request.history, {
          model,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          systemPrompt: request.systemPrompt,
        });
      } else {
        result = await this.provider.generateText(
          `${request.systemPrompt}\n\n${request.userPrompt}`,
          {
            model,
            temperature: request.temperature,
            maxTokens: request.maxTokens,
          }
        );
      }

      logger.debug('Text request completed', {
        model,
        purpose: context.purpose,
        durationMs: Date.now() - startTime,
        tokensUsed: result.tokensUsed,
      });

      return {
        text: result.text,
        tokensUsed: result.tokensUsed,
        finishReason: result.finishReason,
        model: result.model || model,
        cached: false,
      };
    } catch (error) {
      logger.error('Text request failed', {
        model,
        purpose: context.purpose,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Get model capabilities
   */
  getModelInfo(model: string): ModelInfo {
    return MODEL_INFO[model] || DEFAULT_MODEL_INFO;
  }

  /**
   * Estimate cost for request
   */
  estimateCost(request: LLMRequest): CostEstimate {
    const model = request.model || this.defaultModel;
    const pricing = MODEL_PRICING[model] || { input: 0.001, output: 0.003 };

    // Rough token estimation (4 chars per token)
    const inputText = `${request.systemPrompt || ''} ${request.userPrompt}`;
    const inputTokens = Math.ceil(inputText.length / 4);
    const outputTokens = request.maxTokens || 2048;

    const estimatedCostUSD =
      (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;

    return {
      inputTokens,
      outputTokens,
      estimatedCostUSD,
    };
  }
}

/**
 * Create a GeminiHandler from environment variables
 */
export function createGeminiHandler(): GeminiHandler {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY or GOOGLE_AI_API_KEY environment variable required');
  }

  const defaultModel = process.env.LLM_MODEL || 'gemini-2.5-flash';
  return new GeminiHandler(apiKey, defaultModel);
}
