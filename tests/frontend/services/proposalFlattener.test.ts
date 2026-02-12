/**
 * ProposalFlattener Service Tests
 * Tests for flattening conversation/proposal data for UI display

 */

import { describe, it, expect } from 'vitest';
import {
  flattenConversations,
  type ConversationData,
} from '../../../client/src/services/proposalFlattener';

describe('proposalFlattener', () => {
  describe('flattenConversations', () => {
    it('should return empty array for undefined input', () => {
      const result = flattenConversations(undefined);
      expect(result).toEqual([]);
    });

    it('should return empty array for null input', () => {
      const result = flattenConversations(null as any);
      expect(result).toEqual([]);
    });

    it('should return empty array for non-array input', () => {
      const result = flattenConversations({} as any);
      expect(result).toEqual([]);
    });

    it('should return empty array for empty array input', () => {
      const result = flattenConversations([]);
      expect(result).toEqual([]);
    });

    it('should skip conversations without proposals', () => {
      const conversations: ConversationData[] = [
        {
          conversation_id: 'conv-1',
          category: 'setup',
          message_count: 5,
          messages: [],
          proposals: [],
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);
      expect(result).toEqual([]);
    });

    it('should flatten a single conversation with one proposal', () => {
      const conversations: ConversationData[] = [
        {
          conversation_id: 'conv-123',
          category: 'troubleshooting',
          message_count: 3,
          messages: [{ id: 1, content: 'Test message' }],
          proposals: [
            {
              id: 1,
              page: 'docs/setup.md',
              update_type: 'INSERT',
              reasoning: 'Add missing step',
              suggested_text: '## New Section\n\nNew content here',
              status: 'pending',
              created_at: '2024-01-02T00:00:00Z',
            },
          ],
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
      expect(result[0].sectionId).toBe('docs/setup.md');
      expect(result[0].page).toBe('docs/setup.md');
      expect(result[0].type).toBe('add');
      expect(result[0].summary).toBe('Add missing step');
      expect(result[0].diffAfter).toBe('## New Section\n\nNew content here');
      expect(result[0].status).toBe('pending');
      expect(result[0].conversationContext.conversation_id).toBe('conv-123');
    });

    it('should flatten multiple proposals from same conversation', () => {
      const conversations: ConversationData[] = [
        {
          conversation_id: 'conv-456',
          category: 'feature-request',
          message_count: 10,
          messages: [],
          proposals: [
            {
              id: 1,
              page: 'docs/api.md',
              update_type: 'UPDATE',
              reasoning: 'Fix typo',
              suggested_text: 'Corrected text',
              status: 'pending',
            },
            {
              id: 2,
              page: 'docs/config.md',
              update_type: 'INSERT',
              reasoning: 'Add example',
              suggested_text: '```json\n{"key": "value"}\n```',
              status: 'approved',
            },
          ],
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);

      expect(result).toHaveLength(2);
      expect(result[0].page).toBe('docs/api.md');
      expect(result[0].type).toBe('major');
      expect(result[1].page).toBe('docs/config.md');
      expect(result[1].type).toBe('add');
      expect(result[1].status).toBe('approved');
    });

    it('should flatten proposals from multiple conversations', () => {
      const conversations: ConversationData[] = [
        {
          conversation_id: 'conv-1',
          category: 'bug',
          message_count: 2,
          messages: [],
          proposals: [
            {
              id: 1,
              page: 'docs/a.md',
              update_type: 'DELETE',
              reasoning: 'Remove outdated info',
              suggested_text: '',
              status: 'pending',
            },
          ],
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          conversation_id: 'conv-2',
          category: 'question',
          message_count: 4,
          messages: [],
          proposals: [
            {
              id: 2,
              page: 'docs/b.md',
              update_type: 'UPDATE',
              reasoning: 'Clarify wording',
              suggested_text: 'Clear explanation',
              status: 'ignored',
            },
          ],
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('delete');
      expect(result[0].conversationContext.conversation_id).toBe('conv-1');
      expect(result[1].type).toBe('major');
      expect(result[1].status).toBe('rejected'); // 'ignored' maps to 'rejected'
      expect(result[1].conversationContext.conversation_id).toBe('conv-2');
    });
  });

  describe('updateType mapping', () => {
    const createConversation = (updateType: string): ConversationData[] => [
      {
        conversation_id: 'conv-test',
        category: 'test',
        message_count: 1,
        messages: [],
        proposals: [
          {
            id: 1,
            page: 'docs/test.md',
            update_type: updateType,
            reasoning: 'Test',
            suggested_text: 'Test content',
            status: 'pending',
          },
        ],
        created_at: '2024-01-01T00:00:00Z',
      },
    ];

    it('should map INSERT to add', () => {
      const result = flattenConversations(createConversation('INSERT'));
      expect(result[0].type).toBe('add');
    });

    it('should map UPDATE to major', () => {
      const result = flattenConversations(createConversation('UPDATE'));
      expect(result[0].type).toBe('major');
    });

    it('should map DELETE to delete', () => {
      const result = flattenConversations(createConversation('DELETE'));
      expect(result[0].type).toBe('delete');
    });

    it('should map NONE to minor', () => {
      const result = flattenConversations(createConversation('NONE'));
      expect(result[0].type).toBe('minor');
    });

    it('should default unknown types to major', () => {
      const result = flattenConversations(createConversation('UNKNOWN'));
      expect(result[0].type).toBe('major');
    });

    // Test camelCase variant (updateType vs update_type)
    it('should handle camelCase updateType field', () => {
      const conversations: ConversationData[] = [
        {
          conversation_id: 'conv-test',
          category: 'test',
          message_count: 1,
          messages: [],
          proposals: [
            {
              id: 1,
              page: 'docs/test.md',
              updateType: 'INSERT', // camelCase
              reasoning: 'Test',
              suggestedText: 'Test content',
              status: 'pending',
            },
          ],
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);
      expect(result[0].type).toBe('add');
    });
  });

  describe('status mapping', () => {
    const createConversation = (status: string): ConversationData[] => [
      {
        conversation_id: 'conv-test',
        category: 'test',
        message_count: 1,
        messages: [],
        proposals: [
          {
            id: 1,
            page: 'docs/test.md',
            update_type: 'UPDATE',
            reasoning: 'Test',
            suggested_text: 'Test content',
            status,
          },
        ],
        created_at: '2024-01-01T00:00:00Z',
      },
    ];

    it('should map pending to pending', () => {
      const result = flattenConversations(createConversation('pending'));
      expect(result[0].status).toBe('pending');
    });

    it('should map approved to approved', () => {
      const result = flattenConversations(createConversation('approved'));
      expect(result[0].status).toBe('approved');
    });

    it('should map ignored to rejected', () => {
      const result = flattenConversations(createConversation('ignored'));
      expect(result[0].status).toBe('rejected');
    });

    it('should default unknown status to pending', () => {
      const result = flattenConversations(createConversation('unknown_status'));
      expect(result[0].status).toBe('pending');
    });
  });

  describe('content field handling', () => {
    it('should prefer edited_text over suggested_text', () => {
      const conversations: ConversationData[] = [
        {
          conversation_id: 'conv-test',
          category: 'test',
          message_count: 1,
          messages: [],
          proposals: [
            {
              id: 1,
              page: 'docs/test.md',
              update_type: 'UPDATE',
              reasoning: 'Test',
              suggested_text: 'Original suggestion',
              edited_text: 'User edited version',
              status: 'pending',
            },
          ],
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);
      expect(result[0].diffAfter).toBe('User edited version');
    });

    it('should fall back to suggested_text when edited_text is not present', () => {
      const conversations: ConversationData[] = [
        {
          conversation_id: 'conv-test',
          category: 'test',
          message_count: 1,
          messages: [],
          proposals: [
            {
              id: 1,
              page: 'docs/test.md',
              update_type: 'UPDATE',
              reasoning: 'Test',
              suggested_text: 'Original suggestion',
              status: 'pending',
            },
          ],
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);
      expect(result[0].diffAfter).toBe('Original suggestion');
    });

    it('should handle camelCase editedText/suggestedText fields', () => {
      const conversations: ConversationData[] = [
        {
          conversation_id: 'conv-test',
          category: 'test',
          message_count: 1,
          messages: [],
          proposals: [
            {
              id: 1,
              page: 'docs/test.md',
              updateType: 'UPDATE',
              reasoning: 'Test',
              suggestedText: 'CamelCase suggested',
              editedText: 'CamelCase edited',
              status: 'pending',
            },
          ],
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);
      expect(result[0].diffAfter).toBe('CamelCase edited');
    });
  });

  describe('content format scenarios by file type', () => {
    describe('Markdown files (.md)', () => {
      it('should preserve markdown formatting in suggestedText', () => {
        const markdownContent = `## New Section

This is a paragraph with **bold** and *italic* text.

### Code Example

\`\`\`javascript
const example = "test";
console.log(example);
\`\`\`

- List item 1
- List item 2
- List item 3

[Link to docs](https://example.com)`;

        const conversations: ConversationData[] = [
          {
            conversation_id: 'conv-md',
            category: 'docs',
            message_count: 1,
            messages: [],
            proposals: [
              {
                id: 1,
                page: 'docs/example.md',
                update_type: 'INSERT',
                reasoning: 'Add comprehensive section',
                suggested_text: markdownContent,
                status: 'pending',
              },
            ],
            created_at: '2024-01-01T00:00:00Z',
          },
        ];

        const result = flattenConversations(conversations);
        expect(result[0].diffAfter).toBe(markdownContent);
        expect(result[0].diffAfter).toContain('## New Section');
        expect(result[0].diffAfter).toContain('```javascript');
        expect(result[0].diffAfter).toContain('- List item');
        expect(result[0].page).toBe('docs/example.md');
      });

      it('should handle code blocks with different languages', () => {
        const codeContent = `## Code Examples

JavaScript:
\`\`\`javascript
const x = 1;
\`\`\`

Python:
\`\`\`python
x = 1
\`\`\`

Rust:
\`\`\`rust
let x = 1;
\`\`\`

Custom CLI:
\`\`\`bash
myapp view contract.example method_name
\`\`\``;

        const conversations: ConversationData[] = [
          {
            conversation_id: 'conv-code',
            category: 'docs',
            message_count: 1,
            messages: [],
            proposals: [
              {
                id: 1,
                page: 'docs/code.md',
                update_type: 'INSERT',
                reasoning: 'Add code examples',
                suggested_text: codeContent,
                status: 'pending',
              },
            ],
            created_at: '2024-01-01T00:00:00Z',
          },
        ];

        const result = flattenConversations(conversations);
        expect(result[0].diffAfter).toContain('```javascript');
        expect(result[0].diffAfter).toContain('```python');
        expect(result[0].diffAfter).toContain('```rust');
        expect(result[0].diffAfter).toContain('```bash');
      });
    });

    describe('HTML files (.html)', () => {
      it('should preserve HTML content for .html files', () => {
        const htmlContent = `<section id="setup">
  <h2>Setup Instructions</h2>
  <p>Follow these steps to get started:</p>
  <ol>
    <li>Install dependencies</li>
    <li>Configure environment</li>
    <li>Run the application</li>
  </ol>
  <pre><code class="language-bash">npm install</code></pre>
</section>`;

        const conversations: ConversationData[] = [
          {
            conversation_id: 'conv-html',
            category: 'docs',
            message_count: 1,
            messages: [],
            proposals: [
              {
                id: 1,
                page: 'docs/setup.html',
                update_type: 'INSERT',
                reasoning: 'Add setup section',
                suggested_text: htmlContent,
                status: 'pending',
              },
            ],
            created_at: '2024-01-01T00:00:00Z',
          },
        ];

        const result = flattenConversations(conversations);
        expect(result[0].diffAfter).toBe(htmlContent);
        expect(result[0].diffAfter).toContain('<h2>');
        expect(result[0].diffAfter).toContain('<ol>');
        expect(result[0].diffAfter).toContain('<pre><code');
        expect(result[0].page).toBe('docs/setup.html');
      });

      it('should handle HTML with inline styles and classes', () => {
        const styledHtml = `<div class="warning" style="background: yellow;">
  <strong>Warning:</strong> This is important!
</div>`;

        const conversations: ConversationData[] = [
          {
            conversation_id: 'conv-styled-html',
            category: 'docs',
            message_count: 1,
            messages: [],
            proposals: [
              {
                id: 1,
                page: 'templates/warning.html',
                update_type: 'INSERT',
                reasoning: 'Add warning component',
                suggested_text: styledHtml,
                status: 'pending',
              },
            ],
            created_at: '2024-01-01T00:00:00Z',
          },
        ];

        const result = flattenConversations(conversations);
        expect(result[0].diffAfter).toContain('class="warning"');
        expect(result[0].diffAfter).toContain('style="background: yellow;"');
      });
    });

    describe('MDX files (.mdx)', () => {
      it('should preserve MDX content with JSX components', () => {
        const mdxContent = `import { Callout } from '@/components/Callout'

## Getting Started

<Callout type="info">
  This is an informational callout component.
</Callout>

Here's how to install:

\`\`\`bash
npm install @example/sdk
\`\`\`

<CodeTabs>
  <Tab label="JavaScript">
    \`\`\`js
    const client = new Client();
    \`\`\`
  </Tab>
  <Tab label="Rust">
    \`\`\`rust
    let client = Client::new();
    \`\`\`
  </Tab>
</CodeTabs>`;

        const conversations: ConversationData[] = [
          {
            conversation_id: 'conv-mdx',
            category: 'docs',
            message_count: 1,
            messages: [],
            proposals: [
              {
                id: 1,
                page: 'docs/getting-started.mdx',
                update_type: 'INSERT',
                reasoning: 'Add getting started guide',
                suggested_text: mdxContent,
                status: 'pending',
              },
            ],
            created_at: '2024-01-01T00:00:00Z',
          },
        ];

        const result = flattenConversations(conversations);
        expect(result[0].diffAfter).toContain('import { Callout }');
        expect(result[0].diffAfter).toContain('<Callout type="info">');
        expect(result[0].diffAfter).toContain('<CodeTabs>');
        expect(result[0].diffAfter).toContain('## Getting Started');
        expect(result[0].page).toBe('docs/getting-started.mdx');
      });
    });

    describe('Code files', () => {
      it('should preserve TypeScript/JavaScript code with JSDoc comments', () => {
        const tsContent = `/**
 * Connects to a remote wallet
 * @param config - The wallet configuration
 * @returns A promise that resolves to the wallet connection
 * @example
 * const wallet = await connectWallet({ networkId: 'mainnet' });
 */
export async function connectWallet(config: WalletConfig): Promise<WalletConnection> {
  // Implementation here
}`;

        const conversations: ConversationData[] = [
          {
            conversation_id: 'conv-ts',
            category: 'docs',
            message_count: 1,
            messages: [],
            proposals: [
              {
                id: 1,
                page: 'src/wallet.ts',
                update_type: 'UPDATE',
                reasoning: 'Add JSDoc documentation',
                suggested_text: tsContent,
                status: 'pending',
              },
            ],
            created_at: '2024-01-01T00:00:00Z',
          },
        ];

        const result = flattenConversations(conversations);
        expect(result[0].diffAfter).toContain('/**');
        expect(result[0].diffAfter).toContain('@param config');
        expect(result[0].diffAfter).toContain('@returns');
        expect(result[0].diffAfter).toContain('@example');
        expect(result[0].page).toBe('src/wallet.ts');
      });

      it('should preserve Python code with docstrings', () => {
        const pyContent = `def connect_wallet(config: dict) -> WalletConnection:
    """
    Connects to a remote wallet.

    Args:
        config: The wallet configuration dictionary

    Returns:
        A WalletConnection instance

    Example:
        >>> wallet = connect_wallet({'network_id': 'mainnet'})
    """
    # Implementation here
    pass`;

        const conversations: ConversationData[] = [
          {
            conversation_id: 'conv-py',
            category: 'docs',
            message_count: 1,
            messages: [],
            proposals: [
              {
                id: 1,
                page: 'src/wallet.py',
                update_type: 'UPDATE',
                reasoning: 'Add docstring documentation',
                suggested_text: pyContent,
                status: 'pending',
              },
            ],
            created_at: '2024-01-01T00:00:00Z',
          },
        ];

        const result = flattenConversations(conversations);
        expect(result[0].diffAfter).toContain('"""');
        expect(result[0].diffAfter).toContain('Args:');
        expect(result[0].diffAfter).toContain('Returns:');
        expect(result[0].diffAfter).toContain('>>>');
        expect(result[0].page).toBe('src/wallet.py');
      });

      it('should preserve Rust code with doc comments', () => {
        const rustContent = `/// Connects to a remote wallet
///
/// # Arguments
///
/// * \`config\` - The wallet configuration
///
/// # Returns
///
/// A Result containing the WalletConnection or an error
///
/// # Example
///
/// \`\`\`
/// let wallet = connect_wallet(Config::default())?;
/// \`\`\`
pub fn connect_wallet(config: Config) -> Result<WalletConnection, Error> {
    // Implementation here
}`;

        const conversations: ConversationData[] = [
          {
            conversation_id: 'conv-rust',
            category: 'docs',
            message_count: 1,
            messages: [],
            proposals: [
              {
                id: 1,
                page: 'src/wallet.rs',
                update_type: 'UPDATE',
                reasoning: 'Add rustdoc documentation',
                suggested_text: rustContent,
                status: 'pending',
              },
            ],
            created_at: '2024-01-01T00:00:00Z',
          },
        ];

        const result = flattenConversations(conversations);
        expect(result[0].diffAfter).toContain('///');
        expect(result[0].diffAfter).toContain('# Arguments');
        expect(result[0].diffAfter).toContain('# Returns');
        expect(result[0].diffAfter).toContain('# Example');
        expect(result[0].page).toBe('src/wallet.rs');
      });
    });

    describe('Mixed/edge format cases', () => {
      it('should handle MDX files with HTML comments', () => {
        const content = `{/* This is a JSX comment */}

## Section Title

<!-- This is an HTML comment -->

Content here.`;

        const conversations: ConversationData[] = [
          {
            conversation_id: 'conv-mdx-comments',
            category: 'docs',
            message_count: 1,
            messages: [],
            proposals: [
              {
                id: 1,
                page: 'docs/page.mdx',
                update_type: 'UPDATE',
                reasoning: 'Update with comments',
                suggested_text: content,
                status: 'pending',
              },
            ],
            created_at: '2024-01-01T00:00:00Z',
          },
        ];

        const result = flattenConversations(conversations);
        expect(result[0].diffAfter).toContain('{/*');
        expect(result[0].diffAfter).toContain('<!--');
      });

      it('should handle JSON/YAML config files', () => {
        const jsonContent = `{
  "name": "@example/sdk",
  "version": "1.0.0",
  "description": "Example SDK",
  "main": "dist/index.js"
}`;

        const conversations: ConversationData[] = [
          {
            conversation_id: 'conv-json',
            category: 'docs',
            message_count: 1,
            messages: [],
            proposals: [
              {
                id: 1,
                page: 'package.json',
                update_type: 'UPDATE',
                reasoning: 'Update package description',
                suggested_text: jsonContent,
                status: 'pending',
              },
            ],
            created_at: '2024-01-01T00:00:00Z',
          },
        ];

        const result = flattenConversations(conversations);
        expect(result[0].diffAfter).toContain('"name":');
        expect(result[0].diffAfter).toContain('"version":');
        expect(result[0].page).toBe('package.json');
      });
    });
  });

  describe('edge cases', () => {
    it('should handle conversation with null proposals', () => {
      const conversations: ConversationData[] = [
        {
          conversation_id: 'conv-null',
          category: 'test',
          message_count: 1,
          messages: [],
          proposals: null as any,
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);
      expect(result).toEqual([]);
    });

    it('should handle conversation with undefined proposals', () => {
      const conversations = [
        {
          conversation_id: 'conv-undefined',
          category: 'test',
          message_count: 1,
          messages: [],
          created_at: '2024-01-01T00:00:00Z',
        },
      ] as ConversationData[];

      const result = flattenConversations(conversations);
      expect(result).toEqual([]);
    });

    it('should handle missing page field', () => {
      const conversations: ConversationData[] = [
        {
          conversation_id: 'conv-no-page',
          category: 'test',
          message_count: 1,
          messages: [],
          proposals: [
            {
              id: 1,
              update_type: 'UPDATE',
              reasoning: 'Test',
              suggested_text: 'Content',
              status: 'pending',
            },
          ],
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);
      expect(result[0].sectionId).toBe('Unknown section');
      expect(result[0].page).toBeUndefined();
    });

    it('should handle empty suggested_text (returns undefined due to || operator)', () => {
      const conversations: ConversationData[] = [
        {
          conversation_id: 'conv-empty',
          category: 'test',
          message_count: 1,
          messages: [],
          proposals: [
            {
              id: 1,
              page: 'docs/test.md',
              update_type: 'DELETE',
              reasoning: 'Remove section',
              suggested_text: '',
              status: 'pending',
            },
          ],
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);
      // Note: Empty string is treated as falsy by || operator
      // For DELETE operations, undefined/null is acceptable
      expect(result[0].diffAfter).toBeUndefined();
    });

    it('should truncate conversation_id in source', () => {
      const conversations: ConversationData[] = [
        {
          conversation_id: 'very-long-conversation-id-12345',
          category: 'test',
          message_count: 1,
          messages: [],
          proposals: [
            {
              id: 1,
              page: 'docs/test.md',
              update_type: 'UPDATE',
              reasoning: 'Test',
              suggested_text: 'Content',
              status: 'pending',
            },
          ],
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);
      expect(result[0].source).toBe('Conversation very-lon');
    });

    it('should preserve conversation messages in context', () => {
      const messages = [
        { id: 1, author: 'User1', content: 'Question about setup' },
        { id: 2, author: 'User2', content: 'Try this command...' },
      ];

      const conversations: ConversationData[] = [
        {
          conversation_id: 'conv-msgs',
          category: 'support',
          message_count: 2,
          messages,
          proposals: [
            {
              id: 1,
              page: 'docs/setup.md',
              update_type: 'UPDATE',
              reasoning: 'Add troubleshooting',
              suggested_text: 'Updated content',
              status: 'pending',
            },
          ],
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);
      expect(result[0].conversationContext.messages).toEqual(messages);
      expect(result[0].conversationContext.messages).toHaveLength(2);
    });

    it('should handle proposal with review metadata', () => {
      const conversations: ConversationData[] = [
        {
          conversation_id: 'conv-reviewed',
          category: 'test',
          message_count: 1,
          messages: [],
          proposals: [
            {
              id: 1,
              page: 'docs/test.md',
              update_type: 'UPDATE',
              reasoning: 'Test',
              suggested_text: 'Content',
              status: 'approved',
              admin_reviewed_at: '2024-01-05T12:00:00Z',
              admin_reviewed_by: 'admin@example.com',
            },
          ],
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const result = flattenConversations(conversations);
      expect(result[0].reviewedAt).toBe('2024-01-05T12:00:00Z');
      expect(result[0].reviewedBy).toBe('admin@example.com');
    });
  });
});
