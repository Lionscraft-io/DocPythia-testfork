/**
 * Swagger/OpenAPI Configuration
 *
 * This module configures Swagger documentation for the DocPythia API.
 * Access the API documentation at /api/docs
 */

import swaggerJsdoc from 'swagger-jsdoc';
import { getConfig } from '../config/loader.js';

const config = getConfig();

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: `${config.project.name} API`,
    version: '1.0.0',
    description: `
API documentation for ${config.project.name} - AI-powered documentation management system.

## Overview

DocPythia helps teams keep their documentation up-to-date by:
- Scraping community discussions (Zulip, Telegram, etc.)
- Analyzing messages for documentation relevance
- Generating update proposals with AI
- Creating GitHub PRs for approved changes

## Authentication

Most admin endpoints require authentication via Bearer token:
\`\`\`
Authorization: Bearer <your-admin-token>
\`\`\`

## Rate Limiting

API endpoints may be rate-limited in production. Check response headers for rate limit information.
    `,
    contact: {
      name: 'API Support',
      url: config.branding?.projectUrl || 'https://github.com/Lionscraft-io/DocPythia',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: '/api',
      description: 'API Server',
    },
  ],
  tags: [
    {
      name: 'Health',
      description: 'Health check and diagnostics endpoints',
    },
    {
      name: 'Authentication',
      description: 'Admin authentication endpoints',
    },
    {
      name: 'Documentation',
      description: 'Documentation section management',
    },
    {
      name: 'Updates',
      description: 'Pending update management',
    },
    {
      name: 'Messages',
      description: 'Scraped message management',
    },
    {
      name: 'Streams',
      description: 'Multi-stream scanner management',
    },
    {
      name: 'Widget',
      description: 'Embedded chat widget endpoints',
    },
    {
      name: 'Cache',
      description: 'LLM cache management',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Admin authentication token',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'string',
            description: 'Error message',
          },
          details: {
            type: 'string',
            description: 'Additional error details',
          },
        },
        required: ['error'],
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['ok'],
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      DocumentationSection: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          sectionId: {
            type: 'string',
            description: 'Unique section identifier',
          },
          title: {
            type: 'string',
          },
          content: {
            type: 'string',
          },
          version: {
            type: 'integer',
          },
          lastUpdated: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      PendingUpdate: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          sectionId: {
            type: 'string',
          },
          type: {
            type: 'string',
            enum: ['minor', 'major', 'add', 'delete'],
          },
          summary: {
            type: 'string',
          },
          source: {
            type: 'string',
          },
          status: {
            type: 'string',
            enum: ['pending', 'approved', 'rejected', 'auto_applied'],
          },
          diffBefore: {
            type: 'string',
            nullable: true,
          },
          diffAfter: {
            type: 'string',
            nullable: true,
          },
          reviewedBy: {
            type: 'string',
            nullable: true,
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      ScrapedMessage: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
          },
          messageId: {
            type: 'string',
          },
          content: {
            type: 'string',
          },
          senderName: {
            type: 'string',
          },
          topicName: {
            type: 'string',
            nullable: true,
          },
          messageTimestamp: {
            type: 'string',
            format: 'date-time',
          },
          analyzed: {
            type: 'boolean',
          },
        },
      },
      WidgetAskRequest: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            minLength: 1,
          },
          sessionId: {
            type: 'string',
          },
        },
        required: ['question'],
      },
      WidgetAskResponse: {
        type: 'object',
        properties: {
          answer: {
            type: 'string',
          },
          sources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                },
                filePath: {
                  type: 'string',
                },
                url: {
                  type: 'string',
                },
                relevance: {
                  type: 'number',
                },
              },
            },
          },
          usedRAG: {
            type: 'boolean',
          },
        },
      },
      CacheStats: {
        type: 'object',
        properties: {
          totalEntries: {
            type: 'integer',
          },
          byPurpose: {
            type: 'object',
            additionalProperties: {
              type: 'integer',
            },
          },
          totalSize: {
            type: 'integer',
            description: 'Total cache size in bytes',
          },
        },
      },
    },
  },
};

const options: swaggerJsdoc.Options = {
  definition: swaggerDefinition,
  apis: ['./server/routes/*.ts', './server/swagger/paths/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
