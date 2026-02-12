/**
 * Response Parser
 * Parses and validates LLM responses

 * Date: 2025-12-23
 */

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  isTransient?: boolean;
}

/**
 * Parses LLM responses with error handling and validation
 */
export class ResponseParser {
  /**
   * Parse JSON response from LLM
   * Returns structured result with transient error marking for retry logic
   */
  static parseJSON<T>(rawText: string | undefined | null): ParseResult<T> {
    // Handle empty response
    if (!rawText) {
      return {
        success: false,
        error: 'Empty response from LLM - possibly rate limited or timeout',
        isTransient: true,
      };
    }

    try {
      const data = JSON.parse(rawText) as T;
      return {
        success: true,
        data,
      };
    } catch (parseError) {
      return {
        success: false,
        error: `Malformed JSON response: ${(parseError as Error).message}`,
        isTransient: true,
      };
    }
  }

  /**
   * Extract JSON from markdown code blocks if present
   * LLMs sometimes wrap JSON in ```json ... ``` blocks
   */
  static extractJSON(text: string): string {
    // Try to extract from markdown code block
    const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch && jsonBlockMatch[1]) {
      return jsonBlockMatch[1].trim();
    }

    // Try to find JSON object or array
    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch && jsonMatch[1]) {
      return jsonMatch[1].trim();
    }

    // Return original text
    return text.trim();
  }

  /**
   * Validate parsed data against a Zod schema
   */
  static validate<T>(
    data: unknown,
    schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: any } }
  ): ParseResult<T> {
    const result = schema.safeParse(data);

    if (result.success) {
      return {
        success: true,
        data: result.data,
      };
    }

    return {
      success: false,
      error: `Schema validation failed: ${result.error?.message || 'Unknown validation error'}`,
      isTransient: false, // Schema validation failures are not transient
    };
  }
}
