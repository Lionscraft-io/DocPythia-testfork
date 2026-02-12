/**
 * Gemini Analyzer Tests
 * Tests for MessageAnalyzer and related functions

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before imports
const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn().mockReturnValue({
  generateContent: mockGenerateContent,
});

vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: class MockGoogleGenerativeAI {
      constructor(_apiKey: string) {}
      getGenerativeModel = mockGetGenerativeModel;
    },
    SchemaType: {
      STRING: 'string',
      NUMBER: 'number',
      BOOLEAN: 'boolean',
      OBJECT: 'object',
      ARRAY: 'array',
    },
  };
});

vi.mock('../server/storage', () => ({
  storage: {
    getDocumentationSections: vi.fn(),
    getUnanalyzedMessages: vi.fn(),
    createPendingUpdate: vi.fn(),
    markMessageAsAnalyzed: vi.fn(),
    updateDocumentationSection: vi.fn(),
    createUpdateHistory: vi.fn(),
  },
}));

vi.mock('../server/config/loader', () => ({
  getConfig: vi.fn(),
}));

vi.mock('../server/llm/llm-cache.js', () => ({
  llmCache: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../server/stream/llm/prompt-templates.js', () => ({
  PROMPT_TEMPLATES: {
    messageAnalysis: { prompt: 'Analyze: {{content}}' },
    documentationAnswer: { system: 'You are a {{projectName}} expert.' },
  },
  fillTemplate: vi.fn((template: string, vars: Record<string, any>) => {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
    }
    return result;
  }),
}));

import { storage } from '../server/storage';
import { getConfig } from '../server/config/loader';
import { llmCache } from '../server/llm/llm-cache.js';
import {
  MessageAnalyzer,
  createAnalyzerFromEnv,
  AnalysisResult,
} from '../server/analyzer/gemini-analyzer';

describe('MessageAnalyzer', () => {
  let analyzer: MessageAnalyzer;

  const mockConfig = {
    project: { name: 'Test Project' },
  };

  const mockDocSections = [
    {
      sectionId: 'introduction',
      title: 'Introduction',
      content: 'This is the introduction to our documentation...',
    },
    {
      sectionId: 'troubleshooting',
      title: 'Troubleshooting',
      content: 'Common troubleshooting steps...',
    },
  ];

  const mockMessage = {
    id: 1,
    messageId: 'msg-123',
    source: 'zulipchat',
    channelName: 'test-channel',
    topicName: 'Test Topic',
    senderEmail: 'user@test.com',
    senderName: 'Test User',
    content: 'How do I fix the connection error?',
    messageTimestamp: new Date('2025-12-23T10:00:00Z'),
    analyzed: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset module-level mocks
    mockGenerateContent.mockReset();
    mockGetGenerativeModel.mockReset();
    mockGetGenerativeModel.mockReturnValue({
      generateContent: mockGenerateContent,
    });

    vi.mocked(getConfig).mockReturnValue(mockConfig as any);
    vi.mocked(storage.getDocumentationSections).mockResolvedValue(mockDocSections as any);
    vi.mocked(llmCache.get).mockReturnValue(null);

    // Set API key
    process.env.GEMINI_API_KEY = 'test-api-key';

    analyzer = new MessageAnalyzer();
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  describe('loadDocumentation', () => {
    it('should load documentation sections from storage', async () => {
      await analyzer.loadDocumentation();

      expect(storage.getDocumentationSections).toHaveBeenCalled();
    });
  });

  describe('analyzeMessage', () => {
    it('should analyze a message and return result', async () => {
      const analysisResult: AnalysisResult = {
        relevant: true,
        updateType: 'minor',
        sectionId: 'troubleshooting',
        summary: 'Add connection error fix',
        suggestedContent: 'Updated content',
        reasoning: 'Message contains useful troubleshooting info',
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(analysisResult),
        },
      });

      const result = await analyzer.analyzeMessage(mockMessage as any);

      expect(result.relevant).toBe(true);
      expect(result.updateType).toBe('minor');
      expect(result.sectionId).toBe('troubleshooting');
    });

    it('should load documentation if not already loaded', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({ relevant: false, reasoning: 'Not relevant' }),
        },
      });

      await analyzer.analyzeMessage(mockMessage as any);

      expect(storage.getDocumentationSections).toHaveBeenCalled();
    });

    it('should use cached result if available', async () => {
      const cachedResult: AnalysisResult = {
        relevant: true,
        reasoning: 'Cached reasoning',
      };

      vi.mocked(llmCache.get).mockReturnValue({
        response: JSON.stringify(cachedResult),
        model: 'gemini-2.5-flash',
        createdAt: new Date(),
      });

      const result = await analyzer.analyzeMessage(mockMessage as any);

      expect(result.relevant).toBe(true);
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('should regenerate if cached result is invalid JSON', async () => {
      vi.mocked(llmCache.get).mockReturnValue({
        response: 'invalid-json',
        model: 'gemini-2.5-flash',
        createdAt: new Date(),
      });

      const freshResult: AnalysisResult = {
        relevant: false,
        reasoning: 'Fresh analysis',
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(freshResult),
        },
      });

      const result = await analyzer.analyzeMessage(mockMessage as any);

      expect(mockGenerateContent).toHaveBeenCalled();
      expect(result.reasoning).toBe('Fresh analysis');
    });

    it('should cache new analysis results', async () => {
      const analysisResult: AnalysisResult = {
        relevant: true,
        reasoning: 'New analysis',
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(analysisResult),
        },
      });

      await analyzer.analyzeMessage(mockMessage as any);

      expect(llmCache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('relevant'),
        'analysis',
        expect.objectContaining({ model: 'gemini-2.5-flash' })
      );
    });

    it('should throw error on empty Gemini response', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => '',
        },
      });

      await expect(analyzer.analyzeMessage(mockMessage as any)).rejects.toThrow(
        'Empty response from Gemini'
      );
    });

    it('should throw error on Gemini API failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API rate limit'));

      await expect(analyzer.analyzeMessage(mockMessage as any)).rejects.toThrow(
        'Failed to analyze message: API rate limit'
      );
    });
  });

  describe('analyzeUnanalyzedMessages', () => {
    it('should analyze multiple messages and return stats', async () => {
      const messages = [mockMessage, { ...mockMessage, id: 2, messageId: 'msg-456' }];
      vi.mocked(storage.getUnanalyzedMessages).mockResolvedValue(messages as any);

      const analysisResult: AnalysisResult = {
        relevant: true,
        updateType: 'minor',
        sectionId: 'troubleshooting',
        summary: 'Fix description',
        suggestedContent: 'New content',
        reasoning: 'Useful info',
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(analysisResult),
        },
      });

      vi.mocked(storage.createPendingUpdate).mockResolvedValue({ id: 1 } as any);

      const result = await analyzer.analyzeUnanalyzedMessages(10);

      expect(result.analyzed).toBe(2);
      expect(storage.markMessageAsAnalyzed).toHaveBeenCalledTimes(2);
    });

    it('should respect limit parameter', async () => {
      const messages = [
        mockMessage,
        { ...mockMessage, id: 2 },
        { ...mockMessage, id: 3 },
        { ...mockMessage, id: 4 },
        { ...mockMessage, id: 5 },
      ];
      vi.mocked(storage.getUnanalyzedMessages).mockResolvedValue(messages as any);

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({ relevant: false, reasoning: 'Not relevant' }),
        },
      });

      const result = await analyzer.analyzeUnanalyzedMessages(3);

      expect(result.analyzed).toBe(3);
    });

    it('should handle "add" update type', async () => {
      vi.mocked(storage.getUnanalyzedMessages).mockResolvedValue([mockMessage] as any);

      const analysisResult: AnalysisResult = {
        relevant: true,
        updateType: 'add',
        summary: 'Add new section about errors',
        suggestedContent: 'New section content',
        reasoning: 'Missing documentation',
        proposedSectionTitle: 'Error Handling',
        proposedSectionLevel: 2,
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(analysisResult),
        },
      });

      vi.mocked(storage.createPendingUpdate).mockResolvedValue({ id: 1 } as any);

      const result = await analyzer.analyzeUnanalyzedMessages();

      expect(storage.createPendingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'add',
          sectionId: 'error-handling',
        })
      );
      expect(result.updatesCreated).toBe(1);
    });

    it('should skip "add" without title or content', async () => {
      vi.mocked(storage.getUnanalyzedMessages).mockResolvedValue([mockMessage] as any);

      const analysisResult: AnalysisResult = {
        relevant: true,
        updateType: 'add',
        summary: 'Add new section',
        reasoning: 'Missing content',
        // Missing proposedSectionTitle and suggestedContent
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(analysisResult),
        },
      });

      const result = await analyzer.analyzeUnanalyzedMessages();

      expect(storage.createPendingUpdate).not.toHaveBeenCalled();
      expect(result.updatesCreated).toBe(0);
    });

    it('should handle "delete" update type', async () => {
      vi.mocked(storage.getUnanalyzedMessages).mockResolvedValue([mockMessage] as any);

      const analysisResult: AnalysisResult = {
        relevant: true,
        updateType: 'delete',
        sectionId: 'troubleshooting',
        summary: 'Remove outdated section',
        reasoning: 'Section is outdated',
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(analysisResult),
        },
      });

      vi.mocked(storage.createPendingUpdate).mockResolvedValue({ id: 1 } as any);

      await analyzer.analyzeUnanalyzedMessages();

      expect(storage.createPendingUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'delete',
        })
      );
    });

    it('should skip "delete" for non-existent section', async () => {
      vi.mocked(storage.getUnanalyzedMessages).mockResolvedValue([mockMessage] as any);

      const analysisResult: AnalysisResult = {
        relevant: true,
        updateType: 'delete',
        sectionId: 'nonexistent-section',
        summary: 'Remove section',
        reasoning: 'Section should be removed',
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(analysisResult),
        },
      });

      await analyzer.analyzeUnanalyzedMessages();

      expect(storage.createPendingUpdate).not.toHaveBeenCalled();
    });

    it('should auto-apply minor updates for valid sections', async () => {
      vi.mocked(storage.getUnanalyzedMessages).mockResolvedValue([mockMessage] as any);

      const analysisResult: AnalysisResult = {
        relevant: true,
        updateType: 'minor',
        sectionId: 'troubleshooting',
        summary: 'Minor fix',
        suggestedContent: 'Updated troubleshooting content',
        reasoning: 'Small improvement',
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(analysisResult),
        },
      });

      vi.mocked(storage.createPendingUpdate).mockResolvedValue({ id: 1 } as any);

      await analyzer.analyzeUnanalyzedMessages();

      expect(storage.updateDocumentationSection).toHaveBeenCalledWith(
        'troubleshooting',
        'Updated troubleshooting content'
      );
      expect(storage.createUpdateHistory).toHaveBeenCalledWith({
        updateId: 1,
        action: 'auto_applied',
        performedBy: 'AI Auto-Approval',
      });
    });

    it('should continue processing on individual message error', async () => {
      const messages = [mockMessage, { ...mockMessage, id: 2, messageId: 'msg-456' }];
      vi.mocked(storage.getUnanalyzedMessages).mockResolvedValue(messages as any);

      mockGenerateContent.mockRejectedValueOnce(new Error('API error')).mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({ relevant: false, reasoning: 'Not relevant' }),
        },
      });

      const result = await analyzer.analyzeUnanalyzedMessages();

      // Should still mark the second message as analyzed
      expect(storage.markMessageAsAnalyzed).toHaveBeenCalledTimes(1);
      expect(result.analyzed).toBe(2);
    });
  });

  describe('generateDocumentationAnswer', () => {
    it('should generate answer using Gemini', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Here is the answer to your question.',
        },
      });

      const answer = await analyzer.generateDocumentationAnswer('How do I configure X?');

      expect(answer).toBe('Here is the answer to your question.');
    });

    it('should use cached answer if available', async () => {
      vi.mocked(llmCache.get).mockReturnValue({
        response: 'Cached answer',
        model: 'gemini-2.5-flash',
        createdAt: new Date(),
      });

      const answer = await analyzer.generateDocumentationAnswer('Question?');

      expect(answer).toBe('Cached answer');
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('should cache new answers', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Fresh answer',
        },
      });

      await analyzer.generateDocumentationAnswer('New question?');

      expect(llmCache.set).toHaveBeenCalledWith(
        expect.any(String),
        'Fresh answer',
        'general',
        expect.objectContaining({ model: 'gemini-2.5-flash' })
      );
    });

    it('should throw on empty response', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => '',
        },
      });

      await expect(analyzer.generateDocumentationAnswer('Question?')).rejects.toThrow(
        'Empty response from Gemini'
      );
    });

    it('should throw on API error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Network error'));

      await expect(analyzer.generateDocumentationAnswer('Question?')).rejects.toThrow(
        'Failed to generate answer: Network error'
      );
    });
  });
});

describe('createAnalyzerFromEnv', () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('should return MessageAnalyzer when API key is set', () => {
    process.env.GEMINI_API_KEY = 'test-key';

    const analyzer = createAnalyzerFromEnv();

    expect(analyzer).toBeInstanceOf(MessageAnalyzer);
  });

  it('should return null when API key is not set', () => {
    const analyzer = createAnalyzerFromEnv();

    expect(analyzer).toBeNull();
  });
});
