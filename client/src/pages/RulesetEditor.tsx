/**
 * Ruleset Editor Page
 * Create and edit tenant-specific rulesets for proposal quality control
 *
 * @created 2026-01-19
 */

import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  FileText,
  Save,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Info,
  Loader2,
  Sparkles,
  MessageSquare,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useQuery, useMutation } from '@tanstack/react-query';
import { adminApiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

// Get instance prefix from URL (e.g., /myinstance/admin -> /myinstance)
function getInstancePrefix(): string {
  const pathParts = window.location.pathname.split('/');
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

// Get tenant ID from URL (e.g., /myinstance/admin -> myinstance)
function getTenantId(): string {
  const pathParts = window.location.pathname.split('/');
  if (
    pathParts.length >= 2 &&
    pathParts[1] &&
    pathParts[1] !== 'admin' &&
    pathParts[1] !== 'login'
  ) {
    return pathParts[1];
  }
  return 'default';
}

interface Ruleset {
  id: number;
  tenantId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface Feedback {
  id: number;
  actionTaken: string;
  feedbackText: string;
  useForImprovement: boolean;
  createdAt: string;
  processedAt: string | null;
  proposal?: {
    id: number;
    page: string;
    section?: string;
    updateType: string;
  };
}

interface FeedbackResponse {
  instanceId: string;
  count: number;
  feedback: Feedback[];
}

interface ImprovementSuggestion {
  section: 'PROMPT_CONTEXT' | 'REVIEW_MODIFICATIONS' | 'REJECTION_RULES' | 'QUALITY_GATES';
  action: 'add' | 'modify' | 'remove';
  currentRule?: string;
  suggestedRule?: string;
  reasoning: string;
}

interface ImprovementResponse {
  instanceId: string;
  feedbackCount: number;
  feedbackIds: number[];
  suggestions: ImprovementSuggestion[];
  summary: string;
  currentRuleset: string;
}

const DEFAULT_RULESET_TEMPLATE = `# Tenant Ruleset
# This ruleset defines quality control rules for proposal review

## PROMPT_CONTEXT
# Additional context provided to the LLM during proposal generation
# Use this to add project-specific terminology, preferences, or guidelines

## REVIEW_MODIFICATIONS
# Automatic modifications applied to proposals before review
# Example: Replace deprecated terminology, enforce consistent formatting

## REJECTION_RULES
# Rules that automatically reject proposals
# Example: Reject proposals containing certain keywords or patterns

## QUALITY_GATES
# Quality requirements that proposals must meet
# Example: Minimum content length, required sections
`;

export default function RulesetEditor() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const apiPrefix = getInstancePrefix();
  const tenantId = getTenantId();

  const [content, setContent] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false);
  const [improvements, setImprovements] = useState<ImprovementResponse | null>(null);

  // Fetch feedback for this tenant
  const { data: feedbackData } = useQuery<FeedbackResponse>({
    queryKey: [`${apiPrefix}/api/quality/feedback`],
    queryFn: async () => {
      const response = await adminApiRequest('GET', `${apiPrefix}/api/quality/feedback`);
      return response.json();
    },
  });

  // Count unprocessed feedback
  const unprocessedFeedbackCount =
    feedbackData?.feedback?.filter((f) => f.useForImprovement && !f.processedAt).length || 0;

  // Generate improvements mutation
  const generateImprovementsMutation = useMutation({
    mutationFn: async () => {
      const response = await adminApiRequest(
        'POST',
        `${apiPrefix}/api/quality/improvements/generate`,
        {}
      );
      return response.json() as Promise<ImprovementResponse>;
    },
    onSuccess: (data) => {
      setImprovements(data);
      if (data.suggestions.length === 0) {
        toast({
          title: 'No suggestions',
          description: data.summary || 'No improvement suggestions based on current feedback.',
        });
      } else {
        toast({
          title: 'Improvements generated',
          description: `Generated ${data.suggestions.length} suggestions from ${data.feedbackCount} feedback items.`,
        });
      }
    },
    onError: (error) => {
      toast({
        title: 'Generation failed',
        description: error instanceof Error ? error.message : 'Failed to generate improvements',
        variant: 'destructive',
      });
    },
  });

  // Mark feedback as processed mutation
  const markProcessedMutation = useMutation({
    mutationFn: async (feedbackIds: number[]) => {
      const response = await adminApiRequest(
        'POST',
        `${apiPrefix}/api/quality/improvements/apply`,
        { feedbackIds }
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`${apiPrefix}/api/quality/feedback`] });
      setImprovements(null);
      toast({
        title: 'Feedback processed',
        description: 'Feedback items have been marked as processed.',
      });
    },
  });

  // Fetch existing ruleset
  const {
    data: ruleset,
    isLoading,
    error,
  } = useQuery<Ruleset>({
    queryKey: [`${apiPrefix}/api/quality/rulesets/${tenantId}`],
    queryFn: async () => {
      try {
        const response = await adminApiRequest(
          'GET',
          `${apiPrefix}/api/quality/rulesets/${tenantId}`
        );
        return response.json();
      } catch (err) {
        // 404 is expected for new tenants
        if (err instanceof Error && err.message.includes('404')) {
          return null;
        }
        throw err;
      }
    },
    retry: false,
  });

  // Initialize content from fetched ruleset or template
  useEffect(() => {
    if (!isLoading) {
      if (ruleset?.content) {
        setContent(ruleset.content);
      } else {
        // No ruleset or empty content - show template
        setContent(DEFAULT_RULESET_TEMPLATE);
      }
      setHasUnsavedChanges(false);
    }
  }, [ruleset, isLoading]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (newContent: string) => {
      const response = await adminApiRequest(
        'PUT',
        `${apiPrefix}/api/quality/rulesets/${tenantId}`,
        { content: newContent }
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`${apiPrefix}/api/quality/rulesets/${tenantId}`],
      });
      setHasUnsavedChanges(false);
      toast({
        title: 'Ruleset saved',
        description: 'Your changes have been saved successfully.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed to save ruleset',
        variant: 'destructive',
      });
    },
  });

  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    setHasUnsavedChanges(newContent !== (ruleset?.content || DEFAULT_RULESET_TEMPLATE));
  };

  const handleSave = () => {
    saveMutation.mutate(content);
  };

  const navigateBack = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('You have unsaved changes. Are you sure you want to leave?')) {
        return;
      }
    }
    const basePath = apiPrefix ? `${apiPrefix}/admin` : '/admin';
    setLocation(basePath);
  };

  if (error && !(error instanceof Error && error.message.includes('404'))) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load ruleset: {error instanceof Error ? error.message : 'Unknown error'}
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
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={navigateBack}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Ruleset Editor</h1>
                <p className="text-sm text-gray-600">
                  Configure quality rules for tenant: {tenantId}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasUnsavedChanges && (
                <span className="text-sm text-amber-600 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  Unsaved changes
                </span>
              )}
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending || !hasUnsavedChanges}
                className="bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300 disabled:text-gray-500 disabled:opacity-100"
              >
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save Ruleset
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto p-6">
        {/* Info Alert */}
        <Alert className="mb-6 border-blue-200 bg-blue-50">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            <strong>Ruleset Format:</strong> Use markdown headers to define sections. The system
            recognizes these sections: <code>PROMPT_CONTEXT</code>,{' '}
            <code>REVIEW_MODIFICATIONS</code>, <code>REJECTION_RULES</code>, and{' '}
            <code>QUALITY_GATES</code>.
          </AlertDescription>
        </Alert>

        {/* Status Card */}
        {ruleset && (
          <Card className="mb-6">
            <CardHeader className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <span className="text-sm font-medium text-gray-900">Ruleset saved</span>
                </div>
                <span className="text-xs text-gray-500">
                  Last updated: {new Date(ruleset.updatedAt).toLocaleString()}
                </span>
              </div>
            </CardHeader>
          </Card>
        )}

        {/* Editor */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Ruleset Content
            </CardTitle>
            <CardDescription>
              Edit the ruleset markdown below. Changes are applied to new proposal reviews.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              </div>
            ) : (
              <Textarea
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
                className="font-mono text-sm min-h-[500px] resize-y"
                placeholder="Enter your ruleset content..."
              />
            )}
          </CardContent>
        </Card>

        {/* Pipeline Overview */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">How the Pipeline Works</CardTitle>
            <CardDescription>Understanding the documentation update workflow</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm">
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h4 className="font-semibold text-blue-900 mb-2">Pipeline Flow</h4>
                <ol className="list-decimal list-inside space-y-2 text-blue-800">
                  <li>
                    <strong>Message Collection</strong> — Messages are collected from community
                    channels (Zulip, Telegram)
                  </li>
                  <li>
                    <strong>Thread Detection</strong> — AI groups related messages into conversation
                    threads
                  </li>
                  <li>
                    <strong>Proposal Generation</strong> — AI analyzes threads and generates
                    documentation update proposals
                  </li>
                  <li>
                    <strong>Ruleset Application</strong> — Your ruleset filters, modifies, or flags
                    proposals
                  </li>
                  <li>
                    <strong>Human Review</strong> — You approve, reject, or edit proposals in the
                    dashboard
                  </li>
                  <li>
                    <strong>PR Generation</strong> — Approved proposals are turned into GitHub pull
                    requests
                  </li>
                </ol>
              </div>

              <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                <h4 className="font-semibold text-purple-900 mb-2">Feedback Learning Loop</h4>
                <p className="text-purple-800 mb-2">
                  When you approve or reject proposals, your feedback is stored. The AI can analyze
                  this feedback to suggest ruleset improvements:
                </p>
                <ul className="list-disc list-inside space-y-1 text-purple-800">
                  <li>Frequently rejected proposals → New rejection rules</li>
                  <li>Common edits you make → Automatic modifications</li>
                  <li>Quality issues you flag → Quality gate rules</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section Reference */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg">Ruleset Section Reference</CardTitle>
            <CardDescription>How each section affects proposal processing</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm">
              <div className="p-3 border-l-4 border-green-500 bg-green-50">
                <h4 className="font-semibold text-gray-900">## PROMPT_CONTEXT</h4>
                <p className="text-gray-600 mt-1">
                  <strong>When applied:</strong> During proposal generation (Step 3)
                </p>
                <p className="text-gray-600 mt-1">
                  Add project-specific context, terminology, or writing style guidelines that the AI
                  should follow when creating proposals.
                </p>
              </div>
              <div className="p-3 border-l-4 border-amber-500 bg-amber-50">
                <h4 className="font-semibold text-gray-900">## REVIEW_MODIFICATIONS</h4>
                <p className="text-gray-600 mt-1">
                  <strong>When applied:</strong> After proposal generation (Step 4)
                </p>
                <p className="text-gray-600 mt-1">
                  Define find/replace patterns to automatically fix terminology, formatting, or
                  common issues in generated proposals.
                </p>
              </div>
              <div className="p-3 border-l-4 border-red-500 bg-red-50">
                <h4 className="font-semibold text-gray-900">## REJECTION_RULES</h4>
                <p className="text-gray-600 mt-1">
                  <strong>When applied:</strong> After proposal generation (Step 4)
                </p>
                <p className="text-gray-600 mt-1">
                  Criteria that automatically reject proposals. Use for duplicates, off-topic
                  content, or patterns that indicate low-quality suggestions.
                </p>
              </div>
              <div className="p-3 border-l-4 border-blue-500 bg-blue-50">
                <h4 className="font-semibold text-gray-900">## QUALITY_GATES</h4>
                <p className="text-gray-600 mt-1">
                  <strong>When applied:</strong> After proposal generation (Step 4)
                </p>
                <p className="text-gray-600 mt-1">
                  Quality checks that flag proposals for careful review without rejecting them. Use
                  for content length, required sections, or complexity thresholds.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Feedback & Improvements Panel */}
        <Card className="mt-6">
          <CardHeader
            className="cursor-pointer"
            onClick={() => setShowFeedbackPanel(!showFeedbackPanel)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                <CardTitle className="text-lg">AI-Powered Improvements</CardTitle>
                {unprocessedFeedbackCount > 0 && (
                  <Badge variant="secondary" className="bg-purple-100 text-purple-700">
                    {unprocessedFeedbackCount} feedback items
                  </Badge>
                )}
              </div>
              {showFeedbackPanel ? (
                <ChevronUp className="w-5 h-5 text-gray-500" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-500" />
              )}
            </div>
            <CardDescription>
              Generate ruleset improvements based on approval/rejection feedback
            </CardDescription>
          </CardHeader>

          {showFeedbackPanel && (
            <CardContent className="space-y-4">
              {/* Feedback Summary */}
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-gray-600" />
                  <div>
                    <p className="font-medium text-gray-900">
                      {unprocessedFeedbackCount} unprocessed feedback items
                    </p>
                    <p className="text-sm text-gray-600">
                      Total: {feedbackData?.count || 0} feedback entries
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => generateImprovementsMutation.mutate()}
                  disabled={
                    generateImprovementsMutation.isPending || unprocessedFeedbackCount === 0
                  }
                  className="bg-purple-600 hover:bg-purple-700 text-white border-purple-700"
                >
                  {generateImprovementsMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate Improvements
                    </>
                  )}
                </Button>
              </div>

              {/* Improvements Display */}
              {improvements && improvements.suggestions.length > 0 && (
                <div className="space-y-4">
                  <Alert className="border-purple-200 bg-purple-50">
                    <Sparkles className="h-4 w-4 text-purple-600" />
                    <AlertDescription className="text-purple-800">
                      <strong>AI Summary:</strong> {improvements.summary}
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-3">
                    {improvements.suggestions.map((suggestion, idx) => (
                      <div key={idx} className="p-4 border border-gray-200 rounded-lg bg-white">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge
                            variant="outline"
                            className={
                              suggestion.action === 'add'
                                ? 'border-green-300 text-green-700 bg-green-50'
                                : suggestion.action === 'modify'
                                  ? 'border-amber-300 text-amber-700 bg-amber-50'
                                  : 'border-red-300 text-red-700 bg-red-50'
                            }
                          >
                            {suggestion.action === 'add' && <Plus className="w-3 h-3 mr-1" />}
                            {suggestion.action === 'modify' && <Pencil className="w-3 h-3 mr-1" />}
                            {suggestion.action === 'remove' && <Trash2 className="w-3 h-3 mr-1" />}
                            {suggestion.action.toUpperCase()}
                          </Badge>
                          <Badge variant="secondary">{suggestion.section}</Badge>
                        </div>

                        {suggestion.currentRule && (
                          <div className="mb-2">
                            <span className="text-xs text-gray-500">Current:</span>
                            <p className="text-sm font-mono bg-red-50 text-red-800 p-2 rounded mt-1">
                              - {suggestion.currentRule}
                            </p>
                          </div>
                        )}

                        {suggestion.suggestedRule && (
                          <div className="mb-2">
                            <span className="text-xs text-gray-500">Suggested:</span>
                            <p className="text-sm font-mono bg-green-50 text-green-800 p-2 rounded mt-1">
                              + {suggestion.suggestedRule}
                            </p>
                          </div>
                        )}

                        <p className="text-sm text-gray-600 mt-2">
                          <strong>Reasoning:</strong> {suggestion.reasoning}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t">
                    <p className="text-sm text-gray-500">
                      Apply these suggestions manually by editing the ruleset above, then mark
                      feedback as processed.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (improvements.feedbackIds.length > 0) {
                          markProcessedMutation.mutate(improvements.feedbackIds);
                        }
                      }}
                      disabled={markProcessedMutation.isPending}
                    >
                      {markProcessedMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Marking...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Mark as Processed
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* No suggestions state */}
              {improvements && improvements.suggestions.length === 0 && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    {improvements.summary || 'No improvement suggestions at this time.'}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          )}
        </Card>
      </main>
    </div>
  );
}
