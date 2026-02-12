/**
 * LLM Provider Interface
 * Abstracts LLM API interactions for testability

 * Date: 2025-12-23
 */

import { GoogleGenerativeAI, GenerativeModel, GenerationConfig } from '@google/generative-ai';
import { LLMModel } from '../types.js';

/**
 * Result from LLM generation
 */
export interface GenerationResult {
  text: string;
  tokensUsed?: number;
  finishReason?: string;
}

/**
 * Options for content generation
 */
export interface GenerationOptions {
  model: LLMModel | string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  responseSchema?: any;
}

/**
 * Conversation message for multi-turn requests
 */
export interface ConversationMessage {
  role: 'user' | 'model';
  content: string;
}

/**
 * Interface for LLM providers - enables dependency injection and mocking
 */
export interface ILLMProvider {
  /**
   * Generate content from a prompt
   */
  generate(prompt: string, options: GenerationOptions): Promise<GenerationResult>;

  /**
   * Generate content with conversation history
   */
  generateWithHistory(
    prompt: string,
    history: ConversationMessage[],
    options: GenerationOptions
  ): Promise<GenerationResult>;
}

/**
 * Model configuration mapping
 */
// Note: PRO_2 maps to same model as PRO (consolidated after gemini-exp-1206 deprecation)
export const MODEL_MAP: Record<string, string> = {
  [LLMModel.FLASH]: 'gemini-2.5-flash',
  [LLMModel.PRO]: 'gemini-2.5-pro',
};

/**
 * Default generation configs per model tier
 */
export const DEFAULT_CONFIGS: Record<string, Partial<GenerationConfig>> = {
  [LLMModel.FLASH]: {
    temperature: 0.2,
    maxOutputTokens: 2048,
  },
  [LLMModel.PRO]: {
    temperature: 0.4,
    maxOutputTokens: 4096,
  },
};

/**
 * Gemini implementation of LLM provider
 */
export class GeminiProvider implements ILLMProvider {
  private genAI: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generate(prompt: string, options: GenerationOptions): Promise<GenerationResult> {
    const model = this.getModel(options);
    const result = await model.generateContent(prompt);

    return {
      text: result.response.text(),
      tokensUsed: result.response.usageMetadata?.totalTokenCount,
      finishReason: result.response.candidates?.[0]?.finishReason,
    };
  }

  async generateWithHistory(
    prompt: string,
    history: ConversationMessage[],
    options: GenerationOptions
  ): Promise<GenerationResult> {
    const model = this.getModel(options);

    const contents = [
      ...history.map((msg) => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      })),
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ];

    const result = await model.generateContent({ contents });

    return {
      text: result.response.text(),
      tokensUsed: result.response.usageMetadata?.totalTokenCount,
      finishReason: result.response.candidates?.[0]?.finishReason,
    };
  }

  private getModel(options: GenerationOptions): GenerativeModel {
    const modelName = typeof options.model === 'string' ? options.model : MODEL_MAP[options.model];

    if (!modelName) {
      throw new Error(`Model name is empty or undefined. modelType: ${options.model}`);
    }

    const defaultConfig =
      typeof options.model === 'string'
        ? DEFAULT_CONFIGS[LLMModel.FLASH]
        : DEFAULT_CONFIGS[options.model];

    const generationConfig: GenerationConfig = {
      ...defaultConfig,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      responseMimeType: options.responseMimeType,
      responseSchema: options.responseSchema,
    } as GenerationConfig;

    return this.genAI.getGenerativeModel({
      model: modelName,
      generationConfig,
    });
  }

  /**
   * Get the actual model name for a given model type
   */
  static getModelName(model: LLMModel | string): string {
    return typeof model === 'string' ? model : MODEL_MAP[model];
  }
}
