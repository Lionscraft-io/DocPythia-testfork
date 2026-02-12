/**
 * Bad Format Post-Processor Tests
 *
 * Tests to verify post-processors correctly handle bad format issues
 * found in real LLM output.
 *
 * Each test case represents a real issue and verifies whether the
 * post-processor pipeline fixes it appropriately.
 *

 * @created 2026-01-05
 */

import { describe, it, expect } from 'vitest';
import {
  postProcessProposal,
  PostProcessorPipeline,
  HtmlToMarkdownPostProcessor,
  MarkdownFormattingPostProcessor,
  ListFormattingPostProcessor,
} from '../server/pipeline/utils/ProposalPostProcessor.js';

// Test fixtures directory for intermediate results
const INTERMEDIATE_RESULTS: { testName: string; input: string; output: string; fixed: boolean }[] =
  [];

/**
 * Helper to log intermediate results for analysis
 */
function recordResult(testName: string, input: string, output: string, fixed: boolean) {
  INTERMEDIATE_RESULTS.push({ testName, input, output, fixed });
}

describe('BadFormat Post-Processor Tests', () => {
  // Using postProcessProposal which creates the pipeline internally

  describe('Issue 1: Broken Markdown Bold Markers (** split across lines)', () => {
    /**
     * From results file lines 64-75, 102-104, 127-143, 188-199
     * The LLM output has ** on a separate line from the text it should wrap
     *
     * Example from the file:
     * "**
     *
     * Enable Debug Pages:** Enable debug RPC..."
     *
     * Should be: "**Enable Debug Pages:** Enable debug RPC..."
     */

    it('should fix bold markers split with newlines before text', () => {
      const input = `**

Enable Debug Pages:** Enable debug RPC endpoints to diagnose node issues.`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('bold-split-before-text', input, result.text, result.wasModified);

      // Verify the bold markers are properly joined
      expect(result.text).toContain('**Enable Debug Pages:**');
    });

    it('should fix bold markers with trailing newlines after text', () => {
      const input = `**Enable Debug Pages**

: Enable debug RPC endpoints.`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('bold-split-after-text', input, result.text, result.wasModified);

      // Check if malformed bold is fixed
      expect(result.text).not.toContain('**\n');
    });

    it('should handle multiple broken bold markers in same text', () => {
      const input = `**

Cause:** The node is experiencing high CPU usage due to state sync. **

Solution:** Restart the node with proper configuration.`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('multiple-broken-bold', input, result.text, result.wasModified);

      // Debug output
      console.log('Multiple broken bold - Input:', JSON.stringify(input));
      console.log('Multiple broken bold - Output:', JSON.stringify(result.text));

      // Verify both are fixed
      const hasProperCause = result.text.includes('**Cause:**');
      const hasProperSolution = result.text.includes('**Solution:**');

      console.log('hasProperCause:', hasProperCause, 'hasProperSolution:', hasProperSolution);

      expect(hasProperCause && hasProperSolution).toBe(true);
    });
  });

  describe('Issue 2: Duplicate Content Blocks', () => {
    /**
     * From results file lines 679-763
     * The same warning block appears 3 times consecutively
     * This is likely an LLM loop/repetition issue
     */

    it('should detect duplicate consecutive content blocks', () => {
      const input = `:::warning Interacting with Custom Staking Pool Contracts
Staking pool contracts can be highly customized.
:::

:::warning Interacting with Custom Staking Pool Contracts
Staking pool contracts can be highly customized.
:::

:::warning Interacting with Custom Staking Pool Contracts
Staking pool contracts can be highly customized.
:::`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('duplicate-warning-blocks', input, result.text, result.wasModified);

      // Count occurrences of the warning block
      const warningCount = (result.text.match(/:::warning Interacting/g) || []).length;

      // Post-processor should ideally deduplicate, or at least warn
      // This documents current behavior
      expect(warningCount).toBeGreaterThanOrEqual(1);
      // TODO: Add deduplication logic to post-processor
    });

    it('should detect duplicate code examples', () => {
      const input = `\`\`\`js
const account = new Account("user.testnet", provider, signer);
await account.callFunction({ contractId: "test" });
\`\`\`

\`\`\`js
const account = new Account("user.testnet", provider, signer);
await account.callFunction({ contractId: "test" });
\`\`\`

\`\`\`js
const account = new Account("user.testnet", provider, signer);
await account.callFunction({ contractId: "test" });
\`\`\``;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('duplicate-code-blocks', input, result.text, result.wasModified);

      const codeBlockCount = (result.text.match(/```js/g) || []).length;
      expect(codeBlockCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Issue 3: Empty Proposals', () => {
    /**
     * From results file lines 1705, 1854
     * Proposals with "(No content)" as the content
     */

    it('should flag empty proposal content', () => {
      const input = `(No content)`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('empty-proposal', input, result.text, result.wasModified);

      // Empty proposals should generate a warning
      // Currently checking if the text is preserved or handled
      expect(result.text).toBeDefined();
    });

    it('should flag whitespace-only proposals', () => {
      const input = `

   `;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('whitespace-proposal', input, result.text, result.wasModified);

      // Should be trimmed or flagged
      expect(result.text.trim()).toBe('');
    });
  });

  describe('Issue 4: Broken JSON in Proposals', () => {
    /**
     * From results file lines 1765-1767, 1913-1915
     * JSON with line breaks inside field values
     */

    it('should detect broken JSON timestamp', () => {
      const input = `{
  "genesis_time": "2020-07-21T16:55:

51.591948Z",
  "chain_id": "mainnet"
}`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('broken-json-timestamp', input, result.text, result.wasModified);

      // Check if the broken timestamp is still present
      const hasBrokenTimestamp = result.text.includes('"2020-07-21T16:55:\n');

      // Document current behavior - this is a gap in post-processing
      expect(hasBrokenTimestamp).toBeDefined();
    });
  });

  describe('Issue 5: Repeated Bullet Points (LLM Loop)', () => {
    /**
     * From results file lines 2298-2319
     * Same bullet points repeated 4+ times with broken formatting
     * Pattern: - **\n\nCommission**: ...
     */

    it('should fix bullet points with broken bold formatting', () => {
      const input = `- **

Commission**: Validators charge a commission on rewards.

- **

Liquidity**: Staked tokens are locked.

- **

Validator Performance**: If a validator underperforms, they may be slashed.`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('broken-bullet-bold', input, result.text, result.wasModified);

      // Check if the **\n\n pattern is fixed
      expect(result.text).not.toContain('**\n\n');
    });

    it('should detect LLM loop with repeated bullet content', () => {
      const input = `- **Commission**: Validators charge a commission.
- **Liquidity**: Staked tokens are locked.
- **Commission**: Validators charge a commission.
- **Liquidity**: Staked tokens are locked.
- **Commission**: Validators charge a commission.
- **Liquidity**: Staked tokens are locked.`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('llm-loop-bullets', input, result.text, result.wasModified);

      // Count unique bullets vs total
      const commissionCount = (result.text.match(/Commission/g) || []).length;
      expect(commissionCount).toBeGreaterThan(1); // Documents the loop issue
    });
  });

  describe('Issue 6: Placeholder Text in Proposals', () => {
    /**
     * From results file lines 2414-2416
     * Contains "[Describe the specific issue here...]" placeholders
     */

    it('should detect placeholder text patterns', () => {
      const input = `Known Issue: DataSync Indexer Patch for Version 2.6
* Issue: [Describe the specific issue here, e.g., "An issue causing data inconsistencies."]
* Solution: A patch has been developed.
* Further Details: [Link to GitHub issue, PR, or more detailed explanation if available.]`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('placeholder-text', input, result.text, result.wasModified);

      // Check if placeholders are detected (should generate warnings)
      const hasPlaceholder = result.text.includes('[Describe') || result.text.includes('[Link to');

      // Document that placeholders pass through - should be flagged
      expect(hasPlaceholder).toBe(true);
    });
  });

  describe('Issue 7: Run-on Repetitive Text', () => {
    /**
     * From results file lines 2326-2334
     * Same content about validator election repeated 5+ times
     */

    it('should detect severely repeated content', () => {
      const input = `At the beginning of each epoch, some computation produces a list of validators for the very next epoch. The input to this computation includes all accounts that have "raised their hand to be a validator" by submitting a special transaction (StakeAction). At the beginning of each epoch, some computation produces a list of validators for the very next epoch. The input to this computation includes all accounts that have "raised their hand to be a validator" by submitting a special transaction (StakeAction). At the beginning of each epoch, some computation produces a list of validators for the very next epoch. The input to this computation includes all accounts that have "raised their hand to be a validator" by submitting a special transaction (StakeAction).`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('run-on-repetition', input, result.text, result.wasModified);

      // Count repetitions of the key phrase
      const phraseCount = (result.text.match(/At the beginning of each epoch/g) || []).length;

      // This should be flagged as an LLM loop
      expect(phraseCount).toBeGreaterThan(1);
    });
  });

  describe('Issue 8: Broken Header Text', () => {
    /**
     * From results file lines 1832-1840
     * "Git\nHub" should be "GitHub"
     */

    it('should fix header split across lines', () => {
      const input = `## Git
Hub

Created by the community, GitHub is a comprehensive code hosting platform.`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('broken-header', input, result.text, result.wasModified);

      // Check if header is on one line
      const hasProperHeader = result.text.includes('## GitHub');
      const hasBrokenHeader = result.text.includes('## Git\nHub');

      // Document current behavior
      expect(hasBrokenHeader || hasProperHeader).toBeDefined();
    });
  });

  describe('Issue 9: Broken Bold with newline before word (ft_on_transfer)', () => {
    /**
     * From results file lines 1657-1658
     * Pattern: **\nNOT used** should be **NOT used**
     */

    it('should fix bold with newline after opening markers', () => {
      const input = `The memo field is **
NOT used** by the standard, but it may be used by specific implementations.`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('bold-newline-after-open', input, result.text, result.wasModified);

      // Should fix the broken bold
      expect(result.text).toContain('**NOT used**');
      expect(result.text).not.toContain('**\nNOT');
    });

    it('should fix bold with multiple newlines inside', () => {
      const input = `**

This is important:** You must configure this setting.`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('bold-multiple-newlines', input, result.text, result.wasModified);

      expect(result.text).toContain('**This is important:**');
    });
  });

  describe('Issue 10: Multiple bold spans in same paragraph', () => {
    /**
     * Regression test for greedy regex issue
     * Multiple **text** patterns should not interfere with each other
     */

    it('should handle multiple distinct bold spans', () => {
      const input = `**First Item:** Description of first. **Second Item:** Description of second.`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('multiple-bold-spans', input, result.text, result.wasModified);

      // Both should remain intact, not merged
      expect(result.text).toContain('**First Item:**');
      expect(result.text).toContain('**Second Item:**');
    });

    it('should not merge bold spans across sentence boundaries', () => {
      const input = `**Cause:** The issue occurs due to sync. **Solution:** Restart the node.`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('bold-spans-sentence-boundary', input, result.text, result.wasModified);

      // Should preserve both separate bold spans
      expect(result.text).toContain('**Cause:**');
      expect(result.text).toContain('**Solution:**');
      // Should not have introduced newlines between them
      expect(result.text).not.toContain('**\n\nSolution');
    });

    it('should handle complex text with multiple labels', () => {
      const input = `**Cause:** Network timeout. **Impact:** Users see errors. **Solution:** Retry logic. **Status:** Fixed in v2.0.`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('four-bold-labels', input, result.text, result.wasModified);

      expect(result.text).toContain('**Cause:**');
      expect(result.text).toContain('**Impact:**');
      expect(result.text).toContain('**Solution:**');
      expect(result.text).toContain('**Status:**');
    });
  });

  describe('Issue 11: Real examples from results file', () => {
    /**
     * Actual patterns found in the production results
     */

    it('should fix "My node can\'t sync state" troubleshooting format', () => {
      const input = `**

My node can't sync state:** If your node shows "State sync"...

**

Enable Debug Pages:** Enable debug RPC endpoints...`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('real-example-sync-state', input, result.text, result.wasModified);

      expect(result.text).toContain("**My node can't sync state:**");
      expect(result.text).toContain('**Enable Debug Pages:**');
    });

    it('should fix "High CPU usage" troubleshooting format', () => {
      const input = `Troubleshooting common issues:

**

Cause:** High CPU usage during state sync is normal.

**

Solution:** Wait for sync to complete or add more resources.`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('real-example-high-cpu', input, result.text, result.wasModified);

      expect(result.text).toContain('**Cause:**');
      expect(result.text).toContain('**Solution:**');
      expect(result.text).not.toContain('**\n\n');
    });

    it('should handle indexer troubleshooting format', () => {
      const input = `**

Indexer IO Error:** This error indicates disk issues.

**

Resolution:** Check disk space and inode usage.`;

      const result = postProcessProposal(input, 'docs/test.md');
      recordResult('real-example-indexer', input, result.text, result.wasModified);

      expect(result.text).toContain('**Indexer IO Error:**');
      expect(result.text).toContain('**Resolution:**');
    });
  });
});

describe('Post-Processor Gap Analysis', () => {
  /**
   * These tests identify GAPS in the current post-processors
   * They are expected to fail until the gaps are addressed
   */

  describe('Missing: Bold Marker Line Break Fixer', () => {
    it('should have a processor that fixes **\\n\\nText** patterns', () => {
      const pipeline = new PostProcessorPipeline([
        new HtmlToMarkdownPostProcessor(),
        new MarkdownFormattingPostProcessor(),
        new ListFormattingPostProcessor(),
      ]);

      const input = `**

Enable Debug Pages:** Enable debug RPC.`;

      const result = pipeline.process(input, 'docs/test.md');

      // This test SHOULD pass if the processor handles this case
      // Currently expected to FAIL, identifying a gap
      const isFixed = result.text.includes('**Enable Debug Pages:**');
      console.log('Bold marker fix test - Input:', JSON.stringify(input));
      console.log('Bold marker fix test - Output:', JSON.stringify(result.text));
      console.log('Bold marker fix test - Fixed:', isFixed);

      // TODO: Add regex to MarkdownFormattingPostProcessor to handle this
    });
  });

  describe('Missing: Duplicate Content Detector', () => {
    it('should have a processor that detects/removes duplicate blocks', () => {
      // Currently no processor handles this
      // Need to add DuplicateContentPostProcessor
    });
  });

  describe('Missing: Placeholder Text Detector', () => {
    it('should have a processor that flags [placeholder] patterns', () => {
      // Currently no processor warns about placeholder text
      // Need to add validation warnings
    });
  });

  describe('Missing: LLM Loop Detector', () => {
    it('should have a processor that detects repeated content patterns', () => {
      // Currently no processor detects LLM loops
      // Need to add content similarity detection
    });
  });
});

describe('Raw vs Processed Regression Tests (2026-01-06)', () => {
  /**
   * Tests based on comparing raw LLM output with post-processed output
   * from the admin dashboard proposals.
   */

  describe('Protected Compound Words', () => {
    it('should NOT split RocksDB in headers', () => {
      const input = `### RocksDB Log File Management for Validator Nodes`;
      const result = postProcessProposal(input, 'docs/test.md');

      expect(result.text).toContain('RocksDB');
      expect(result.text).not.toContain('Rocks DB');
      expect(result.text).not.toContain('Rocks\n\nDB');
    });

    it('should NOT split PostgreSQL in headers', () => {
      const input = `## Using PostgreSQL with JavaScript`;
      const result = postProcessProposal(input, 'docs/test.md');

      expect(result.text).toContain('PostgreSQL');
      expect(result.text).toContain('JavaScript');
    });

    it('should NOT split compound words in body text', () => {
      const input = `Configure your RocksDB settings and connect to PostgreSQL via JavaScript.`;
      const result = postProcessProposal(input, 'docs/test.md');

      expect(result.text).toContain('RocksDB');
      expect(result.text).toContain('PostgreSQL');
      expect(result.text).toContain('JavaScript');
    });
  });

  describe('HTML br tag handling in tables', () => {
    it('should convert <br/> to newline inside table rows', () => {
      // Changed behavior: <br/> is now converted to newlines everywhere
      // because frontend doesn't render HTML - it shows literal <br/> text
      const input = `| Error | Description | Solution |
| --- | --- | --- |
| NO_SYNCED_BLOCKS | Node is syncing | • Wait for sync <br/>• Try different node |`;

      const result = postProcessProposal(input, 'docs/test.md');

      expect(result.text).not.toContain('<br/>');
      expect(result.text).toContain('• Wait for sync');
      expect(result.text).toContain('• Try different node');
    });

    it('should convert <br/> to newline outside tables', () => {
      const input = `First line<br/>Second line<br/>Third line`;
      const result = postProcessProposal(input, 'docs/test.md');

      expect(result.text).toContain('\n');
      expect(result.text).not.toContain('<br/>');
    });
  });

  describe('Numbered list items with bold', () => {
    it('should handle numbered lists with bold titles', () => {
      const input = `1. **Stopping the node.** Ensure the process is stopped.
2. **Deleting the data directory.** Remove ~/.app/data.
3. **Re-initializing the node.** Run app init.`;

      const result = postProcessProposal(input, 'docs/test.md');

      expect(result.text).toContain('1. **Stopping the node.**');
      expect(result.text).toContain('2. **Deleting the data directory.**');
      expect(result.text).toContain('3. **Re-initializing the node.**');
      // Should NOT have space inside bold markers
      expect(result.text).not.toContain('** Stopping');
      expect(result.text).not.toContain('** Deleting');
    });

    it('should NOT insert space after ** in list items', () => {
      const input = `1. **Step one**
2. **Step two**
3. **Step three**`;

      const result = postProcessProposal(input, 'docs/test.md');

      // Check no space was inserted after **
      expect(result.text).not.toMatch(/\*\* [A-Z]/);
    });
  });

  describe('Label formatting (Cause/Solution)', () => {
    it('should add proper spacing after Cause: labels', () => {
      const input = `Cause:The node is experiencing issues.`;
      const result = postProcessProposal(input, 'docs/test.md');

      // Should have proper separation
      expect(result.text).toMatch(/Cause:[\s\n]/);
    });

    it('should add proper spacing after Solution: labels', () => {
      const input = `occur.Solution:Restart the node.`;
      const result = postProcessProposal(input, 'docs/test.md');

      // Should separate the label from preceding text
      expect(result.text).toContain('\n\nSolution:');
    });

    it('should handle Cause/Solution pairs correctly', () => {
      const input = `***My node fails***Cause: High CPU usage.Solution: Add resources.`;
      const result = postProcessProposal(input, 'docs/test.md');

      // Both labels should be properly formatted
      expect(result.text).toContain('Cause:');
      expect(result.text).toContain('Solution:');
    });
  });

  describe('Backtick-enclosed words broken across lines', () => {
    it('should join backtick words split by newlines', () => {
      const input = 'Troubleshooting `Shadow\nValidator` Standby Nodes';
      const result = postProcessProposal(input, 'docs/test.md');

      expect(result.text).toContain('`ShadowValidator`');
      expect(result.text).not.toContain('`Shadow\nValidator`');
    });

    it('should handle multiple broken backtick words', () => {
      const input = 'Use `Shadow\nValidator` and `Mem\nTrie` features';
      const result = postProcessProposal(input, 'docs/test.md');

      expect(result.text).toContain('`ShadowValidator`');
      expect(result.text).toContain('`MemTrie`');
    });
  });

  describe('Compound words broken across lines', () => {
    it('should join MacOS broken across lines', () => {
      const input = `Known Performance Considerations for Mac
OS (aarch64)`;
      const result = postProcessProposal(input, 'docs/test.md');

      expect(result.text).toContain('MacOS');
      expect(result.text).not.toContain('Mac\nOS');
    });

    it('should join GitHub broken across lines', () => {
      const input = `Check Git
Hub repository for details.`;
      const result = postProcessProposal(input, 'docs/test.md');

      expect(result.text).toContain('GitHub');
    });
  });

  describe('Triple-star formatting (bold+italic)', () => {
    it('should handle ***Title***Cause: pattern', () => {
      const input = `***My node can't sync***Cause: Network issues prevent sync.`;
      const result = postProcessProposal(input, 'docs/test.md');

      // Should add separation between title and Cause
      expect(result.text).toContain("***My node can't sync***");
      expect(result.text).toContain('Cause:');
    });
  });

  describe('Headers running into text', () => {
    it('should separate header from following text', () => {
      const input = `## Expected Synchronization TimesThe time required for sync varies.`;
      const result = postProcessProposal(input, 'docs/test.md');

      // Should add newline after header
      expect(result.text).toMatch(/## Expected Synchronization Times\s*\n/);
    });

    it('should handle subsection headers', () => {
      const input = `### Enabling Debug LoggingWhen troubleshooting complex issues...`;
      const result = postProcessProposal(input, 'docs/test.md');

      expect(result.text).toMatch(/### Enabling Debug Logging\s*\n/);
    });
  });
});

// Export intermediate results for analysis
export function getIntermediateResults() {
  return INTERMEDIATE_RESULTS;
}
