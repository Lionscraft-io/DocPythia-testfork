import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { storage } from '../storage';
import type { ScrapedMessage, DocumentationSection } from '../storage';
import { getConfig } from '../config/loader';
import { llmCache } from '../llm/llm-cache.js';
import { PROMPT_TEMPLATES, fillTemplate } from '../stream/llm/prompt-templates.js';
import { createLogger, getErrorMessage } from '../utils/logger.js';

const logger = createLogger('GeminiAnalyzer');

// Model configuration - uses same env vars as batch processor for consistency
const ANALYSIS_MODEL = process.env.LLM_CLASSIFICATION_MODEL || 'gemini-2.5-flash';
const ANSWER_MODEL = process.env.LLM_CLASSIFICATION_MODEL || 'gemini-2.5-flash';

export interface AnalysisResult {
  relevant: boolean;
  updateType?: 'minor' | 'major' | 'add' | 'delete' | null;
  sectionId?: string | null;
  summary?: string | null;
  suggestedContent?: string | null;
  reasoning?: string;
  proposedSectionTitle?: string | null; // For "add" operations
  proposedSectionLevel?: number | null; // For "add" operations
}

export class MessageAnalyzer {
  private documentationSections: DocumentationSection[] = [];
  private genAI: GoogleGenerativeAI;

  constructor() {
    // DON'T DELETE THIS COMMENT - Note that the newest Gemini model series is "gemini-2.5-flash" or "gemini-2.5-pro"
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  }

  async loadDocumentation() {
    this.documentationSections = await storage.getDocumentationSections();
    logger.info(`Loaded ${this.documentationSections.length} documentation sections for analysis`);
  }

  async analyzeMessage(message: ScrapedMessage): Promise<AnalysisResult> {
    if (this.documentationSections.length === 0) {
      await this.loadDocumentation();
    }

    const config = getConfig();
    const documentationContext = this.documentationSections
      .map(
        (section) =>
          `Section ID: ${section.sectionId}\nTitle: ${section.title}\nContent: ${section.content.substring(0, 500)}...`
      )
      .join('\n\n');

    const prompt = fillTemplate(PROMPT_TEMPLATES.messageAnalysis.prompt, {
      projectName: config.project.name,
      documentationContext,
      topic: message.topicName || 'N/A',
      senderName: message.senderName,
      messageTimestamp: message.messageTimestamp,
      content: message.content,
    });

    try {
      // Check cache first
      const cached = llmCache.get(prompt, 'analysis');
      if (cached) {
        try {
          const result = JSON.parse(cached.response) as AnalysisResult;
          logger.debug('Using cached analysis result');
          return result;
        } catch {
          logger.warn('Failed to parse cached analysis, will regenerate');
        }
      }

      const systemPrompt =
        'You are an expert technical writer analyzing community messages for documentation updates. Always respond with valid JSON.';

      const model = this.genAI.getGenerativeModel({
        model: ANALYSIS_MODEL,
        systemInstruction: systemPrompt,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              relevant: { type: SchemaType.BOOLEAN },
              updateType: {
                type: SchemaType.STRING,
                format: 'enum',
                enum: ['minor', 'major', 'add', 'delete'],
                nullable: true,
              },
              sectionId: { type: SchemaType.STRING, nullable: true },
              summary: { type: SchemaType.STRING, nullable: true },
              suggestedContent: { type: SchemaType.STRING, nullable: true },
              reasoning: { type: SchemaType.STRING },
              proposedSectionTitle: { type: SchemaType.STRING, nullable: true },
              proposedSectionLevel: { type: SchemaType.NUMBER, nullable: true },
            },
            required: ['relevant', 'reasoning'],
          },
        },
      });

      const response = await model.generateContent(prompt);

      const rawJson = response.response.text();
      if (!rawJson) {
        throw new Error('Empty response from Gemini');
      }

      const result = JSON.parse(rawJson) as AnalysisResult;

      // Save to cache
      llmCache.set(prompt, rawJson, 'analysis', {
        model: ANALYSIS_MODEL,
      });

      return result;
    } catch (error) {
      const message = getErrorMessage(error);
      logger.error('Error analyzing message:', message);
      throw new Error(`Failed to analyze message: ${message}`);
    }
  }

  async analyzeUnanalyzedMessages(limit: number = 10): Promise<{
    analyzed: number;
    relevant: number;
    updatesCreated: number;
  }> {
    const messages = await storage.getUnanalyzedMessages();
    const toAnalyze = messages.slice(0, limit);

    logger.info(`Analyzing ${toAnalyze.length} messages...`);

    let relevantCount = 0;
    let updatesCreated = 0;

    for (const message of toAnalyze) {
      try {
        logger.debug(`Analyzing message ${message.messageId}...`);
        const result = await this.analyzeMessage(message);

        logger.debug(`Relevant: ${result.relevant}`);
        if (result.reasoning) {
          logger.debug(`Reasoning: ${result.reasoning}`);
        }

        if (result.relevant && result.updateType && result.summary) {
          relevantCount++;

          // Handle different operation types
          if (result.updateType === 'add') {
            // Adding a new section - requires proposed title and content
            if (!result.proposedSectionTitle || !result.suggestedContent) {
              logger.warn(`"add" operation missing title or content. Skipping.`);
            } else {
              // Generate a section ID from the proposed title
              const proposedSectionId = result.proposedSectionTitle
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');

              await storage.createPendingUpdate({
                sectionId: proposedSectionId,
                type: 'add',
                summary: `Add new section: "${result.proposedSectionTitle}". ${result.summary}`,
                source: `Zulipchat message from ${message.senderName} on ${message.messageTimestamp.toISOString()}`,
                status: 'pending', // Always requires manual review
                diffBefore: null,
                diffAfter: result.suggestedContent,
                reviewedBy: null,
              });

              updatesCreated++;
              logger.info(`Created "add" update for new section: ${proposedSectionId}`);
            }
          } else if (result.updateType === 'delete') {
            // Deleting an existing section
            if (!result.sectionId) {
              logger.warn(`"delete" operation missing sectionId. Skipping.`);
            } else {
              const section = this.documentationSections.find(
                (s) => s.sectionId === result.sectionId
              );

              if (!section) {
                logger.warn(`Cannot delete non-existent section "${result.sectionId}". Skipping.`);
              } else {
                await storage.createPendingUpdate({
                  sectionId: result.sectionId,
                  type: 'delete',
                  summary: `Delete section: "${section.title}". ${result.summary}`,
                  source: `Zulipchat message from ${message.senderName} on ${message.messageTimestamp.toISOString()}`,
                  status: 'pending', // Always requires manual review
                  diffBefore: section.content,
                  diffAfter: null,
                  reviewedBy: null,
                });

                updatesCreated++;
                logger.info(`Created "delete" update for section: ${result.sectionId}`);
              }
            }
          } else {
            // Updating existing section (minor or major)
            if (!result.sectionId) {
              logger.warn(`Update operation missing sectionId. Skipping.`);
            } else {
              const section = this.documentationSections.find(
                (s) => s.sectionId === result.sectionId
              );

              if (!section) {
                logger.warn(
                  `AI returned unknown sectionId "${result.sectionId}". Converting to major update for manual review.`
                );
                result.updateType = 'major';
              }

              const pendingUpdate = await storage.createPendingUpdate({
                sectionId: section
                  ? result.sectionId
                  : this.documentationSections[0]?.sectionId || 'introduction',
                type: result.updateType,
                summary: section
                  ? result.summary
                  : `[TRIAGE] AI suggested unknown section "${result.sectionId}". ${result.summary}`,
                source: `Zulipchat message from ${message.senderName} on ${message.messageTimestamp.toISOString()}`,
                status: result.updateType === 'minor' && section ? 'auto_applied' : 'pending',
                diffBefore: section?.content || null,
                diffAfter: result.suggestedContent || null,
                reviewedBy: result.updateType === 'minor' && section ? 'AI Auto-Approval' : null,
              });

              updatesCreated++;
              logger.info(
                `Created ${result.updateType} update for section ${section?.sectionId || 'introduction'}`
              );

              // Auto-apply minor updates only if section was valid
              if (result.updateType === 'minor' && result.suggestedContent && section) {
                await storage.updateDocumentationSection(result.sectionId, result.suggestedContent);

                // Create audit history entry for auto-applied update
                await storage.createUpdateHistory({
                  updateId: pendingUpdate.id,
                  action: 'auto_applied',
                  performedBy: 'AI Auto-Approval',
                });

                logger.info(`Auto-applied minor update with audit log`);
              }
            }
          }
        }

        // Mark as analyzed
        await storage.markMessageAsAnalyzed(message.id);
      } catch (error) {
        logger.error(`Error analyzing message ${message.messageId}:`, getErrorMessage(error));
        // Continue with next message
      }
    }

    return {
      analyzed: toAnalyze.length,
      relevant: relevantCount,
      updatesCreated,
    };
  }

  /**
   * Generate an answer to a documentation question
   * Used by the widget API endpoint with RAG context
   */
  async generateDocumentationAnswer(prompt: string): Promise<string> {
    try {
      // Check cache first
      const cached = llmCache.get(prompt, 'general');
      if (cached) {
        logger.debug('Using cached documentation answer');
        return cached.response;
      }

      const config = getConfig();
      const systemPrompt = fillTemplate(PROMPT_TEMPLATES.documentationAnswer.system, {
        projectName: config.project.name,
      });

      const model = this.genAI.getGenerativeModel({
        model: ANSWER_MODEL,
        systemInstruction: systemPrompt,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      });

      const response = await model.generateContent(prompt);

      const answer = response.response.text();
      if (!answer) {
        throw new Error('Empty response from Gemini');
      }

      // Save to cache
      llmCache.set(prompt, answer, 'general', {
        model: ANSWER_MODEL,
      });

      return answer;
    } catch (error) {
      const errMsg = getErrorMessage(error);
      logger.error('Error generating documentation answer:', errMsg);
      throw new Error(`Failed to generate answer: ${errMsg}`);
    }
  }
}

export function createAnalyzerFromEnv(): MessageAnalyzer | null {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    logger.warn('Gemini API key not found in environment variables');
    return null;
  }

  return new MessageAnalyzer();
}
