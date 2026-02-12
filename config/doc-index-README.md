# Documentation Index Configuration

Configuration for the documentation index generator used in LLM prompts.

**Location**: `/config/{instanceId}/doc-index.config.json`

## Instance-Specific Configuration

Each instance has its own doc-index configuration:
- `/config/{instanceId}/doc-index.config.json` - Instance-specific documentation structure

Example: `/config/projecta/doc-index.config.json`, `/config/projectb/doc-index.config.json`

## doc-index.config.json

Controls what documentation is included in LLM prompts to reduce token usage and improve relevance.

### Configuration Options

```json
{
  "includePatterns": [
    "docs/**/*.md",
    "guides/**/*.md"
  ],
  "excludePatterns": [
    "**/node_modules/**",
    "**/build/**",
    "**/README.md"
  ],
  "excludeTitles": [
    "Skip to main content",
    "Quick Links",
    "Copyright"
  ],
  "maxPages": 50,
  "maxSectionsPerPage": 5,
  "maxSummaryLength": 150,
  "compactFormat": {
    "includeSummaries": false,
    "includeSections": true,
    "maxSectionsInCompact": 3
  }
}
```

### Field Descriptions

#### includePatterns
**Type**: `string[]`
**Default**: `["**/*.md"]`

Glob patterns for file paths to include. Documents must match at least one pattern to be included.

**Examples**:
- `"docs/**/*.md"` - Include all markdown files in docs directory and subdirectories
- `"guides/**/*.md"` - Include all markdown files in guides directory
- `"api/*.md"` - Include only markdown files directly in api directory (not subdirectories)

#### excludePatterns
**Type**: `string[]`
**Default**: `["**/node_modules/**", "**/build/**", "**/dist/**"]`

Glob patterns for file paths to exclude. Takes precedence over includePatterns.

**Examples**:
- `"**/_*.md"` - Exclude files starting with underscore
- `"**/temp/**"` - Exclude temp directories
- `"**/CONTRIBUTING.md"` - Exclude CONTRIBUTING files

#### excludeTitles
**Type**: `string[]`
**Default**: `["Skip to main content", "Quick Links", "Resources", "Community", "Copyright"]`

Document titles (or partial matches) to exclude. Useful for filtering out navigation menus and boilerplate.

**Case-insensitive matching**. If document title contains any of these strings, it will be excluded.

#### maxPages
**Type**: `number`
**Default**: `50`

Maximum number of documents to include in the index. After filtering, only the first N documents will be included.

**Recommendation**: Keep under 100 to avoid excessive token usage.

#### maxSectionsPerPage
**Type**: `number`
**Default**: `5`

Maximum number of section headers to extract per document. Limits the detail level in the index.

#### maxSummaryLength
**Type**: `number`
**Default**: `150`

Maximum length (in characters) for document summaries. Summaries are auto-generated from the first paragraph.

#### compactFormat
Configuration for the compact index format (used in LLM prompts).

##### includeSummaries
**Type**: `boolean`
**Default**: `false`

Whether to include document summaries in compact format. Increases token usage but provides more context.

##### includeSections
**Type**: `boolean`
**Default**: `true`

Whether to include section headers in compact format. Helps LLM understand document structure.

##### maxSectionsInCompact
**Type**: `number`
**Default**: `3`

Maximum number of sections to show per document in compact format. Keeps prompts concise.

## Usage Examples

### Minimal Index (Very Low Token Usage)
```json
{
  "includePatterns": ["docs/**/*.md"],
  "excludePatterns": ["**/_*.md", "**/README.md"],
  "excludeTitles": ["Skip to main content", "Navigation", "Footer", "Menu"],
  "maxPages": 20,
  "maxSectionsPerPage": 3,
  "maxSummaryLength": 100,
  "compactFormat": {
    "includeSummaries": false,
    "includeSections": false,
    "maxSectionsInCompact": 0
  }
}
```

**Output Format**:
```
=== DOCUMENTATION INDEX (Compact) ===
20 pages available

- Getting Started (docs/getting-started.md)
- API Reference (docs/api-reference.md)
```

### Moderate Index (Balanced)
```json
{
  "includePatterns": ["docs/**/*.md", "guides/**/*.md"],
  "excludePatterns": ["**/temp/**", "**/_*.md"],
  "excludeTitles": ["Skip to main content"],
  "maxPages": 50,
  "maxSectionsPerPage": 5,
  "maxSummaryLength": 150,
  "compactFormat": {
    "includeSummaries": false,
    "includeSections": true,
    "maxSectionsInCompact": 3
  }
}
```

**Output Format**:
```
=== DOCUMENTATION INDEX (Compact) ===
50 pages available

- Getting Started (docs/getting-started.md)
  Sections: Introduction, Installation, Quick Start +2 more
- API Reference (docs/api-reference.md)
  Sections: Authentication, Endpoints, Rate Limits
```

### Detailed Index (High Token Usage)
```json
{
  "includePatterns": ["**/*.md"],
  "excludePatterns": ["**/node_modules/**"],
  "excludeTitles": [],
  "maxPages": 100,
  "maxSectionsPerPage": 10,
  "maxSummaryLength": 250,
  "compactFormat": {
    "includeSummaries": true,
    "includeSections": true,
    "maxSectionsInCompact": 5
  }
}
```

**Output Format**:
```
=== DOCUMENTATION INDEX (Compact) ===
100 pages available

- Getting Started (docs/getting-started.md)
  Sections: Introduction, Installation, Quick Start, Configuration, Troubleshooting +3 more
  A comprehensive guide to getting started with the platform. Learn how to install, configure, and deploy your first application in minutes.
- API Reference (docs/api-reference.md)
  Sections: Authentication, Endpoints, Rate Limits, Error Handling, Examples
  Complete API documentation covering all endpoints, authentication methods, and usage examples.
```

## Troubleshooting

### Index Still Too Large

1. **Reduce maxPages**: Lower from 50 to 20-30
2. **Disable summaries**: Set `compactFormat.includeSummaries: false`
3. **Reduce sections**: Set `maxSectionsInCompact: 0` or `1`
4. **Add more excludePatterns**: Filter out less relevant docs

### Missing Important Documents

1. **Check includePatterns**: Ensure patterns match your docs
2. **Check excludeTitles**: May be excluding too aggressively
3. **Check excludePatterns**: May be too broad
4. **Increase maxPages**: If hitting the limit

### Navigation/Menu Content Still Included

1. **Add to excludeTitles**: Add more patterns like "Menu", "Navigation", "Footer"
2. **Use excludePatterns**: Filter by file path if navigation is in specific files
3. **Check database**: Query `document_pages` table to see what titles exist

```sql
SELECT title, file_path FROM document_pages
WHERE title ILIKE '%navigation%' OR title ILIKE '%menu%';
```

## Cache Invalidation

The documentation index is cached for 1 hour. To force a refresh:

1. **Restart server**: Cache is in-memory
2. **Programmatic**: Call `docIndexGenerator.invalidateCache()`
3. **After sync**: Cache auto-invalidates after git sync

## Monitoring

Check server logs for filtering statistics:

```
Generating fresh documentation index...
Found 150 documents in vector store
Filtered to 45 documents (excluded 105)
Limited to first 50 documents
Documentation index generated: 45 pages, 8 categories
```

This shows:
- Total documents in database: 150
- After filtering: 45 (excluded 105)
- After limit: 45 (no limiting needed)
- Final: 45 pages in index
