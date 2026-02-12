// Test the new fixes for RocksDB and <br/> in tables

import { MarkdownFormattingPostProcessor } from '../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js';
import { HtmlToMarkdownPostProcessor } from '../server/pipeline/utils/post-processors/HtmlToMarkdownPostProcessor.js';
import { describe, it, expect } from 'vitest';

describe('New Post-Processor Fixes', () => {
  const mdProcessor = new MarkdownFormattingPostProcessor();
  const htmlProcessor = new HtmlToMarkdownPostProcessor();
  const context = { isMarkdown: true, originalText: '', filePath: 'test.md' };

  describe('RocksDB protection', () => {
    it('should preserve RocksDB in headers', () => {
      const input = '### RocksDB Log File Management for Validator Nodes';
      const result = mdProcessor.process(input, context);
      expect(result.text).toContain('RocksDB');
      expect(result.text).not.toContain('Rocks DB');
    });

    it('should preserve other compound words', () => {
      const input = '### Using PostgreSQL with JavaScript on MacOS';
      const result = mdProcessor.process(input, context);
      expect(result.text).toContain('PostgreSQL');
      expect(result.text).toContain('JavaScript');
      expect(result.text).toContain('MacOS');
    });
  });

  describe('<br/> handling', () => {
    it('should convert <br/> to newline in table rows', () => {
      // Changed: now converts <br/> everywhere since frontend shows literal text
      const input = '| NO_SYNCED_BLOCKS | Description | • Wait <br/>• Send request |';
      const result = htmlProcessor.process(input, context);
      expect(result.text).not.toContain('<br/>');
      expect(result.text).toContain('• Wait');
      expect(result.text).toContain('• Send request');
    });

    it('should convert <br/> to newline outside tables', () => {
      const input = 'First line<br/>Second line';
      const result = htmlProcessor.process(input, context);
      expect(result.text).toContain('\n');
      expect(result.text).not.toContain('<br/>');
    });
  });

  describe('Bold marker space fix (Fix 0j)', () => {
    it('should remove space after opening bold markers', () => {
      const input = '1. ** Check indexer logs**: Look for warnings';
      const result = mdProcessor.process(input, context);
      expect(result.text).toContain('**Check indexer logs**');
      expect(result.text).not.toContain('** Check');
    });

    it('should not affect closing bold markers with trailing space', () => {
      const input = '**bold** text continues';
      const result = mdProcessor.process(input, context);
      expect(result.text).toBe('**bold** text continues');
    });

    it('should handle bold at start of line', () => {
      const input = '** Start of line**';
      const result = mdProcessor.process(input, context);
      expect(result.text).toBe('**Start of line**');
    });
  });
});
