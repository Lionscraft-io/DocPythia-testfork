/**
 * PRPreviewModal
 * Modal for previewing and configuring PR generation from approved changesets
 *

 * @created 2025-11-06
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import {
  AlertCircle,
  FileText,
  GitPullRequest,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { useConfig } from '@/hooks/useConfig';

interface PRPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  approvedProposals: any[];
  onSubmit: (prData: PRSubmitData) => Promise<void>;
}

export interface PRSubmitData {
  targetRepo: string;
  sourceRepo: string;
  baseBranch: string;
  prTitle: string;
  prBody: string;
  submittedBy: string;
}

export function PRPreviewModal({
  isOpen,
  onClose,
  approvedProposals,
  onSubmit,
}: PRPreviewModalProps) {
  const { data: config, isLoading: configLoading } = useConfig();
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [isFilesExpanded, setIsFilesExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    pr?: { url: string; number: number };
    appliedCount?: number;
    failedCount?: number;
    error?: string;
  } | null>(null);

  // Get repository configuration from backend (all read-only)
  const targetRepo = config?.repository?.targetRepo || '';
  const sourceRepo = config?.repository?.sourceRepo || ''; // Same as targetRepo, kept for API compatibility
  const baseBranch = config?.repository?.baseBranch || 'main';

  // Group proposals by file
  const proposalsByFile = approvedProposals.reduce(
    (acc, proposal) => {
      const file = proposal.page;
      if (!acc[file]) {
        acc[file] = [];
      }
      acc[file].push(proposal);
      return acc;
    },
    {} as Record<string, any[]>
  );

  const affectedFiles = Object.keys(proposalsByFile);
  const totalProposals = approvedProposals.length;

  const handleSubmit = async () => {
    if (!prTitle.trim()) {
      alert('Please enter a PR title');
      return;
    }

    if (!targetRepo) {
      alert('Repository configuration is missing. Please check your settings.');
      return;
    }

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      await onSubmit({
        targetRepo,
        sourceRepo,
        baseBranch,
        prTitle: prTitle.trim(),
        prBody: prBody.trim(),
        submittedBy: 'system',
      });

      setSubmitResult({
        success: true,
        appliedCount: totalProposals,
        failedCount: 0,
      });
    } catch (error) {
      setSubmitResult({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate PR',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setPrTitle('');
      setPrBody('');
      setSubmitResult(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-white text-gray-900">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-gray-900">
            <GitPullRequest className="w-5 h-5" />
            Generate Pull Request
          </DialogTitle>
          <DialogDescription className="text-gray-600">
            Review and configure your pull request for {totalProposals} approved proposals across{' '}
            {affectedFiles.length} files.
          </DialogDescription>
        </DialogHeader>

        {submitResult ? (
          <div className="space-y-4">
            {submitResult.success ? (
              <Alert className="border-green-500 bg-green-50">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-900">
                  <div className="space-y-2">
                    <p className="font-semibold">Pull request created successfully!</p>
                    {submitResult.pr && (
                      <p>
                        PR #{submitResult.pr.number}:{' '}
                        <a
                          href={submitResult.pr.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline"
                        >
                          {submitResult.pr.url}
                        </a>
                      </p>
                    )}
                    <p className="text-sm">
                      Applied {submitResult.appliedCount} proposals successfully
                      {submitResult.failedCount! > 0 && ` (${submitResult.failedCount} failed)`}
                    </p>
                  </div>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="border-red-500 bg-red-50">
                <XCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-900">
                  <div className="space-y-2">
                    <p className="font-semibold">Failed to generate pull request</p>
                    <p className="text-sm">{submitResult.error}</p>
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary Section */}
            <div className="p-4 border border-gray-200 rounded-lg space-y-2 bg-gray-50">
              <h3 className="font-semibold text-gray-900">Changeset Summary</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Total Proposals:</span>
                  <span className="ml-2 font-semibold text-gray-900">{totalProposals}</span>
                </div>
                <div>
                  <span className="text-gray-600">Affected Files:</span>
                  <span className="ml-2 font-semibold text-gray-900">{affectedFiles.length}</span>
                </div>
              </div>
            </div>

            {/* Affected Files Preview - Collapsible */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setIsFilesExpanded(!isFilesExpanded)}
                className="flex items-center justify-between w-full p-3 border border-gray-200 rounded-md bg-white hover:bg-gray-50 transition-colors text-gray-900"
              >
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-medium cursor-pointer text-gray-900">
                    Affected Files
                  </Label>
                  <span className="text-sm text-gray-600">({affectedFiles.length} files)</span>
                </div>
                {isFilesExpanded ? (
                  <ChevronUp className="w-4 h-4 text-gray-600" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-600" />
                )}
              </button>
              {isFilesExpanded && (
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-md p-3 bg-white">
                  <ul className="space-y-1 text-sm">
                    {affectedFiles.map((file, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <FileText className="w-3 h-3 text-gray-500" />
                        <span className="font-mono text-xs text-gray-900">{file}</span>
                        <span className="text-gray-600">
                          ({proposalsByFile[file].length} changes)
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Repository Configuration */}
            <div className="space-y-4 border-t border-gray-200 pt-4">
              <h3 className="font-semibold text-gray-900">Repository Configuration</h3>

              {!configLoading && !targetRepo && (
                <Alert className="bg-yellow-50 border-yellow-200">
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                  <AlertDescription className="text-gray-900">
                    Repository configuration not found. Please ensure{' '}
                    <code className="px-1 py-0.5 bg-gray-200 rounded text-xs">
                      documentation.gitUrl
                    </code>{' '}
                    is configured in your instance settings.
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="targetRepo" className="text-gray-900">
                  Repository
                </Label>
                <Input
                  id="targetRepo"
                  value={targetRepo || (configLoading ? 'Loading...' : 'Not configured')}
                  disabled
                  className="bg-gray-100 text-gray-700 border-gray-300"
                />
                <p className="text-xs text-gray-600">The repository where the PR will be created</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="baseBranch" className="text-gray-900">
                  Base Branch
                </Label>
                <Input
                  id="baseBranch"
                  value={baseBranch || 'main'}
                  disabled
                  className="bg-gray-100 text-gray-700 border-gray-300"
                />
                <p className="text-xs text-gray-600">Target branch for the PR</p>
              </div>
            </div>

            {/* PR Details */}
            <div className="space-y-4 border-t border-gray-200 pt-4">
              <h3 className="font-semibold text-gray-900">Pull Request Details</h3>

              <div className="space-y-2">
                <Label htmlFor="prTitle" className="text-gray-900">
                  PR Title *
                </Label>
                <Input
                  id="prTitle"
                  placeholder="e.g., docs: Update documentation based on community feedback"
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  required
                  className="bg-white text-gray-900 border-gray-300"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="prBody" className="text-gray-900">
                  PR Description *
                </Label>
                <Textarea
                  id="prBody"
                  placeholder="Describe the changes in this pull request..."
                  value={prBody}
                  onChange={(e) => setPrBody(e.target.value)}
                  rows={6}
                  required
                  className="bg-white text-gray-900 border-gray-300"
                />
                <p className="text-xs text-gray-600">
                  Statistics will be automatically appended to the description
                </p>
              </div>
            </div>

            {/* Warning */}
            <Alert className="bg-blue-50 border-blue-200">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-gray-900">
                The PR will be created as a <strong>draft</strong>. Review it on GitHub before
                publishing.
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter className="bg-white border-t border-gray-200">
          {submitResult ? (
            <Button onClick={handleClose} className="text-gray-900">
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={isSubmitting}
                className="text-gray-900 border-gray-300"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !prTitle.trim() || !targetRepo}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating PR...
                  </>
                ) : (
                  <>
                    <GitPullRequest className="w-4 h-4 mr-2" />
                    Create Draft PR
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
