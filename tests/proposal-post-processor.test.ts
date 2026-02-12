/**
 * Tests for ProposalPostProcessor
 * Verifies HTML to Markdown conversion and warning detection
 */

import { describe, it, expect } from 'vitest';
import {
  postProcessProposal,
  postProcessProposals,
  isMarkdownFile,
  isHtmlFile,
  containsHtml,
  convertHtmlToMarkdown,
  detectComplexHtml,
} from '../server/pipeline/utils/ProposalPostProcessor.js';

describe('ProposalPostProcessor', () => {
  describe('isMarkdownFile', () => {
    it('should identify .md files as markdown', () => {
      expect(isMarkdownFile('docs/api/rpc/errors.md')).toBe(true);
      expect(isMarkdownFile('README.md')).toBe(true);
    });

    it('should identify .mdx files as markdown', () => {
      expect(isMarkdownFile('docs/guides/tutorial.mdx')).toBe(true);
    });

    it('should identify .markdown files as markdown', () => {
      expect(isMarkdownFile('notes.markdown')).toBe(true);
    });

    it('should not identify other files as markdown', () => {
      expect(isMarkdownFile('index.html')).toBe(false);
      expect(isMarkdownFile('script.js')).toBe(false);
      expect(isMarkdownFile('styles.css')).toBe(false);
    });
  });

  describe('isHtmlFile', () => {
    it('should identify .html files', () => {
      expect(isHtmlFile('index.html')).toBe(true);
    });

    it('should identify .htm files', () => {
      expect(isHtmlFile('page.htm')).toBe(true);
    });

    it('should not identify markdown files as HTML', () => {
      expect(isHtmlFile('README.md')).toBe(false);
    });
  });

  describe('containsHtml', () => {
    it('should detect HTML tags', () => {
      expect(containsHtml('<p>Hello</p>')).toBe(true);
      expect(containsHtml('<strong>bold</strong>')).toBe(true);
      expect(containsHtml('<a href="#">link</a>')).toBe(true);
    });

    it('should detect self-closing tags', () => {
      expect(containsHtml('<br/>')).toBe(true);
      expect(containsHtml('<img src="x" />')).toBe(true);
    });

    it('should not detect plain text', () => {
      expect(containsHtml('Just plain text')).toBe(false);
      expect(containsHtml('# Markdown heading')).toBe(false);
    });

    it('should handle empty/undefined input', () => {
      expect(containsHtml('')).toBe(false);
    });
  });

  describe('convertHtmlToMarkdown', () => {
    describe('headers', () => {
      it('should convert h1 to #', () => {
        expect(convertHtmlToMarkdown('<h1>Title</h1>')).toBe('# Title');
      });

      it('should convert h2 to ##', () => {
        expect(convertHtmlToMarkdown('<h2>Section</h2>')).toBe('## Section');
      });

      it('should convert h3-h6', () => {
        expect(convertHtmlToMarkdown('<h3>Subsection</h3>')).toBe('### Subsection');
        expect(convertHtmlToMarkdown('<h4>Level 4</h4>')).toBe('#### Level 4');
        expect(convertHtmlToMarkdown('<h5>Level 5</h5>')).toBe('##### Level 5');
        expect(convertHtmlToMarkdown('<h6>Level 6</h6>')).toBe('###### Level 6');
      });
    });

    describe('text formatting', () => {
      it('should convert strong to **', () => {
        expect(convertHtmlToMarkdown('<strong>bold text</strong>')).toBe('**bold text**');
      });

      it('should convert b to **', () => {
        expect(convertHtmlToMarkdown('<b>bold</b>')).toBe('**bold**');
      });

      it('should convert em to *', () => {
        expect(convertHtmlToMarkdown('<em>italic text</em>')).toBe('*italic text*');
      });

      it('should convert i to *', () => {
        expect(convertHtmlToMarkdown('<i>italic</i>')).toBe('*italic*');
      });

      it('should convert del/s to ~~', () => {
        expect(convertHtmlToMarkdown('<del>deleted</del>')).toBe('~~deleted~~');
        expect(convertHtmlToMarkdown('<s>strikethrough</s>')).toBe('~~strikethrough~~');
      });
    });

    describe('code', () => {
      it('should convert inline code', () => {
        expect(convertHtmlToMarkdown('<code>const x = 1</code>')).toBe('`const x = 1`');
      });

      it('should convert code blocks', () => {
        const html = '<pre><code>function test() {\n  return true;\n}</code></pre>';
        const expected = '```\nfunction test() {\n  return true;\n}\n```';
        expect(convertHtmlToMarkdown(html)).toBe(expected);
      });

      it('should convert pre without code', () => {
        const html = '<pre>preformatted text</pre>';
        const expected = '```\npreformatted text\n```';
        expect(convertHtmlToMarkdown(html)).toBe(expected);
      });
    });

    describe('links', () => {
      it('should convert links', () => {
        expect(convertHtmlToMarkdown('<a href="https://example.com">Click here</a>')).toBe(
          '[Click here](https://example.com)'
        );
      });

      it('should handle links with extra attributes', () => {
        expect(convertHtmlToMarkdown('<a href="url" target="_blank" rel="noopener">Link</a>')).toBe(
          '[Link](url)'
        );
      });
    });

    describe('images', () => {
      it('should convert images with alt text', () => {
        expect(convertHtmlToMarkdown('<img src="image.png" alt="My Image" />')).toBe(
          '![My Image](image.png)'
        );
      });

      it('should convert images without alt text', () => {
        expect(convertHtmlToMarkdown('<img src="image.png" />')).toBe('![](image.png)');
      });
    });

    describe('structural elements', () => {
      it('should convert paragraphs', () => {
        expect(convertHtmlToMarkdown('<p>A paragraph</p>')).toBe('A paragraph');
      });

      it('should convert line breaks', () => {
        expect(convertHtmlToMarkdown('Line 1<br/>Line 2')).toBe('Line 1\nLine 2');
      });

      it('should convert horizontal rules', () => {
        expect(convertHtmlToMarkdown('Above<hr/>Below')).toContain('---');
      });

      it('should convert blockquotes', () => {
        expect(convertHtmlToMarkdown('<blockquote>A quote</blockquote>')).toContain('> A quote');
      });
    });

    describe('lists', () => {
      it('should convert unordered lists', () => {
        const html = '<ul><li>Item 1</li><li>Item 2</li></ul>';
        const result = convertHtmlToMarkdown(html);
        expect(result).toContain('- Item 1');
        expect(result).toContain('- Item 2');
      });
    });

    describe('cleanup', () => {
      it('should remove div wrappers', () => {
        expect(convertHtmlToMarkdown('<div>content</div>')).toBe('content');
      });

      it('should remove span wrappers', () => {
        expect(convertHtmlToMarkdown('<span>text</span>')).toBe('text');
      });

      it('should clean up excessive newlines', () => {
        expect(convertHtmlToMarkdown('<p>A</p>\n\n\n\n<p>B</p>')).toContain('A\n\nB');
      });
    });
  });

  describe('detectComplexHtml', () => {
    it('should detect tables', () => {
      const warnings = detectComplexHtml('<table><tr><td>Cell</td></tr></table>');
      expect(warnings).toContain(
        'Contains HTML table - manual conversion to markdown table may be needed'
      );
    });

    it('should detect inline styles', () => {
      const warnings = detectComplexHtml('<p style="color: red;">Text</p>');
      expect(warnings).toContain('Contains inline styles - may need cleanup');
    });

    it('should detect SVG', () => {
      const warnings = detectComplexHtml('<svg><circle/></svg>');
      expect(warnings).toContain('Contains SVG element - needs manual review');
    });

    it('should detect script tags', () => {
      const warnings = detectComplexHtml('<script>alert("hi")</script>');
      expect(warnings).toContain('Contains script tag - should be removed or converted');
    });

    it('should detect form elements', () => {
      const warnings = detectComplexHtml('<form><input type="text" /></form>');
      expect(warnings.some((w) => w.includes('form') || w.includes('input'))).toBe(true);
    });

    it('should return empty array for clean text', () => {
      const warnings = detectComplexHtml('Just plain markdown text');
      expect(warnings).toEqual([]);
    });
  });

  describe('postProcessProposal', () => {
    it('should convert HTML to markdown for .md files', () => {
      const result = postProcessProposal('<strong>bold</strong> text', 'docs/guide.md');
      expect(result.text).toBe('**bold** text');
      expect(result.wasModified).toBe(true);
    });

    it('should not modify non-markdown files', () => {
      const result = postProcessProposal('<strong>bold</strong>', 'index.html');
      expect(result.text).toBe('<strong>bold</strong>');
      expect(result.wasModified).toBe(false);
    });

    it('should not modify text without HTML', () => {
      const result = postProcessProposal('**Already markdown**', 'docs/guide.md');
      expect(result.text).toBe('**Already markdown**');
      expect(result.wasModified).toBe(false);
    });

    it('should add warnings for complex HTML', () => {
      const result = postProcessProposal('<table><tr><td>Data</td></tr></table>', 'docs/guide.md');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('table');
    });

    it('should handle undefined input', () => {
      const result = postProcessProposal(undefined, 'docs/guide.md');
      expect(result.text).toBe('');
      expect(result.warnings).toEqual([]);
      expect(result.wasModified).toBe(false);
    });
  });

  describe('postProcessProposals', () => {
    it('should process multiple proposals', () => {
      const proposals = [
        { suggestedText: '<strong>bold</strong>', page: 'docs/a.md' },
        { suggestedText: '<em>italic</em>', page: 'docs/b.md' },
        { suggestedText: '<b>html</b>', page: 'index.html' },
      ];

      const results = postProcessProposals(proposals);

      expect(results[0].suggestedText).toBe('**bold**');
      expect(results[1].suggestedText).toBe('*italic*');
      expect(results[2].suggestedText).toBe('<b>html</b>'); // HTML file, not converted
    });

    it('should preserve existing warnings', () => {
      const proposals = [
        {
          suggestedText: '<table></table>',
          page: 'docs/a.md',
          warnings: ['Existing warning'],
        },
      ];

      const results = postProcessProposals(proposals);

      expect(results[0].warnings).toContain('Existing warning');
      expect(results[0].warnings!.length).toBeGreaterThan(1);
    });
  });

  describe('edge cases - nested HTML', () => {
    it('should convert nested bold and italic', () => {
      const html = '<strong><em>bold italic</em></strong>';
      expect(convertHtmlToMarkdown(html)).toBe('***bold italic***');
    });

    it('should handle bold inside italic', () => {
      const html = '<em><strong>italic bold</strong></em>';
      expect(convertHtmlToMarkdown(html)).toBe('***italic bold***');
    });

    it('should handle link with bold text', () => {
      const html = '<a href="url"><strong>Bold Link</strong></a>';
      expect(convertHtmlToMarkdown(html)).toBe('[**Bold Link**](url)');
    });

    it('should handle multiple inline elements in paragraph', () => {
      const html = '<p>This is <strong>bold</strong> and <em>italic</em> text.</p>';
      expect(convertHtmlToMarkdown(html)).toBe('This is **bold** and *italic* text.');
    });

    it('should handle deeply nested elements', () => {
      const html = '<div><p><strong><em>deeply</em> nested</strong></p></div>';
      const result = convertHtmlToMarkdown(html);
      // "deeply" is both bold and italic, " nested" is just bold
      expect(result).toContain('***deeply*');
      expect(result).toContain('nested**');
    });
  });

  describe('edge cases - MDX admonitions', () => {
    it('should convert blockquote with info class to MDX admonition', () => {
      const html = '<blockquote class="info">This is info</blockquote>';
      const result = convertHtmlToMarkdown(html);
      expect(result).toContain(':::info');
      expect(result).toContain('This is info');
      expect(result).toContain(':::');
    });

    it('should convert blockquote with warning class', () => {
      const html = '<blockquote class="warning">Warning message</blockquote>';
      const result = convertHtmlToMarkdown(html);
      expect(result).toContain(':::warning');
    });

    it('should convert blockquote with tip class', () => {
      const html = '<blockquote class="tip">Pro tip here</blockquote>';
      const result = convertHtmlToMarkdown(html);
      expect(result).toContain(':::tip');
    });

    it('should convert blockquote with danger class', () => {
      const html = '<blockquote class="danger">Dangerous operation</blockquote>';
      const result = convertHtmlToMarkdown(html);
      expect(result).toContain(':::danger');
    });

    it('should convert blockquote with caution class', () => {
      const html = '<blockquote class="caution">Be careful</blockquote>';
      const result = convertHtmlToMarkdown(html);
      expect(result).toContain(':::caution');
    });

    it('should convert blockquote with success class to tip', () => {
      const html = '<blockquote class="success">Success!</blockquote>';
      const result = convertHtmlToMarkdown(html);
      expect(result).toContain(':::tip');
    });

    it('should convert blockquote with important class to warning', () => {
      const html = '<blockquote class="important">Important note</blockquote>';
      const result = convertHtmlToMarkdown(html);
      expect(result).toContain(':::warning');
    });

    it('should handle blockquote with nested HTML inside', () => {
      const html =
        '<blockquote class="info"><strong>Bold</strong> and <em>italic</em> content</blockquote>';
      const result = convertHtmlToMarkdown(html);
      expect(result).toContain(':::info');
      expect(result).toContain('**Bold**');
      expect(result).toContain('*italic*');
    });

    it('should handle blockquote with br tags inside', () => {
      const html = '<blockquote class="info">Line 1<br/>Line 2</blockquote>';
      const result = convertHtmlToMarkdown(html);
      expect(result).toContain(':::info');
      expect(result).toContain('Line 1');
      expect(result).toContain('Line 2');
    });

    it('should convert simple blockquote without class to > quote', () => {
      const html = '<blockquote>Simple quote</blockquote>';
      const result = convertHtmlToMarkdown(html);
      expect(result).toContain('> Simple quote');
      expect(result).not.toContain(':::');
    });
  });

  describe('edge cases - mixed content', () => {
    it('should handle markdown mixed with HTML', () => {
      const mixed = '# Heading\n\n<strong>Bold HTML</strong>\n\n**Already markdown**';
      const result = convertHtmlToMarkdown(mixed);
      expect(result).toContain('# Heading');
      expect(result).toContain('**Bold HTML**');
      expect(result).toContain('**Already markdown**');
    });

    it('should preserve code blocks while converting surrounding HTML', () => {
      const html = '<p>Before</p>\n<pre><code>const x = 1;</code></pre>\n<p>After</p>';
      const result = convertHtmlToMarkdown(html);
      expect(result).toContain('Before');
      expect(result).toContain('```');
      expect(result).toContain('const x = 1;');
      expect(result).toContain('After');
    });

    it('should preserve code block structure with HTML-like content', () => {
      // Note: Regex-based conversion will still process HTML-like tags inside code blocks
      // This is a known limitation - in practice, LLM proposals rarely have raw HTML inside code
      const html = '<pre><code>function test() {\n  console.log("hello");\n}</code></pre>';
      const result = convertHtmlToMarkdown(html);
      expect(result).toContain('```');
      expect(result).toContain('function test()');
      expect(result).toContain('console.log');
    });
  });

  describe('edge cases - malformed HTML', () => {
    it('should handle unclosed tags gracefully', () => {
      const html = '<strong>unclosed';
      // Should not throw
      expect(() => convertHtmlToMarkdown(html)).not.toThrow();
    });

    it('should handle empty tags', () => {
      const html = '<p></p><strong></strong>';
      expect(() => convertHtmlToMarkdown(html)).not.toThrow();
    });

    it('should handle tags with extra whitespace', () => {
      const html = '<p   >text<  /p>';
      expect(() => convertHtmlToMarkdown(html)).not.toThrow();
    });
  });

  describe('edge cases - special characters', () => {
    it('should preserve special markdown characters in content', () => {
      const html = '<p>Use *asterisks* and _underscores_</p>';
      const result = convertHtmlToMarkdown(html);
      expect(result).toContain('*asterisks*');
      expect(result).toContain('_underscores_');
    });

    it('should handle HTML entities', () => {
      const html = '<p>&lt;code&gt; and &amp;</p>';
      const result = convertHtmlToMarkdown(html);
      // Entities are preserved, not double-encoded
      expect(result).toContain('&lt;code&gt;');
      expect(result).toContain('&amp;');
    });
  });
});

describe('MarkdownFormattingPostProcessor', () => {
  describe('markdown headers running into text', () => {
    it('should add line break after ## TitleThe', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process(
        '## Rosetta API Architectural ConsiderationsThe Rosetta API is tightly',
        {
          targetFilePath: 'doc.md',
          fileExtension: 'md',
          isMarkdown: true,
          isHtml: false,
          originalText: '',
          previousWarnings: [],
        }
      );
      expect(result.text).toContain('Considerations\n\nThe Rosetta');
      expect(result.wasModified).toBe(true);
    });

    it('should add line break after ### TitleWhen', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process('### TroubleshootingWhen you encounter', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain('Troubleshooting\n\nWhen');
      expect(result.wasModified).toBe(true);
    });
  });

  describe('bold/italic headers running into text', () => {
    it('should add line break after ***Title***Cause:', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process(
        '***My node shows inconsistent DB State.***Cause: These errors indicate...',
        {
          targetFilePath: 'doc.md',
          fileExtension: 'md',
          isMarkdown: true,
          isHtml: false,
          originalText: '',
          previousWarnings: [],
        }
      );
      expect(result.text).toContain('***My node shows inconsistent DB State.***\n\nCause:');
      expect(result.wasModified).toBe(true);
    });

    it('should add line break after **Title**Text', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process('**Bold Header**Some text follows', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain('**Bold Header**\n\nSome text follows');
      expect(result.wasModified).toBe(true);
    });

    it('should not modify correctly formatted headers', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const input = '***Title***\n\nCause: properly formatted';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe(input);
      expect(result.wasModified).toBe(false);
    });
  });

  describe('numbered lists after colons (using ListFormattingPostProcessor)', () => {
    it('should add line break for Solution:1.', async () => {
      const { ListFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
      const processor = new ListFormattingPostProcessor();
      const result = processor.process('Solution:1. First step 2. Second step', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain('Solution:\n\n1. First step');
      expect(result.wasModified).toBe(true);
    });

    it('should add line breaks between consecutive numbered items', async () => {
      const { ListFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
      const processor = new ListFormattingPostProcessor();
      const result = processor.process('1. First item.2. Second item.3. Third item', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain('1. First item.\n\n2. Second item.\n\n3. Third item');
      expect(result.wasModified).toBe(true);
    });
  });

  describe('labels without line breaks', () => {
    it('should add line break after Cause: when followed by text', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process('Cause: These errors indicate a problem.', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain('Cause:\n\nThese errors');
      expect(result.wasModified).toBe(true);
    });

    it('should add line break after Solution: when followed by text', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process('Solution: Restart the node and check logs.', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain('Solution:\n\nRestart');
      expect(result.wasModified).toBe(true);
    });

    it('should not modify labels already followed by newline', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const input = 'Cause:\n\nThese errors indicate a problem.';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe(input);
      expect(result.wasModified).toBe(false);
    });
  });

  describe('complex real-world examples (full pipeline)', () => {
    it('should properly format LLM-generated proposal with multiple issues', async () => {
      const { postProcessProposal } =
        await import('../server/pipeline/utils/ProposalPostProcessor.js');

      const input =
        '***My node shows inconsistent DB State or DB Not Found.***Cause: Inconsistent DB state errors often indicate a corrupt state.Solution:1. Initial Attempt: Restart the node.2. Persistent Failure: Perform a full resync.3. Check Logs: Review node logs for specific errors.';

      const result = postProcessProposal(input, 'doc.md');

      // Should have line break after header (before Cause:)
      expect(result.text).toContain(
        '***My node shows inconsistent DB State or DB Not Found.***\n\nCause:'
      );
      // Should have line break before Solution (after sentence ending) and before list
      expect(result.text).toContain('state.\n\nSolution:\n\n1.');
      // Should have line breaks between list items
      expect(result.text).toContain('.\n\n2.');
      expect(result.text).toContain('.\n\n3.');
      expect(result.wasModified).toBe(true);
    });

    it('should handle proposal with bullet points', async () => {
      const { postProcessProposal } =
        await import('../server/pipeline/utils/ProposalPostProcessor.js');

      const input =
        'Cause: Multiple factors can contribute:* Network issues* Database corruption* Insufficient resources';

      const result = postProcessProposal(input, 'doc.md');

      // Should add line break after start label and before bullets
      expect(result.text).toContain('Cause:\n\nMultiple');
      // Should have line break before bullet points (after colon)
      expect(result.text).toContain('contribute:\n\n* Network');
      expect(result.wasModified).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should clean up excessive newlines', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process('Text\n\n\n\n\nMore text', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe('Text\n\nMore text');
      expect(result.wasModified).toBe(true);
    });

    it('should trim trailing whitespace on lines', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process('Line with trailing spaces   \nAnother line  ', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe('Line with trailing spaces\nAnother line');
      expect(result.wasModified).toBe(true);
    });

    it('should not process non-markdown files', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const shouldProcess = processor.shouldProcess({
        targetFilePath: 'doc.html',
        fileExtension: 'html',
        isMarkdown: false,
        isHtml: true,
        originalText: '',
        previousWarnings: [],
      });
      expect(shouldProcess).toBe(false);
    });

    it('should handle empty input', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process('', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe('');
      expect(result.wasModified).toBe(false);
    });
  });

  describe('section titles running into text (Fix 1d)', () => {
    it('should fix TroubleshootingIf pattern', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process(
        'TroubleshootingIf you notice that your node runs state sync',
        {
          targetFilePath: 'doc.md',
          fileExtension: 'md',
          isMarkdown: true,
          isHtml: false,
          originalText: '',
          previousWarnings: [],
        }
      );
      expect(result.text).toBe('Troubleshooting\n\nIf you notice that your node runs state sync');
      expect(result.wasModified).toBe(true);
    });

    it('should fix OverviewThe pattern', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process('OverviewThe following guide explains', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe('Overview\n\nThe following guide explains');
      expect(result.wasModified).toBe(true);
    });

    it('should fix PrerequisitesBefore pattern', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process('PrerequisitesBefore you begin, ensure', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe('Prerequisites\n\nBefore you begin, ensure');
      expect(result.wasModified).toBe(true);
    });

    it('should not modify correctly separated section titles', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const input = 'Troubleshooting\n\nIf you notice issues';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe(input);
      expect(result.wasModified).toBe(false);
    });
  });

  describe('admonition syntax running into text (Fix 1c)', () => {
    it('should fix :::note Title:::For pattern', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process(
        ':::note MacOS Performance Consideration:::For macOS users, especially',
        {
          targetFilePath: 'doc.md',
          fileExtension: 'md',
          isMarkdown: true,
          isHtml: false,
          originalText: '',
          previousWarnings: [],
        }
      );
      expect(result.text).toBe(
        ':::note MacOS Performance Consideration:::\n\nFor macOS users, especially'
      );
      expect(result.wasModified).toBe(true);
    });

    it('should fix :::warning Title:::This pattern', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process(':::warning Important:::This operation is dangerous', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe(':::warning Important:::\n\nThis operation is dangerous');
      expect(result.wasModified).toBe(true);
    });

    it('should fix :::tip:::Always pattern (no title)', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process(':::tip:::Always backup your data', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe(':::tip:::\n\nAlways backup your data');
      expect(result.wasModified).toBe(true);
    });

    it('should not modify correctly formatted admonitions', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const input = ':::note Title:::\n\nContent here';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe(input);
      expect(result.wasModified).toBe(false);
    });
  });

  describe('bold headers with colon running into text (Fix 1b)', () => {
    it('should fix **Title:**While pattern', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process('**Important Note:**While this works in most cases', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe('**Important Note:**\n\nWhile this works in most cases');
      expect(result.wasModified).toBe(true);
    });

    it('should fix ***Title:***Some pattern', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const result = processor.process('***Configuration:***Some settings require', {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe('***Configuration:***\n\nSome settings require');
      expect(result.wasModified).toBe(true);
    });
  });

  describe('real-world proposal formatting issues', () => {
    it('should fix actual proposal: TroubleshootingIf you notice that your node runs state sync', async () => {
      // Uses full pipeline: markdown (TroubleshootingIf) + list (colon + number)
      const { postProcessProposal } =
        await import('../server/pipeline/utils/ProposalPostProcessor.js');
      const input =
        "TroubleshootingIf you notice that your node runs state sync and it hasn't completed after 3 hours, please check the following:1. Config options related to the state sync";
      const result = postProcessProposal(input, 'doc.md');
      expect(result.text).toContain('Troubleshooting\n\nIf you notice');
      expect(result.text).toContain('following:\n\n1. Config');
      expect(result.wasModified).toBe(true);
    });

    it('should fix actual proposal: ***Title***Cause:', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const input =
        '***My node shows inconsistent DB State or DB Not Found.***Cause: Inconsistent DB state';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain(
        '***My node shows inconsistent DB State or DB Not Found.***\n\nCause:'
      );
      expect(result.wasModified).toBe(true);
    });

    it('should fix actual proposal: :::note:::For macOS', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const input =
        ':::note MacOS Performance Consideration:::For macOS users, especially those with Apple Silicon (aarch64) devices';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain(
        ':::note MacOS Performance Consideration:::\n\nFor macOS users'
      );
      expect(result.wasModified).toBe(true);
    });

    it('should fix complex proposal with multiple issues', async () => {
      // Uses full pipeline: markdown + list formatting
      const { postProcessProposal } =
        await import('../server/pipeline/utils/ProposalPostProcessor.js');
      const input =
        '***RPC Node stuck at genesis height***Cause: This often indicates network issues.Solution:1. Check your connection.2. Verify config settings.TroubleshootingIf the problem persists, contact support.';
      const result = postProcessProposal(input, 'doc.md');
      // Header should have line break after
      expect(result.text).toContain('***RPC Node stuck at genesis height***\n\nCause:');
      // Solution should be on new line with list properly formatted
      expect(result.text).toContain('issues.\n\nSolution:\n\n1.');
      // List items should have line breaks
      expect(result.text).toContain('.\n\n2.');
      // Troubleshooting should have line break after
      expect(result.text).toContain('Troubleshooting\n\nIf the problem');
      expect(result.wasModified).toBe(true);
    });

    it('should fix closing paren followed by number: migration)2. Finding', async () => {
      const { ListFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
      const processor = new ListFormattingPostProcessor();
      const input =
        '1. DB Migration (optional if the release contains a DB migration)2. Finding Peers';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain('migration)\n\n2. Finding');
      expect(result.wasModified).toBe(true);
    });

    it('should fix word directly followed by number: Sync5. Download', async () => {
      const { ListFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
      const processor = new ListFormattingPostProcessor();
      const input = '4. State Sync5. Download Blocks';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain('Sync\n\n5. Download');
      expect(result.wasModified).toBe(true);
    });

    it('should fix closing paren followed by dash bullet: Phase)- During', async () => {
      const { ListFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
      const processor = new ListFormattingPostProcessor();
      const input = '3. Download Headers (Header Sync Phase)- During this phase';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain('Phase)\n\n- During');
      expect(result.wasModified).toBe(true);
    });

    it('should fix period followed by number with bold: directory.2. **Check', async () => {
      const { ListFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
      const processor = new ListFormattingPostProcessor();
      const input = 'operations on the .app/data directory.2. **Check Disk Health:**';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain('directory.\n\n2. **Check');
      expect(result.wasModified).toBe(true);
    });

    it('should fix asterisk bullets after backticks: `code`* next', async () => {
      const { ListFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
      const processor = new ListFormattingPostProcessor();
      const input = '* `state_sync_enabled`* `state_sync`* `tracked_shards`';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain('`state_sync_enabled`\n\n* `state_sync`');
      expect(result.wasModified).toBe(true);
    });

    it('should fix asterisk bullets after sentence with multiple spaces', async () => {
      const { ListFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
      const processor = new ListFormattingPostProcessor();
      const input = 'reducing parallel test execution. *   **Operating System**: If possible';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain('execution.\n\n*   **Operating');
      expect(result.wasModified).toBe(true);
    });

    it('should fix asterisk bullets after sentence with single space', async () => {
      const { ListFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
      const processor = new ListFormattingPostProcessor();
      const input = 'Monitor disk I/O. * Check your node CPU usage';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toContain('I/O.\n\n* Check');
      expect(result.wasModified).toBe(true);
    });
  });
});

describe('Literal backslash-n conversion', () => {
  it('should convert literal \\n to actual newlines', async () => {
    const { ListFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
    const processor = new ListFormattingPostProcessor();
    // Note: In JavaScript, '\\n' is a literal backslash followed by n (2 chars)
    const input = 'Line 1\\nLine 2\\nLine 3';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('Line 1\nLine 2\nLine 3');
    expect(result.wasModified).toBe(true);
  });

  it('should convert literal \\n in code blocks', async () => {
    const { ListFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
    const processor = new ListFormattingPostProcessor();
    const input = '```bash\\n$ apt update\\n$ apt install git\\n```';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('```bash\n$ apt update\n$ apt install git\n```');
    expect(result.wasModified).toBe(true);
  });
});

describe('Labels after colons', () => {
  it('should fix Cause: after colon (not just .!?)', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = 'consider the following:Cause: Recent node upgrades';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toContain('following:\n\nCause:\n\nRecent');
    expect(result.wasModified).toBe(true);
  });

  it('should fix Solution: after colon', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = 'here is the issue:Solution: Try restarting';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toContain('issue:\n\nSolution:\n\nTry');
    expect(result.wasModified).toBe(true);
  });
});

describe('Numbered Labels', () => {
  it('should fix Solution 1: labels with numbers', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = "errors like 'MissingBlock'.Solution 1: Ensure correct release";
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toContain("'MissingBlock'.\n\nSolution 1:\n\nEnsure");
    expect(result.wasModified).toBe(true);
  });

  it('should fix Cause 2: labels with numbers', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = 'state (see above).Cause 2: State sync issues';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toContain('above).\n\nCause 2:\n\nState');
    expect(result.wasModified).toBe(true);
  });
});

describe('Full Pipeline Integration', () => {
  it('should apply both HTML conversion and markdown formatting', async () => {
    const { postProcessProposal } =
      await import('../server/pipeline/utils/ProposalPostProcessor.js');

    // HTML that becomes poorly formatted markdown
    const html =
      '<strong>Title</strong>Cause: <em>issues</em> occur.Solution:1. Step one.2. Step two.';

    const result = postProcessProposal(html, 'doc.md');

    // HTML should be converted
    expect(result.text).toContain('**Title**');
    expect(result.text).toContain('*issues*');
    // Formatting should be fixed - line break after bold title and before Solution
    expect(result.text).toContain('**Title**\n\n');
    expect(result.text).toContain('occur.\n\nSolution:\n\n1.');
    expect(result.wasModified).toBe(true);
  });

  it('should handle blockquote with class becoming admonition needing formatting', async () => {
    const { postProcessProposal } =
      await import('../server/pipeline/utils/ProposalPostProcessor.js');

    const html =
      '<blockquote class="warning"><strong>Performance Note</strong><br/>Some important warning text.</blockquote>';

    const result = postProcessProposal(html, 'doc.md');

    expect(result.text).toContain(':::warning');
    expect(result.text).toContain('**Performance Note**');
    expect(result.wasModified).toBe(true);
  });
});

describe('PostProcessorPipeline', () => {
  it('should be exported and usable', async () => {
    const { PostProcessorPipeline, HtmlToMarkdownPostProcessor } =
      await import('../server/pipeline/utils/ProposalPostProcessor.js');

    const pipeline = new PostProcessorPipeline([new HtmlToMarkdownPostProcessor()]);
    const result = pipeline.process('<strong>test</strong>', 'doc.md');
    expect(result.text).toBe('**test**');
  });

  it('should allow adding processors dynamically', async () => {
    const { PostProcessorPipeline, HtmlToMarkdownPostProcessor } =
      await import('../server/pipeline/utils/ProposalPostProcessor.js');

    const pipeline = new PostProcessorPipeline();
    pipeline.addProcessor(new HtmlToMarkdownPostProcessor());
    expect(pipeline.getProcessors().length).toBe(1);

    const result = pipeline.process('<em>italic</em>', 'doc.md');
    expect(result.text).toBe('*italic*');
  });

  it('should allow removing processors by name', async () => {
    const { PostProcessorPipeline, HtmlToMarkdownPostProcessor } =
      await import('../server/pipeline/utils/ProposalPostProcessor.js');

    const pipeline = new PostProcessorPipeline([new HtmlToMarkdownPostProcessor()]);
    expect(pipeline.getProcessors().length).toBe(1);

    const removed = pipeline.removeProcessor('html-to-markdown');
    expect(removed).toBe(true);
    expect(pipeline.getProcessors().length).toBe(0);

    // After removal, HTML is not converted
    const result = pipeline.process('<strong>test</strong>', 'doc.md');
    expect(result.text).toBe('<strong>test</strong>');
  });

  it('should skip disabled processors', async () => {
    const { PostProcessorPipeline, HtmlToMarkdownPostProcessor } =
      await import('../server/pipeline/utils/ProposalPostProcessor.js');

    const processor = new HtmlToMarkdownPostProcessor();
    processor.enabled = false;

    const pipeline = new PostProcessorPipeline([processor]);
    const result = pipeline.process('<strong>test</strong>', 'doc.md');
    expect(result.text).toBe('<strong>test</strong>');
    expect(result.wasModified).toBe(false);
  });

  it('should accumulate warnings from multiple processors', async () => {
    const { PostProcessorPipeline, HtmlToMarkdownPostProcessor } =
      await import('../server/pipeline/utils/ProposalPostProcessor.js');

    const pipeline = new PostProcessorPipeline([new HtmlToMarkdownPostProcessor()]);
    const result = pipeline.process('<table><tr><td>Data</td></tr></table>', 'doc.md');

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('table'))).toBe(true);
  });

  it('should handle empty input gracefully', async () => {
    const { PostProcessorPipeline, HtmlToMarkdownPostProcessor } =
      await import('../server/pipeline/utils/ProposalPostProcessor.js');

    const pipeline = new PostProcessorPipeline([new HtmlToMarkdownPostProcessor()]);

    const undefinedResult = pipeline.process(undefined, 'doc.md');
    expect(undefinedResult.text).toBe('');
    expect(undefinedResult.wasModified).toBe(false);

    const emptyResult = pipeline.process('', 'doc.md');
    expect(emptyResult.text).toBe('');
    expect(emptyResult.wasModified).toBe(false);
  });
});

// ============================================================================
// NEW FIXES TESTS (2026-01-06)
// ============================================================================

describe('Code Masking Utility', () => {
  it('should mask and unmask fenced code blocks', async () => {
    const { maskCodeSegments, unmaskCodeSegments } =
      await import('../server/pipeline/utils/post-processors/types.js');

    const input = 'Text before ```js\nconst x = 1;\n``` text after';
    const masked = maskCodeSegments(input);

    expect(masked.text).toContain('__CODE_BLOCK_');
    expect(masked.text).not.toContain('```');
    expect(masked.masks.size).toBe(1);

    const restored = unmaskCodeSegments(masked);
    expect(restored).toBe(input);
  });

  it('should mask and unmask inline code', async () => {
    const { maskCodeSegments, unmaskCodeSegments } =
      await import('../server/pipeline/utils/post-processors/types.js');

    const input = 'Use `rpc.mainnet.example.org` for mainnet';
    const masked = maskCodeSegments(input);

    expect(masked.text).toContain('__INLINE_CODE_');
    expect(masked.text).not.toContain('`rpc.mainnet.example.org`');
    expect(masked.masks.size).toBe(1);

    const restored = unmaskCodeSegments(masked);
    expect(restored).toBe(input);
  });

  it('should mask multiple code segments', async () => {
    const { maskCodeSegments, unmaskCodeSegments } =
      await import('../server/pipeline/utils/post-processors/types.js');

    const input = 'Use `code1` and `code2` with ```bash\necho test\n```';
    const masked = maskCodeSegments(input);

    expect(masked.masks.size).toBe(3); // 2 inline + 1 block

    const restored = unmaskCodeSegments(masked);
    expect(restored).toBe(input);
  });
});

describe('Fix #2: Sentence Run-on After Period', () => {
  it('should fix DataSync.Please pattern', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('DataSync.Please refer to the documentation', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('DataSync. Please refer to the documentation');
    expect(result.wasModified).toBe(true);
  });

  it('should fix deprecated.This pattern', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('deprecated.This method is no longer supported', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('deprecated. This method is no longer supported');
    expect(result.wasModified).toBe(true);
  });

  // Specific patterns from proposals.txt
  it('should fix error.Please pattern from proposals', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('403 error.Please refer to', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('403 error. Please refer to');
    expect(result.wasModified).toBe(true);
  });

  it('should fix issues.Ensure pattern from proposals', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('resolve temporary issues.Ensure your node', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('resolve temporary issues. Ensure your node');
    expect(result.wasModified).toBe(true);
  });

  it('should fix lifecycle.After pattern from proposals', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('validator lifecycle.After activation', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('validator lifecycle. After activation');
    expect(result.wasModified).toBe(true);
  });

  it('should fix service.After pattern from proposals', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('deprecated service.After the deprecation date', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('deprecated service. After the deprecation date');
    expect(result.wasModified).toBe(true);
  });

  it('should fix validator.This pattern from proposals', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('become a validator.This is a known issue', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('become a validator. This is a known issue');
    expect(result.wasModified).toBe(true);
  });

  // Patterns NOT in allowlist - should NOT be modified
  it('should NOT fix conventions.Always (Always not in allowlist)', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = 'Follow naming conventions.Always use descriptive names';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });

  it('should NOT fix ecosystem.Chunk (Chunk not in allowlist)', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = 'Kubernetes ecosystem.Chunk producers handle';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });

  it('should NOT modify non-sentence-starter words like JavaScript', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('foo.JavaScript runtime', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('foo.JavaScript runtime');
    expect(result.wasModified).toBe(false);
  });

  it('should NOT modify content inside inline code', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('Use `rpc.mainnet.example.org` for mainnet', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('Use `rpc.mainnet.example.org` for mainnet');
    expect(result.wasModified).toBe(false);
  });

  it('should NOT modify content inside fenced code blocks', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = '```js\nfoo.The value\n```';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });
});

describe('Fix #3: Bold Header + Numbered List', () => {
  it('should fix **Title:**1. pattern (colon inside bold)', async () => {
    const { ListFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
    const processor = new ListFormattingPostProcessor();
    const result = processor.process('**Accessing GCS Snapshots:**1. First step', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('**Accessing GCS Snapshots:**\n\n1. First step');
    expect(result.wasModified).toBe(true);
  });

  // Other specific patterns from proposals.txt
  it('should fix **Identification Methods:**1. pattern from proposals', async () => {
    const { ListFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
    const processor = new ListFormattingPostProcessor();
    const result = processor.process('**Identification Methods:**1. Check the logs', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('**Identification Methods:**\n\n1. Check the logs');
    expect(result.wasModified).toBe(true);
  });

  it('should fix **Troubleshooting Steps:**1. pattern from proposals', async () => {
    const { ListFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
    const processor = new ListFormattingPostProcessor();
    const result = processor.process('**Troubleshooting Steps:**1. Restart the node', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('**Troubleshooting Steps:**\n\n1. Restart the node');
    expect(result.wasModified).toBe(true);
  });

  it('should fix **Title**:1. pattern (colon outside bold)', async () => {
    const { ListFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
    const processor = new ListFormattingPostProcessor();
    const result = processor.process('**Title**:1. First step', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('**Title**:\n\n1. First step');
    expect(result.wasModified).toBe(true);
  });

  it('should fix ***Title:***1. pattern (bold+italic)', async () => {
    const { ListFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
    const processor = new ListFormattingPostProcessor();
    const result = processor.process('***Important Note:***1. First item', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('***Important Note:***\n\n1. First item');
    expect(result.wasModified).toBe(true);
  });

  it('should NOT modify already formatted bold + list', async () => {
    const { ListFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
    const processor = new ListFormattingPostProcessor();
    const input = '**Title:**\n\n1. First step';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });
});

describe('Fix #4: Missing Space After Markdown Link', () => {
  it('should fix ](url)This pattern', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('[link](https://example.com)This continues', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('[link](https://example.com) This continues');
    expect(result.wasModified).toBe(true);
  });

  // Specific pattern from proposals.txt
  it('should fix ](https://docs.example.com/docs/snapshots)T pattern from proposals', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process(
      '[Snapshots Documentation](https://docs.example.com/docs/snapshots)This resource will guide',
      {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      }
    );
    expect(result.text).toBe(
      '[Snapshots Documentation](https://docs.example.com/docs/snapshots) This resource will guide'
    );
    expect(result.wasModified).toBe(true);
  });

  it('should fix ](url)123 pattern (number after link)', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('[docs](url)123 items', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('[docs](url) 123 items');
    expect(result.wasModified).toBe(true);
  });

  it('should fix ](url)"Quoted pattern (quote after link)', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('[link](url)"Quoted text"', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('[link](url) "Quoted text"');
    expect(result.wasModified).toBe(true);
  });

  it('should NOT modify link followed by punctuation', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = '[link](url). Next sentence';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });

  it('should NOT modify link inside code block', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = '```\n[link](url)This\n```';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });
});

describe('Fix #5: Trailing Separator Garbage', () => {
  it('should remove trailing ======== at end of text', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('Content here\n\n========================================', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('Content here');
    expect(result.wasModified).toBe(true);
  });

  it('should NOT remove setext heading mid-document', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = 'Title\n======\n\nContent here';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });
});

describe('Fix #6: Period Before Bold (Missing Space)', () => {
  it('should fix available.**As of pattern', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('no longer available.**As of June 1st', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('no longer available. **As of June 1st');
    expect(result.wasModified).toBe(true);
  });

  it('should fix period before ***bold+italic', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('something.***Important Note***', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('something. ***Important Note***');
    expect(result.wasModified).toBe(true);
  });

  it('should NOT modify list items like 1.**Bold**', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = '1.**Bold** text here';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });

  it('should NOT modify ellipsis before bold', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    // The guard requires lowercase before period, so ...**Bold won't match
    const input = '...**Bold**';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });

  it('should NOT modify bold inside code block', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = '```\nfoo.**Bar**\n```';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });
});

describe('Combined New Fixes Integration', () => {
  it('should fix multiple issues in one proposal', async () => {
    const { postProcessProposal } =
      await import('../server/pipeline/utils/ProposalPostProcessor.js');

    // Combines: sentence run-on, link spacing, period before bold
    const input =
      'DataSync.Please refer to [docs](https://example.com)This is deprecated.**Note:** Content';

    const result = postProcessProposal(input, 'doc.md');

    // Sentence run-on fixed
    expect(result.text).toContain('DataSync. Please');
    // Link spacing fixed
    expect(result.text).toContain('](https://example.com) This');
    // Period before bold fixed
    expect(result.text).toContain('deprecated. **Note:**');
    expect(result.wasModified).toBe(true);
  });

  it('should handle real proposal with trailing separator', async () => {
    const { postProcessProposal } =
      await import('../server/pipeline/utils/ProposalPostProcessor.js');

    const input = `## Custom Data Retention

Some content here about data retention.

========================================

`;

    const result = postProcessProposal(input, 'doc.md');

    expect(result.text).not.toContain('====');
    expect(result.text).toContain('Some content here');
    expect(result.wasModified).toBe(true);
  });
});

// ============================================================================
// CODE REVIEW SUGGESTED TESTS (2026-01-06)
// Verify code masking protects patterns inside code blocks
// ============================================================================

describe('Code Block Protection - Review Tests', () => {
  describe('Fenced code blocks should remain unchanged', () => {
    // Fix 1b is now code-masked (code masking moved earlier in process)
    it('should NOT modify Fix 1b pattern (**Title**Cause:) inside fenced code block', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const input = '```markdown\n**Bold Header**Cause: text\n```';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe(input);
      expect(result.wasModified).toBe(false);
    });

    // Fix 1c is now code-masked (code masking moved earlier in process)
    it('should NOT modify Fix 1c pattern (**Title:**While) inside fenced code block', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const input = '```\n**Important Note:**While this works\n```';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe(input);
      expect(result.wasModified).toBe(false);
    });

    // ListFormattingPostProcessor now uses code masking
    it('should NOT modify Fix 6b pattern (**Steps:**1.) inside fenced code block', async () => {
      const { ListFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
      const processor = new ListFormattingPostProcessor();
      const input = '```\n**Steps:**1. First\n```';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe(input);
      expect(result.wasModified).toBe(false);
    });

    // Fix 3c is now code-masked (code masking moved earlier in process)
    it('should NOT modify Fix 3c pattern (Cause:) inside fenced code block', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const input = '```\nfollowing:Cause: Recent\n```';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe(input);
      expect(result.wasModified).toBe(false);
    });
  });

  describe('Inline code should remain unchanged', () => {
    it('should NOT modify ](url)This pattern inside inline code', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const input = 'Use `[link](url)This` syntax';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe(input);
      expect(result.wasModified).toBe(false);
    });

    // Labels before inline code should not be treated as formatting issues
    // Fixed by adding negative lookahead (?!`) in label patterns
    it('should NOT treat Example: before inline code as a label', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const input = 'Example: `foo.**Bold**` syntax';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe(input);
      expect(result.wasModified).toBe(false);
    });

    it('should NOT modify Cause: pattern inside inline code', async () => {
      const { MarkdownFormattingPostProcessor } =
        await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
      const processor = new MarkdownFormattingPostProcessor();
      const input = 'Use `Cause: message` format';
      const result = processor.process(input, {
        targetFilePath: 'doc.md',
        fileExtension: 'md',
        isMarkdown: true,
        isHtml: false,
        originalText: '',
        previousWarnings: [],
      });
      expect(result.text).toBe(input);
      expect(result.wasModified).toBe(false);
    });
  });
});

describe('Legitimate CamelCase Identifiers in Headers', () => {
  it('should NOT split ## RocksDB Internals (DB is uppercase, not sentence starter)', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = '## RocksDB Internals';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });

  it('should NOT split ## JavaScript Runtime (Script not sentence starter)', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = '## JavaScript Runtime';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });

  it('should NOT split ## TestNet Deployment (Net not sentence starter)', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = '## TestNet Deployment';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });

  it('should split ## ConsiderationsThe text (The IS sentence starter)', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('## ConsiderationsThe text continues', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('## Considerations\n\nThe text continues');
    expect(result.wasModified).toBe(true);
  });

  it('should split at sentence starter but NOT at CamelCase in same header', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    // "Net" is not a sentence starter, "For" is
    const result = processor.process('### TestNet DeploymentFor testing purposes', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    // Should preserve TestNet but split at For
    expect(result.text).toBe('### TestNet Deployment\n\nFor testing purposes');
    expect(result.wasModified).toBe(true);
  });
});

describe('Setext Heading Behavior', () => {
  it('should preserve setext heading mid-document (Title followed by ===)', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = 'Title\n======\n\nContent here';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });

  it('should remove orphan ===== at end with no text above', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = 'Content\n\n\n========';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('Content');
    expect(result.wasModified).toBe(true);
  });

  it('should handle setext heading immediately before trailing separator', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    // Valid setext heading followed by trailing garbage
    const input = 'Title\n======\n\nContent\n\n========';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    // Should preserve the setext heading but remove trailing separator
    expect(result.text).toBe('Title\n======\n\nContent');
    expect(result.wasModified).toBe(true);
  });
});

describe('Additional Code Masking Edge Cases', () => {
  it('should NOT modify .**Bold pattern inside inline code', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = 'Use `text.**Bold**` for emphasis';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });

  it('should NOT modify DataSync.Please pattern inside fenced code block (Fix 6 is code-masked)', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = '```\nconst msg = "DataSync.Please check the docs";\n```';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });

  it('should NOT modify sentence run-on inside inline code', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = 'Run `validator.This` to check';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });

  it('should NOT modify trailing separator inside fenced code block', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = '```\n========\n```\n\nMore content';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });
});

describe('Fix 7 Link Spacing Edge Cases', () => {
  it('should add space after link followed by opening paren', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('[link](url)(see docs)', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('[link](url) (see docs)');
    expect(result.wasModified).toBe(true);
  });

  it('should add space after link followed by straight double quote', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('[link](url)"quoted text"', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('[link](url) "quoted text"');
    expect(result.wasModified).toBe(true);
  });

  it('should add space after link followed by curly quote', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const result = processor.process('[link](url)"quoted text"', {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe('[link](url) "quoted text"');
    expect(result.wasModified).toBe(true);
  });

  it('should NOT add space after link followed by punctuation', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = '[link](url), and more';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });

  it('should NOT add space after link already followed by space', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();
    const input = '[link](url) This continues';
    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });
    expect(result.text).toBe(input);
    expect(result.wasModified).toBe(false);
  });
});

/**
 * ============================================================================
 * PRODUCTION DATA ISSUE REPRODUCTION TESTS
 * ============================================================================
 *
 * These tests document formatting issues found in production proposals.
 * Tests are marked with `.fails` or `.skip` to track known issues until fixed.
 *
 * Issues identified from database review (2026-01-07):
 * 1. Random "O" characters inserted between text
 * 2. Code blocks with commands concatenated (no newlines)
 * 3. Escaped double quotes ("" instead of ")
 * 4. JSON configs on single lines
 * 5. List items running together
 */

describe('Production Data Issues - Random O Characters (ID 1187)', () => {
  // Issue: Random "O" letter appearing between text segments
  // Example: "commandO commandO" instead of "command\ncommand"
  // FIXED: fixRandomOCharacters in CodeBlockFormattingPostProcessor

  it('should not have random O characters between code commands', async () => {
    const { CodeBlockFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/CodeBlockFormattingPostProcessor.js');
    const processor = new CodeBlockFormattingPostProcessor();

    // Simulated input with random "O" character issue
    const input = `To check your service status, run:

\`\`\`bash
curl http://localhost:8080/health | grep statusO echo "done"
\`\`\``;

    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });

    // Expected: Commands should be on separate lines, no random "O"
    expect(result.text).toContain('grep status\necho "done"');
    expect(result.text).not.toMatch(/statusO\s*echo/);
  });
});

describe('Production Data Issues - Code Blocks Without Newlines (IDs 1218, 1216, 1212)', () => {
  // Issue: Multiple commands concatenated on single line within code blocks
  // Example: "git pull git push" instead of "git pull\ngit push"
  // FIXED: splitConcatenatedCommands in CodeBlockFormattingPostProcessor

  it('should detect and fix concatenated bash commands', async () => {
    const { CodeBlockFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/CodeBlockFormattingPostProcessor.js');
    const processor = new CodeBlockFormattingPostProcessor();

    // Commands concatenated without newlines
    const input = `\`\`\`bash
curl http://localhost/health echo "check complete" git status
\`\`\``;

    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });

    // Commands should be on separate lines
    expect(result.text).toContain('curl http://localhost/health\n');
    expect(result.text).toContain('echo "check complete"\n');
    expect(result.text).toContain('git status');
  });

  it('should detect concatenated docker commands', async () => {
    const { CodeBlockFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/CodeBlockFormattingPostProcessor.js');
    const processor = new CodeBlockFormattingPostProcessor();

    // docker commands run together
    const input = `\`\`\`
docker ps docker logs docpythia-app
\`\`\``;

    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });

    expect(result.text).toContain('docker ps\n');
    expect(result.text).toContain('docker logs docpythia-app');
  });

  it('should fix concatenated shell commands with pipes', async () => {
    const { CodeBlockFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/CodeBlockFormattingPostProcessor.js');
    const processor = new CodeBlockFormattingPostProcessor();

    // Shell commands that should be separate
    const input = `\`\`\`bash
curl -s https://api.example.com/status | jq '.version' echo "Done"
\`\`\``;

    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });

    // The echo should be on a new line
    expect(result.text).toContain("jq '.version'\necho");
  });
});

describe('Production Data Issues - Escaped Double Quotes', () => {
  // Issue: Escaped quotes appearing as "" instead of proper "
  // This often happens with JSON values or quoted strings
  // FIXED: Fix 6b in MarkdownFormattingPostProcessor

  it('should fix doubled quotes in inline content', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();

    // Doubled quotes from CSV/JSON escaping issues
    const input = `Set the ""archive"" field to ""true"" in your config.`;

    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });

    // Quotes should be normalized
    expect(result.text).toBe('Set the "archive" field to "true" in your config.');
  });

  it('should fix doubled quotes in configuration examples', async () => {
    const { MarkdownFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/MarkdownFormattingPostProcessor.js');
    const processor = new MarkdownFormattingPostProcessor();

    // Common in JSON configuration snippets
    const input = `The ""tracked_shards"" array should contain ""all"" for archival nodes.`;

    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });

    expect(result.text).toBe('The "tracked_shards" array should contain "all" for archival nodes.');
  });
});

describe('Production Data Issues - JSON on Single Line', () => {
  // Issue: JSON configurations not properly formatted with newlines
  // Example: {"field": "value", "field2": "value2"} instead of multi-line
  // FIXED: formatJson in CodeBlockFormattingPostProcessor

  it('should format inline JSON config in documentation', async () => {
    const { CodeBlockFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/CodeBlockFormattingPostProcessor.js');
    const processor = new CodeBlockFormattingPostProcessor();

    // Single-line JSON that should be formatted
    const input = `Add this to your config.json:

\`\`\`json
{"archive": true, "tracked_shards": ["all"], "gc": {"gc_blocks_limit": 10000}}
\`\`\``;

    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });

    // JSON should be multi-line for readability
    expect(result.text).toContain('"archive": true,\n');
    expect(result.text).toContain('"tracked_shards": [\n');
  });

  it('should format complex nested JSON', async () => {
    const { CodeBlockFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/CodeBlockFormattingPostProcessor.js');
    const processor = new CodeBlockFormattingPostProcessor();

    const input = `\`\`\`json
{"network": {"boot_nodes": ["ed25519:...@mainnet.example.org:24567"]}, "rpc": {"addr": "0.0.0.0:3030"}}
\`\`\``;

    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });

    // Should have proper JSON formatting
    expect(result.text).toContain('"network": {\n');
    expect(result.text).toContain('"boot_nodes":');
  });
});

describe('Production Data Issues - List Items Concatenated', () => {
  // Issue: List items running together without proper line breaks
  // Example: "- item 1- item 2" instead of "- item 1\n- item 2"
  // FIXED: Fix 7b and 8b in ListFormattingPostProcessor

  it('should fix bullet list items concatenated together', async () => {
    const { ListFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
    const processor = new ListFormattingPostProcessor();

    // List items without line breaks
    const input = `Common issues include:- Node not syncing properly- Missing blocks in database- High CPU usage during sync`;

    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });

    expect(result.text).toContain('include:\n\n- Node not syncing');
    expect(result.text).toContain('properly\n\n- Missing blocks');
    expect(result.text).toContain('database\n\n- High CPU');
  });

  it('should fix asterisk list items concatenated', async () => {
    const { ListFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
    const processor = new ListFormattingPostProcessor();

    // Asterisk lists run together
    const input = `Prerequisites:* Valid admin account* Access to RPC node* Sufficient disk space`;

    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });

    expect(result.text).toContain('Prerequisites:\n\n* Valid admin');
    expect(result.text).toContain('account\n\n* Access to');
    expect(result.text).toContain('node\n\n* Sufficient');
  });

  // These patterns ARE already handled by Fix 6 in ListFormattingPostProcessor
  it('should fix numbered list items concatenated (already working)', async () => {
    const { ListFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
    const processor = new ListFormattingPostProcessor();

    // Numbered list items run together
    const input = `Follow these steps:1. Stop the validator service2. Backup your data directory3. Download the latest snapshot4. Start the validator again`;

    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });

    expect(result.text).toContain('steps:\n\n1. Stop');
    expect(result.text).toContain('service\n\n2. Backup');
    expect(result.text).toContain('directory\n\n3. Download');
    expect(result.text).toContain('snapshot\n\n4. Start');
  });

  it('should fix mixed sentence-list concatenation (already working)', async () => {
    const { ListFormattingPostProcessor } =
      await import('../server/pipeline/utils/post-processors/ListFormattingPostProcessor.js');
    const processor = new ListFormattingPostProcessor();

    // Sentence ending directly followed by list number
    const input = `This is important to understand.1. First step2. Second step`;

    const result = processor.process(input, {
      targetFilePath: 'doc.md',
      fileExtension: 'md',
      isMarkdown: true,
      isHtml: false,
      originalText: '',
      previousWarnings: [],
    });

    expect(result.text).toContain('understand.\n\n1. First');
    expect(result.text).toContain('step\n\n2. Second');
  });
});
