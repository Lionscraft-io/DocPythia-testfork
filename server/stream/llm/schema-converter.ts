/**
 * Schema Converter
 * Converts Zod schemas to Gemini-compatible JSON schemas

 * Date: 2025-12-23
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Converts Zod schema to Gemini-compatible JSON schema
 * Removes unsupported fields and inlines all definitions
 */
export class SchemaConverter {
  /**
   * Convert a Zod schema to Gemini-compatible JSON schema
   */
  static toGeminiSchema(zodSchema: any): any {
    // Convert Zod schema to JSON schema using OpenAPI 3.0 format
    const rawJsonSchema = zodToJsonSchema(zodSchema, {
      target: 'openApi3',
      $refStrategy: 'none', // Don't use $ref, inline all definitions
    });

    // Clean the schema to remove fields Gemini doesn't support
    return SchemaConverter.cleanSchema(rawJsonSchema);
  }

  /**
   * Clean JSON schema to remove fields that Gemini API doesn't support
   * Gemini has a more restricted schema format than OpenAPI 3.0
   */
  static cleanSchema(schema: any): any {
    if (typeof schema !== 'object' || schema === null) {
      return schema;
    }

    if (Array.isArray(schema)) {
      return schema.map((item) => SchemaConverter.cleanSchema(item));
    }

    const cleaned: any = {};

    // Fields that Gemini doesn't support
    const unsupportedFields = new Set(['additionalProperties', '$schema', 'definitions', '$ref']);

    for (const [key, value] of Object.entries(schema)) {
      // Skip unsupported fields
      if (unsupportedFields.has(key)) {
        continue;
      }

      // Recursively clean nested objects
      cleaned[key] = SchemaConverter.cleanSchema(value);
    }

    return cleaned;
  }
}
