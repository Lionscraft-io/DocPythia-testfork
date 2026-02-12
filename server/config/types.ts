// Instance configuration types
// Multi-instance configuration system

export interface InstanceConfig {
  project: ProjectConfig;
  branding: BrandingConfig;
  documentation: DocumentationConfig;
  database: DatabaseConfig;
  community?: CommunityConfig; // Legacy - now optional (use streams array instead)
  widget: WidgetConfig;
  features: FeatureFlags;
  admin: AdminConfig;
  streams?: any[]; // Stream configurations
}

export interface DatabaseConfig {
  name: string; // Database name for this instance
  host?: string; // Override from env if needed
  port?: number;
  user?: string;
  password?: string;
}

export interface ProjectConfig {
  name: string;
  shortName: string;
  description: string;
  domain?: string;
  supportEmail?: string;
}

export interface BrandingConfig {
  logo: string;
  favicon?: string;
  primaryColor: string;
  secondaryColor?: string;
  accentColor?: string;
  darkModePrimaryColor?: string;
  projectUrl: string;
}

export interface DocumentationConfig {
  gitUrl: string;
  branch: string;
  gitUsername?: string;
  gitToken?: string;
  docsPath?: string; // Path within repo, e.g., "docs/" or ""
}

export interface CommunityConfig {
  zulip?: ZulipConfig;
  telegram?: TelegramConfig;
  discord?: DiscordConfig;
}

export interface ZulipConfig {
  enabled: boolean;
  site?: string;
  botEmail?: string;
  apiKey?: string;
  channel?: string;
}

export interface TelegramConfig {
  enabled: boolean;
  botToken?: string;
  channelId?: string;
}

export interface DiscordConfig {
  enabled: boolean;
  botToken?: string;
  guildId?: string;
  channelId?: string;
}

export interface WidgetConfig {
  enabled: boolean;
  title: string;
  welcomeMessage: string;
  suggestedQuestions: string[];
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  theme: 'light' | 'dark' | 'auto';
  primaryColor?: string;
}

export interface FeatureFlags {
  ragEnabled: boolean;
  schedulerEnabled: boolean;
  chatEnabled: boolean;
  analyticsEnabled: boolean;
  versionHistoryEnabled: boolean;
}

export interface AdminConfig {
  passwordHash: string;
  allowedOrigins?: string[];
}

// Runtime configuration with resolved values
export interface ResolvedConfig extends InstanceConfig {
  _source: ConfigSource;
}

export interface ConfigSource {
  file: boolean;
  env: boolean;
  defaults: boolean;
  s3?: boolean;
}
