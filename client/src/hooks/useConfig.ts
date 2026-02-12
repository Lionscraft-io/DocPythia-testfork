import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';

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
  chatEnabled: boolean;
  versionHistoryEnabled: boolean;
}

export interface RepositoryConfig {
  targetRepo: string;
  sourceRepo: string;
  baseBranch: string;
}

export interface AppConfig {
  project: ProjectConfig;
  branding: BrandingConfig;
  widget: WidgetConfig;
  features: FeatureFlags;
  repository: RepositoryConfig;
}

/**
 * Get the instance ID from a URL path
 * e.g., /myinstance/admin -> "myinstance", /admin -> null
 */
function getInstanceFromPath(path: string): string | null {
  // Match /:instance/... pattern (but not /admin, /api, etc.)
  const match = path.match(/^\/([a-zA-Z0-9_-]+)\//);
  if (match) {
    const potentialInstance = match[1];
    // Exclude known non-instance routes
    const nonInstanceRoutes = ['api', 'admin', 'docs', 'assets', 'static', 'login', 'logout'];
    if (!nonInstanceRoutes.includes(potentialInstance)) {
      return potentialInstance;
    }
  }
  return null;
}

async function fetchConfig(instance: string | null): Promise<AppConfig> {
  // Determine the correct config endpoint based on instance
  const configUrl = instance ? `/${instance}/api/config` : '/api/config';

  console.log(`[useConfig] Fetching config from: ${configUrl} (instance: ${instance})`);

  const response = await fetch(configUrl);
  if (!response.ok) {
    throw new Error('Failed to fetch configuration');
  }
  const data = await response.json();
  console.log(`[useConfig] Config loaded:`, {
    instance,
    targetRepo: data.repository?.targetRepo,
    projectName: data.project?.name,
  });
  return data;
}

export function useConfig() {
  // Use wouter's useLocation to ensure we re-render when the URL changes
  // This is critical for proper instance detection after navigation
  const [location] = useLocation();
  const instance = getInstanceFromPath(location);

  return useQuery({
    queryKey: ['config', instance], // Include instance in key for proper caching per-instance
    queryFn: () => fetchConfig(instance),
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    retry: 3,
  });
}
