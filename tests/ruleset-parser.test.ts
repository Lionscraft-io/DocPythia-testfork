/**
 * Ruleset Parser Tests
 *
 * Tests for the ruleset parsing functionality.
 *

 * @created 2026-01-19
 */

import { describe, it, expect } from 'vitest';
import {
  parseRuleset,
  createEmptyRuleset,
  hasRules,
  getDefaultRulesetTemplate,
} from '../server/pipeline/types/ruleset.js';

describe('parseRuleset', () => {
  it('should parse empty content', () => {
    const result = parseRuleset('');
    expect(result.promptContext).toEqual([]);
    expect(result.rejectionRules).toEqual([]);
    expect(result.reviewModifications).toEqual([]);
    expect(result.qualityGates).toEqual([]);
  });

  it('should parse PROMPT_CONTEXT section', () => {
    const markdown = `# Ruleset

## PROMPT_CONTEXT
- Use formal tone
- Target intermediate developers
- Include code examples`;

    const result = parseRuleset(markdown);
    expect(result.promptContext).toHaveLength(3);
    expect(result.promptContext).toContain('Use formal tone');
    expect(result.promptContext).toContain('Target intermediate developers');
    expect(result.promptContext).toContain('Include code examples');
  });

  it('should parse REJECTION_RULES section', () => {
    const markdown = `# Ruleset

## REJECTION_RULES
- If duplicationWarning.overlapPercentage > 80%, reject as duplicate
- Proposals mentioning "competitor"`;

    const result = parseRuleset(markdown);
    expect(result.rejectionRules).toHaveLength(2);
    expect(result.rejectionRules[0]).toContain('overlapPercentage');
    expect(result.rejectionRules[1]).toContain('competitor');
  });

  it('should parse REVIEW_MODIFICATIONS section', () => {
    const markdown = `# Ruleset

## REVIEW_MODIFICATIONS
- Adjust format to match target page
- Shorten sentences if avgSentenceLength differs by >50%`;

    const result = parseRuleset(markdown);
    expect(result.reviewModifications).toHaveLength(2);
    expect(result.reviewModifications[0]).toContain('Adjust format');
  });

  it('should parse QUALITY_GATES section', () => {
    const markdown = `# Ruleset

## QUALITY_GATES
- If changePercentage > 50%, flag as significant change
- If otherPendingProposals > 0, flag for coordination`;

    const result = parseRuleset(markdown);
    expect(result.qualityGates).toHaveLength(2);
    expect(result.qualityGates[0]).toContain('changePercentage');
  });

  it('should handle all sections together', () => {
    const markdown = `# Documentation Ruleset

## PROMPT_CONTEXT
<!-- Context for generation -->
- Follow documentation style guide
- Use "validator" not "node operator"

## REVIEW_MODIFICATIONS
- Adjust format to match target

## REJECTION_RULES
- Reject duplicates with >75% overlap

## QUALITY_GATES
- Flag large changes`;

    const result = parseRuleset(markdown);
    expect(result.promptContext).toHaveLength(2);
    expect(result.reviewModifications).toHaveLength(1);
    expect(result.rejectionRules).toHaveLength(1);
    expect(result.qualityGates).toHaveLength(1);
  });

  it('should ignore HTML comments', () => {
    const markdown = `## PROMPT_CONTEXT
<!-- This is a comment -->
- Actual rule`;

    const result = parseRuleset(markdown);
    expect(result.promptContext).toHaveLength(1);
    expect(result.promptContext[0]).toBe('Actual rule');
  });

  it('should handle numbered lists', () => {
    const markdown = `## PROMPT_CONTEXT
1. First rule
2. Second rule
3. Third rule`;

    const result = parseRuleset(markdown);
    expect(result.promptContext).toHaveLength(3);
    expect(result.promptContext[0]).toBe('First rule');
  });

  it('should handle bullet variations (*, -, •)', () => {
    const markdown = `## PROMPT_CONTEXT
- Dash bullet
* Asterisk bullet
• Unicode bullet`;

    const result = parseRuleset(markdown);
    expect(result.promptContext).toHaveLength(3);
  });

  it('should handle section headers with underscores or spaces', () => {
    const markdown1 = `## PROMPT_CONTEXT
- Rule 1`;

    const markdown2 = `## PROMPT CONTEXT
- Rule 2`;

    const result1 = parseRuleset(markdown1);
    const result2 = parseRuleset(markdown2);

    expect(result1.promptContext).toHaveLength(1);
    expect(result2.promptContext).toHaveLength(1);
  });
});

describe('createEmptyRuleset', () => {
  it('should create an empty ruleset', () => {
    const result = createEmptyRuleset();
    expect(result.promptContext).toEqual([]);
    expect(result.rejectionRules).toEqual([]);
    expect(result.reviewModifications).toEqual([]);
    expect(result.qualityGates).toEqual([]);
    expect(result.rawContent).toBe('');
  });
});

describe('hasRules', () => {
  it('should return false for empty ruleset', () => {
    const ruleset = createEmptyRuleset();
    expect(hasRules(ruleset)).toBe(false);
  });

  it('should return true if promptContext has rules', () => {
    const ruleset = createEmptyRuleset();
    ruleset.promptContext = ['Rule 1'];
    expect(hasRules(ruleset)).toBe(true);
  });

  it('should return true if rejectionRules has rules', () => {
    const ruleset = createEmptyRuleset();
    ruleset.rejectionRules = ['Reject X'];
    expect(hasRules(ruleset)).toBe(true);
  });

  it('should return true if qualityGates has rules', () => {
    const ruleset = createEmptyRuleset();
    ruleset.qualityGates = ['Flag Y'];
    expect(hasRules(ruleset)).toBe(true);
  });
});

describe('getDefaultRulesetTemplate', () => {
  it('should return a valid template with all sections', () => {
    const template = getDefaultRulesetTemplate();

    expect(template).toContain('## PROMPT_CONTEXT');
    expect(template).toContain('## REVIEW_MODIFICATIONS');
    expect(template).toContain('## REJECTION_RULES');
    expect(template).toContain('## QUALITY_GATES');
  });

  it('should be parseable', () => {
    const template = getDefaultRulesetTemplate();
    const result = parseRuleset(template);

    expect(result.promptContext.length).toBeGreaterThan(0);
    expect(result.reviewModifications.length).toBeGreaterThan(0);
    expect(result.rejectionRules.length).toBeGreaterThan(0);
    expect(result.qualityGates.length).toBeGreaterThan(0);
  });
});
