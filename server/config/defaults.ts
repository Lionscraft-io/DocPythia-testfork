// Default configuration - Generic template
// Multi-instance configuration system
// Updated: 2025-12-29 - Removed client-specific references

import type { InstanceConfig } from './types';

export const defaultConfig: InstanceConfig = {
  project: {
    name: 'DocPythia',
    shortName: 'docs',
    description: 'AI-powered documentation assistant',
    domain: 'docs.example.com',
    supportEmail: 'support@example.com',
  },

  branding: {
    logo: '/assets/logo.svg',
    favicon: '/ico.png',
    primaryColor: '#3B82F6',
    secondaryColor: '#1F2937',
    accentColor: '#10B981',
    darkModePrimaryColor: '#60A5FA',
    projectUrl: 'https://example.com',
  },

  documentation: {
    gitUrl: 'https://github.com/example/docs',
    branch: 'main',
    docsPath: '',
  },

  database: {
    name: 'docpythia',
  },

  community: {
    zulip: {
      enabled: false,
      site: 'https://example.zulipchat.com',
      channel: 'general',
    },
    telegram: {
      enabled: false,
    },
    discord: {
      enabled: false,
    },
  },

  widget: {
    enabled: true,
    title: 'Documentation Assistant',
    welcomeMessage: "Hello! I'm your documentation assistant. How can I help you today?",
    suggestedQuestions: [
      'How do I get started?',
      'Where can I find the API documentation?',
      'What are the system requirements?',
      'How do I configure the application?',
    ],
    position: 'bottom-right',
    theme: 'auto',
  },

  features: {
    ragEnabled: false,
    schedulerEnabled: false,
    chatEnabled: true,
    analyticsEnabled: false,
    versionHistoryEnabled: true,
  },

  admin: {
    passwordHash: 'change_me_in_production', // SHA256 hash of admin password
    allowedOrigins: ['http://localhost:3762', 'http://localhost:5173'],
  },
};
