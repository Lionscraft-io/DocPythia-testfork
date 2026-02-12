/**
 * Message Vector Search Service
 * Search for similar messages using embeddings and pgvector
 * Multi-instance aware - each instance has its own vector search

 * Date: 2025-10-31
 * Updated: 2025-11-14 - Multi-instance support
 * Reference: /docs/specs/multi-stream-scanner-phase-1.md
 */

import { PrismaClient } from '@prisma/client';
import { geminiEmbedder } from '../embeddings/gemini-embedder.js';
import { PgVectorStore } from '../vector-store.js';

export interface SimilarMessage {
  id: number;
  content: string;
  author: string;
  timestamp: Date;
  channel: string | null;
  similarity: number;
}

export class MessageVectorSearch {
  private db: PrismaClient;
  private vectorStore: PgVectorStore;
  private instanceId: string;

  constructor(instanceId: string, db: PrismaClient) {
    this.instanceId = instanceId;
    this.db = db;
    this.vectorStore = new PgVectorStore(instanceId, db);
  }
  /**
   * Generate embedding for a message
   */
  async generateEmbedding(content: string): Promise<number[]> {
    try {
      const embedding = await geminiEmbedder.embedText(content);
      return embedding;
    } catch (error) {
      console.error('Error generating message embedding:', error);
      throw error;
    }
  }

  /**
   * Store embedding for a message
   */
  async storeEmbedding(messageId: number, embedding: number[]): Promise<void> {
    try {
      // Convert embedding array to PostgreSQL vector format
      const vectorString = `[${embedding.join(',')}]`;

      await this.db.$executeRaw`
        UPDATE "unified_messages"
        SET embedding = ${vectorString}::vector
        WHERE id = ${messageId}
      `;

      console.log(`Stored embedding for message ${messageId}`);
    } catch (error) {
      console.error(`Error storing embedding for message ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * Search for similar messages using cosine similarity
   * @param queryEmbedding - The embedding vector to search with
   * @param limit - Maximum number of results to return
   * @param excludeMessageId - Optional message ID to exclude from results (e.g., current message)
   * @param minSimilarity - Minimum similarity threshold (0-1)
   */
  async searchSimilarMessages(
    queryEmbedding: number[],
    limit: number = 10,
    excludeMessageId?: number,
    minSimilarity: number = 0.5
  ): Promise<SimilarMessage[]> {
    try {
      // Convert embedding array to PostgreSQL vector format
      const vectorString = `[${queryEmbedding.join(',')}]`;

      // Build the WHERE clause for excluding a message
      const excludeClause = excludeMessageId ? `AND id != ${excludeMessageId}` : '';

      // Use pgvector cosine similarity operator (<=>)
      // Lower distance = higher similarity
      // Similarity = 1 - distance
      const query = `
        SELECT
          id,
          content,
          author,
          timestamp,
          channel,
          (1 - (embedding <=> $1::vector)) as distance
        FROM "unified_messages"
        WHERE embedding IS NOT NULL
          ${excludeClause}
          AND (1 - (embedding <=> $1::vector)) >= $2
        ORDER BY embedding <=> $1::vector ASC
        LIMIT $3
      `;

      const results = await this.db.$queryRawUnsafe<
        Array<{
          id: number;
          content: string;
          author: string;
          timestamp: Date;
          channel: string | null;
          distance: number;
        }>
      >(query, vectorString, minSimilarity, limit);

      // Transform results to SimilarMessage format
      return results.map((row) => ({
        id: row.id,
        content: row.content,
        author: row.author,
        timestamp: row.timestamp,
        channel: row.channel,
        similarity: row.distance, // distance is already converted to similarity (1 - cosine_distance)
      }));
    } catch (error) {
      console.error('Error searching similar messages:', error);
      throw error;
    }
  }

  /**
   * Search for similar messages by message content
   * Generates embedding for content and searches
   */
  async searchSimilarByContent(
    content: string,
    limit: number = 10,
    excludeMessageId?: number,
    minSimilarity: number = 0.5
  ): Promise<SimilarMessage[]> {
    try {
      // Generate embedding for the content
      const embedding = await this.generateEmbedding(content);

      // Search using the embedding
      return await this.searchSimilarMessages(embedding, limit, excludeMessageId, minSimilarity);
    } catch (error) {
      console.error('Error searching similar messages by content:', error);
      throw error;
    }
  }

  /**
   * Get total count of messages with embeddings
   */
  async getEmbeddedMessagesCount(): Promise<number> {
    try {
      const result = await this.db.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count
        FROM "unified_messages"
        WHERE embedding IS NOT NULL
      `;

      return Number(result[0].count);
    } catch (error) {
      console.error('Error getting embedded messages count:', error);
      return 0;
    }
  }

  /**
   * Check if a message has an embedding
   */
  async hasEmbedding(messageId: number): Promise<boolean> {
    try {
      const result = await this.db.$queryRaw<[{ has_embedding: boolean }]>`
        SELECT (embedding IS NOT NULL) as has_embedding
        FROM "unified_messages"
        WHERE id = ${messageId}
      `;

      return result[0]?.has_embedding || false;
    } catch (error) {
      console.error(`Error checking embedding for message ${messageId}:`, error);
      return false;
    }
  }

  /**
   * Batch store embeddings for multiple messages
   */
  async batchStoreEmbeddings(
    embeddings: Array<{ messageId: number; embedding: number[] }>
  ): Promise<void> {
    try {
      for (const { messageId, embedding } of embeddings) {
        await this.storeEmbedding(messageId, embedding);
      }
      console.log(`Batch stored ${embeddings.length} embeddings`);
    } catch (error) {
      console.error('Error batch storing embeddings:', error);
      throw error;
    }
  }

  /**
   * Search for similar documentation pages using RAG
   * This searches the document_pages table, not unified_messages
   * @param queryText - The text to search for (will be embedded)
   * @param limit - Maximum number of documentation results to return
   */
  async searchSimilarDocs(
    queryText: string,
    limit: number = 5
  ): Promise<
    Array<{
      id: number;
      title: string;
      file_path: string;
      content: string;
      distance: number;
    }>
  > {
    try {
      console.log(`Searching for top ${limit} similar documentation pages...`);

      // Generate embedding for the query text
      const queryEmbedding = await this.generateEmbedding(queryText);

      // Search documentation using vector store
      const results = await this.vectorStore.searchSimilar(queryEmbedding, limit);

      // Transform results to expected format
      return results.map((doc) => ({
        id: doc.pageId,
        title: doc.title,
        file_path: doc.filePath,
        content: doc.content,
        distance: doc.similarity, // vectorStore returns similarity (0-1), higher is better
      }));
    } catch (error) {
      console.error('Error searching similar documentation:', error);
      throw error;
    }
  }
}
