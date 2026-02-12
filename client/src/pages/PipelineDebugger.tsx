/**
 * Pipeline Debugger Page
 * Debug pipeline runs, view step execution details, manage prompt overrides
 *
 * @created 2026-01-19
 */

import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Play,
  AlertCircle,
  CheckCircle2,
  Clock,
  Layers,
  FileText,
  Edit,
  X,
  Save,
  Trash2,
  RefreshCw,
  Zap,
  MessageSquare,
  Database,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { adminApiRequest } from '@/lib/queryClient';
import PipelineProgress from '@/components/PipelineProgress';

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

interface PipelineStep {
  stepName: string;
  stepType: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  durationMs: number;
  inputCount?: number;
  outputCount?: number;
  promptUsed?: string;
  error?: string;
  outputSummary?: string;
}

interface PipelineRun {
  id: number;
  instanceId: string;
  batchId: string;
  pipelineId: string;
  status: string;
  inputMessages: number;
  steps: PipelineStep[];
  outputThreads?: number;
  outputProposals?: number;
  totalDurationMs?: number;
  llmCalls?: number;
  llmTokensUsed?: number;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

interface PipelineRunsResponse {
  runs: PipelineRun[];
  total: number;
}

interface PromptWithOverride {
  id: string;
  version: string;
  hasOverride: boolean;
  override?: {
    system?: string;
    user?: string;
    createdAt: string;
  };
  metadata: {
    description: string;
    tags: string[];
  };
  system: string;
  user: string;
}

interface PromptsWithOverridesResponse {
  prompts: PromptWithOverride[];
}

export default function PipelineDebugger() {
  const [, setLocation] = useLocation();
  useQueryClient(); // Used for cache invalidation
  const apiPrefix = getInstancePrefix();

  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [editedSystem, setEditedSystem] = useState('');
  const [editedUser, setEditedUser] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);
  const [initialRunCount, setInitialRunCount] = useState<number | null>(null);

  // Fetch pipeline runs - poll more frequently when processing
  const {
    data: runsData,
    isLoading: runsLoading,
    error: runsError,
    refetch: refetchRuns,
  } = useQuery<PipelineRunsResponse>({
    queryKey: [`${apiPrefix}/api/admin/quality/pipeline/runs`],
    queryFn: async () => {
      const response = await adminApiRequest(
        'GET',
        `${apiPrefix}/api/admin/quality/pipeline/runs?limit=50`
      );
      return response.json();
    },
    // Poll every 2s when processing, otherwise every 30s for background updates
    refetchInterval: isProcessing ? 2000 : 30000,
  });

  // Fetch selected run details
  const { data: selectedRun } = useQuery<PipelineRun>({
    queryKey: [`${apiPrefix}/api/admin/quality/pipeline/runs/${selectedRunId}`],
    queryFn: async () => {
      const response = await adminApiRequest(
        'GET',
        `${apiPrefix}/api/admin/quality/pipeline/runs/${selectedRunId}`
      );
      return response.json();
    },
    enabled: selectedRunId !== null,
  });

  // Fetch prompts with override status
  const {
    data: promptsData,
    isLoading: promptsLoading,
    refetch: refetchPrompts,
  } = useQuery<PromptsWithOverridesResponse>({
    queryKey: [`${apiPrefix}/api/admin/quality/pipeline/prompts`],
    queryFn: async () => {
      const response = await adminApiRequest(
        'GET',
        `${apiPrefix}/api/admin/quality/pipeline/prompts`
      );
      return response.json();
    },
  });

  // Save prompt override mutation
  const saveOverrideMutation = useMutation({
    mutationFn: async (data: { promptId: string; system?: string; user?: string }) => {
      return adminApiRequest(
        'PUT',
        `${apiPrefix}/api/admin/quality/pipeline/prompts/${data.promptId}/override`,
        { system: data.system, user: data.user }
      );
    },
    onSuccess: () => {
      refetchPrompts();
      setEditingPrompt(null);
    },
  });

  // Delete prompt override mutation
  const deleteOverrideMutation = useMutation({
    mutationFn: async (promptId: string) => {
      return adminApiRequest(
        'DELETE',
        `${apiPrefix}/api/admin/quality/pipeline/prompts/${promptId}/override`
      );
    },
    onSuccess: () => {
      refetchPrompts();
    },
  });

  // Fetch pending messages count - poll when processing to show count decreasing
  const { data: pendingData, refetch: refetchPending } = useQuery<{
    pendingCount: number;
    sampleMessages: Array<{
      id: number;
      streamId: string;
      author: string;
      content: string;
      timestamp: string;
      channel: string;
      topic: string;
    }>;
  }>({
    queryKey: [`${apiPrefix}/api/admin/quality/pipeline/pending-messages`],
    queryFn: async () => {
      const response = await adminApiRequest(
        'GET',
        `${apiPrefix}/api/admin/quality/pipeline/pending-messages`
      );
      return response.json();
    },
    // Poll every 2s when processing to show count decrease
    refetchInterval: isProcessing ? 2000 : false,
  });

  // Track running state and detect completion
  const hasRunningPipeline = runsData?.runs.some((run) => run.status === 'running');
  const currentRunCount = runsData?.runs.length ?? 0;

  // Detect when processing completes
  useEffect(() => {
    if (!isProcessing || !runsData) return;

    // Wait at least 3 seconds before checking for completion to allow backend to create run
    const minWaitTime = 3000;
    const elapsed = processingStartedAt ? Date.now() - processingStartedAt : 0;
    if (elapsed < minWaitTime) return;

    // Check if a new run appeared (run count increased) or if we see a running pipeline that completed
    const newRunAppeared = initialRunCount !== null && currentRunCount > initialRunCount;
    const recentRun = runsData.runs[0];

    if (newRunAppeared && recentRun && recentRun.status !== 'running') {
      // New completed run found
      setIsProcessing(false);
      setProcessingStartedAt(null);
      setInitialRunCount(null);
      refetchPending();
      if (recentRun.id !== selectedRunId) {
        setSelectedRunId(recentRun.id);
      }
    } else if (hasRunningPipeline === false && elapsed > 10000) {
      // Fallback: if no running pipeline after 10s, assume completion
      setIsProcessing(false);
      setProcessingStartedAt(null);
      setInitialRunCount(null);
      refetchPending();
      if (recentRun && recentRun.id !== selectedRunId) {
        setSelectedRunId(recentRun.id);
      }
    }
  }, [
    isProcessing,
    hasRunningPipeline,
    runsData,
    currentRunCount,
    initialRunCount,
    processingStartedAt,
    selectedRunId,
    refetchPending,
  ]);

  // Run test pipeline mutation - returns immediately, frontend polls for completion
  const runTestMutation = useMutation({
    mutationFn: async () => {
      const response = await adminApiRequest(
        'POST',
        `${apiPrefix}/api/admin/quality/pipeline/test-run`
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to run pipeline');
      }
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success && data.status === 'processing') {
        // Pipeline started - enter polling mode
        setIsProcessing(true);
        setProcessingStartedAt(Date.now());
        setInitialRunCount(runsData?.runs.length ?? 0);
        refetchRuns();
        refetchPending();
      } else if (!data.success) {
        // No messages to process
        alert(data.message || 'No messages to process');
      }
    },
    onError: (error) => {
      setIsProcessing(false);
      setProcessingStartedAt(null);
      setInitialRunCount(null);
      alert(`Error: ${error.message}`);
    },
  });

  // Simulate messages mutation
  const simulateMutation = useMutation({
    mutationFn: async (messages: Array<{ content: string; author?: string }>) => {
      const response = await adminApiRequest(
        'POST',
        `${apiPrefix}/api/admin/quality/pipeline/simulate`,
        { messages }
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || 'Failed to create test messages');
      }
      return response.json();
    },
    onSuccess: () => {
      refetchPending();
    },
    onError: (error) => {
      alert(`Error: ${error.message}`);
    },
  });

  const [showSimulateForm, setShowSimulateForm] = useState(false);
  const [simulateContent, setSimulateContent] = useState('');

  const navigateBack = () => {
    const basePath = apiPrefix ? `${apiPrefix}/admin` : '/admin';
    setLocation(basePath);
  };

  const startEditingPrompt = (prompt: PromptWithOverride) => {
    setEditingPrompt(prompt.id);
    setEditedSystem(prompt.override?.system || prompt.system);
    setEditedUser(prompt.override?.user || prompt.user);
  };

  const cancelEditing = () => {
    setEditingPrompt(null);
    setEditedSystem('');
    setEditedUser('');
  };

  const saveOverride = () => {
    if (editingPrompt) {
      saveOverrideMutation.mutate({
        promptId: editingPrompt,
        system: editedSystem,
        user: editedUser,
      });
    }
  };

  const formatDuration = (ms?: number): string => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatDate = (date: string): string => {
    return new Date(date).toLocaleString();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge className="bg-green-100 text-green-800">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Completed
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="bg-red-100 text-red-800">
            <AlertCircle className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
      case 'running':
        return (
          <Badge className="bg-blue-100 text-blue-800">
            <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
            Running
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (runsLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (runsError) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load pipeline runs:{' '}
              {runsError instanceof Error ? runsError.message : 'Unknown error'}
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
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={navigateBack}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Pipeline Debugger</h1>
              <p className="text-sm text-gray-600">
                Debug pipeline runs and manage prompt overrides
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto p-6">
        <Tabs defaultValue="runs" className="space-y-6">
          <TabsList>
            <TabsTrigger value="runs" className="flex items-center gap-2">
              <Play className="w-4 h-4" />
              Pipeline Runs
            </TabsTrigger>
            <TabsTrigger value="test" className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Test Pipeline
            </TabsTrigger>
            <TabsTrigger value="prompts" className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Prompt Overrides
            </TabsTrigger>
          </TabsList>

          {/* Pipeline Runs Tab */}
          <TabsContent value="runs" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Runs List */}
              <div className="lg:col-span-1">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Layers className="w-5 h-5" />
                        Recent Runs
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => refetchRuns()}>
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                    </div>
                    <CardDescription>{runsData?.total || 0} pipeline runs</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y max-h-[600px] overflow-y-auto">
                      {runsData?.runs.map((run) => (
                        <div
                          key={run.id}
                          className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                            selectedRunId === run.id
                              ? 'bg-blue-50 border-l-2 border-l-blue-500'
                              : ''
                          }`}
                          onClick={() => setSelectedRunId(run.id)}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <span className="font-mono text-sm font-medium truncate max-w-[180px]">
                              {run.pipelineId}
                            </span>
                            {getStatusBadge(run.status)}
                          </div>
                          <div className="text-xs text-gray-500 space-y-1">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDate(run.createdAt)}
                            </div>
                            <div className="flex items-center gap-2">
                              <span>{run.inputMessages} inputs</span>
                              <span>→</span>
                              <span>{run.outputProposals ?? '-'} proposals</span>
                            </div>
                          </div>
                        </div>
                      ))}

                      {(!runsData?.runs || runsData.runs.length === 0) && (
                        <div className="p-8 text-center text-gray-500">
                          <Play className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                          <p>No pipeline runs found</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Run Details */}
              <div className="lg:col-span-2">
                {selectedRunId && selectedRun ? (
                  <Card>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <span className="font-mono">{selectedRun.pipelineId}</span>
                            {getStatusBadge(selectedRun.status)}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            Batch: {selectedRun.batchId}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {/* Metrics */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-gray-50 rounded-lg p-3">
                          <div className="flex items-center gap-2 text-gray-600 mb-1">
                            <Clock className="w-4 h-4" />
                            <span className="text-sm">Duration</span>
                          </div>
                          <span className="text-lg font-semibold">
                            {formatDuration(selectedRun.totalDurationMs)}
                          </span>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <div className="flex items-center gap-2 text-gray-600 mb-1">
                            <MessageSquare className="w-4 h-4" />
                            <span className="text-sm">Input</span>
                          </div>
                          <span className="text-lg font-semibold">
                            {selectedRun.inputMessages} msgs
                          </span>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <div className="flex items-center gap-2 text-gray-600 mb-1">
                            <Zap className="w-4 h-4" />
                            <span className="text-sm">LLM Calls</span>
                          </div>
                          <span className="text-lg font-semibold">
                            {selectedRun.llmCalls ?? '-'}
                          </span>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">
                          <div className="flex items-center gap-2 text-gray-600 mb-1">
                            <Database className="w-4 h-4" />
                            <span className="text-sm">Output</span>
                          </div>
                          <span className="text-lg font-semibold">
                            {selectedRun.outputProposals ?? '-'} proposals
                          </span>
                        </div>
                      </div>

                      {/* Error Message */}
                      {selectedRun.errorMessage && (
                        <Alert variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription className="font-mono text-sm whitespace-pre-wrap">
                            {selectedRun.errorMessage}
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Pipeline Progress Visualization */}
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-3">Pipeline Progress</h4>
                        <PipelineProgress
                          isRunning={selectedRun.status === 'running'}
                          currentRun={selectedRun}
                          prompts={promptsData?.prompts?.map((p) => ({
                            id: p.id,
                            system: p.override?.system || p.system,
                            user: p.override?.user || p.user,
                            metadata: p.metadata,
                          }))}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="h-full flex items-center justify-center">
                    <CardContent className="text-center py-16">
                      <Layers className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500">Select a pipeline run to view details</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Test Pipeline Tab */}
          <TabsContent value="test" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pending Messages */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <MessageSquare className="w-5 h-5" />
                        Pending Messages
                      </CardTitle>
                      <CardDescription>
                        Messages waiting to be processed by the pipeline
                      </CardDescription>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => refetchPending()}>
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-4">
                    <div className="text-4xl font-bold text-blue-600 mb-2">
                      {pendingData?.pendingCount ?? 0}
                    </div>
                    <p className="text-sm text-gray-500">pending messages</p>
                  </div>

                  {pendingData?.sampleMessages && pendingData.sampleMessages.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-sm font-medium text-gray-700">Recent messages:</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {pendingData.sampleMessages.map((msg) => (
                          <div key={msg.id} className="text-sm p-2 bg-gray-50 rounded border">
                            <div className="flex items-center gap-2 text-gray-500 mb-1">
                              <span className="font-medium">{msg.author}</span>
                              <span>•</span>
                              <span>{msg.streamId}</span>
                            </div>
                            <p className="text-gray-700 line-clamp-2">{msg.content}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-4">
                    <Button
                      className="w-full"
                      onClick={() => runTestMutation.mutate()}
                      disabled={
                        runTestMutation.isPending ||
                        isProcessing ||
                        (pendingData?.pendingCount ?? 0) === 0
                      }
                    >
                      {runTestMutation.isPending || isProcessing ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          {isProcessing ? 'Processing...' : 'Starting Pipeline...'}
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Run Pipeline on Pending Messages
                        </>
                      )}
                    </Button>
                    {isProcessing && (
                      <p className="text-xs text-blue-600 mt-2 text-center">
                        Pipeline running in background. Results will appear in Pipeline Runs tab.
                      </p>
                    )}
                    {!isProcessing && (pendingData?.pendingCount ?? 0) === 0 && (
                      <p className="text-xs text-gray-500 mt-2 text-center">
                        No pending messages. Create simulated messages below to test.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Simulate Messages */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Zap className="w-5 h-5" />
                    Simulate Test Messages
                  </CardTitle>
                  <CardDescription>
                    Create fake messages to test the pipeline without waiting for real data
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!showSimulateForm ? (
                    <div className="text-center py-8">
                      <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500 mb-4">
                        Create simulated messages to test how the pipeline processes them
                      </p>
                      <Button variant="outline" onClick={() => setShowSimulateForm(true)}>
                        <Zap className="w-4 h-4 mr-2" />
                        Create Test Messages
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="simulate-content">Test Message Content</Label>
                        <Textarea
                          id="simulate-content"
                          value={simulateContent}
                          onChange={(e) => setSimulateContent(e.target.value)}
                          placeholder="Enter a message that might trigger a documentation update, e.g.:

I figured out how to configure the validator node. You need to set min_peers=5 in the config.json file and make sure the network port 24567 is open. This fixed my syncing issues."
                          rows={6}
                          className="mt-1"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Write a message that contains documentation-worthy information
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowSimulateForm(false);
                            setSimulateContent('');
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={() => {
                            if (simulateContent.trim()) {
                              simulateMutation.mutate([{ content: simulateContent.trim() }]);
                              setSimulateContent('');
                              setShowSimulateForm(false);
                            }
                          }}
                          disabled={simulateMutation.isPending || !simulateContent.trim()}
                        >
                          {simulateMutation.isPending ? (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <Zap className="w-4 h-4 mr-2" />
                              Create & Queue Message
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Quick Tips */}
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>How to test:</strong> Create a simulated message with content that would
                trigger a documentation update (e.g., troubleshooting steps, configuration tips).
                Then click "Run Pipeline" to process it. The results will appear in the Pipeline
                Runs tab.
              </AlertDescription>
            </Alert>

            {/* Pipeline Progress Visualization - Only show when actively running */}
            {(isProcessing || hasRunningPipeline) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Layers className="w-5 h-5" />
                    Pipeline Progress
                  </CardTitle>
                  <CardDescription>
                    Visual representation of pipeline stages and execution status
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <PipelineProgress
                    isRunning={true}
                    currentRun={
                      runsData?.runs.find((r) => r.status === 'running') || runsData?.runs[0]
                    }
                    prompts={promptsData?.prompts?.map((p) => ({
                      id: p.id,
                      system: p.override?.system || p.system,
                      user: p.override?.user || p.user,
                      metadata: p.metadata,
                    }))}
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Prompt Overrides Tab */}
          <TabsContent value="prompts" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Edit className="w-5 h-5" />
                      Prompt Overrides
                    </CardTitle>
                    <CardDescription>
                      Create temporary overrides to test prompt changes without modifying defaults
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => refetchPrompts()}>
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {promptsLoading ? (
                  <div className="animate-pulse space-y-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-20 bg-gray-200 rounded"></div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {promptsData?.prompts.map((prompt) => {
                      const isEditing = editingPrompt === prompt.id;

                      return (
                        <div key={prompt.id} className="border rounded-lg overflow-hidden">
                          <div className="flex items-start justify-between p-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-medium">{prompt.id}</span>
                                <Badge variant="outline" className="text-xs">
                                  v{prompt.version}
                                </Badge>
                                {prompt.hasOverride && (
                                  <Badge className="bg-orange-100 text-orange-800">
                                    <Edit className="w-3 h-3 mr-1" />
                                    Override Active
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-gray-600 mt-1">
                                {prompt.metadata.description}
                              </p>
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
                            <div className="flex gap-2">
                              {!isEditing && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => startEditingPrompt(prompt)}
                                  >
                                    <Edit className="w-4 h-4 mr-1" />
                                    {prompt.hasOverride ? 'Edit Override' : 'Create Override'}
                                  </Button>
                                  {prompt.hasOverride && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-red-600 hover:text-red-700"
                                      onClick={() => deleteOverrideMutation.mutate(prompt.id)}
                                      disabled={deleteOverrideMutation.isPending}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {isEditing && (
                            <div className="border-t p-4 bg-gray-50 space-y-4">
                              <div>
                                <Label htmlFor={`${prompt.id}-system`}>System Prompt</Label>
                                <Textarea
                                  id={`${prompt.id}-system`}
                                  value={editedSystem}
                                  onChange={(e) => setEditedSystem(e.target.value)}
                                  rows={6}
                                  className="mt-1 font-mono text-sm"
                                />
                              </div>
                              <div>
                                <Label htmlFor={`${prompt.id}-user`}>User Prompt</Label>
                                <Textarea
                                  id={`${prompt.id}-user`}
                                  value={editedUser}
                                  onChange={(e) => setEditedUser(e.target.value)}
                                  rows={6}
                                  className="mt-1 font-mono text-sm"
                                />
                              </div>
                              <div className="flex gap-2 justify-end">
                                <Button variant="outline" onClick={cancelEditing}>
                                  <X className="w-4 h-4 mr-1" />
                                  Cancel
                                </Button>
                                <Button
                                  onClick={saveOverride}
                                  disabled={saveOverrideMutation.isPending}
                                >
                                  <Save className="w-4 h-4 mr-1" />
                                  Save Override
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {(!promptsData?.prompts || promptsData.prompts.length === 0) && (
                      <div className="text-center py-8">
                        <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-gray-500">No prompts found</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
