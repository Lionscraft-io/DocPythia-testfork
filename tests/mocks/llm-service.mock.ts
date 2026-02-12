/**
 * LLM Service Mock
 * Provides mock implementations for LLM service operations
 */

import { vi } from 'vitest';

export const mockLLMService = {
  requestJSON: vi.fn(),
};

// Updated for thread-based architecture
export const mockBatchClassificationResponse = {
  threads: [
    {
      category: 'troubleshooting',
      messages: [1], // Message IDs in this thread
      summary: 'User encountered RPC connection issues',
      docValueReason: 'User encountered an error not documented',
      ragSearchCriteria: {
        keywords: ['error', 'rpc', 'connection'],
        semanticQuery: 'RPC connection troubleshooting',
      },
    },
  ],
  batchSummary: 'Found 1 valuable thread: 1 troubleshooting',
};

// Updated for conversation-based architecture
export const mockProposalResponse = {
  proposals: [
    {
      updateType: 'UPDATE',
      page: 'docs/troubleshooting.md',
      section: 'Common Errors',
      location: {
        lineStart: 45,
        lineEnd: 50,
        sectionName: 'RPC Timeout Errors',
      },
      suggestedText: 'Updated section about RPC timeout errors...',
      reasoning: 'This error pattern is common but not documented',
      sourceMessages: [1],
    },
  ],
  proposalsRejected: false,
};

export const createMockLLMResponse = (data: any) => ({
  data,
  response: {
    content: JSON.stringify(data),
    modelUsed: 'gemini-2.5-flash',
    tokensUsed: 500,
    finishReason: 'STOP',
  },
});

// Helper to reset LLM service mocks
export const resetLLMServiceMocks = () => {
  mockLLMService.requestJSON.mockReset();
};

// Setup default mock behavior
export const setupLLMServiceMocks = () => {
  mockLLMService.requestJSON.mockImplementation(async (request, schema, purpose, _messageId) => {
    if (purpose === 'analysis') {
      // Batch classification
      return createMockLLMResponse(mockBatchClassificationResponse);
    } else if (purpose === 'changegeneration') {
      // Proposal generation
      return createMockLLMResponse(mockProposalResponse);
    }
    return createMockLLMResponse({});
  });
};
