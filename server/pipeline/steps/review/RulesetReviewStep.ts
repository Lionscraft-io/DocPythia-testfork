/**
 * Ruleset Review Step
 *
 * Applies tenant ruleset to proposals after enrichment.
 * Evaluates rejection rules, applies modifications, and adds quality flags.
 *
 * Pipeline position: After ContextEnrichmentStep, before saving proposals
 *

 * @created 2026-01-19
 */

import { z } from 'zod';
import { BasePipelineStep } from '../base/BasePipelineStep.js';
import {
  StepType,
  type StepConfig,
  type StepMetadata,
  type PipelineContext,
  type Proposal,
  type ILLMHandler,
} from '../../core/interfaces.js';
import {
  parseRuleset,
  createEmptyRuleset,
  hasRules,
  type ParsedRuleset,
  type RulesetApplicationResult,
  type QualityFlag,
} from '../../types/ruleset.js';
import type { ProposalEnrichment } from '../../types/enrichment.js';

/**
 * Configuration for RulesetReviewStep
 */
interface RulesetReviewConfig {
  /** Enable rejection rule processing */
  enableRejection?: boolean;
  /** Enable modification processing */
  enableModifications?: boolean;
  /** Enable quality gate flagging */
  enableQualityGates?: boolean;
  /** Model to use for modifications */
  modificationModel?: string;
  /** Max tokens for modification responses */
  maxModificationTokens?: number;
}

/**
 * Extended proposal with enrichment and review data
 */
interface ReviewableProposal extends Proposal {
  enrichment?: ProposalEnrichment;
  reviewResult?: RulesetApplicationResult;
  qualityFlags?: QualityFlag[];
}

/**
 * Schema for LLM modification response
 */
const modificationResponseSchema = z.object({
  modified: z.boolean(),
  content: z.string(),
  modificationsApplied: z.array(z.string()),
});

/**
 * Applies tenant ruleset to proposals
 */
export class RulesetReviewStep extends BasePipelineStep {
  readonly stepType = StepType.RULESET_REVIEW;

  private enableRejection: boolean;
  private enableModifications: boolean;
  private enableQualityGates: boolean;
  private modificationModel: string;
  private maxModificationTokens: number;

  constructor(config: StepConfig, llmHandler: ILLMHandler) {
    super(config, llmHandler);

    const reviewConfig = config.config as RulesetReviewConfig;
    this.enableRejection = reviewConfig.enableRejection ?? true;
    this.enableModifications = reviewConfig.enableModifications ?? true;
    this.enableQualityGates = reviewConfig.enableQualityGates ?? true;
    this.modificationModel = reviewConfig.modificationModel ?? 'gemini-1.5-flash';
    this.maxModificationTokens = reviewConfig.maxModificationTokens ?? 4096;
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();

    // Load tenant ruleset
    const ruleset = await this.loadRuleset(context);

    if (!hasRules(ruleset)) {
      this.logger.info('No ruleset rules defined, skipping ruleset review');
      this.recordTiming(context, startTime);
      return context;
    }

    // Count total proposals
    let totalProposals = 0;
    let rejectedCount = 0;
    let modifiedCount = 0;
    let flaggedCount = 0;

    for (const proposals of context.proposals.values()) {
      totalProposals += proposals.length;
    }

    if (totalProposals === 0) {
      this.logger.info('No proposals to review');
      this.recordTiming(context, startTime);
      return context;
    }

    this.logger.info(`Applying ruleset to ${totalProposals} proposals`, {
      rejectionRules: ruleset.rejectionRules.length,
      modificationRules: ruleset.reviewModifications.length,
      qualityGates: ruleset.qualityGates.length,
    });

    // Process each proposal
    for (const [threadId, proposals] of context.proposals.entries()) {
      const reviewedProposals: Proposal[] = [];

      for (const proposal of proposals) {
        const reviewable = proposal as ReviewableProposal;

        try {
          const result = await this.applyRuleset(ruleset, reviewable, context);

          // Store review result
          reviewable.reviewResult = result;

          if (result.rejected) {
            rejectedCount++;
            this.logger.debug(`Proposal rejected: ${result.rejectionReason}`, {
              page: proposal.page,
              rule: result.rejectionRule,
            });
            // Skip rejected proposals (don't add to reviewedProposals)
            continue;
          }

          if (result.modificationsApplied.length > 0) {
            modifiedCount++;
            // Update the proposal content if modified
            if (result.modifiedContent) {
              proposal.suggestedText = result.modifiedContent;
            }
          }

          if (result.qualityFlags.length > 0) {
            flaggedCount++;
            reviewable.qualityFlags = result.qualityFlags.map((flag) => ({
              rule: flag,
              reason: flag,
              severity: 'warning' as const,
            }));
          }

          reviewedProposals.push(proposal);
        } catch (error) {
          this.logger.error(`Failed to apply ruleset to proposal for ${proposal.page}:`, error);
          // Keep the proposal on error
          reviewedProposals.push(proposal);
        }
      }

      // Update the proposals map with reviewed (non-rejected) proposals
      context.proposals.set(threadId, reviewedProposals);
    }

    this.recordTiming(context, startTime);

    this.logger.info('Ruleset review complete', {
      totalProposals,
      rejected: rejectedCount,
      modified: modifiedCount,
      flagged: flaggedCount,
    });

    return context;
  }

  /**
   * Load the tenant's ruleset from the database
   */
  private async loadRuleset(context: PipelineContext): Promise<ParsedRuleset> {
    try {
      const ruleset = await context.db.tenantRuleset.findFirst({
        where: {
          tenantId: context.instanceId,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      if (!ruleset || !ruleset.content) {
        this.logger.debug('No tenant ruleset found');
        return createEmptyRuleset();
      }

      return parseRuleset(ruleset.content);
    } catch (error) {
      this.logger.warn('Failed to load tenant ruleset:', error);
      return createEmptyRuleset();
    }
  }

  /**
   * Apply ruleset to a single proposal
   */
  private async applyRuleset(
    ruleset: ParsedRuleset,
    proposal: ReviewableProposal,
    context: PipelineContext
  ): Promise<RulesetApplicationResult> {
    const result: RulesetApplicationResult = {
      rejected: false,
      modificationsApplied: [],
      qualityFlags: [],
      originalContent: proposal.suggestedText,
    };

    const enrichment = proposal.enrichment;

    // 1. Check rejection rules
    if (this.enableRejection && ruleset.rejectionRules.length > 0) {
      const rejection = this.evaluateRejectionRules(ruleset.rejectionRules, proposal, enrichment);
      if (rejection) {
        result.rejected = true;
        result.rejectionReason = rejection.reason;
        result.rejectionRule = rejection.rule;
        return result;
      }
    }

    // 2. Apply modifications
    if (
      this.enableModifications &&
      ruleset.reviewModifications.length > 0 &&
      proposal.suggestedText
    ) {
      const modification = await this.applyModifications(
        ruleset.reviewModifications,
        proposal,
        enrichment,
        context
      );
      if (modification.modified) {
        result.modifiedContent = modification.content;
        result.modificationsApplied = modification.modificationsApplied;
      }
    }

    // 3. Check quality gates
    if (this.enableQualityGates && ruleset.qualityGates.length > 0) {
      result.qualityFlags = this.evaluateQualityGates(ruleset.qualityGates, proposal, enrichment);
    }

    return result;
  }

  /**
   * Evaluate rejection rules against proposal and enrichment data
   */
  private evaluateRejectionRules(
    rules: string[],
    proposal: ReviewableProposal,
    enrichment?: ProposalEnrichment
  ): { rule: string; reason: string } | null {
    for (const rule of rules) {
      const ruleLower = rule.toLowerCase();

      // Check duplication-based rules
      if (enrichment?.duplicationWarning) {
        if (ruleLower.includes('duplicationwarning') && ruleLower.includes('overlappercentage')) {
          // Extract threshold from rule like "overlapPercentage > 80%"
          const thresholdMatch = rule.match(/>\s*(\d+)/);
          const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 80;

          if (
            enrichment.duplicationWarning.detected &&
            (enrichment.duplicationWarning.overlapPercentage || 0) > threshold
          ) {
            return {
              rule,
              reason: `Duplicate content detected: ${enrichment.duplicationWarning.overlapPercentage}% overlap with ${enrichment.duplicationWarning.matchingPage}`,
            };
          }
        }
      }

      // Check similarity-based rules
      if (enrichment?.relatedDocs && ruleLower.includes('similarityscore')) {
        const thresholdMatch = rule.match(/>\s*(\d*\.?\d+)/);
        const threshold = thresholdMatch ? parseFloat(thresholdMatch[1]) : 0.85;

        for (const doc of enrichment.relatedDocs) {
          if (doc.similarityScore > threshold) {
            return {
              rule,
              reason: `High similarity with existing doc: ${Math.round(doc.similarityScore * 100)}% match with ${doc.page}`,
            };
          }
        }
      }

      // Check for specific content patterns mentioned in rule
      if (proposal.suggestedText) {
        // Simple pattern check: "Proposals mentioning X"
        if (ruleLower.includes('proposals mentioning') || ruleLower.includes('containing')) {
          // Extract the pattern to check for
          const patternMatch = rule.match(/(?:mentioning|containing)\s+["']?([^"']+)["']?/i);
          if (patternMatch) {
            const pattern = patternMatch[1].trim();
            if (proposal.suggestedText.toLowerCase().includes(pattern.toLowerCase())) {
              return {
                rule,
                reason: `Content matches rejection pattern: "${pattern}"`,
              };
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Apply LLM-based modifications to proposal
   */
  private async applyModifications(
    rules: string[],
    proposal: ReviewableProposal,
    enrichment: ProposalEnrichment | undefined,
    context: PipelineContext
  ): Promise<{ modified: boolean; content: string; modificationsApplied: string[] }> {
    if (!proposal.suggestedText || rules.length === 0) {
      return { modified: false, content: proposal.suggestedText || '', modificationsApplied: [] };
    }

    const llmHandler = this.requireLLMHandler();

    // Build context for LLM
    const enrichmentContext = enrichment
      ? `
Enrichment Analysis:
- Related docs found: ${enrichment.relatedDocs.length}
- Duplication warning: ${enrichment.duplicationWarning.detected ? `Yes (${enrichment.duplicationWarning.overlapPercentage}% overlap)` : 'No'}
- Style analysis:
  - Target page format: ${enrichment.styleAnalysis.targetPageStyle.formatPattern}
  - Proposal format: ${enrichment.styleAnalysis.proposalStyle.formatPattern}
  - Target avg sentence length: ${enrichment.styleAnalysis.targetPageStyle.avgSentenceLength} words
  - Proposal avg sentence length: ${enrichment.styleAnalysis.proposalStyle.avgSentenceLength} words
  - Target technical depth: ${enrichment.styleAnalysis.targetPageStyle.technicalDepth}
  - Proposal technical depth: ${enrichment.styleAnalysis.proposalStyle.technicalDepth}
  - Consistency notes: ${enrichment.styleAnalysis.consistencyNotes.join('; ') || 'None'}
- Change impact: ${enrichment.changeContext.changePercentage}% change
`
      : 'No enrichment data available.';

    const systemPrompt = `You are a technical documentation editor. Apply the following modification rules to improve the proposal content.

Modification Rules:
${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

${enrichmentContext}

Guidelines:
- Only make modifications that align with the rules
- Preserve the core meaning and information
- If no modifications are needed, return the original content unchanged
- Return valid JSON with modified content`;

    const userPrompt = `Apply the modification rules to this proposal content:

Target Page: ${proposal.page}
${proposal.section ? `Section: ${proposal.section}` : ''}

Current Content:
${proposal.suggestedText}

Return JSON with:
- modified: boolean (true if any changes made)
- content: the modified content (or original if no changes)
- modificationsApplied: array of rule descriptions that were applied`;

    try {
      const { data } = await llmHandler.requestJSON(
        {
          model: this.modificationModel,
          systemPrompt,
          userPrompt,
          temperature: 0.3,
          maxTokens: this.maxModificationTokens,
        },
        modificationResponseSchema,
        {
          instanceId: context.instanceId,
          batchId: context.batchId,
          purpose: 'ruleset-modification',
        }
      );

      context.metrics.llmCalls++;

      return {
        modified: data.modified,
        content: data.content,
        modificationsApplied: data.modificationsApplied,
      };
    } catch (error) {
      this.logger.warn('Failed to apply modifications via LLM:', error);
      return { modified: false, content: proposal.suggestedText, modificationsApplied: [] };
    }
  }

  /**
   * Evaluate quality gates and return flags
   */
  private evaluateQualityGates(
    gates: string[],
    proposal: ReviewableProposal,
    enrichment?: ProposalEnrichment
  ): string[] {
    const flags: string[] = [];

    for (const gate of gates) {
      const gateLower = gate.toLowerCase();

      // Check style consistency notes
      if (
        enrichment?.styleAnalysis &&
        gateLower.includes('consistencynotes') &&
        (gateLower.includes('not empty') || gateLower.includes('is not empty'))
      ) {
        if (enrichment.styleAnalysis.consistencyNotes.length > 0) {
          flags.push(`Style review: ${enrichment.styleAnalysis.consistencyNotes.join(', ')}`);
        }
      }

      // Check change percentage
      if (enrichment?.changeContext && gateLower.includes('changepercentage')) {
        const thresholdMatch = gate.match(/>\s*(\d+)/);
        const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 50;

        if (enrichment.changeContext.changePercentage > threshold) {
          flags.push(
            `Significant change: ${enrichment.changeContext.changePercentage}% modification`
          );
        }
      }

      // Check for other pending proposals
      if (
        enrichment?.changeContext &&
        gateLower.includes('otherpendingproposals') &&
        gateLower.includes('> 0')
      ) {
        if (enrichment.changeContext.otherPendingProposals > 0) {
          flags.push(
            `Coordination needed: ${enrichment.changeContext.otherPendingProposals} other pending proposals`
          );
        }
      }

      // Check message count (evidence requirement)
      if (enrichment?.sourceAnalysis && gateLower.includes('messagecount')) {
        const thresholdMatch = gate.match(/<\s*(\d+)/);
        if (thresholdMatch) {
          const threshold = parseInt(thresholdMatch[1], 10);
          if (enrichment.sourceAnalysis.messageCount < threshold) {
            flags.push(`Limited evidence: only ${enrichment.sourceAnalysis.messageCount} messages`);
          }
        }
      }

      // Check technical depth mismatch
      if (
        enrichment?.styleAnalysis &&
        gateLower.includes('technicaldepth') &&
        gateLower.includes('mismatch')
      ) {
        if (
          enrichment.styleAnalysis.targetPageStyle.technicalDepth !==
          enrichment.styleAnalysis.proposalStyle.technicalDepth
        ) {
          flags.push(
            `Technical depth mismatch: target is ${enrichment.styleAnalysis.targetPageStyle.technicalDepth}, proposal is ${enrichment.styleAnalysis.proposalStyle.technicalDepth}`
          );
        }
      }
    }

    return flags;
  }

  validateConfig(config: StepConfig): boolean {
    if (!super.validateConfig(config)) {
      return false;
    }

    // Validate model if specified
    const reviewConfig = config.config as RulesetReviewConfig;
    if (reviewConfig.maxModificationTokens !== undefined) {
      if (
        typeof reviewConfig.maxModificationTokens !== 'number' ||
        reviewConfig.maxModificationTokens < 100
      ) {
        this.logger.error('maxModificationTokens must be at least 100');
        return false;
      }
    }

    return true;
  }

  getMetadata(): StepMetadata {
    return {
      name: 'Ruleset Review',
      description:
        'Applies tenant ruleset rules to proposals for rejection, modification, and flagging',
      version: '1.0.0',
      author: 'system',
    };
  }
}

/**
 * Factory function for RulesetReviewStep
 */
export function createRulesetReviewStep(
  config: StepConfig,
  llmHandler: ILLMHandler
): RulesetReviewStep {
  return new RulesetReviewStep(config, llmHandler);
}
