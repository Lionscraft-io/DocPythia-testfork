import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createAnalyzerFromEnv } from '../analyzer/gemini-analyzer';
import { geminiEmbedder } from '../embeddings/gemini-embedder.js';
import { PgVectorStore } from '../vector-store.js';
import { db as prisma } from '../db';
import { createLogger, getErrorMessage } from '../utils/logger.js';

const logger = createLogger('WidgetRoutes');

// Create default vectorStore for widget endpoints
let vectorStore: PgVectorStore;
try {
  vectorStore = new PgVectorStore('default', prisma);
} catch {
  logger.warn('Failed to initialize default vectorStore');
}

const router = Router();

// Widget HTML endpoint
router.get('/:expertId', (req: Request, res: Response) => {
  const { expertId } = req.params;
  const { theme = 'light' } = req.query;

  // Configurable widget content
  const projectName = process.env.PROJECT_NAME || 'DocPythia';
  const widgetTitle = process.env.WIDGET_TITLE || `${projectName} Assistant`;
  const welcomeMessage =
    process.env.WIDGET_WELCOME_MESSAGE ||
    `Hello! I'm your ${projectName} documentation assistant. How can I help you today?`;
  const placeholderText =
    process.env.WIDGET_PLACEHOLDER || `Ask me anything about ${projectName}...`;

  // Suggested questions from env (comma-separated) or defaults
  const suggestedQuestionsEnv = process.env.WIDGET_SUGGESTED_QUESTIONS || '';
  const suggestedQuestions = suggestedQuestionsEnv
    ? suggestedQuestionsEnv
        .split('|')
        .map((q) => q.trim())
        .filter((q) => q)
    : [
        'How do I get started?',
        'What are the system requirements?',
        'How do I configure the service?',
      ];

  const widgetHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Assistant Widget</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        body {
            background: ${theme === 'dark' ? '#1a1a1a' : '#ffffff'};
            color: ${theme === 'dark' ? '#ffffff' : '#333333'};
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .widget-header {
            padding: 16px;
            border-bottom: 1px solid ${theme === 'dark' ? '#333' : '#e5e5e5'};
            background: ${theme === 'dark' ? '#2a2a2a' : '#f8f9fa'};
        }

        .widget-title {
            font-size: 16px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .widget-content {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
        }

        .chat-container {
            max-width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
        }

        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px 0;
        }

        .message {
            margin-bottom: 16px;
            padding: 12px 16px;
            border-radius: 12px;
            max-width: 80%;
        }

        .message.user {
            background: #007bff;
            color: white;
            margin-left: auto;
        }

        .message.assistant {
            background: ${theme === 'dark' ? '#333' : '#f1f3f4'};
            color: ${theme === 'dark' ? '#fff' : '#333'};
        }

        .input-container {
            display: flex;
            gap: 8px;
            padding: 16px;
            border-top: 1px solid ${theme === 'dark' ? '#333' : '#e5e5e5'};
        }

        .chat-input {
            flex: 1;
            padding: 12px;
            border: 1px solid ${theme === 'dark' ? '#444' : '#ddd'};
            border-radius: 8px;
            background: ${theme === 'dark' ? '#333' : '#fff'};
            color: ${theme === 'dark' ? '#fff' : '#333'};
        }

        .send-button {
            padding: 12px 16px;
            background: #007bff;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
        }

        .send-button:hover {
            background: #0056b3;
        }

        .suggested-questions {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 16px;
        }

        .suggestion-button {
            padding: 8px 12px;
            background: ${theme === 'dark' ? '#444' : '#f8f9fa'};
            border: 1px solid ${theme === 'dark' ? '#555' : '#e5e5e5'};
            border-radius: 8px;
            cursor: pointer;
            text-align: left;
            transition: background-color 0.2s;
        }

        .suggestion-button:hover {
            background: ${theme === 'dark' ? '#555' : '#e9ecef'};
        }
    </style>
</head>
<body>
    <div class="widget-header">
        <div class="widget-title">
            <span>🤖</span>
            <span>${widgetTitle}</span>
        </div>
    </div>

    <div class="widget-content">
        <div class="chat-container">
            <div class="messages" id="messages">
                <div class="message assistant">
                    ${welcomeMessage}
                </div>

                <div class="suggested-questions">
                    ${suggestedQuestions
                      .map(
                        (q) => `
                    <button class="suggestion-button" onclick="askQuestion('${q.replace(/'/g, "\\'")}')">
                        ${q}
                    </button>`
                      )
                      .join('')}
                </div>
            </div>

            <div class="input-container">
                <input
                    type="text"
                    class="chat-input"
                    placeholder="${placeholderText}"
                    id="chatInput"
                    onkeypress="handleKeyPress(event)"
                />
                <button class="send-button" onclick="sendMessage()">
                    Send
                </button>
            </div>
        </div>
    </div>

    <script>
        const projectName = '${projectName}';

        function askQuestion(question) {
            const input = document.getElementById('chatInput');
            input.value = question;
            sendMessage();
        }

        function handleKeyPress(event) {
            if (event.key === 'Enter') {
                sendMessage();
            }
        }

        function sendMessage() {
            const input = document.getElementById('chatInput');
            const message = input.value.trim();

            if (!message) return;

            // Add user message
            addMessage(message, 'user');
            input.value = '';

            // Simulate AI response (replace with actual API call)
            setTimeout(() => {
                addMessage('I\\'m processing your question. This is a demo response.', 'assistant');
            }, 1000);
        }

        function addMessage(text, sender) {
            const messagesContainer = document.getElementById('messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${sender}\`;
            messageDiv.textContent = text;
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;

            // Remove suggested questions after first user message
            if (sender === 'user') {
                const suggestions = messagesContainer.querySelector('.suggested-questions');
                if (suggestions) {
                    suggestions.remove();
                }
            }
        }

        // Notify parent window if embedded
        if (window.parent !== window) {
            window.parent.postMessage({
                type: 'WIDGET_LOADED',
                expertId: '${expertId}'
            }, '*');
        }
    </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.send(widgetHtml);
});

// Widget ask endpoint (public)
router.post('/ask', async (req: Request, res: Response) => {
  try {
    const bodyValidation = z
      .object({
        question: z.string().min(1),
        sessionId: z.string().optional(),
      })
      .safeParse(req.body);

    if (!bodyValidation.success) {
      return res.status(400).json({ error: 'Invalid request body', details: bodyValidation.error });
    }

    const { question } = bodyValidation.data;

    logger.debug(`Widget question received: "${question.substring(0, 100)}..."`);

    // Get RAG context using vector store directly
    const queryEmbedding = await geminiEmbedder.embedText(question);
    const similarDocs = await vectorStore.searchSimilar(queryEmbedding, 3);

    const context = {
      retrievedDocs: similarDocs,
      formattedContext:
        similarDocs.length > 0
          ? similarDocs
              .map((doc, idx) => `[${idx + 1}] ${doc.title} (${doc.filePath})\n${doc.content}`)
              .join('\n\n---\n\n')
          : '',
      usedRetrieval: similarDocs.length > 0,
    };

    // Generate answer using Gemini with context
    const analyzer = createAnalyzerFromEnv();

    if (!analyzer) {
      return res.status(500).json({
        error: 'AI service not configured. Please set GEMINI_API_KEY environment variable.',
      });
    }

    const projectName = process.env.PROJECT_NAME || 'the documentation';
    let prompt = '';
    if (context.usedRetrieval && context.formattedContext) {
      prompt = `${context.formattedContext}\n\n---\n\nQuestion: ${question}\n\nProvide a helpful answer based on the documentation above. If the documentation doesn't contain relevant information, let the user know.`;
    } else {
      prompt = `Question: ${question}\n\nProvide a helpful answer about ${projectName} based on your general knowledge.`;
    }

    // Use the analyzer's generateAnswer method if available, otherwise use a basic response
    const answer = await analyzer.generateDocumentationAnswer(prompt);

    // Build document URL helper
    const buildDocUrl = (filePath: string): string => {
      const baseUrl = process.env.DOCS_GIT_URL || '';
      const cleanBaseUrl = baseUrl.replace(/\.git$/, '');
      return `${cleanBaseUrl}/blob/main/${filePath}`;
    };

    res.json({
      answer,
      sources: context.retrievedDocs.map((doc) => ({
        title: doc.title,
        filePath: doc.filePath,
        url: buildDocUrl(doc.filePath),
        relevance: doc.similarity,
      })),
      usedRAG: context.usedRetrieval,
    });
  } catch (error) {
    logger.error('Error processing widget question:', error);
    res.status(500).json({
      error: 'Failed to process question',
      details: getErrorMessage(error),
    });
  }
});

export default router;
