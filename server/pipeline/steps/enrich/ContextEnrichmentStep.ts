/**
 * Context Enrichment Step
 *
 * Analyzes proposals after generation to provide structured context data.
 * This data helps reviewers make informed decisions and enables ruleset rules.
 *
 * Pipeline position: After ProposalGenerateStep, before RulesetReviewStep
 *

 * @created 2026-01-19
 */

import { BasePipelineStep } from '../base/BasePipelineStep.js';
import {
  StepType,
  type StepConfig,
  type StepMetadata,
  type PipelineContext,
  type Proposal,
  type RagDocument,
} from '../../core/interfaces.js';
import {
  type ProposalEnrichment,
  type RelatedDoc,
  type StyleMetrics,
  createEmptyEnrichment,
  textAnalysis,
} from '../../types/enrichment.js';

/**
 * Configuration for ContextEnrichmentStep
 */
interface ContextEnrichmentConfig {
  /** Minimum similarity score to consider a doc related (0-1) */
  minSimilarityScore?: number;
  /** Maximum related docs to include per proposal */
  maxRelatedDocs?: number;
  /** Enable duplication detection */
  enableDuplicationCheck?: boolean;
  /** N-gram size for overlap calculation */
  ngramSize?: number;
  /** Overlap percentage threshold for duplication warning */
  duplicationThreshold?: number;
}

/**
 * Extended proposal with enrichment data
 */
interface EnrichedProposal extends Proposal {
  enrichment?: ProposalEnrichment;
}

/**
 * Enriches proposals with context analysis
 */
export class ContextEnrichmentStep extends BasePipelineStep {
  readonly stepType = StepType.CONTEXT_ENRICH;

  private minSimilarityScore: number;
  private maxRelatedDocs: number;
  private enableDuplicationCheck: boolean;
  private ngramSize: number;
  private duplicationThreshold: number;

  constructor(config: StepConfig) {
    super(config);

    const enrichConfig = config.config as ContextEnrichmentConfig;
    this.minSimilarityScore = enrichConfig.minSimilarityScore ?? 0.6;
    this.maxRelatedDocs = enrichConfig.maxRelatedDocs ?? 5;
    this.enableDuplicationCheck = enrichConfig.enableDuplicationCheck ?? true;
    this.ngramSize = enrichConfig.ngramSize ?? 3;
    this.duplicationThreshold = enrichConfig.duplicationThreshold ?? 50;
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();

    // Count total proposals
    let totalProposals = 0;
    for (const proposals of context.proposals.values()) {
      totalProposals += proposals.length;
    }

    if (totalProposals === 0) {
      this.logger.info('No proposals to enrich');
      this.recordTiming(context, startTime);
      return context;
    }

    this.logger.info(`Enriching ${totalProposals} proposals with context analysis`);

    // Get all existing docs for duplication check
    const allRagDocs: RagDocument[] = [];
    for (const docs of context.ragResults.values()) {
      allRagDocs.push(...docs);
    }

    // Get pending proposal count for this instance
    const pendingProposalCount = await this.getPendingProposalCount(context);

    // Enrich each proposal
    for (const [threadId, proposals] of context.proposals.entries()) {
      const thread = context.threads.find((t) => t.id === threadId);
      const threadMessages = thread
        ? context.messages.filter((m) => thread.messageIds.includes(m.id))
        : [];
      const ragDocs = context.ragResults.get(threadId) || [];

      for (const proposal of proposals) {
        try {
          const enrichment = await this.enrichProposal(
            proposal,
            ragDocs,
            allRagDocs,
            threadMessages,
            pendingProposalCount
          );

          // Attach enrichment to proposal
          (proposal as EnrichedProposal).enrichment = enrichment;

          this.logger.debug(`Enriched proposal for ${proposal.page}`, {
            relatedDocs: enrichment.relatedDocs.length,
            duplicationDetected: enrichment.duplicationWarning.detected,
            consistencyNotes: enrichment.styleAnalysis.consistencyNotes.length,
          });
        } catch (error) {
          this.logger.error(`Failed to enrich proposal for ${proposal.page}:`, error);
          // Attach empty enrichment on error
          (proposal as EnrichedProposal).enrichment = createEmptyEnrichment();
        }
      }
    }

    this.recordTiming(context, startTime);

    this.logger.info(`Context enrichment complete: ${totalProposals} proposals enriched`);

    return context;
  }

  /**
   * Enrich a single proposal with context analysis
   */
  private async enrichProposal(
    proposal: Proposal,
    threadRagDocs: RagDocument[],
    allRagDocs: RagDocument[],
    threadMessages: { author: string; content: string }[],
    pendingProposalCount: number
  ): Promise<ProposalEnrichment> {
    const enrichment = createEmptyEnrichment();

    // 1. Find related documentation
    enrichment.relatedDocs = this.findRelatedDocs(proposal, threadRagDocs, allRagDocs);

    // 2. Check for duplication
    if (this.enableDuplicationCheck && proposal.suggestedText) {
      enrichment.duplicationWarning = this.checkDuplication(proposal, allRagDocs);
    }

    // 3. Analyze style consistency
    enrichment.styleAnalysis = this.analyzeStyle(proposal, threadRagDocs);

    // 4. Calculate change context
    enrichment.changeContext = this.calculateChangeContext(
      proposal,
      threadRagDocs,
      pendingProposalCount
    );

    // 5. Analyze source conversation
    enrichment.sourceAnalysis = this.analyzeSourceConversation(threadMessages);

    return enrichment;
  }

  /**
   * Find related documentation for a proposal
   */
  private findRelatedDocs(
    proposal: Proposal,
    threadRagDocs: RagDocument[],
    allRagDocs: RagDocument[]
  ): RelatedDoc[] {
    const relatedDocs: RelatedDoc[] = [];
    const seenPages = new Set<string>();

    // First, add same-section matches from thread RAG results
    for (const doc of threadRagDocs) {
      if (doc.similarity >= this.minSimilarityScore && !seenPages.has(doc.filePath)) {
        const matchType =
          doc.filePath === proposal.page
            ? 'same-section'
            : doc.similarity >= 0.8
              ? 'semantic'
              : 'keyword';

        relatedDocs.push({
          page: doc.filePath,
          section: doc.title,
          similarityScore: doc.similarity,
          matchType,
          snippet: doc.content.slice(0, 200) + (doc.content.length > 200 ? '...' : ''),
        });
        seenPages.add(doc.filePath);
      }
    }

    // Then add any high-similarity matches from all RAG docs
    for (const doc of allRagDocs) {
      if (
        doc.similarity >= this.minSimilarityScore &&
        !seenPages.has(doc.filePath) &&
        relatedDocs.length < this.maxRelatedDocs
      ) {
        relatedDocs.push({
          page: doc.filePath,
          section: doc.title,
          similarityScore: doc.similarity,
          matchType: 'semantic',
          snippet: doc.content.slice(0, 200) + (doc.content.length > 200 ? '...' : ''),
        });
        seenPages.add(doc.filePath);
      }
    }

    // Sort by similarity and limit
    return relatedDocs
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, this.maxRelatedDocs);
  }

  /**
   * Check for duplication with existing documentation
   */
  private checkDuplication(
    proposal: Proposal,
    ragDocs: RagDocument[]
  ): ProposalEnrichment['duplicationWarning'] {
    if (!proposal.suggestedText) {
      return { detected: false };
    }

    let maxOverlap = 0;
    let matchingPage: string | undefined;
    let matchingSection: string | undefined;

    for (const doc of ragDocs) {
      const overlap = textAnalysis.ngramOverlap(
        proposal.suggestedText,
        doc.content,
        this.ngramSize
      );

      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        matchingPage = doc.filePath;
        matchingSection = doc.title;
      }
    }

    return {
      detected: maxOverlap >= this.duplicationThreshold,
      matchingPage: maxOverlap >= this.duplicationThreshold ? matchingPage : undefined,
      matchingSection: maxOverlap >= this.duplicationThreshold ? matchingSection : undefined,
      overlapPercentage: maxOverlap,
    };
  }

  /**
   * Analyze style consistency between proposal and target page
   */
  private analyzeStyle(
    proposal: Proposal,
    ragDocs: RagDocument[]
  ): ProposalEnrichment['styleAnalysis'] {
    // Find the target page content
    const targetDoc = ragDocs.find((d) => d.filePath === proposal.page);
    const targetContent = targetDoc?.content || '';

    // Analyze target page style
    const targetPageStyle: StyleMetrics = {
      avgSentenceLength: textAnalysis.avgSentenceLength(targetContent),
      usesCodeExamples: textAnalysis.hasCodeExamples(targetContent),
      formatPattern: textAnalysis.detectFormatPattern(targetContent),
      technicalDepth: textAnalysis.estimateTechnicalDepth(targetContent),
    };

    // Analyze proposal style
    const proposalContent = proposal.suggestedText || '';
    const proposalStyle: StyleMetrics = {
      avgSentenceLength: textAnalysis.avgSentenceLength(proposalContent),
      usesCodeExamples: textAnalysis.hasCodeExamples(proposalContent),
      formatPattern: textAnalysis.detectFormatPattern(proposalContent),
      technicalDepth: textAnalysis.estimateTechnicalDepth(proposalContent),
    };

    // Generate consistency notes
    const consistencyNotes: string[] = [];

    if (targetContent) {
      // Check format consistency
      if (targetPageStyle.formatPattern !== proposalStyle.formatPattern) {
        consistencyNotes.push(
          `Format mismatch: target uses ${targetPageStyle.formatPattern}, proposal uses ${proposalStyle.formatPattern}`
        );
      }

      // Check technical depth consistency
      if (targetPageStyle.technicalDepth !== proposalStyle.technicalDepth) {
        consistencyNotes.push(
          `Technical depth mismatch: target is ${targetPageStyle.technicalDepth}, proposal is ${proposalStyle.technicalDepth}`
        );
      }

      // Check code example consistency
      if (targetPageStyle.usesCodeExamples && !proposalStyle.usesCodeExamples) {
        consistencyNotes.push('Target page uses code examples but proposal does not');
      }

      // Check sentence length consistency (50% difference threshold)
      if (
        targetPageStyle.avgSentenceLength > 0 &&
        Math.abs(targetPageStyle.avgSentenceLength - proposalStyle.avgSentenceLength) /
          targetPageStyle.avgSentenceLength >
          0.5
      ) {
        consistencyNotes.push(
          `Sentence length differs significantly: target avg ${targetPageStyle.avgSentenceLength} words, proposal avg ${proposalStyle.avgSentenceLength} words`
        );
      }
    }

    return {
      targetPageStyle,
      proposalStyle,
      consistencyNotes,
    };
  }

  /**
   * Calculate change impact context
   */
  private calculateChangeContext(
    proposal: Proposal,
    ragDocs: RagDocument[],
    pendingProposalCount: number
  ): ProposalEnrichment['changeContext'] {
    // Find the target section
    const targetDoc = ragDocs.find((d) => d.filePath === proposal.page);
    const targetContent = targetDoc?.content || '';
    const proposalContent = proposal.suggestedText || '';

    const targetCharCount = targetContent.length;
    const proposalCharCount = proposalContent.length;

    // Calculate change percentage
    let changePercentage = 0;
    if (proposal.updateType === 'INSERT') {
      // For inserts, change is 100% new
      changePercentage = 100;
    } else if (proposal.updateType === 'DELETE') {
      // For deletes, change is 100% removal
      changePercentage = 100;
    } else if (targetCharCount > 0) {
      // For updates, calculate relative change
      const diff = Math.abs(targetCharCount - proposalCharCount);
      changePercentage = Math.round((diff / targetCharCount) * 100);
    }

    return {
      targetSectionCharCount: targetCharCount,
      proposalCharCount: proposalCharCount,
      changePercentage: Math.min(changePercentage, 100),
      lastUpdated: null, // Would need to query doc metadata
      otherPendingProposals: pendingProposalCount,
    };
  }

  /**
   * Analyze the source conversation
   */
  private analyzeSourceConversation(
    messages: { author: string; content: string }[]
  ): ProposalEnrichment['sourceAnalysis'] {
    if (messages.length === 0) {
      return {
        messageCount: 0,
        uniqueAuthors: 0,
        threadHadConsensus: false,
        conversationSummary: '',
      };
    }

    const uniqueAuthors = new Set(messages.map((m) => m.author)).size;

    // Simple consensus heuristic: multiple authors agreeing
    // This is a placeholder - a real implementation might use sentiment analysis
    const threadHadConsensus = uniqueAuthors >= 2 && messages.length >= 3;

    // Generate a brief summary from message contents
    const allContent = messages.map((m) => m.content).join(' ');
    const conversationSummary =
      allContent.length > 200
        ? allContent.slice(0, 200) + '...'
        : allContent || 'No conversation content';

    return {
      messageCount: messages.length,
      uniqueAuthors,
      threadHadConsensus,
      conversationSummary,
    };
  }

  /**
   * Get count of pending proposals for the instance
   */
  private async getPendingProposalCount(context: PipelineContext): Promise<number> {
    try {
      const count = await context.db.docProposal.count({
        where: {
          status: 'pending',
        },
      });
      return count;
    } catch {
      this.logger.warn('Could not fetch pending proposal count');
      return 0;
    }
  }

  validateConfig(config: StepConfig): boolean {
    if (!super.validateConfig(config)) {
      return false;
    }

    const enrichConfig = config.config as ContextEnrichmentConfig;

    // Validate minSimilarityScore
    if (enrichConfig.minSimilarityScore !== undefined) {
      if (
        typeof enrichConfig.minSimilarityScore !== 'number' ||
        enrichConfig.minSimilarityScore < 0 ||
        enrichConfig.minSimilarityScore > 1
      ) {
        this.logger.error('minSimilarityScore must be between 0 and 1');
        return false;
      }
    }

    // Validate maxRelatedDocs
    if (enrichConfig.maxRelatedDocs !== undefined) {
      if (typeof enrichConfig.maxRelatedDocs !== 'number' || enrichConfig.maxRelatedDocs < 1) {
        this.logger.error('maxRelatedDocs must be a positive number');
        return false;
      }
    }

    // Validate duplicationThreshold
    if (enrichConfig.duplicationThreshold !== undefined) {
      if (
        typeof enrichConfig.duplicationThreshold !== 'number' ||
        enrichConfig.duplicationThreshold < 0 ||
        enrichConfig.duplicationThreshold > 100
      ) {
        this.logger.error('duplicationThreshold must be between 0 and 100');
        return false;
      }
    }

    return true;
  }

  getMetadata(): StepMetadata {
    return {
      name: 'Context Enrichment',
      description: 'Analyzes proposals to provide context for review and ruleset evaluation',
      version: '1.0.0',
      author: 'system',
    };
  }
}

/**
 * Factory function for ContextEnrichmentStep
 */
export function createContextEnrichmentStep(config: StepConfig): ContextEnrichmentStep {
  return new ContextEnrichmentStep(config);
}
