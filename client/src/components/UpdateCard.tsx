import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Check,
  X,
  Edit,
  MessageSquare,
  Eye,
  Code,
  ExternalLink,
  FileText,
  FileCode,
} from 'lucide-react';
import { ReviewContextPanel, type ProposalEnrichment } from './ReviewContextPanel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useState, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Check if content contains MDX/Docusaurus-specific components
 * that ReactMarkdown cannot render (excluding admonitions which we handle)
 */
function containsMdxComponents(content: string): boolean {
  if (!content) return false;

  // Check for MDX imports first (definitive MDX indicator)
  const importPattern = /^import\s+/m;
  if (importPattern.test(content)) return true;

  // Check for JSX components like <Tabs>, <TabItem>, <CodeBlock />, etc.
  // Must be PascalCase (not ALL_CAPS which are CLI placeholders like <COLUMN>)
  // PascalCase: starts with uppercase, contains at least one lowercase letter
  const jsxMatches = content.match(/<\/?([A-Z][A-Za-z0-9]*)[\s/>]/g);
  if (jsxMatches) {
    for (const match of jsxMatches) {
      // Extract the tag name
      const tagName = match.replace(/^<\/?/, '').replace(/[\s/>]$/, '');
      // Check if it's PascalCase (has lowercase letters) vs ALL_CAPS placeholder
      if (/[a-z]/.test(tagName)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Convert Docusaurus admonitions (:::tip, :::warning, etc.) to styled blockquotes
 * for preview rendering
 */
function convertAdmonitionsToBlockquotes(content: string): string {
  if (!content) return content;

  const typeEmoji: Record<string, string> = {
    tip: '💡',
    note: '📝',
    info: 'ℹ️',
    warning: '⚠️',
    caution: '⚠️',
    danger: '🚨',
    important: '❗',
  };

  let result = content;

  // Pattern 1: Multiline admonitions - :::type\ncontent\n:::
  const multilineRegex =
    /^:::(tip|note|info|warning|caution|danger|important)(\[.*?\])?\s*\n([\s\S]*?)^:::\s*$/gm;
  result = result.replace(multilineRegex, (_match, type, title, innerContent) => {
    const emoji = typeEmoji[type] || '📌';
    const label = title ? title.slice(1, -1) : type.charAt(0).toUpperCase() + type.slice(1);
    const lines = innerContent.trim().split('\n');
    const quotedLines = lines.map((line: string) => `> ${line}`).join('\n');
    return `> ${emoji} **${label}**\n>\n${quotedLines}\n`;
  });

  // Pattern 2: Inline/single-line admonitions - :::type content ::: (all on one line or closing on same line)
  const inlineRegex =
    /:::(tip|note|info|warning|caution|danger|important)\s+([^:]+(?:(?!:::)[^:])*)\s*:::/gi;
  result = result.replace(inlineRegex, (_match, type, innerContent) => {
    const emoji = typeEmoji[type.toLowerCase()] || '📌';
    const label = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
    // Wrap long content properly
    const trimmedContent = innerContent.trim();
    return `\n> ${emoji} **${label}**\n>\n> ${trimmedContent}\n`;
  });

  // Pattern 3: Admonition with title on same line as type - :::type Title\ncontent\n:::
  const titledRegex =
    /^:::(tip|note|info|warning|caution|danger|important)\s+([^\n]+)\n([\s\S]*?)^:::\s*$/gm;
  result = result.replace(titledRegex, (_match, type, titleLine, innerContent) => {
    const emoji = typeEmoji[type] || '📌';
    // First line after :::type is treated as title if it doesn't look like content
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    const fullContent = titleLine.trim() + '\n' + innerContent.trim();
    const lines = fullContent.split('\n');
    const quotedLines = lines.map((line: string) => `> ${line}`).join('\n');
    return `> ${emoji} **${label}**\n>\n${quotedLines}\n`;
  });

  return result;
}

/**
 * Render content as either Markdown or as a code block for MDX content
 */
function ContentRenderer({ content, className }: { content: string; className?: string }) {
  const isMdx = useMemo(() => containsMdxComponents(content), [content]);

  // Convert admonitions to blockquotes for preview
  const processedContent = useMemo(() => convertAdmonitionsToBlockquotes(content), [content]);

  // Check if content has admonitions (for showing the info badge)
  const hasAdmonitions = useMemo(() => /^:::\w+/m.test(content), [content]);

  if (!content) {
    return <span className="text-gray-400 italic">(No content)</span>;
  }

  if (isMdx) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded mb-2 border border-amber-200">
          <FileCode className="h-3 w-3" />
          Contains MDX/Docusaurus components - shown as source
        </div>
        <pre className="bg-gray-900 text-gray-100 p-3 rounded-md text-xs overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
          {content}
        </pre>
      </div>
    );
  }

  return (
    <div className={className}>
      {hasAdmonitions && (
        <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded mb-2 border border-blue-200">
          <FileCode className="h-3 w-3" />
          Admonitions shown as blockquotes in preview
        </div>
      )}
      <div className="prose prose-sm max-w-none text-gray-900">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{processedContent}</ReactMarkdown>
      </div>
    </div>
  );
}

/**
 * Feedback data for ruleset improvement
 */
export interface ProposalFeedback {
  proposalId: string;
  action: 'approved' | 'rejected' | 'ignored';
  feedbackText: string;
  useForImprovement: boolean;
}

interface UpdateCardProps {
  id: string;
  type: 'minor' | 'major' | 'add' | 'delete';
  section: string;
  summary: string;
  source: string;
  timestamp: string;
  status: 'pending' | 'approved' | 'rejected' | 'auto-applied';
  diff?: {
    before: string;
    after: string;
  };
  gitUrl?: string;
  enrichment?: ProposalEnrichment | null;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onEdit?: (id: string, data: { summary?: string; diffAfter?: string }) => void;
  onViewContext?: () => void;
  onFeedback?: (feedback: ProposalFeedback) => void;
}

export function UpdateCard({
  id,
  type,
  section,
  summary,
  source,
  timestamp,
  status,
  diff,
  gitUrl,
  enrichment,
  onApprove,
  onReject,
  onEdit,
  onViewContext,
  onFeedback,
}: UpdateCardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [editedContent, setEditedContent] = useState(diff?.after || '');
  const [filePreviewOpen, setFilePreviewOpen] = useState(false);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Feedback dialog state
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [useForImprovement, setUseForImprovement] = useState(true);
  const [pendingAction, setPendingAction] = useState<'approved' | 'rejected' | 'ignored' | null>(
    null
  );

  // Build the GitHub URL for the file
  const buildGitHubUrl = (filePath: string): string => {
    if (!gitUrl) return '';
    const cleanBaseUrl = gitUrl.replace(/\.git$/, '');
    return `${cleanBaseUrl}/blob/main/${filePath}`;
  };

  // Fetch file content when preview is opened
  useEffect(() => {
    if (filePreviewOpen && !fileContent && !fileLoading) {
      setFileLoading(true);
      setFileError(null);

      // The section is the file path - fetch from API
      fetch(`/api/docs/${encodeURIComponent(section)}`)
        .then(async (res) => {
          if (!res.ok) {
            throw new Error('File not found');
          }
          const data = await res.json();
          setFileContent(data.content || data.currentContent || '');
        })
        .catch((err) => {
          setFileError(err.message || 'Failed to load file');
        })
        .finally(() => {
          setFileLoading(false);
        });
    }
  }, [filePreviewOpen, fileContent, fileLoading, section]);

  const handleOpenFilePreview = () => {
    setFilePreviewOpen(true);
  };

  const handleOpenInNewTab = () => {
    const url = buildGitHubUrl(section);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Handle approve with optional feedback
  const handleApproveClick = () => {
    if (onFeedback) {
      setPendingAction('approved');
      setFeedbackOpen(true);
    } else {
      onApprove?.(id);
    }
  };

  // Handle reject/ignore with optional feedback, or reset to pending directly
  const handleRejectClick = () => {
    // Reset to pending (from approved or ignored tabs) — no feedback needed
    if (status === 'approved' || status === 'rejected') {
      onReject?.(id);
      return;
    }

    // Ignore (from pending tab) — show feedback dialog if available
    if (onFeedback) {
      setPendingAction('ignored');
      setFeedbackOpen(true);
    } else {
      onReject?.(id);
    }
  };

  // Submit feedback (if provided) and complete the action
  const handleFeedbackSubmit = () => {
    if (pendingAction && onFeedback && feedbackText.trim()) {
      onFeedback({
        proposalId: id,
        action: pendingAction,
        feedbackText: feedbackText.trim(),
        useForImprovement,
      });
    }

    // Complete the original action
    if (pendingAction === 'approved') {
      onApprove?.(id);
    } else if (pendingAction === 'rejected' || pendingAction === 'ignored') {
      onReject?.(id);
    }

    // Reset state
    setFeedbackOpen(false);
    setFeedbackText('');
    setUseForImprovement(true);
    setPendingAction(null);
  };

  return (
    <Card className="bg-white border-gray-200">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-xs font-mono px-2 py-1 rounded border ${
              type === 'add'
                ? 'bg-blue-50 text-blue-800 border-blue-200'
                : type === 'delete'
                  ? 'bg-red-50 text-red-800 border-red-200'
                  : 'bg-green-50 text-green-800 border-green-200'
            }`}
            data-testid="badge-type"
          >
            {type === 'add'
              ? 'NEW SECTION'
              : type === 'delete'
                ? 'SECTION DELETION'
                : 'SECTION UPDATE'}
          </span>
          <button
            onClick={handleOpenFilePreview}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer flex items-center gap-1"
            data-testid="text-section"
            title="Click to preview file content"
          >
            <FileText className="h-4 w-4" />
            {section}
          </button>
          {gitUrl && type !== 'add' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleOpenInNewTab}
              className="h-6 w-6 p-0 text-gray-500 hover:text-blue-600"
              title="Open in GitHub"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
        </div>
        {(onApprove || onReject || onEdit) && (
          <div className="flex gap-2">
            {onEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditOpen(true)}
                data-testid={`button-edit-${id}`}
                className="text-gray-700 hover:bg-gray-100"
              >
                <Edit className="mr-1 h-4 w-4" />
                Edit
              </Button>
            )}
            {onApprove && (
              <Button
                size="sm"
                variant="default"
                onClick={handleApproveClick}
                data-testid={`button-approve-${id}`}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <Check className="mr-1 h-4 w-4" />
                Approve
              </Button>
            )}
            {onReject && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRejectClick}
                data-testid={`button-reject-${id}`}
                className="border-gray-500 text-gray-900 hover:bg-gray-100 hover:border-gray-600"
              >
                <X className="mr-1 h-4 w-4" />
                {status === 'approved' || status === 'rejected' ? 'Reset to Pending' : 'Ignore'}
              </Button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Show proposal text first if available */}
        {diff && (
          <div className="bg-gray-50 p-3 rounded border border-gray-200">
            <div className="mb-1 text-xs font-semibold text-gray-700">Proposed Change:</div>
            <ContentRenderer content={diff.after || ''} />
          </div>
        )}

        {/* Then show the reason/summary */}
        <div>
          <div className="mb-1 text-xs font-semibold text-gray-700">Reason:</div>
          <p className="text-sm text-gray-900" data-testid="text-summary">
            {summary}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-500">
            <span data-testid="text-source">Source: {source}</span>
            <span data-testid="text-timestamp">{timestamp}</span>
          </div>
        </div>

        {/* Review Context Panel with enrichment data */}
        {enrichment && <ReviewContextPanel enrichment={enrichment} className="mt-3" />}

        {onViewContext && (
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={onViewContext}
              data-testid={`button-view-context-${id}`}
              className="text-xs border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              <MessageSquare className="mr-1 h-3 w-3" />
              View Conversation Context
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto bg-white [&>button]:text-gray-900 [&>button]:hover:bg-gray-100">
          <DialogHeader>
            <DialogTitle className="text-gray-900">Edit Change Proposal</DialogTitle>
            <DialogDescription className="text-gray-600">
              Modify the AI-generated content before approving.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {diff && (
              <div className="space-y-2">
                <Label className="text-gray-900">
                  {type === 'delete' ? 'Content to be deleted' : 'Proposed Content (Markdown)'}
                </Label>
                <Tabs defaultValue="edit" className="w-full">
                  <TabsList className="bg-gray-100">
                    <TabsTrigger
                      value="edit"
                      className="text-gray-700 data-[state=active]:bg-white"
                    >
                      <Code className="w-4 h-4 mr-1" />
                      Edit
                    </TabsTrigger>
                    <TabsTrigger
                      value="preview"
                      className="text-gray-700 data-[state=active]:bg-white"
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      Preview
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="edit" className="mt-2">
                    <Textarea
                      id="edit-content"
                      value={editedContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                      rows={16}
                      className="font-mono text-sm border-gray-300 text-gray-900 bg-white"
                      data-testid="textarea-edit-content"
                      disabled={type === 'delete'}
                      placeholder="Enter markdown content..."
                    />
                  </TabsContent>
                  <TabsContent value="preview" className="mt-2">
                    <div className="min-h-[400px] p-4 border border-gray-300 rounded-md bg-white">
                      <ContentRenderer content={editedContent || ''} />
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditOpen(false);
                setEditedContent(diff?.after || '');
              }}
              data-testid="button-cancel-edit"
              className="border-gray-300 text-gray-700"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                onEdit?.(id, {
                  diffAfter: editedContent,
                });
                setEditOpen(false);
              }}
              data-testid="button-save-edit"
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File Preview Dialog */}
      <Dialog open={filePreviewOpen} onOpenChange={setFilePreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden bg-white [&>button]:text-gray-900 [&>button]:hover:bg-gray-100">
          <DialogHeader>
            <DialogTitle className="text-gray-900 flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {section}
            </DialogTitle>
            <DialogDescription className="text-gray-600 flex items-center gap-2">
              {type === 'add' ? 'New file (will be created)' : 'Current file content'}
              {gitUrl && type !== 'add' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleOpenInNewTab}
                  className="h-6 text-xs border-gray-300 text-gray-600 hover:text-blue-600"
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Open in GitHub
                </Button>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[60vh] border border-gray-200 rounded-md p-4 bg-gray-50">
            {fileLoading && (
              <div className="flex items-center justify-center py-8 text-gray-500">
                Loading file content...
              </div>
            )}
            {fileError && (
              <div className="flex items-center justify-center py-8 text-red-500">
                Error: {fileError}
              </div>
            )}
            {!fileLoading && !fileError && fileContent && <ContentRenderer content={fileContent} />}
            {!fileLoading && !fileError && !fileContent && (
              <div className="flex items-center justify-center py-8 text-gray-500">
                No content available
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFilePreviewOpen(false)}
              className="border-gray-300 text-gray-700"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Feedback Dialog */}
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent className="max-w-md bg-white [&>button]:text-gray-900 [&>button]:hover:bg-gray-100">
          <DialogHeader>
            <DialogTitle className="text-gray-900">
              {pendingAction === 'approved' ? 'Approve Proposal' : 'Ignore Proposal'}
            </DialogTitle>
            <DialogDescription className="text-gray-600">
              Optionally provide feedback to help improve future proposals.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="feedback" className="text-gray-900">
                Feedback (optional)
              </Label>
              <Textarea
                id="feedback"
                placeholder={
                  pendingAction === 'approved'
                    ? 'What made this proposal good? Any suggestions for similar proposals?'
                    : 'Why was this proposal ignored? What would make it better?'
                }
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                rows={4}
                className="border-gray-300 text-gray-900 bg-white"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="useForImprovement"
                checked={useForImprovement}
                onCheckedChange={(checked) => setUseForImprovement(checked === true)}
              />
              <Label htmlFor="useForImprovement" className="text-sm text-gray-700 cursor-pointer">
                Use this feedback to improve the ruleset
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleFeedbackSubmit}
              className={
                pendingAction === 'approved'
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-red-600 hover:bg-red-700 text-white'
              }
            >
              {pendingAction === 'approved' ? 'Approve' : 'Ignore'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
