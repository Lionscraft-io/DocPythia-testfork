/**
 * Gemini Embedding Service
 * Generates document embeddings using Google's gemini-embedding-001 model

 * Date: 2025-10-29
 * Updated: 2026-02-09 - Switched to gemini-embedding-001 (text-embedding-004 deprecated)
 * Reference: /docs/specs/rag-documentation-retrieval.md
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { llmCache } from '../llm/llm-cache.js';

export interface EmbeddingService {
  embedText(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class GeminiEmbedder implements EmbeddingService {
  private genAI: GoogleGenerativeAI;
  private embedModel: string;
  private outputDimensionality: number;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // milliseconds
  private readonly BATCH_SIZE = 10; // Process 10 documents at a time

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    if (!key) {
      throw new Error('Gemini API key not found. Please set GEMINI_API_KEY or GOOGLE_AI_API_KEY');
    }

    console.log(
      `[DEBUG] GeminiEmbedder API key: ${key.substring(0, 15)}... (length: ${key.length})`
    );
    this.genAI = new GoogleGenerativeAI(key);
    // Default to gemini-embedding-001 (text-embedding-004 was deprecated Feb 2026)
    this.embedModel = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
    // Use 768 dimensions for backward compatibility with existing vectors
    this.outputDimensionality = parseInt(process.env.GEMINI_EMBED_DIMENSIONS || '768', 10);
    console.log(
      `GeminiEmbedder initialized with model: ${this.embedModel}, dimensions: ${this.outputDimensionality}`
    );
  }

  /**
   * Generate embedding for a single text
   */
  async embedText(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot embed empty text');
    }

    // Check cache first
    const cached = llmCache.get(text, 'embeddings');
    if (cached) {
      try {
        const embedding = JSON.parse(cached.response) as number[];
        console.log(`Using cached embedding (${embedding.length} dimensions)`);
        return embedding;
      } catch {
        console.warn('Failed to parse cached embedding, will regenerate');
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        console.log(
          `Generating embedding for text (attempt ${attempt + 1}/${this.MAX_RETRIES})...`
        );

        const model = this.genAI.getGenerativeModel({ model: this.embedModel });
        // Use structured content format with outputDimensionality for dimension control
        // Note: outputDimensionality is supported by API but not yet in SDK types
        const result = await model.embedContent({
          content: { role: 'user', parts: [{ text }] },
          outputDimensionality: this.outputDimensionality,
        } as Parameters<typeof model.embedContent>[0]);

        const embedding = result.embedding.values;

        if (!embedding) {
          throw new Error('Invalid embedding response from Gemini API');
        }

        // Verify dimension match
        if (embedding.length !== this.outputDimensionality) {
          console.warn(`Expected ${this.outputDimensionality} dimensions, got ${embedding.length}`);
        }

        console.log(`Successfully generated ${embedding.length}-dimensional embedding`);

        // Save to cache
        llmCache.set(text, JSON.stringify(embedding), 'embeddings', {
          model: this.embedModel,
        });

        return embedding;
      } catch (error: any) {
        lastError = error;
        console.error(`Embedding attempt ${attempt + 1} failed:`, error.message);

        if (attempt < this.MAX_RETRIES - 1) {
          // Wait before retrying with exponential backoff
          const delay = this.RETRY_DELAY * Math.pow(2, attempt);
          console.log(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(
      `Failed to generate embedding after ${this.MAX_RETRIES} attempts: ${lastError?.message}`
    );
  }

  /**
   * Generate embeddings for multiple texts in batch
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const embeddings: number[][] = [];
    const batches = this.chunkArray(texts, this.BATCH_SIZE);

    console.log(`Processing ${texts.length} texts in ${batches.length} batches...`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} items)...`);

      // Process each item in the batch sequentially to avoid rate limits
      for (const text of batch) {
        try {
          const embedding = await this.embedText(text);
          embeddings.push(embedding);
        } catch (error) {
          console.error(`Failed to embed text in batch ${i + 1}:`, error);
          // Push zero vector for failed embeddings to maintain array alignment
          embeddings.push(new Array(768).fill(0));
        }

        // Small delay between requests to avoid rate limiting
        await this.sleep(100);
      }

      // Longer delay between batches
      if (i < batches.length - 1) {
        await this.sleep(500);
      }
    }

    console.log(`Successfully generated ${embeddings.length} embeddings`);
    return embeddings;
  }

  /**
   * Helper function to chunk an array into smaller arrays
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Helper function to sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract title from markdown content
   */
  static extractTitle(content: string): string {
    // Try to extract the first H1 heading
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) {
      return h1Match[1].trim();
    }

    // Try to extract the first H2 heading
    const h2Match = content.match(/^##\s+(.+)$/m);
    if (h2Match) {
      return h2Match[1].trim();
    }

    // Try to extract from frontmatter title
    const frontmatterMatch = content.match(/^---[\s\S]*?title:\s*["']?(.+?)["']?[\s\S]*?---/);
    if (frontmatterMatch) {
      return frontmatterMatch[1].trim();
    }

    // Fall back to first line of content
    const firstLine = content.split('\n')[0].trim();
    if (firstLine) {
      return firstLine.substring(0, 100); // Limit to 100 characters
    }

    return 'Untitled Document';
  }

  /**
   * Prepare text for embedding by cleaning and truncating if necessary
   */
  static prepareText(text: string, maxTokens: number = 8192): string {
    // Remove excessive whitespace
    let prepared = text.replace(/\s+/g, ' ').trim();

    // Rough approximation: 1 token ≈ 4 characters
    const maxChars = maxTokens * 4;
    if (prepared.length > maxChars) {
      prepared = prepared.substring(0, maxChars);
      // Try to cut at a sentence boundary
      const lastPeriod = prepared.lastIndexOf('.');
      if (lastPeriod > maxChars * 0.8) {
        prepared = prepared.substring(0, lastPeriod + 1);
      }
    }

    return prepared;
  }
}

// Export singleton instance
export const geminiEmbedder = new GeminiEmbedder();
