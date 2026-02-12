# Customizable Analysis Pipeline

This directory contains the customizable analysis pipeline implementation as defined in `/docs/specs/customizable-analysis-pipeline.md`.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   Configuration Layer                        │
│  ┌───────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Prompt Files  │  │ Domain Defs  │  │ Pipeline Config │  │
│  │ (Markdown)    │  │ (JSON)       │  │ (JSON)          │  │
│  └───────────────┘  └──────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Pipeline Layer                                     │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌─────────────┐           │
│  │ Filter │→│ Classify │→│ Enrich │→│ Generate │→│ Context     │→          │
│  │ Step   │ │ Step     │ │ (RAG)  │ │ Step     │ │ Enrichment  │           │
│  └────────┘ └──────────┘ └────────┘ └──────────┘ └─────────────┘           │
│                                                        ↓                     │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────┐                              │
│  │ Condense │←│ Validate │←│ Ruleset Review  │                              │
│  │ Step     │ │ Step     │ │ Step            │                              │
│  └──────────┘ └──────────┘ └─────────────────┘                              │
└─────────────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   Execution Layer                            │
│              PipelineOrchestrator + Context                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Integration Layer                           │
│    LLM Handlers  │  RAG Service  │  Database Persistence     │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
pipeline/
├── core/
│   ├── interfaces.ts          # All interface definitions
│   ├── PipelineContext.ts     # Context factory and utilities
│   ├── PipelineOrchestrator.ts # Step execution coordinator (with PipelineRunLog)
│   └── StepFactory.ts         # Step creation factory
├── steps/
│   ├── base/
│   │   └── BasePipelineStep.ts # Abstract base class
│   ├── filter/
│   │   └── KeywordFilterStep.ts
│   ├── classify/
│   │   └── BatchClassifyStep.ts
│   ├── enrich/
│   │   ├── RagEnrichStep.ts           # RAG context enrichment
│   │   └── ContextEnrichmentStep.ts   # Quality System context analysis
│   ├── generate/
│   │   └── ProposalGenerateStep.ts
│   ├── review/
│   │   └── RulesetReviewStep.ts       # Quality System ruleset processing
│   └── transform/
│       ├── ContentValidationStep.ts   # XML/format validation
│       └── LengthReductionStep.ts     # Content condensation
├── types/
│   ├── enrichment.ts          # ProposalEnrichment types & textAnalysis utils
│   └── ruleset.ts             # ParsedRuleset types & parsing functions
├── handlers/
│   └── GeminiHandler.ts       # Gemini LLM implementation
├── prompts/
│   └── PromptRegistry.ts      # Prompt template management
├── config/
│   ├── DomainConfigLoader.ts  # Domain config loading
│   └── PipelineConfigLoader.ts # Pipeline config loading
├── utils/
│   └── ProposalPostProcessor.ts # Markdown formatting fixes
├── index.ts                   # Module exports
└── README.md                  # This file
```

## Quality System

The pipeline includes a **Quality System** (Phase 3) for automated proposal quality control:

### Steps

1. **Context Enrichment** (`context-enrich`): Analyzes proposals after generation
   - Finds related documentation via RAG
   - Checks for content duplication (n-gram overlap)
   - Analyzes style consistency with target page
   - Calculates change impact context
   - Analyzes source conversation quality

2. **Ruleset Review** (`ruleset-review`): Applies tenant-specific rules
   - **PROMPT_CONTEXT**: Injected into proposal generation prompts
   - **REJECTION_RULES**: Auto-reject proposals matching patterns
   - **QUALITY_GATES**: Flag proposals for human review
   - **REVIEW_MODIFICATIONS**: Suggest content modifications

3. **Content Validation** (`validate`): Ensures proper formatting
   - Validates XML/markdown structure
   - Uses LLM to fix formatting issues

4. **Length Reduction** (`condense`): Shortens overly long proposals
   - Priority-based length limits
   - LLM-assisted condensation

### Ruleset Configuration

Instance-specific rulesets are stored at `config/{instanceId}/ruleset.md`:

```markdown
## PROMPT_CONTEXT
- Use formal technical writing style
- Always use "validator" instead of "node operator"

## REJECTION_RULES
- If duplicationWarning.overlapPercentage > 80%, reject as duplicate
- Proposals mentioning "competitor"

## QUALITY_GATES
- If changePercentage > 50%, flag as significant_change
- If otherPendingProposals > 0, flag as needs_coordination

## REVIEW_MODIFICATIONS
- Adjust format to match target page
```

### Testing Quality System

```bash
# Run Quality System tests
npm test -- quality-system-integration.test.ts quality-system-flow.test.ts ruleset-parser.test.ts
```

## Configuration Files

Configuration files are stored in `/config/`:

```
config/
├── defaults/
│   ├── prompts/
│   │   ├── thread-classification.md
│   │   └── changeset-generation.md
│   ├── domains/
│   │   └── generic.json
│   └── pipelines/
│       └── default.json
└── {instanceId}/
    ├── prompts/
    │   └── custom-prompt.md    # Override defaults
    ├── domains/
    │   └── validators.json     # Instance-specific domain
    └── pipelines/
        └── custom.json         # Instance-specific pipeline
```

## Usage

### Basic Usage

```typescript
import {
  PipelineOrchestrator,
  createPipelineContext,
  createPromptRegistry,
  createGeminiHandler,
  loadDomainConfig,
  loadPipelineConfig,
} from './pipeline';

// Load configuration
const domainConfig = await loadDomainConfig('./config', 'myinstance', 'validators');
const pipelineConfig = await loadPipelineConfig('./config', 'myinstance', 'validators');

// Create services
const llmHandler = createGeminiHandler();
const prompts = createPromptRegistry('./config', 'myinstance');
await prompts.load();

// Create orchestrator
const orchestrator = new PipelineOrchestrator(pipelineConfig, llmHandler);

// Create context
const context = createPipelineContext({
  instanceId: 'myinstance',
  batchId: 'batch-123',
  streamId: 'myinstance-zulip',
  messages: [...],
  domainConfig,
  prompts,
  llmHandler,
  ragService: vectorSearch,
  db: prisma,
});

// Execute pipeline
const result = await orchestrator.execute(context);

console.log(`Processed ${result.messagesProcessed} messages`);
console.log(`Created ${result.threadsCreated} threads`);
console.log(`Generated ${result.proposalsGenerated} proposals`);
```

### Adding Custom Steps

```typescript
import { BasePipelineStep, StepType, StepFactory } from './pipeline';

class MyCustomStep extends BasePipelineStep {
  readonly stepType = StepType.TRANSFORM;

  async execute(context) {
    // Custom logic here
    return context;
  }

  getMetadata() {
    return {
      name: 'My Custom Step',
      description: 'Does something custom',
      version: '1.0.0',
    };
  }
}

// Register with factory
const factory = getStepFactory();
factory.register('custom', (config, llmHandler) => new MyCustomStep(config));
```

## Key Interfaces

### IPipelineStep

```typescript
interface IPipelineStep {
  readonly stepId: string;
  readonly stepType: StepType;
  execute(context: PipelineContext): Promise<PipelineContext>;
  validateConfig(config: StepConfig): boolean;
  getMetadata(): StepMetadata;
}
```

### ILLMHandler

```typescript
interface ILLMHandler {
  readonly name: string;
  requestJSON<T>(request: LLMRequest, schema: z.ZodSchema<T>, context: LLMContext): Promise<{ data: T; response: LLMResponse }>;
  requestText(request: LLMRequest, context: LLMContext): Promise<LLMResponse>;
  getModelInfo(model: string): ModelInfo;
  estimateCost(request: LLMRequest): CostEstimate;
}
```

### IPromptRegistry

```typescript
interface IPromptRegistry {
  get(promptId: string): PromptTemplate | null;
  render(promptId: string, variables: Record<string, unknown>): RenderedPrompt;
  list(): PromptTemplate[];
  reload(): Promise<void>;
  validate(template: PromptTemplate): ValidationResult;
}
```

## Prompt Template Format

Prompts are Markdown files with YAML frontmatter:

```markdown
---
id: my-prompt
version: "1.0.0"
metadata:

  description: My prompt description
  requiredVariables:
    - variable1
    - variable2
  tags:
    - classification
---

# System Prompt

Your system prompt here with {{variable1}} interpolation.

---

# User Prompt

Your user prompt here with {{variable2}} interpolation.
```

## Domain Configuration

```json
{
  "domainId": "my-domain",
  "name": "My Domain",
  "categories": [
    {
      "id": "category-id",
      "label": "Category Label",
      "description": "Category description",
      "priority": 90
    }
  ],
  "keywords": {
    "include": ["keyword1", "keyword2"],
    "exclude": ["spam"]
  },
  "ragPaths": {
    "include": ["docs/**"],
    "exclude": ["i18n/**"]
  },
  "context": {
    "projectName": "My Project",
    "domain": "My Domain",
    "targetAudience": "Developers",
    "documentationPurpose": "Technical documentation"
  }
}
```

## Testing

Tests are located in `/tests/`:

- `tests/pipeline-steps.test.ts` - Unit tests for pipeline steps
- `tests/pipeline-config.test.ts` - Unit tests for configuration loaders
- `tests/pipeline-integration.test.ts` - Integration tests
- `tests/pipeline-e2e.test.ts` - End-to-end tests
- `tests/transform-steps.test.ts` - Transform step tests (validate, condense)
- `tests/quality-system-integration.test.ts` - Quality System unit tests
- `tests/quality-system-flow.test.ts` - Quality System integration tests
- `tests/ruleset-parser.test.ts` - Ruleset parsing tests

```bash
# Run all pipeline tests
npm test -- pipeline-steps.test.ts pipeline-config.test.ts pipeline-integration.test.ts pipeline-e2e.test.ts

# Run Quality System tests
npm test -- quality-system-integration.test.ts quality-system-flow.test.ts ruleset-parser.test.ts

# Run transform step tests
npm test -- transform-steps.test.ts
```

## Author

Updated: 2026-01-19 - Added Quality System documentation
