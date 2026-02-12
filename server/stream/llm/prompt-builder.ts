/**
 * Prompt Builder
 * Builds prompts from LLM request components

 * Date: 2025-12-23
 */

import { LLMRequest } from '../types.js';
import { ConversationMessage } from './llm-provider.js';

/**
 * Builds prompts for LLM requests
 */
export class PromptBuilder {
  /**
   * Build a complete prompt from system and user prompts
   */
  static build(request: LLMRequest): string {
    if (request.systemPrompt) {
      return `${request.systemPrompt}\n\n${request.userPrompt}`;
    }
    return request.userPrompt;
  }

  /**
   * Convert LLMRequest history to ConversationMessage format
   */
  static convertHistory(history?: Array<{ role: string; content: string }>): ConversationMessage[] {
    if (!history || history.length === 0) {
      return [];
    }

    return history.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      content: msg.content,
    })) as ConversationMessage[];
  }

  /**
   * Check if request has conversation history
   */
  static hasHistory(request: LLMRequest): boolean {
    return !!(request.history && request.history.length > 0);
  }

  /**
   * Create a cache key from request
   */
  static createCacheKey(request: LLMRequest): string {
    return PromptBuilder.build(request);
  }
}
