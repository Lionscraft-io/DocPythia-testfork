/**
 * Ruleset Types and Parser
 *
 * Types and utilities for parsing tenant rulesets.
 * Rulesets use convention-based markdown with action-based sections.
 *

 * @created 2026-01-19
 */

/**
 * Parsed ruleset structure
 */
export interface ParsedRuleset {
  /** Context injected into generation prompts */
  promptContext: string[];
  /** Rules for modifying proposals after enrichment */
  reviewModifications: string[];
  /** Rules for auto-rejecting proposals */
  rejectionRules: string[];
  /** Rules for flagging proposals for review */
  qualityGates: string[];
  /** Raw markdown content */
  rawContent: string;
}

/**
 * Result of applying a ruleset to a proposal
 */
export interface RulesetApplicationResult {
  /** Whether the proposal was rejected */
  rejected: boolean;
  /** Reason for rejection (if rejected) */
  rejectionReason?: string;
  /** Which rejection rule triggered */
  rejectionRule?: string;
  /** Modifications applied to the proposal */
  modificationsApplied: string[];
  /** Quality flags added */
  qualityFlags: string[];
  /** Original content before modifications */
  originalContent?: string;
  /** Modified content (if any modifications applied) */
  modifiedContent?: string;
}

/**
 * Quality flag added to a proposal
 */
export interface QualityFlag {
  rule: string;
  reason: string;
  severity: 'info' | 'warning' | 'critical';
}

/**
 * Parse ruleset markdown into structured sections
 */
export function parseRuleset(markdown: string): ParsedRuleset {
  const result: ParsedRuleset = {
    promptContext: [],
    reviewModifications: [],
    rejectionRules: [],
    qualityGates: [],
    rawContent: markdown,
  };

  if (!markdown || typeof markdown !== 'string') {
    return result;
  }

  // Split by H2 headers to find sections
  const sections = markdown.split(/^## /m);

  for (const section of sections) {
    if (!section.trim()) continue;

    const lines = section.split('\n');
    const header = lines[0]?.trim().toUpperCase() || '';
    const content = lines.slice(1).join('\n');

    // Extract bullet points from the section
    const rules = extractRules(content);

    if (header.includes('PROMPT_CONTEXT') || header.includes('PROMPT CONTEXT')) {
      result.promptContext = rules;
    } else if (header.includes('REVIEW_MODIFICATIONS') || header.includes('REVIEW MODIFICATIONS')) {
      result.reviewModifications = rules;
    } else if (header.includes('REJECTION_RULES') || header.includes('REJECTION RULES')) {
      result.rejectionRules = rules;
    } else if (header.includes('QUALITY_GATES') || header.includes('QUALITY GATES')) {
      result.qualityGates = rules;
    }
  }

  return result;
}

/**
 * Extract rules (bullet points) from section content
 */
function extractRules(content: string): string[] {
  const rules: string[] = [];

  // Remove HTML comments
  const cleanContent = content.replace(/<!--[\s\S]*?-->/g, '');

  // Match bullet points (-, *, •) and numbered lists
  const bulletRegex = /^[\s]*[-*•]\s+(.+)$/gm;
  const numberedRegex = /^[\s]*\d+\.\s+(.+)$/gm;

  let match;

  while ((match = bulletRegex.exec(cleanContent)) !== null) {
    const rule = match[1].trim();
    if (rule) {
      rules.push(rule);
    }
  }

  while ((match = numberedRegex.exec(cleanContent)) !== null) {
    const rule = match[1].trim();
    if (rule) {
      rules.push(rule);
    }
  }

  return rules;
}

/**
 * Create an empty ruleset
 */
export function createEmptyRuleset(): ParsedRuleset {
  return {
    promptContext: [],
    reviewModifications: [],
    rejectionRules: [],
    qualityGates: [],
    rawContent: '',
  };
}

/**
 * Check if a ruleset has any rules defined
 */
export function hasRules(ruleset: ParsedRuleset): boolean {
  return (
    ruleset.promptContext.length > 0 ||
    ruleset.reviewModifications.length > 0 ||
    ruleset.rejectionRules.length > 0 ||
    ruleset.qualityGates.length > 0
  );
}

/**
 * Generate a default ruleset template
 */
export function getDefaultRulesetTemplate(): string {
  return `# Documentation Ruleset

## PROMPT_CONTEXT
<!-- Injected into changeset generation prompt -->
- Follow the existing documentation style and tone
- Use technical terminology appropriate for the target audience

## REVIEW_MODIFICATIONS
<!-- Applied to proposals after enrichment, can reference enrichment data -->
- If styleAnalysis shows formatPattern mismatch, adjust to match target page
- If avgSentenceLength differs by >50% from target, adjust for consistency

## REJECTION_RULES
<!-- Auto-reject proposals matching these criteria -->
- If duplicationWarning.overlapPercentage > 80%, reject as duplicate content

## QUALITY_GATES
<!-- Flag for reviewer attention without rejecting -->
- If styleAnalysis.consistencyNotes is not empty, flag for style review
- If changePercentage > 50%, flag as significant change
- If otherPendingProposals > 0, flag for coordination review
`;
}
