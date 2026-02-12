/**
 * Proposal Enrichment Types
 *
 * Type definitions for the Context Enrichment pipeline step.
 * These types define the structured analysis data attached to proposals.
 *

 * @created 2026-01-19
 */

/**
 * Related documentation found via RAG
 */
export interface RelatedDoc {
  page: string;
  section: string;
  similarityScore: number; // 0-1
  matchType: 'semantic' | 'keyword' | 'same-section';
  snippet: string;
}

/**
 * Duplication detection result
 */
export interface DuplicationWarning {
  detected: boolean;
  matchingPage?: string;
  matchingSection?: string;
  overlapPercentage?: number;
}

/**
 * Style analysis for a document
 */
export interface StyleMetrics {
  avgSentenceLength: number;
  usesCodeExamples: boolean;
  formatPattern: 'prose' | 'bullets' | 'mixed';
  technicalDepth: 'beginner' | 'intermediate' | 'advanced';
}

/**
 * Style consistency analysis
 */
export interface StyleAnalysis {
  targetPageStyle: StyleMetrics;
  proposalStyle: StyleMetrics;
  consistencyNotes: string[];
}

/**
 * Change impact context
 */
export interface ChangeContext {
  targetSectionCharCount: number;
  proposalCharCount: number;
  changePercentage: number;
  lastUpdated: Date | null;
  otherPendingProposals: number;
}

/**
 * Source conversation analysis
 */
export interface SourceAnalysis {
  messageCount: number;
  uniqueAuthors: number;
  threadHadConsensus: boolean;
  conversationSummary: string;
}

/**
 * Complete enrichment data for a proposal
 */
export interface ProposalEnrichment {
  // Related documentation (from RAG)
  relatedDocs: RelatedDoc[];

  // Duplication detection
  duplicationWarning: DuplicationWarning;

  // Style consistency analysis
  styleAnalysis: StyleAnalysis;

  // Change impact
  changeContext: ChangeContext;

  // Source conversation analysis
  sourceAnalysis: SourceAnalysis;

  // Metadata
  enrichedAt: Date;
  enrichmentVersion: string;
}

/**
 * Create default/empty enrichment data
 */
export function createEmptyEnrichment(): ProposalEnrichment {
  return {
    relatedDocs: [],
    duplicationWarning: {
      detected: false,
    },
    styleAnalysis: {
      targetPageStyle: {
        avgSentenceLength: 0,
        usesCodeExamples: false,
        formatPattern: 'prose',
        technicalDepth: 'intermediate',
      },
      proposalStyle: {
        avgSentenceLength: 0,
        usesCodeExamples: false,
        formatPattern: 'prose',
        technicalDepth: 'intermediate',
      },
      consistencyNotes: [],
    },
    changeContext: {
      targetSectionCharCount: 0,
      proposalCharCount: 0,
      changePercentage: 0,
      lastUpdated: null,
      otherPendingProposals: 0,
    },
    sourceAnalysis: {
      messageCount: 0,
      uniqueAuthors: 0,
      threadHadConsensus: false,
      conversationSummary: '',
    },
    enrichedAt: new Date(),
    enrichmentVersion: '1.0.0',
  };
}

/**
 * Simple text analysis utilities
 */
export const textAnalysis = {
  /**
   * Calculate average sentence length in words
   */
  avgSentenceLength(text: string): number {
    if (!text || text.trim().length === 0) return 0;

    // Split by sentence-ending punctuation
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    if (sentences.length === 0) return 0;

    const totalWords = sentences.reduce((sum, sentence) => {
      const words = sentence
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0);
      return sum + words.length;
    }, 0);

    return Math.round(totalWords / sentences.length);
  },

  /**
   * Check if text contains code examples
   */
  hasCodeExamples(text: string): boolean {
    // Check for markdown code blocks
    if (/```[\s\S]*?```/.test(text)) return true;
    // Check for inline code
    if (/`[^`]+`/.test(text)) return true;
    // Check for common code patterns
    if (/\b(function|const|let|var|import|export|class|def|return)\b/.test(text)) return true;
    return false;
  },

  /**
   * Detect format pattern
   */
  detectFormatPattern(text: string): 'prose' | 'bullets' | 'mixed' {
    const hasBullets = /^[\s]*[-*•]\s/m.test(text);
    const hasNumberedList = /^[\s]*\d+\.\s/m.test(text);
    const hasParagraphs = /\n\n/.test(text);

    if ((hasBullets || hasNumberedList) && hasParagraphs) {
      return 'mixed';
    }
    if (hasBullets || hasNumberedList) {
      return 'bullets';
    }
    return 'prose';
  },

  /**
   * Estimate technical depth based on content
   */
  estimateTechnicalDepth(text: string): 'beginner' | 'intermediate' | 'advanced' {
    const advancedTerms = [
      'algorithm',
      'complexity',
      'optimization',
      'architecture',
      'implementation details',
      'low-level',
      'internals',
      'bytecode',
      'assembly',
      'kernel',
      'syscall',
    ];
    const beginnerTerms = [
      'getting started',
      'introduction',
      'basic',
      'simple',
      'beginner',
      'first steps',
      'tutorial',
      'learn',
    ];

    const lowerText = text.toLowerCase();
    const advancedCount = advancedTerms.filter((term) => lowerText.includes(term)).length;
    const beginnerCount = beginnerTerms.filter((term) => lowerText.includes(term)).length;

    if (advancedCount > 2) return 'advanced';
    if (beginnerCount > 2) return 'beginner';
    return 'intermediate';
  },

  /**
   * Calculate n-gram overlap percentage between two texts
   */
  ngramOverlap(text1: string, text2: string, n: number = 3): number {
    if (!text1 || !text2) return 0;

    const getNgrams = (text: string): Set<string> => {
      const words = text
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 0);
      const ngrams = new Set<string>();
      for (let i = 0; i <= words.length - n; i++) {
        ngrams.add(words.slice(i, i + n).join(' '));
      }
      return ngrams;
    };

    const ngrams1 = getNgrams(text1);
    const ngrams2 = getNgrams(text2);

    if (ngrams1.size === 0 || ngrams2.size === 0) return 0;

    let overlap = 0;
    for (const ngram of ngrams1) {
      if (ngrams2.has(ngram)) overlap++;
    }

    return Math.round((overlap / Math.min(ngrams1.size, ngrams2.size)) * 100);
  },
};
