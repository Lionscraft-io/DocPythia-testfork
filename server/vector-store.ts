/**
 * Vector Store Service
 * Manages document embeddings storage and vector similarity search using pgvector
 * Multi-instance aware - each instance has its own vector store

 * Date: 2025-10-29
 * Updated: 2025-11-14 - Multi-instance support
 * Reference: /docs/specs/rag-documentation-retrieval.md
 */

import { PrismaClient } from '@prisma/client';
import { InstanceConfigLoader } from './config/instance-loader';
import pg, { Pool as PoolType } from 'pg';
const { Pool } = pg;

export interface DocumentPage {
  filePath: string;
  title: string;
  content: string;
  gitHash: string;
  gitUrl: string;
  embedding: number[];
}

export interface SearchResult {
  pageId: number;
  filePath: string;
  title: string;
  content: string;
  similarity: number;
}

export interface VectorStore {
  upsertDocument(doc: DocumentPage): Promise<void>;
  deleteDocument(filePath: string): Promise<void>;
  searchSimilar(queryEmbedding: number[], topK: number): Promise<SearchResult[]>;
  getDocumentByPath(filePath: string): Promise<DocumentPage | null>;
}

export class PgVectorStore implements VectorStore {
  private pool: PoolType;
  private db: PrismaClient;
  private instanceId: string;

  constructor(instanceId: string, db: PrismaClient) {
    this.instanceId = instanceId;
    this.db = db;

    // Get instance-specific database URL (preserve query params like sslmode)
    const config = InstanceConfigLoader.get(instanceId);
    const baseUrl = process.env.DATABASE_URL || '';
    const url = new URL(baseUrl);
    url.pathname = url.pathname.replace(/\/[^/]+$/, `/${config.database.name}`);
    const databaseUrl = url.toString();

    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    // Create a pg Pool for direct SQL queries with pgvector
    // Configure SSL for RDS (accepts Amazon's certificate chain)
    const sslMode = url.searchParams.get('sslmode');
    const ssl = sslMode === 'require' ? { rejectUnauthorized: false } : undefined;

    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl,
    });

    console.log(`PgVectorStore initialized for ${instanceId} (${config.database.name})`);
  }

  /**
   * Convert number array to pgvector format string
   */
  private vectorToString(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  /**
   * Parse pgvector string to number array
   */
  private stringToVector(vectorString: string): number[] {
    // Remove brackets and parse
    const cleaned = vectorString.replace(/^\[|\]$/g, '');
    return cleaned.split(',').map((v) => parseFloat(v.trim()));
  }

  /**
   * Upsert a document with its embedding
   */
  async upsertDocument(doc: DocumentPage): Promise<void> {
    try {
      console.log(`[${this.instanceId}] Upserting document: ${doc.filePath}`);

      // First, check if a document with this filePath already exists
      const existing = await this.db.documentPage.findFirst({
        where: { filePath: doc.filePath },
      });

      if (existing) {
        // Update existing document
        await this.pool.query(
          `UPDATE document_pages
           SET title = $1, content = $2, commit_hash = $3, git_url = $4,
               embedding = $5::vector, updated_at = NOW()
           WHERE file_path = $6`,
          [
            doc.title,
            doc.content,
            doc.gitHash,
            doc.gitUrl,
            this.vectorToString(doc.embedding),
            doc.filePath,
          ]
        );
        console.log(`[${this.instanceId}] Updated document: ${doc.filePath}`);
      } else {
        // Insert new document
        await this.pool.query(
          `INSERT INTO document_pages (file_path, title, content, commit_hash, git_url, embedding, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6::vector, NOW(), NOW())`,
          [
            doc.filePath,
            doc.title,
            doc.content,
            doc.gitHash,
            doc.gitUrl,
            this.vectorToString(doc.embedding),
          ]
        );
        console.log(`[${this.instanceId}] Inserted new document: ${doc.filePath}`);
      }
    } catch (error) {
      console.error(`[${this.instanceId}] Error upserting document ${doc.filePath}:`, error);
      throw error;
    }
  }

  /**
   * Delete a document by file path
   */
  async deleteDocument(filePath: string): Promise<void> {
    try {
      console.log(`[${this.instanceId}] Deleting document: ${filePath}`);

      await this.db.documentPage.deleteMany({
        where: { filePath },
      });

      console.log(`[${this.instanceId}] Deleted document: ${filePath}`);
    } catch (error) {
      console.error(`[${this.instanceId}] Error deleting document ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Search for similar documents using cosine similarity
   */
  async searchSimilar(queryEmbedding: number[], topK: number = 3): Promise<SearchResult[]> {
    try {
      console.log(`Searching for top ${topK} similar documents...`);

      const vectorString = this.vectorToString(queryEmbedding);

      // Use cosine distance operator (<=>)
      // Lower distance = higher similarity
      // We convert to similarity score: 1 - distance
      const result = await this.pool.query(
        `SELECT
          id as "pageId",
          file_path as "filePath",
          title,
          content,
          1 - (embedding <=> $1::vector) as similarity
         FROM document_pages
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [vectorString, topK]
      );

      const searchResults: SearchResult[] = result.rows.map((row: any) => ({
        pageId: row.pageId,
        filePath: row.filePath,
        title: row.title,
        content: row.content,
        similarity: parseFloat(row.similarity),
      }));

      console.log(`Found ${searchResults.length} similar documents`);
      return searchResults;
    } catch (error) {
      console.error('Error searching similar documents:', error);
      throw error;
    }
  }

  /**
   * Get a document by its file path
   */
  async getDocumentByPath(filePath: string): Promise<DocumentPage | null> {
    try {
      const result = await this.pool.query(
        `SELECT
          file_path as "filePath",
          title,
          content,
          commit_hash as "gitHash",
          git_url as "gitUrl",
          embedding
         FROM document_pages
         WHERE file_path = $1
         LIMIT 1`,
        [filePath]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      return {
        filePath: row.filePath,
        title: row.title,
        content: row.content,
        gitHash: row.gitHash,
        gitUrl: row.gitUrl,
        embedding: row.embedding ? this.stringToVector(row.embedding) : [],
      };
    } catch (error) {
      console.error(`Error getting document ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Get document by file path and commit hash (for resume logic)
   */
  async getDocument(filePath: string, commitHash: string): Promise<DocumentPage | null> {
    try {
      const result = await this.pool.query(
        `SELECT
          file_path as "filePath",
          title,
          content,
          commit_hash as "gitHash",
          git_url as "gitUrl",
          embedding
         FROM document_pages
         WHERE file_path = $1 AND commit_hash = $2
         LIMIT 1`,
        [filePath, commitHash]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      return {
        filePath: row.filePath,
        title: row.title,
        content: row.content,
        gitHash: row.gitHash,
        gitUrl: row.gitUrl,
        embedding: row.embedding ? this.stringToVector(row.embedding) : [],
      };
    } catch (error) {
      console.error(`Error getting document ${filePath} for commit ${commitHash}:`, error);
      throw error;
    }
  }

  /**
   * Get statistics about the vector store
   */
  async getStats(): Promise<{ totalDocuments: number; documentsWithEmbeddings: number }> {
    try {
      const result = await this.pool.query(
        `SELECT
          COUNT(*) as total,
          COUNT(embedding) as with_embeddings
         FROM document_pages`
      );

      return {
        totalDocuments: parseInt(result.rows[0].total),
        documentsWithEmbeddings: parseInt(result.rows[0].with_embeddings),
      };
    } catch (error) {
      console.error('Error getting vector store stats:', error);
      throw error;
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    await this.pool.end();
    console.log(`[${this.instanceId}] PgVectorStore cleaned up`);
  }
}
