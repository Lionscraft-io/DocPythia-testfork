/**
 * Prompts Overview Page
 * Read-only view of all available prompts in the system
 *
 * @created 2026-01-19
 */

import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  FileText,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useQuery } from '@tanstack/react-query';
import { adminApiRequest } from '@/lib/queryClient';

// Get instance prefix from URL (e.g., /myinstance/admin -> /myinstance)
function getInstancePrefix(): string {
  const pathParts = window.location.pathname.split('/');
  // If path is like /myinstance/admin/prompts, return /myinstance
  if (
    pathParts.length >= 2 &&
    pathParts[1] &&
    pathParts[1] !== 'admin' &&
    pathParts[1] !== 'login'
  ) {
    return `/${pathParts[1]}`;
  }
  return '';
}

interface PromptTemplate {
  id: string;
  version: string;
  metadata: {
    author?: string;
    description: string;
    requiredVariables: string[];
    tags: string[];
  };
  system: string;
  user: string;
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
}

interface PromptsResponse {
  instanceId: string;
  count: number;
  prompts: PromptTemplate[];
}

export default function PromptsOverview() {
  const [, setLocation] = useLocation();
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());
  const apiPrefix = getInstancePrefix();

  // Fetch prompts
  const {
    data: promptsData,
    isLoading,
    error,
  } = useQuery<PromptsResponse>({
    queryKey: [`${apiPrefix}/api/quality/prompts`],
    queryFn: async () => {
      const response = await adminApiRequest('GET', `${apiPrefix}/api/quality/prompts`);
      return response.json();
    },
  });

  const togglePromptExpanded = (promptId: string) => {
    const newExpanded = new Set(expandedPrompts);
    if (newExpanded.has(promptId)) {
      newExpanded.delete(promptId);
    } else {
      newExpanded.add(promptId);
    }
    setExpandedPrompts(newExpanded);
  };

  const navigateBack = () => {
    const basePath = apiPrefix ? `${apiPrefix}/admin` : '/admin';
    setLocation(basePath);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load prompts: {error instanceof Error ? error.message : 'Unknown error'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={navigateBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Prompts Overview</h1>
              <p className="text-sm text-gray-600">
                View all available prompts in the system ({promptsData?.instanceId || 'default'})
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto p-6">
        {/* Summary */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Prompt Templates
            </CardTitle>
            <CardDescription>
              {promptsData?.count || 0} prompts available for instance: {promptsData?.instanceId}
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Prompts List */}
        <div className="space-y-4">
          {promptsData?.prompts.map((prompt) => {
            const isExpanded = expandedPrompts.has(prompt.id);

            return (
              <Card key={prompt.id} className="overflow-hidden">
                <CardHeader
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => togglePromptExpanded(prompt.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg font-mono">{prompt.id}</CardTitle>
                        <Badge variant="outline" className="text-xs">
                          v{prompt.version}
                        </Badge>
                        {prompt.validation.valid ? (
                          <Badge className="bg-green-100 text-green-800">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Valid
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Invalid
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="mt-1">
                        {prompt.metadata.description}
                      </CardDescription>

                      {/* Tags */}
                      {prompt.metadata.tags.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {prompt.metadata.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    <Button variant="ghost" size="sm">
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 border-t">
                    {/* Validation Messages */}
                    {prompt.validation.errors.length > 0 && (
                      <Alert variant="destructive" className="mb-4">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          <ul className="list-disc list-inside">
                            {prompt.validation.errors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}

                    {prompt.validation.warnings.length > 0 && (
                      <Alert className="mb-4 border-yellow-200 bg-yellow-50">
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        <AlertDescription className="text-yellow-800">
                          <ul className="list-disc list-inside">
                            {prompt.validation.warnings.map((warn, i) => (
                              <li key={i}>{warn}</li>
                            ))}
                          </ul>
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Metadata */}
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      {prompt.metadata.author && (
                        <div>
                          <span className="text-sm font-medium text-gray-500">Author:</span>
                          <span className="ml-2 text-sm text-gray-900">
                            {prompt.metadata.author}
                          </span>
                        </div>
                      )}
                      <div>
                        <span className="text-sm font-medium text-gray-500">
                          Required Variables:
                        </span>
                        <div className="ml-2 mt-1 flex flex-wrap gap-1">
                          {prompt.metadata.requiredVariables.length > 0 ? (
                            prompt.metadata.requiredVariables.map((v) => (
                              <code
                                key={v}
                                className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-800"
                              >
                                {`{{${v}}}`}
                              </code>
                            ))
                          ) : (
                            <span className="text-sm text-gray-500">None</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* System Prompt */}
                    {prompt.system && (
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold text-gray-900 mb-2">System Prompt</h4>
                        <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                          {prompt.system}
                        </pre>
                      </div>
                    )}

                    {/* User Prompt */}
                    {prompt.user && (
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900 mb-2">User Prompt</h4>
                        <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm whitespace-pre-wrap max-h-64 overflow-y-auto">
                          {prompt.user}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}

          {(!promptsData?.prompts || promptsData.prompts.length === 0) && (
            <Card>
              <CardContent className="text-center py-8">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No prompts found for this instance</p>
                <p className="text-sm text-gray-400 mt-2">
                  Prompts should be placed in config/defaults/prompts/ or config/{'{instanceId}'}
                  /prompts/
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
