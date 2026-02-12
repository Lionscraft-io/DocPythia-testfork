/**
 * Vector Search Mock
 * Provides mock implementations for message vector search operations
 */

import { vi } from 'vitest';

export const mockVectorSearch = {
  searchSimilarDocs: vi.fn(),
  storeEmbedding: vi.fn(),
  hasEmbedding: vi.fn(),
  getEmbeddedMessagesCount: vi.fn(),
};

export const mockRAGDocs = [
  {
    id: 1,
    title: 'Troubleshooting Guide',
    file_path: 'docs/troubleshooting.md',
    content: 'This guide covers common troubleshooting scenarios...',
    distance: 0.85,
  },
  {
    id: 2,
    title: 'API Reference',
    file_path: 'docs/api-reference.md',
    content: 'Complete API reference documentation...',
    distance: 0.78,
  },
  {
    id: 3,
    title: 'Getting Started',
    file_path: 'docs/getting-started.md',
    content: 'Quick start guide for new users...',
    distance: 0.72,
  },
];

export const setupVectorSearchMocks = () => {
  mockVectorSearch.searchSimilarDocs.mockResolvedValue(mockRAGDocs);
  mockVectorSearch.storeEmbedding.mockResolvedValue(undefined);
  mockVectorSearch.hasEmbedding.mockResolvedValue(true);
  mockVectorSearch.getEmbeddedMessagesCount.mockResolvedValue(100);
};

export const resetVectorSearchMocks = () => {
  Object.values(mockVectorSearch).forEach((method) => {
    if (typeof method?.mockReset === 'function') {
      method.mockReset();
    }
  });
};
