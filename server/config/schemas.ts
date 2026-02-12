// Zod validation schemas for instance configuration
// Multi-instance configuration system

import { z } from 'zod';

export const ProjectConfigSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  shortName: z
    .string()
    .min(1, 'Short name is required')
    .regex(/^[a-z0-9-]+$/, 'Short name must be lowercase alphanumeric with hyphens'),
  description: z.string().min(1, 'Description is required'),
  domain: z.string().optional(),
  supportEmail: z.string().email().optional(),
});

export const BrandingConfigSchema = z.object({
  logo: z.string().min(1, 'Logo path or URL is required'), // Can be URL or relative path
  favicon: z.string().optional(), // Can be URL or relative path
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Primary color must be a valid hex color'),
  secondaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  darkModePrimaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  projectUrl: z.string().min(1, 'Project URL is required'), // Can be full URL or path
});

export const DocumentationConfigSchema = z.object({
  gitUrl: z.string().url('Git URL must be valid'),
  branch: z.string().min(1, 'Branch is required'),
  gitUsername: z.string().optional(),
  gitToken: z.string().optional(),
  docsPath: z.string().optional(),
});

export const ZulipConfigSchema = z.object({
  enabled: z.boolean(),
  site: z.string().url().optional(),
  botEmail: z.string().email().optional(),
  apiKey: z.string().optional(),
  channel: z.string().optional(),
});
// Note: Validation removed - this is legacy config.
// Actual Zulip configuration is done via streams array with environment variables.

export const TelegramConfigSchema = z.object({
  enabled: z.boolean(),
  botToken: z.string().optional(),
  channelId: z.string().optional(),
});
// Note: Validation removed - this is legacy config.
// Actual Telegram configuration is done via streams array with environment variables.

export const DiscordConfigSchema = z.object({
  enabled: z.boolean(),
  botToken: z.string().optional(),
  guildId: z.string().optional(),
  channelId: z.string().optional(),
});
// Note: Validation removed - this is legacy config.
// Actual Discord configuration would be done via streams array with environment variables.

export const CommunityConfigSchema = z.object({
  zulip: ZulipConfigSchema.optional(),
  telegram: TelegramConfigSchema.optional(),
  discord: DiscordConfigSchema.optional(),
});

export const WidgetConfigSchema = z.object({
  enabled: z.boolean(),
  title: z.string().min(1, 'Widget title is required'),
  welcomeMessage: z.string().min(1, 'Welcome message is required'),
  suggestedQuestions: z.array(z.string()).min(1, 'At least one suggested question is required'),
  position: z.enum(['bottom-right', 'bottom-left', 'top-right', 'top-left']),
  theme: z.enum(['light', 'dark', 'auto']),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

export const FeatureFlagsSchema = z.object({
  ragEnabled: z.boolean(),
  schedulerEnabled: z.boolean(),
  chatEnabled: z.boolean(),
  analyticsEnabled: z.boolean(),
  versionHistoryEnabled: z.boolean(),
});

export const DatabaseConfigSchema = z.object({
  name: z.string().min(1, 'Database name is required'),
  host: z.string().optional(),
  port: z.number().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
});

export const AdminConfigSchema = z.object({
  passwordHash: z.string().min(1, 'Admin password hash is required'),
  allowedOrigins: z.array(z.string()).optional(),
});

export const InstanceConfigSchema = z.object({
  project: ProjectConfigSchema,
  branding: BrandingConfigSchema,
  documentation: DocumentationConfigSchema,
  database: DatabaseConfigSchema,
  community: CommunityConfigSchema.optional(), // Legacy config - now optional (use streams array instead)
  widget: WidgetConfigSchema,
  features: FeatureFlagsSchema,
  admin: AdminConfigSchema,
  streams: z.array(z.any()).optional(), // Stream configurations (validated separately by StreamManager)
});
