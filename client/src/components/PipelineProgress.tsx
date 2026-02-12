/**
 * Pipeline Progress Visual Component
 * Shows real-time pipeline execution with animated steps and details
 *
 * @created 2026-02-11
 */

import { useState } from 'react';
import {
  Filter,
  Tags,
  Search,
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  ChevronUp,
  ChevronDown,
  FileText,
  AlertCircle,
  ArrowRight,
  Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';

interface PromptLogEntry {
  label: string;
  entryType: 'llm-call' | 'rag-query';
  promptId?: string;
  template?: { system: string; user: string };
  resolved?: { system: string; user: string };
  response?: string;
  query?: string;
  resultCount?: number;
  results?: Array<{ filePath: string; title: string; similarity: number }>;
}

interface PipelineStep {
  stepName: string;
  stepType: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  durationMs?: number;
  inputCount?: number;
  outputCount?: number;
  promptUsed?: string;
  error?: string;
  outputSummary?: string; // JSON summary of step output
  // Prompt debugging fields (legacy single-entry, backward compat)
  promptId?: string;
  promptTemplate?: { system: string; user: string };
  promptResolved?: { system: string; user: string };
  llmResponse?: string;
  // Multi-entry prompt/query log (new format)
  promptEntries?: PromptLogEntry[];
}

interface PipelineProgressProps {
  isRunning: boolean;
  currentRun?: {
    id: number;
    status: string;
    steps: PipelineStep[];
    inputMessages: number;
    outputProposals?: number;
    totalDurationMs?: number;
  } | null;
  prompts?: Array<{
    id: string;
    system: string;
    user: string;
    metadata: { description: string };
  }>;
}

// Define all pipeline stages with their metadata
const PIPELINE_STAGES = [
  {
    id: 'filter',
    name: 'Filter',
    stepType: 'filter',
    icon: Filter,
    description: 'Pre-filter messages by keywords',
    promptId: null,
    color: 'blue',
  },
  {
    id: 'classify',
    name: 'Classify',
    stepType: 'classify',
    icon: Tags,
    description: 'Classify messages into threads and categories',
    promptId: 'thread-classification',
    color: 'purple',
  },
  {
    id: 'enrich',
    name: 'Enrich',
    stepType: 'enrich',
    icon: Search,
    description: 'Retrieve relevant documentation context via RAG',
    promptId: null,
    color: 'cyan',
  },
  {
    id: 'generate',
    name: 'Generate',
    stepType: 'generate',
    icon: Sparkles,
    description: 'Generate documentation update proposals',
    promptId: 'changeset-generation',
    color: 'amber',
  },
  {
    id: 'validate',
    name: 'Validate',
    stepType: 'validate',
    icon: CheckCircle2,
    description: 'Validate and reformat proposal content',
    promptId: 'content-reformat',
    color: 'green',
  },
  {
    id: 'condense',
    name: 'Condense',
    stepType: 'condense',
    icon: FileText,
    description: 'Reduce proposal length if needed',
    promptId: 'content-condense',
    color: 'rose',
  },
];

function getStepStatus(
  stageType: string,
  steps: PipelineStep[],
  isRunning: boolean
): 'pending' | 'running' | 'completed' | 'failed' | 'skipped' {
  const step = steps.find((s) => s.stepType === stageType);
  if (step) {
    return step.status as 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  }
  // If running but step not in list yet, it might be pending or current
  if (isRunning) {
    // Find the last completed step to determine current position
    const completedSteps = steps.filter((s) => s.status === 'completed');
    const stageIndex = PIPELINE_STAGES.findIndex((s) => s.stepType === stageType);
    const lastCompletedIndex = PIPELINE_STAGES.findIndex(
      (s) => s.stepType === completedSteps[completedSteps.length - 1]?.stepType
    );

    if (stageIndex === lastCompletedIndex + 1) {
      return 'running';
    } else if (stageIndex > lastCompletedIndex + 1) {
      return 'pending';
    }
  }
  return 'pending';
}

function getStepData(stageType: string, steps: PipelineStep[]): PipelineStep | undefined {
  return steps.find((s) => s.stepType === stageType);
}

function formatDuration(ms?: number): string {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

type PromptViewType = 'template' | 'resolved' | 'response';

export default function PipelineProgress({
  isRunning,
  currentRun,
  prompts,
}: PipelineProgressProps) {
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(new Set());
  // Track which view is selected for each step's prompt section
  const [promptViews, setPromptViews] = useState<Map<string, PromptViewType>>(new Map());

  const togglePromptExpanded = (promptId: string) => {
    const newExpanded = new Set(expandedPrompts);
    if (newExpanded.has(promptId)) {
      newExpanded.delete(promptId);
    } else {
      newExpanded.add(promptId);
    }
    setExpandedPrompts(newExpanded);
  };

  const getPromptView = (stageId: string): PromptViewType => {
    return promptViews.get(stageId) || 'template';
  };

  const setPromptView = (stageId: string, view: PromptViewType) => {
    const newViews = new Map(promptViews);
    newViews.set(stageId, view);
    setPromptViews(newViews);
  };

  const steps = currentRun?.steps || [];
  const showProgress = isRunning || (currentRun && currentRun.status !== 'pending');

  if (!showProgress) {
    return (
      <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center">
        <div className="flex justify-center gap-2 mb-4">
          {PIPELINE_STAGES.map((stage, index) => (
            <div key={stage.id} className="flex items-center">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                <stage.icon className="w-5 h-5 text-gray-400" />
              </div>
              {index < PIPELINE_STAGES.length - 1 && <div className="w-8 h-0.5 bg-gray-200 mx-1" />}
            </div>
          ))}
        </div>
        <p className="text-gray-500 text-sm">Pipeline stages will appear here when running</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="border rounded-lg bg-white overflow-hidden">
        {/* Pipeline Header */}
        <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                <span className="font-medium text-blue-700">Pipeline Running...</span>
              </>
            ) : currentRun?.status === 'completed' ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="font-medium text-green-700">Pipeline Completed</span>
              </>
            ) : currentRun?.status === 'failed' ? (
              <>
                <XCircle className="w-4 h-4 text-red-500" />
                <span className="font-medium text-red-700">Pipeline Failed</span>
              </>
            ) : (
              <span className="font-medium text-gray-700">Pipeline Status</span>
            )}
          </div>
          {currentRun?.totalDurationMs && (
            <div className="flex items-center gap-1 text-sm text-gray-500">
              <Clock className="w-3 h-3" />
              {formatDuration(currentRun.totalDurationMs)}
            </div>
          )}
        </div>

        {/* Pipeline Stages */}
        <div className="p-4">
          {/* Visual Flow */}
          <div className="flex items-center justify-between mb-6">
            {PIPELINE_STAGES.map((stage, index) => {
              const status = getStepStatus(stage.stepType, steps, isRunning);
              const stepData = getStepData(stage.stepType, steps);
              const prompt = prompts?.find((p) => p.id === stage.promptId);

              return (
                <div key={stage.id} className="flex items-center flex-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() =>
                          setExpandedStage(expandedStage === stage.id ? null : stage.id)
                        }
                        className={cn(
                          'relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300',
                          status === 'pending' && 'bg-gray-100',
                          status === 'running' && 'bg-blue-100 ring-4 ring-blue-200 animate-pulse',
                          status === 'completed' && 'bg-green-100',
                          status === 'failed' && 'bg-red-100',
                          status === 'skipped' && 'bg-gray-100 opacity-50',
                          expandedStage === stage.id && 'ring-2 ring-blue-400'
                        )}
                      >
                        {status === 'running' ? (
                          <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                        ) : status === 'completed' ? (
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                        ) : status === 'failed' ? (
                          <XCircle className="w-5 h-5 text-red-600" />
                        ) : (
                          <stage.icon
                            className={cn(
                              'w-5 h-5',
                              status === 'skipped' ? 'text-gray-400' : 'text-gray-500'
                            )}
                          />
                        )}
                        {status === 'completed' && stepData?.durationMs && (
                          <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-gray-500 whitespace-nowrap">
                            {formatDuration(stepData.durationMs)}
                          </span>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <div className="space-y-1">
                        <p className="font-medium">{stage.name}</p>
                        <p className="text-xs text-gray-400">{stage.description}</p>
                        {prompt && (
                          <div className="mt-2 pt-2 border-t border-gray-600">
                            <p className="text-xs text-gray-400 mb-1">Prompt: {stage.promptId}</p>
                            <p className="text-xs text-gray-300 line-clamp-3">
                              {prompt.system.substring(0, 150)}...
                            </p>
                          </div>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>

                  {/* Connector Line */}
                  {index < PIPELINE_STAGES.length - 1 && (
                    <div className="flex-1 mx-2 relative">
                      <div
                        className={cn(
                          'h-0.5 w-full transition-all duration-500',
                          status === 'completed' ? 'bg-green-400' : 'bg-gray-200'
                        )}
                      />
                      {status === 'running' && (
                        <div className="absolute inset-0 h-0.5 bg-gradient-to-r from-blue-400 to-transparent animate-pulse" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Stage Labels with Input/Output Counts */}
          <div className="flex items-center justify-between mb-4">
            {PIPELINE_STAGES.map((stage) => {
              const stepData = getStepData(stage.stepType, steps);
              return (
                <div key={`label-${stage.id}`} className="w-12 text-center">
                  <span className="text-[10px] text-gray-500 font-medium block">{stage.name}</span>
                  {stepData &&
                    (stepData.inputCount !== undefined || stepData.outputCount !== undefined) && (
                      <span className="text-[9px] text-gray-400 block">
                        {stepData.inputCount ?? '?'} → {stepData.outputCount ?? '?'}
                      </span>
                    )}
                </div>
              );
            })}
          </div>

          {/* Expand All Steps Toggle */}
          <div className="border-t pt-3 mt-2">
            <button
              onClick={() => {
                setShowAllSteps(!showAllSteps);
                setExpandedStage(null);
              }}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors w-full"
            >
              {showAllSteps ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
              <span className="font-medium">{showAllSteps ? 'Hide' : 'Show'} Step Details</span>
              {steps.length > 0 && (
                <span className="text-gray-400">({steps.length} steps executed)</span>
              )}
            </button>
          </div>

          {/* All Steps List View */}
          {showAllSteps && (
            <div className="mt-4 space-y-2">
              {PIPELINE_STAGES.map((stage, index) => {
                const stepData = getStepData(stage.stepType, steps);
                const status = getStepStatus(stage.stepType, steps, isRunning);
                const prompt = prompts?.find((p) => p.id === stage.promptId);

                return (
                  <div
                    key={stage.id}
                    className={cn(
                      'border rounded-lg overflow-hidden',
                      status === 'failed' && 'border-red-200',
                      status === 'skipped' && 'border-gray-200 bg-gray-50 opacity-60',
                      status === 'completed' && 'border-green-200',
                      status === 'running' && 'border-blue-200 bg-blue-50',
                      status === 'pending' && 'border-gray-200'
                    )}
                  >
                    <div
                      className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50"
                      onClick={() => setExpandedStage(expandedStage === stage.id ? null : stage.id)}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
                            status === 'completed' && 'bg-green-100 text-green-700',
                            status === 'failed' && 'bg-red-100 text-red-700',
                            status === 'running' && 'bg-blue-100 text-blue-700',
                            status === 'skipped' && 'bg-gray-100 text-gray-500',
                            status === 'pending' && 'bg-gray-100 text-gray-500'
                          )}
                        >
                          {index + 1}
                        </span>
                        <stage.icon
                          className={cn(
                            'w-4 h-4',
                            status === 'completed' && 'text-green-600',
                            status === 'failed' && 'text-red-600',
                            status === 'running' && 'text-blue-600',
                            (status === 'skipped' || status === 'pending') && 'text-gray-400'
                          )}
                        />
                        <span className="font-medium">{stage.name}</span>
                        <Badge
                          className={cn(
                            'text-xs',
                            status === 'completed' && 'bg-green-100 text-green-800',
                            status === 'failed' && 'bg-red-100 text-red-800',
                            status === 'running' && 'bg-blue-100 text-blue-800',
                            status === 'skipped' && 'bg-gray-100 text-gray-600',
                            status === 'pending' && 'bg-gray-100 text-gray-600'
                          )}
                        >
                          {status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        {stepData &&
                          (stepData.inputCount !== undefined ||
                            stepData.outputCount !== undefined) && (
                            <span className="flex items-center gap-1">
                              <span>{stepData.inputCount ?? '-'}</span>
                              <ArrowRight className="w-3 h-3" />
                              <span>{stepData.outputCount ?? '-'}</span>
                            </span>
                          )}
                        {stepData?.durationMs !== undefined && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(stepData.durationMs)}
                          </span>
                        )}
                        {expandedStage === stage.id ? (
                          <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                    </div>

                    {/* Expanded Details for this step */}
                    {expandedStage === stage.id && (
                      <div className="border-t p-3 bg-gray-50 space-y-3">
                        <p className="text-sm text-gray-600">{stage.description}</p>

                        {/* Skipped notice */}
                        {status === 'skipped' && (
                          <p className="text-sm text-gray-400 italic">
                            Step skipped — no input to process.
                          </p>
                        )}

                        {/* Input/Output Details (hide for skipped) */}
                        {status !== 'skipped' &&
                          stepData &&
                          (stepData.inputCount !== undefined ||
                            stepData.outputCount !== undefined) && (
                            <div className="flex gap-6 text-sm">
                              {stepData.inputCount !== undefined && (
                                <div>
                                  <span className="text-gray-500">Input:</span>
                                  <span className="ml-2 font-medium">
                                    {stepData.inputCount} items
                                  </span>
                                </div>
                              )}
                              {stepData.outputCount !== undefined && (
                                <div>
                                  <span className="text-gray-500">Output:</span>
                                  <span className="ml-2 font-medium">
                                    {stepData.outputCount} items
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                        {/* Error */}
                        {stepData?.error && (
                          <div className="bg-red-50 border border-red-200 rounded-md p-3">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                              <p className="text-sm text-red-700">{stepData.error}</p>
                            </div>
                          </div>
                        )}

                        {/* Step Output - Expandable (hide for skipped) */}
                        {status !== 'skipped' && stepData?.outputSummary && (
                          <div className="bg-blue-50 rounded-md border border-blue-200 overflow-hidden">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePromptExpanded(`output-${stage.id}`);
                              }}
                              className="w-full flex items-center justify-between p-3 hover:bg-blue-100 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <Database className="w-4 h-4 text-blue-500" />
                                <span className="text-xs font-medium text-blue-700">
                                  Step Output
                                </span>
                              </div>
                              {expandedPrompts.has(`output-${stage.id}`) ? (
                                <ChevronUp className="w-4 h-4 text-blue-400" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-blue-400" />
                              )}
                            </button>
                            {expandedPrompts.has(`output-${stage.id}`) && (
                              <div className="border-t border-blue-200 p-3 bg-white">
                                <pre className="text-gray-700 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap max-h-80 overflow-y-auto">
                                  {(() => {
                                    try {
                                      return JSON.stringify(
                                        JSON.parse(stepData.outputSummary),
                                        null,
                                        2
                                      );
                                    } catch {
                                      return stepData.outputSummary;
                                    }
                                  })()}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Prompt Used (hide for skipped) */}
                        {status !== 'skipped' && stepData?.promptUsed && (
                          <div className="text-sm">
                            <span className="text-gray-500">Prompt:</span>
                            <code className="ml-2 px-1.5 py-0.5 bg-gray-200 rounded text-xs">
                              {stepData.promptUsed}
                            </code>
                          </div>
                        )}

                        {/* Multi-entry Prompt/Query Log (new format) */}
                        {status !== 'skipped' &&
                          stepData?.promptEntries &&
                          stepData.promptEntries.length > 0 && (
                            <div className="bg-white rounded-md border overflow-hidden">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePromptExpanded(`prompt-${stage.id}`);
                                }}
                                className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <FileText className="w-4 h-4 text-gray-400" />
                                  <span className="text-xs font-medium text-gray-600">
                                    LLM & RAG Interactions
                                  </span>
                                  <Badge className="text-[10px] bg-gray-100 text-gray-600">
                                    {stepData.promptEntries.length}
                                  </Badge>
                                </div>
                                {expandedPrompts.has(`prompt-${stage.id}`) ? (
                                  <ChevronUp className="w-4 h-4 text-gray-400" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-gray-400" />
                                )}
                              </button>
                              {expandedPrompts.has(`prompt-${stage.id}`) && (
                                <div className="border-t divide-y">
                                  {stepData.promptEntries.map((entry, entryIdx) => {
                                    const entryKey = `${stage.id}-${entryIdx}`;
                                    const isEntryExpanded = expandedPrompts.has(
                                      `entry-${entryKey}`
                                    );
                                    const entryView = getPromptView(entryKey);

                                    return (
                                      <div key={entryKey} className="bg-gray-50">
                                        {/* Entry Header */}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            togglePromptExpanded(`entry-${entryKey}`);
                                          }}
                                          className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-100 transition-colors"
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-gray-400 font-mono w-5">
                                              [{entryIdx + 1}]
                                            </span>
                                            {entry.entryType === 'rag-query' ? (
                                              <Search className="w-3 h-3 text-cyan-500" />
                                            ) : (
                                              <Sparkles className="w-3 h-3 text-amber-500" />
                                            )}
                                            <span className="text-xs text-gray-700 truncate max-w-[300px]">
                                              {entry.label}
                                            </span>
                                            <Badge
                                              className={cn(
                                                'text-[9px]',
                                                entry.entryType === 'rag-query'
                                                  ? 'bg-cyan-50 text-cyan-700'
                                                  : 'bg-amber-50 text-amber-700'
                                              )}
                                            >
                                              {entry.entryType === 'rag-query' ? 'RAG' : 'LLM'}
                                            </Badge>
                                          </div>
                                          {isEntryExpanded ? (
                                            <ChevronUp className="w-3 h-3 text-gray-400" />
                                          ) : (
                                            <ChevronDown className="w-3 h-3 text-gray-400" />
                                          )}
                                        </button>

                                        {/* Entry Content */}
                                        {isEntryExpanded && (
                                          <div className="px-3 pb-3 space-y-2">
                                            {/* RAG Query Entry */}
                                            {entry.entryType === 'rag-query' && (
                                              <div className="space-y-2">
                                                <div className="text-xs">
                                                  <span className="text-gray-500 font-medium">
                                                    Query:
                                                  </span>
                                                  <pre className="text-gray-700 font-mono bg-white p-2 rounded mt-1 text-[11px] border whitespace-pre-wrap">
                                                    {entry.query || '(empty)'}
                                                  </pre>
                                                </div>
                                                <div className="text-xs">
                                                  <span className="text-gray-500 font-medium">
                                                    Results ({entry.resultCount ?? 0} docs):
                                                  </span>
                                                  {entry.results && entry.results.length > 0 ? (
                                                    <table className="w-full mt-1 text-[11px] border rounded overflow-hidden">
                                                      <thead>
                                                        <tr className="bg-gray-100 text-gray-600">
                                                          <th className="text-left px-2 py-1">
                                                            File
                                                          </th>
                                                          <th className="text-left px-2 py-1">
                                                            Title
                                                          </th>
                                                          <th className="text-right px-2 py-1">
                                                            Similarity
                                                          </th>
                                                        </tr>
                                                      </thead>
                                                      <tbody>
                                                        {entry.results.map((r, ri) => (
                                                          <tr
                                                            key={ri}
                                                            className="border-t bg-white"
                                                          >
                                                            <td className="px-2 py-1 font-mono text-gray-600 truncate max-w-[200px]">
                                                              {r.filePath}
                                                            </td>
                                                            <td className="px-2 py-1 text-gray-700 truncate max-w-[200px]">
                                                              {r.title}
                                                            </td>
                                                            <td className="px-2 py-1 text-right text-gray-600">
                                                              {r.similarity.toFixed(3)}
                                                            </td>
                                                          </tr>
                                                        ))}
                                                      </tbody>
                                                    </table>
                                                  ) : (
                                                    <p className="text-gray-400 italic mt-1">
                                                      No results
                                                    </p>
                                                  )}
                                                </div>
                                              </div>
                                            )}

                                            {/* LLM Call Entry */}
                                            {entry.entryType === 'llm-call' && (
                                              <div className="space-y-2">
                                                {/* View Toggle */}
                                                <div className="flex gap-1 p-1 bg-gray-100 rounded-md w-fit">
                                                  {(
                                                    ['template', 'resolved', 'response'] as const
                                                  ).map((view) => (
                                                    <button
                                                      key={view}
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        setPromptView(entryKey, view);
                                                      }}
                                                      className={cn(
                                                        'px-3 py-1 text-xs font-medium rounded transition-colors capitalize',
                                                        entryView === view
                                                          ? 'bg-white text-gray-900 shadow-sm'
                                                          : 'text-gray-500 hover:text-gray-700'
                                                      )}
                                                      disabled={
                                                        (view === 'resolved' && !entry.resolved) ||
                                                        (view === 'response' && !entry.response)
                                                      }
                                                    >
                                                      {view}
                                                    </button>
                                                  ))}
                                                </div>

                                                {/* Template */}
                                                {entryView === 'template' && entry.template && (
                                                  <div className="space-y-2">
                                                    <div className="text-xs">
                                                      <span className="text-gray-500 font-medium">
                                                        System Template:
                                                      </span>
                                                      <pre className="text-gray-700 font-mono bg-white p-3 rounded mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] max-h-64 overflow-y-auto border">
                                                        {entry.template.system || '(not available)'}
                                                      </pre>
                                                    </div>
                                                    <div className="text-xs">
                                                      <span className="text-gray-500 font-medium">
                                                        User Template:
                                                      </span>
                                                      <pre className="text-gray-700 font-mono bg-white p-3 rounded mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] max-h-64 overflow-y-auto border">
                                                        {entry.template.user || '(not available)'}
                                                      </pre>
                                                    </div>
                                                  </div>
                                                )}

                                                {/* Resolved */}
                                                {entryView === 'resolved' && entry.resolved && (
                                                  <div className="space-y-2">
                                                    <div className="text-xs">
                                                      <span className="text-gray-500 font-medium">
                                                        System Prompt (Resolved):
                                                      </span>
                                                      <pre className="text-gray-700 font-mono bg-white p-3 rounded mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] max-h-64 overflow-y-auto border">
                                                        {entry.resolved.system || '(empty)'}
                                                      </pre>
                                                    </div>
                                                    <div className="text-xs">
                                                      <span className="text-gray-500 font-medium">
                                                        User Prompt (Resolved):
                                                      </span>
                                                      <pre className="text-gray-700 font-mono bg-white p-3 rounded mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] max-h-64 overflow-y-auto border">
                                                        {entry.resolved.user || '(empty)'}
                                                      </pre>
                                                    </div>
                                                  </div>
                                                )}

                                                {/* Response */}
                                                {entryView === 'response' && entry.response && (
                                                  <div className="text-xs">
                                                    <span className="text-gray-500 font-medium">
                                                      LLM Response:
                                                    </span>
                                                    <pre className="text-gray-700 font-mono bg-white p-3 rounded mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] max-h-80 overflow-y-auto border">
                                                      {(() => {
                                                        try {
                                                          return JSON.stringify(
                                                            JSON.parse(entry.response),
                                                            null,
                                                            2
                                                          );
                                                        } catch {
                                                          return entry.response;
                                                        }
                                                      })()}
                                                    </pre>
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                        {/* Legacy single-entry LLM Prompt/Response (backward compat for old runs) */}
                        {status !== 'skipped' &&
                          !stepData?.promptEntries &&
                          (prompt ||
                            stepData?.promptTemplate ||
                            stepData?.promptResolved ||
                            stepData?.llmResponse) && (
                            <div className="bg-white rounded-md border overflow-hidden">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePromptExpanded(`prompt-${stage.id}`);
                                }}
                                className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <FileText className="w-4 h-4 text-gray-400" />
                                  <span className="text-xs font-medium text-gray-600">
                                    LLM Prompt & Response
                                  </span>
                                  {stepData?.promptId && (
                                    <code className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] text-gray-500">
                                      {stepData.promptId}
                                    </code>
                                  )}
                                </div>
                                {expandedPrompts.has(`prompt-${stage.id}`) ? (
                                  <ChevronUp className="w-4 h-4 text-gray-400" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-gray-400" />
                                )}
                              </button>
                              {expandedPrompts.has(`prompt-${stage.id}`) && (
                                <div className="border-t p-3 bg-gray-50 space-y-3">
                                  <div className="flex gap-1 p-1 bg-gray-100 rounded-md w-fit">
                                    {(['template', 'resolved', 'response'] as const).map((view) => (
                                      <button
                                        key={view}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPromptView(stage.id, view);
                                        }}
                                        className={cn(
                                          'px-3 py-1 text-xs font-medium rounded transition-colors capitalize',
                                          getPromptView(stage.id) === view
                                            ? 'bg-white text-gray-900 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                        )}
                                        disabled={
                                          (view === 'resolved' && !stepData?.promptResolved) ||
                                          (view === 'response' && !stepData?.llmResponse)
                                        }
                                      >
                                        {view}
                                      </button>
                                    ))}
                                  </div>

                                  {getPromptView(stage.id) === 'template' && (
                                    <div className="space-y-3">
                                      {(stepData?.promptTemplate || prompt) && (
                                        <>
                                          <div className="text-xs">
                                            <span className="text-gray-500 font-medium">
                                              System Template:
                                            </span>
                                            <pre className="text-gray-700 font-mono bg-white p-3 rounded mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] max-h-64 overflow-y-auto border">
                                              {stepData?.promptTemplate?.system ||
                                                prompt?.system ||
                                                '(not available)'}
                                            </pre>
                                          </div>
                                          <div className="text-xs">
                                            <span className="text-gray-500 font-medium">
                                              User Template:
                                            </span>
                                            <pre className="text-gray-700 font-mono bg-white p-3 rounded mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] max-h-64 overflow-y-auto border">
                                              {stepData?.promptTemplate?.user ||
                                                prompt?.user ||
                                                '(not available)'}
                                            </pre>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}

                                  {getPromptView(stage.id) === 'resolved' &&
                                    stepData?.promptResolved && (
                                      <div className="space-y-3">
                                        <div className="text-xs">
                                          <span className="text-gray-500 font-medium">
                                            System Prompt (Resolved):
                                          </span>
                                          <pre className="text-gray-700 font-mono bg-white p-3 rounded mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] max-h-64 overflow-y-auto border">
                                            {stepData.promptResolved.system || '(empty)'}
                                          </pre>
                                        </div>
                                        <div className="text-xs">
                                          <span className="text-gray-500 font-medium">
                                            User Prompt (Resolved):
                                          </span>
                                          <pre className="text-gray-700 font-mono bg-white p-3 rounded mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] max-h-64 overflow-y-auto border">
                                            {stepData.promptResolved.user || '(empty)'}
                                          </pre>
                                        </div>
                                      </div>
                                    )}

                                  {getPromptView(stage.id) === 'response' &&
                                    stepData?.llmResponse && (
                                      <div className="text-xs">
                                        <span className="text-gray-500 font-medium">
                                          LLM Response:
                                        </span>
                                        <pre className="text-gray-700 font-mono bg-white p-3 rounded mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] max-h-80 overflow-y-auto border">
                                          {(() => {
                                            try {
                                              return JSON.stringify(
                                                JSON.parse(stepData.llmResponse),
                                                null,
                                                2
                                              );
                                            } catch {
                                              return stepData.llmResponse;
                                            }
                                          })()}
                                        </pre>
                                      </div>
                                    )}

                                  {getPromptView(stage.id) === 'resolved' &&
                                    !stepData?.promptResolved && (
                                      <p className="text-xs text-gray-500 italic">
                                        Resolved prompt not available. Run the pipeline to capture
                                        this data.
                                      </p>
                                    )}
                                  {getPromptView(stage.id) === 'response' &&
                                    !stepData?.llmResponse && (
                                      <p className="text-xs text-gray-500 italic">
                                        LLM response not available. Run the pipeline to capture this
                                        data.
                                      </p>
                                    )}
                                </div>
                              )}
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
