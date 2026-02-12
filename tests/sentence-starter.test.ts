/**
 * Tests for the sentence-starter approach to header splitting
 *
 * This approach replaces the protected compound words list with
 * semantic detection of sentence starters vs CamelCase identifiers.
 *
 * Key insight: Only split headers when the uppercase word is a
 * sentence starter (The, This, If, etc.), not when it's part of
 * a CamelCase identifier (Script, Storage, Net, etc.)
 */

import {
  MarkdownFormattingPostProcessor,
  isSentenceStarter,
  SENTENCE_STARTERS,
} from '../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js';
import { describe, it, expect } from 'vitest';

describe('Sentence Starter Detection', () => {
  describe('isSentenceStarter function', () => {
    it('should identify common articles as sentence starters', () => {
      expect(isSentenceStarter('The')).toBe(true);
      expect(isSentenceStarter('A')).toBe(true);
      expect(isSentenceStarter('An')).toBe(true);
      expect(isSentenceStarter('This')).toBe(true);
      expect(isSentenceStarter('That')).toBe(true);
    });

    it('should identify common pronouns as sentence starters', () => {
      expect(isSentenceStarter('It')).toBe(true);
      expect(isSentenceStarter('We')).toBe(true);
      expect(isSentenceStarter('You')).toBe(true);
      expect(isSentenceStarter('They')).toBe(true);
    });

    it('should identify common verbs as sentence starters', () => {
      expect(isSentenceStarter('Use')).toBe(true);
      expect(isSentenceStarter('Run')).toBe(true);
      expect(isSentenceStarter('Check')).toBe(true);
      expect(isSentenceStarter('Install')).toBe(true);
    });

    it('should identify common prepositions as sentence starters', () => {
      expect(isSentenceStarter('For')).toBe(true);
      expect(isSentenceStarter('From')).toBe(true);
      expect(isSentenceStarter('To')).toBe(true);
      expect(isSentenceStarter('In')).toBe(true);
    });

    it('should identify common transitions as sentence starters', () => {
      expect(isSentenceStarter('If')).toBe(true);
      expect(isSentenceStarter('When')).toBe(true);
      expect(isSentenceStarter('While')).toBe(true);
      expect(isSentenceStarter('However')).toBe(true);
    });

    it('should identify documentation labels as sentence starters', () => {
      expect(isSentenceStarter('Cause')).toBe(true);
      expect(isSentenceStarter('Solution')).toBe(true);
      expect(isSentenceStarter('Note')).toBe(true);
      expect(isSentenceStarter('Warning')).toBe(true);
    });

    it('should NOT identify CamelCase word parts as sentence starters', () => {
      // These are common second parts of CamelCase identifiers
      expect(isSentenceStarter('Script')).toBe(false);
      expect(isSentenceStarter('Storage')).toBe(false);
      expect(isSentenceStarter('Net')).toBe(false);
      expect(isSentenceStarter('Sync')).toBe(false);
      expect(isSentenceStarter('Validator')).toBe(false);
      expect(isSentenceStarter('Blocks')).toBe(false);
      expect(isSentenceStarter('Hub')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isSentenceStarter('the')).toBe(true);
      expect(isSentenceStarter('THE')).toBe(true);
      expect(isSentenceStarter('The')).toBe(true);
    });
  });

  describe('SENTENCE_STARTERS set', () => {
    it('should contain expected number of starters', () => {
      // Reasonable range for sentence starters
      expect(SENTENCE_STARTERS.size).toBeGreaterThan(100);
      expect(SENTENCE_STARTERS.size).toBeLessThan(200);
    });

    it('should not contain technical terms', () => {
      // Technical terms that should NOT be sentence starters
      const technicalTerms = [
        'script',
        'storage',
        'net',
        'sync',
        'validator',
        'blocks',
        'hub',
        'lab',
        'bucket',
        'rocks',
        'level',
        'mongo',
        'couch',
        'dynamo',
        'assembly',
        'socket',
        'flare',
        'front',
        'trie',
      ];

      for (const term of technicalTerms) {
        expect(SENTENCE_STARTERS.has(term)).toBe(false);
      }
    });
  });
});

describe('Header Splitting with Sentence Starters', () => {
  const processor = new MarkdownFormattingPostProcessor();
  const context = { isMarkdown: true, originalText: '', filePath: 'test.md' };

  describe('Should SPLIT when followed by sentence starter', () => {
    it('should split header running into "The"', () => {
      const input = '## ConsiderationsThe text continues here';
      const result = processor.process(input, context);
      expect(result.text).toBe('## Considerations\n\nThe text continues here');
      expect(result.wasModified).toBe(true);
    });

    it('should split header running into "This"', () => {
      const input = '## OverviewThis guide explains';
      const result = processor.process(input, context);
      expect(result.text).toBe('## Overview\n\nThis guide explains');
    });

    it('should split header running into "If"', () => {
      const input = '## TroubleshootingIf you encounter errors';
      const result = processor.process(input, context);
      expect(result.text).toBe('## Troubleshooting\n\nIf you encounter errors');
    });

    it('should split header running into "For"', () => {
      const input = '### InstallationFor macOS users';
      const result = processor.process(input, context);
      expect(result.text).toBe('### Installation\n\nFor macOS users');
    });

    it('should split header running into "Use"', () => {
      const input = '## ConfigurationUse the following settings';
      const result = processor.process(input, context);
      expect(result.text).toBe('## Configuration\n\nUse the following settings');
    });

    it('should split header running into "When"', () => {
      const input = '## Best PracticesWhen running in production';
      const result = processor.process(input, context);
      expect(result.text).toBe('## Best Practices\n\nWhen running in production');
    });
  });

  describe('Should NOT split CamelCase identifiers', () => {
    it('should preserve RocksDB', () => {
      const input = '### RocksDB Log File Management';
      const result = processor.process(input, context);
      expect(result.text).toBe('### RocksDB Log File Management');
      expect(result.wasModified).toBe(false);
    });

    it('should preserve JavaScript', () => {
      const input = '### JavaScript Runtime Configuration';
      const result = processor.process(input, context);
      expect(result.text).toBe('### JavaScript Runtime Configuration');
      expect(result.wasModified).toBe(false);
    });

    it('should preserve TypeScript', () => {
      const input = '## TypeScript Integration Guide';
      const result = processor.process(input, context);
      expect(result.text).toBe('## TypeScript Integration Guide');
      expect(result.wasModified).toBe(false);
    });

    it('should preserve PostgreSQL', () => {
      const input = '### PostgreSQL Database Setup';
      const result = processor.process(input, context);
      expect(result.text).toBe('### PostgreSQL Database Setup');
      expect(result.wasModified).toBe(false);
    });

    it('should preserve TestNet', () => {
      const input = '## TestNet Deployment Guide';
      const result = processor.process(input, context);
      expect(result.text).toBe('## TestNet Deployment Guide');
      expect(result.wasModified).toBe(false);
    });

    it('should preserve MainNet', () => {
      const input = '### MainNet Configuration';
      const result = processor.process(input, context);
      expect(result.text).toBe('### MainNet Configuration');
      expect(result.wasModified).toBe(false);
    });

    it('should preserve FlatStorage', () => {
      const input = '## FlatStorage Migration Guide';
      const result = processor.process(input, context);
      expect(result.text).toBe('## FlatStorage Migration Guide');
      expect(result.wasModified).toBe(false);
    });

    it('should preserve StateSync', () => {
      const input = '### StateSync Configuration';
      const result = processor.process(input, context);
      expect(result.text).toBe('### StateSync Configuration');
      expect(result.wasModified).toBe(false);
    });

    it('should preserve ShadowValidator', () => {
      const input = '## ShadowValidator Setup';
      const result = processor.process(input, context);
      expect(result.text).toBe('## ShadowValidator Setup');
      expect(result.wasModified).toBe(false);
    });

    it('should preserve GitHub', () => {
      const input = '### GitHub Integration';
      const result = processor.process(input, context);
      expect(result.text).toBe('### GitHub Integration');
      expect(result.wasModified).toBe(false);
    });

    it('should preserve WebSocket', () => {
      const input = '## WebSocket Connection Guide';
      const result = processor.process(input, context);
      expect(result.text).toBe('## WebSocket Connection Guide');
      expect(result.wasModified).toBe(false);
    });

    it('should preserve PostHog', () => {
      const input = '### PostHog Analytics Integration';
      const result = processor.process(input, context);
      expect(result.text).toBe('### PostHog Analytics Integration');
      expect(result.wasModified).toBe(false);
    });

    it('should preserve MacOS', () => {
      const input = '## MacOS Installation';
      const result = processor.process(input, context);
      expect(result.text).toBe('## MacOS Installation');
      expect(result.wasModified).toBe(false);
    });
  });

  describe('Pattern matching edge cases', () => {
    it('should not match when uppercase is followed by uppercase (RocksDB)', () => {
      // The pattern [A-Z][a-z]+ requires lowercase after uppercase
      // RocksDB has D followed by B (uppercase), so it won't match
      const input = '### RocksDB internals';
      const result = processor.process(input, context);
      expect(result.text).not.toContain('Rocks\n\nDB');
    });

    it('should not match when uppercase is followed by uppercase (PostgreSQL)', () => {
      // PostgreSQL has S followed by QL (uppercase)
      const input = '### PostgreSQL configuration';
      const result = processor.process(input, context);
      expect(result.text).not.toContain('Postgre\n\nSQL');
    });

    it('should handle multiple CamelCase words in one header', () => {
      const input = '### Using JavaScript and TypeScript with PostgreSQL';
      const result = processor.process(input, context);
      expect(result.text).toBe('### Using JavaScript and TypeScript with PostgreSQL');
    });

    it('should handle formatting error with CamelCase word', () => {
      // RocksDB is valid CamelCase, but "The" is a sentence starter
      const input = '### RocksDB ConfigurationThe following settings';
      const result = processor.process(input, context);
      expect(result.text).toBe('### RocksDB Configuration\n\nThe following settings');
    });
  });
});

describe('Bold Header Splitting with Sentence Starters', () => {
  const processor = new MarkdownFormattingPostProcessor();
  const context = { isMarkdown: true, originalText: '', filePath: 'test.md' };

  describe('Should SPLIT bold headers with sentence starters', () => {
    it('should split bold header running into "The"', () => {
      const input = '**Title**The text continues';
      const result = processor.process(input, context);
      expect(result.text).toBe('**Title**\n\nThe text continues');
    });

    it('should split bold header running into "Cause"', () => {
      const input = '**Issue**Cause: The node is down';
      const result = processor.process(input, context);
      expect(result.text).toBe('**Issue**\n\nCause: The node is down');
    });
  });

  describe('Should NOT split bold headers with non-sentence-starters', () => {
    it('should preserve bold with CamelCase continuation', () => {
      const input = '**Config**Script execution';
      const result = processor.process(input, context);
      // "Script" is not a sentence starter, so no split
      expect(result.text).toBe('**Config**Script execution');
    });
  });

  describe('Bold with colon should always split', () => {
    it('should always split after colon (content follows)', () => {
      const input = '**Title:**RocksDB threw an error';
      const result = processor.process(input, context);
      // Colon indicates content follows, so always split
      expect(result.text).toBe('**Title:**\n\nRocksDB threw an error');
    });
  });
});

describe('Admonition Splitting with Sentence Starters', () => {
  const processor = new MarkdownFormattingPostProcessor();
  const context = { isMarkdown: true, originalText: '', filePath: 'test.md' };

  it('should split admonition running into sentence starter', () => {
    const input = ':::note Title:::For macOS users';
    const result = processor.process(input, context);
    expect(result.text).toBe(':::note Title:::\n\nFor macOS users');
  });

  it('should not split admonition running into non-sentence-starter', () => {
    const input = ':::note Title:::Storage configuration';
    const result = processor.process(input, context);
    // "Storage" is not a sentence starter
    expect(result.text).toBe(':::note Title:::Storage configuration');
  });
});

describe('Section Title Splitting with Sentence Starters', () => {
  const processor = new MarkdownFormattingPostProcessor();
  const context = { isMarkdown: true, originalText: '', filePath: 'test.md' };

  it('should split Troubleshooting running into sentence starter', () => {
    const input = 'TroubleshootingIf you encounter errors';
    const result = processor.process(input, context);
    expect(result.text).toBe('Troubleshooting\n\nIf you encounter errors');
  });

  it('should split Overview running into sentence starter', () => {
    const input = 'OverviewThis document explains';
    const result = processor.process(input, context);
    expect(result.text).toBe('Overview\n\nThis document explains');
  });

  it('should not split section title running into non-sentence-starter', () => {
    const input = 'TroubleshootingScript execution';
    const result = processor.process(input, context);
    // "Script" is not a sentence starter
    expect(result.text).toBe('TroubleshootingScript execution');
  });
});

describe('Real-world examples from production', () => {
  const processor = new MarkdownFormattingPostProcessor();
  const context = { isMarkdown: true, originalText: '', filePath: 'test.md' };

  it('should handle real-world documentation headers correctly', () => {
    const examples = [
      // Should NOT split - CamelCase identifiers
      { input: '## StateSync Configuration', expected: '## StateSync Configuration' },
      { input: '### TestNet vs MainNet', expected: '### TestNet vs MainNet' },
      {
        input: '## FlatStorageBlockNotSupported Error',
        expected: '## FlatStorageBlockNotSupported Error',
      },
      { input: '### ChunkValidator Setup', expected: '### ChunkValidator Setup' },
      // Should SPLIT - formatting errors
      {
        input: '## Expected Synchronization TimesThe time required',
        expected: '## Expected Synchronization Times\n\nThe time required',
      },
      {
        input: '### Node ConfigurationUse the following',
        expected: '### Node Configuration\n\nUse the following',
      },
    ];

    for (const { input, expected } of examples) {
      const result = processor.process(input, context);
      expect(result.text).toBe(expected);
    }
  });

  it('should handle complex mixed content', () => {
    const input = `## RocksDB ConfigurationThe following settings are recommended

### TestNet DeploymentFor testing purposes

### MainNet ProductionUse production-ready configurations`;

    const result = processor.process(input, context);

    // CamelCase identifiers preserved, formatting errors fixed
    expect(result.text).toContain('## RocksDB Configuration\n\nThe following');
    expect(result.text).toContain('### TestNet Deployment\n\nFor testing');
    expect(result.text).toContain('### MainNet Production\n\nUse production');
  });
});
