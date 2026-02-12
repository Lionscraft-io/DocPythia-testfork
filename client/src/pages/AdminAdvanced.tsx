import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StatsCard } from '@/components/StatsCard';
import { ProposalActionButtons } from '@/components/ProposalActionButtons';
import { EditProposalModal } from '@/components/EditProposalModal';
import { PRPreviewModal, type PRSubmitData } from '@/components/PRPreviewModal';
import {
  FileText,
  CheckCircle2,
  Database,
  Trash2,
  Search,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, adminApiRequest, getQueryFn } from '@/lib/queryClient';
import type { PendingUpdate, DocumentationSection, SectionVersion } from '@shared/schema';

// Get instance prefix from URL (e.g., /myinstance/admin -> /myinstance)
function getInstancePrefix(): string {
  const pathParts = window.location.pathname.split('/');
  // If path is like /myinstance/admin/advanced, return /myinstance
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

export default function AdminAdvanced() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedSection] = useState<string>('');
  const [, setAuthDisabled] = useState(false);
  const [proposalsPage, setProposalsPage] = useState(1);
  const [changesetPage, setChangesetPage] = useState(1);
  const [discardedPage, setDiscardedPage] = useState(1);
  const [unprocessedPage, setUnprocessedPage] = useState(1);
  const [cachePurposeFilter, setCachePurposeFilter] = useState<
    'all' | 'index' | 'embeddings' | 'analysis' | 'changegeneration' | 'review' | 'general'
  >('all');
  const [cacheSearchText, setCacheSearchText] = useState('');

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingProposal, setEditingProposal] = useState<any>(null);
  const [prModalOpen, setPrModalOpen] = useState(false);

  // Expansion state for conversations
  const [expandedRagDocs, setExpandedRagDocs] = useState<Set<string>>(new Set());
  const [expandedProposalText, setExpandedProposalText] = useState<Set<number>>(new Set());
  const [expandedProposalReasoning, setExpandedProposalReasoning] = useState<Set<number>>(
    new Set()
  );
  const [expandedConversationDetails, setExpandedConversationDetails] = useState<Set<string>>(
    new Set()
  );

  // File preview state
  const [filePreviewOpen, setFilePreviewOpen] = useState(false);
  const [previewFilePath, setPreviewFilePath] = useState<string>('');
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Check if auth is disabled on mount
  useEffect(() => {
    fetch('/api/updates')
      .then((res) => {
        if (res.ok) {
          // If we can access without auth, it's disabled
          setAuthDisabled(true);
        } else if (res.status === 401 || res.status === 403) {
          // Auth is required
          const token = sessionStorage.getItem('admin_token');
          if (!token) {
            setLocation('/admin/login');
          }
        }
      })
      .catch(() => {
        // On error, check for token
        const token = sessionStorage.getItem('admin_token');
        if (!token) {
          setLocation('/admin/login');
        }
      });
  }, [setLocation]);

  const { isLoading, error } = useQuery<PendingUpdate[]>({
    queryKey: ['/api/updates'],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
  });

  useQuery<DocumentationSection[]>({
    queryKey: ['/api/docs'],
  });

  useQuery<SectionVersion[]>({
    queryKey: [`/api/sections/${selectedSection}/history`],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
    enabled: !!selectedSection,
  });

  // Fetch git stats for documentation URL
  const { data: gitStats } = useQuery<{ gitUrl: string }>({
    queryKey: ['/api/docs/git-stats'],
  });

  // Build the GitHub URL for a file
  const buildGitHubUrl = (filePath: string): string => {
    if (!gitStats?.gitUrl) return '';
    const cleanBaseUrl = gitStats.gitUrl.replace(/\.git$/, '');
    return `${cleanBaseUrl}/blob/main/${filePath}`;
  };

  // Handle file preview
  const handleOpenFilePreview = (filePath: string) => {
    setPreviewFilePath(filePath);
    setFilePreviewOpen(true);
    setFileContent(null);
    setFileError(null);
    setFileLoading(true);

    fetch(`/api/docs/${encodeURIComponent(filePath)}`)
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
  };

  const handleOpenInNewTab = (filePath: string) => {
    const url = buildGitHubUrl(filePath);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  // Suggested Changes: conversations with pending proposals
  const suggestedChangesUrl = `/api/admin/stream/conversations?page=${proposalsPage}&limit=10&category=all&status=pending&hideEmptyProposals=false`;
  const { data: suggestedChanges } = useQuery<any>({
    queryKey: [suggestedChangesUrl],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  // Changeset: conversations with approved proposals
  const changesetUrl = `/api/admin/stream/conversations?page=${changesetPage}&limit=10&category=all&status=changeset&hideEmptyProposals=false`;
  const { data: changeset } = useQuery<any>({
    queryKey: [changesetUrl],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  // Discarded: conversations with all ignored proposals
  const discardedConvsUrl = `/api/admin/stream/conversations?page=${discardedPage}&limit=10&category=all&status=discarded&hideEmptyProposals=false`;
  const { data: discardedConvs } = useQuery<any>({
    queryKey: [discardedConvsUrl],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  const unprocessedMessagesUrl = `/api/admin/stream/messages?page=${unprocessedPage}&limit=20&processingStatus=PENDING`;
  const { data: unprocessedMessages } = useQuery<any>({
    queryKey: [unprocessedMessagesUrl],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  // No filters to reset - removed

  const { data: streamStats } = useQuery<any>({
    queryKey: ['/api/admin/stream/stats'],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  const { data: llmCacheStats } = useQuery<any>({
    queryKey: ['/api/admin/llm-cache/stats'],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
  });

  const { data: llmCacheData } = useQuery<any>({
    queryKey: ['/api/admin/llm-cache'],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
  });

  const { data: batchHistory } = useQuery<any>({
    queryKey: ['/api/admin/stream/batches?status=submitted'],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  useEffect(() => {
    if (error && (error.message.includes('401') || error.message.includes('403'))) {
      sessionStorage.removeItem('admin_token');
      setLocation('/admin/login');
    }
  }, [error, setLocation]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _approveMutation = useMutation({
    mutationFn: async (id: string) => {
      return await adminApiRequest('POST', `/api/updates/${id}/approve`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/updates'] });
      toast({
        title: 'Update Approved',
        description: 'The documentation has been updated successfully.',
      });
    },
    onError: (error: Error) => {
      if (error.message.includes('401') || error.message.includes('403')) {
        sessionStorage.removeItem('admin_token');
        setLocation('/admin/login');
      } else {
        toast({
          title: 'Error',
          description: 'Failed to approve update.',
          variant: 'destructive',
        });
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      return await adminApiRequest('POST', `/api/updates/${id}/reject`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/updates'] });
      toast({
        title: 'Update Rejected',
        description: 'The proposed change has been rejected.',
        variant: 'destructive',
      });
    },
    onError: (error: Error) => {
      if (error.message.includes('401') || error.message.includes('403')) {
        sessionStorage.removeItem('admin_token');
        setLocation('/admin/login');
      } else {
        toast({
          title: 'Error',
          description: 'Failed to reject update.',
          variant: 'destructive',
        });
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _editMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: { summary?: string; diffAfter?: string };
    }) => {
      return await adminApiRequest('PATCH', `/api/updates/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/updates'] });
      toast({
        title: 'Update Edited',
        description: 'The change proposal has been updated.',
      });
    },
    onError: (error: Error) => {
      if (error.message.includes('401') || error.message.includes('403')) {
        sessionStorage.removeItem('admin_token');
        setLocation('/admin/login');
      } else {
        toast({
          title: 'Error',
          description: 'Failed to edit update.',
          variant: 'destructive',
        });
      }
    },
  });

  const syncDocsMutation = useMutation({
    mutationFn: async (force: boolean = false) => {
      const response = await adminApiRequest('POST', '/api/docs/sync', { force });
      return await response.json();
    },
    onSuccess: (data: any) => {
      const shortPrevHash = data.previousHash ? data.previousHash.substring(0, 8) : 'none';
      const shortCurrentHash = data.currentHash ? data.currentHash.substring(0, 8) : 'unknown';
      const durationSeconds = ((data.duration || 0) / 1000).toFixed(1);

      let message = '';
      if (data.hadUpdates) {
        message = `Synced ${data.summary?.filesProcessed?.length || 0} files. Added: ${data.summary?.added || 0}, Modified: ${data.summary?.modified || 0}${data.summary?.deleted ? `, Deleted: ${data.summary.deleted}` : ''}`;
      } else {
        message = `No updates found - already up to date`;
      }

      message += `\n\nTotal documents: ${data.totalDocuments || 'unknown'}`;
      message += `\nDuration: ${durationSeconds}s`;
      message += `\n\nFrom: ${shortPrevHash}\nTo: ${shortCurrentHash}`;

      toast({
        title: 'Documentation Sync Complete',
        description: message,
        duration: Infinity, // Don't auto-close
      });
    },
    onError: (error: Error) => {
      if (error.message.includes('401') || error.message.includes('403')) {
        sessionStorage.removeItem('admin_token');
        setLocation('/admin/login');
      } else {
        toast({
          title: 'Sync Failed',
          description: error.message || 'Failed to sync documentation.',
          variant: 'destructive',
        });
      }
    },
  });

  const handleSyncDocs = () => {
    syncDocsMutation.mutate(false);
  };

  const processStreamsMutation = useMutation({
    mutationFn: async () => {
      const response = await adminApiRequest('POST', '/api/admin/stream/process-batch', {});
      return await response.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: 'Batch Processed',
        description: `Successfully processed batch. Messages: ${data.messagesProcessed || 0}`,
        duration: 5000,
      });
      // Refresh updates list and conversations
      queryClient.invalidateQueries({ queryKey: ['/api/updates'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stream/conversations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stream/stats'] });
    },
    onError: (error: Error) => {
      if (error.message.includes('401') || error.message.includes('403')) {
        sessionStorage.removeItem('admin_token');
        setLocation('/admin/login');
      } else {
        toast({
          title: 'Processing Failed',
          description: error.message || 'Failed to process streams.',
          variant: 'destructive',
        });
      }
    },
  });

  const clearProcessedMutation = useMutation({
    mutationFn: async () => {
      const prefix = getInstancePrefix();
      const response = await adminApiRequest(
        'POST',
        `${prefix}/api/admin/stream/clear-processed`,
        {}
      );
      return await response.json();
    },
    onSuccess: (data: any) => {
      const prefix = getInstancePrefix();
      toast({
        title: 'Messages Reset',
        description: `Successfully reset ${data.count} messages back to PENDING status.`,
        duration: 5000,
      });
      // Refresh updates list and conversations
      queryClient.invalidateQueries({ queryKey: ['/api/updates'] });
      queryClient.invalidateQueries({ queryKey: [`${prefix}/api/admin/stream/conversations`] });
      queryClient.invalidateQueries({ queryKey: [`${prefix}/api/admin/stream/stats`] });
    },
    onError: (error: Error) => {
      if (error.message.includes('401') || error.message.includes('403')) {
        sessionStorage.removeItem('admin_token');
        setLocation('/admin/login');
      } else {
        toast({
          title: 'Clear Failed',
          description: error.message || 'Failed to clear processed messages.',
          variant: 'destructive',
        });
      }
    },
  });

  const handleProcessStreams = () => {
    processStreamsMutation.mutate();
  };

  const handleClearProcessed = () => {
    clearProcessedMutation.mutate();
  };

  const reprocessProposalsMutation = useMutation({
    mutationFn: async () => {
      const prefix = getInstancePrefix();
      const response = await adminApiRequest(
        'POST',
        `${prefix}/api/admin/stream/reprocess-proposals`,
        {}
      );
      return await response.json();
    },
    onSuccess: (data: any) => {
      const prefix = getInstancePrefix();
      toast({
        title: 'Proposals Reprocessed',
        description: `Processed ${data.processed} proposals, ${data.modified} were modified.`,
        duration: 5000,
      });
      // Refresh conversations data
      queryClient.invalidateQueries({ queryKey: [`${prefix}/api/admin/stream/conversations`] });
      queryClient.invalidateQueries({ queryKey: [`${prefix}/api/admin/stream/proposals`] });
    },
    onError: () => {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to reprocess proposals.',
      });
    },
  });

  const handleReprocessProposals = () => {
    reprocessProposalsMutation.mutate();
  };

  const clearCacheMutation = useMutation({
    mutationFn: async (purpose?: string) => {
      const url = purpose ? `/api/admin/llm-cache/${purpose}` : '/api/admin/llm-cache';
      const response = await adminApiRequest('DELETE', url, {});
      return await response.json();
    },
    onSuccess: (data: any, purpose?: string) => {
      toast({
        title: 'Cache Cleared',
        description: purpose
          ? `Cleared ${data.deletedCount} cached ${purpose} requests`
          : `Cleared ${data.deletedCount} total cached requests`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/llm-cache/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/llm-cache'] });
    },
    onError: (error: Error) => {
      if (error.message.includes('401') || error.message.includes('403')) {
        sessionStorage.removeItem('admin_token');
        setLocation('/admin/login');
      } else {
        toast({
          title: 'Clear Failed',
          description: error.message || 'Failed to clear cache.',
          variant: 'destructive',
        });
      }
    },
  });

  const handleClearCache = (purpose?: string) => {
    clearCacheMutation.mutate(purpose);
  };

  // Edit proposal mutation
  const editProposalMutation = useMutation({
    mutationFn: async ({ proposalId, text }: { proposalId: number; text: string }) => {
      const response = await adminApiRequest('PATCH', `/api/admin/stream/proposals/${proposalId}`, {
        suggestedText: text,
        editedBy: 'admin',
      });
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Proposal Updated',
        description: 'The proposal text has been updated successfully.',
      });
      queryClient.invalidateQueries({ queryKey: [suggestedChangesUrl] });
      queryClient.invalidateQueries({ queryKey: [changesetUrl] });
      queryClient.invalidateQueries({ queryKey: [discardedConvsUrl] });
      setEditModalOpen(false);
      setEditingProposal(null);
    },
    onError: (error: Error) => {
      if (error.message.includes('401') || error.message.includes('403')) {
        sessionStorage.removeItem('admin_token');
        setLocation('/admin/login');
      } else {
        toast({
          title: 'Error',
          description: 'Failed to update proposal.',
          variant: 'destructive',
        });
      }
    },
  });

  // Change proposal status mutation with optimistic updates
  const changeProposalStatusMutation = useMutation({
    mutationFn: async ({
      proposalId,
      status,
    }: {
      proposalId: number;
      status: 'approved' | 'ignored' | 'pending';
      sourceTab?: 'pending' | 'changeset' | 'discarded';
    }) => {
      const response = await adminApiRequest(
        'POST',
        `/api/admin/stream/proposals/${proposalId}/status`,
        {
          status,
          reviewedBy: 'admin',
        }
      );
      return await response.json();
    },
    onMutate: async ({ proposalId, sourceTab }) => {
      // Determine source query key
      const sourceKey =
        sourceTab === 'changeset'
          ? changesetUrl
          : sourceTab === 'discarded'
            ? discardedConvsUrl
            : suggestedChangesUrl;

      await queryClient.cancelQueries({ queryKey: [sourceKey] });
      const prevSource = queryClient.getQueryData([sourceKey]);

      // Optimistically remove proposal from source tab
      queryClient.setQueryData([sourceKey], (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data
            .map((conv: any) => ({
              ...conv,
              proposals: conv.proposals?.filter((p: any) => p.id !== proposalId),
            }))
            .filter((conv: any) => conv.proposals?.length > 0),
        };
      });

      return { prevSource, sourceKey };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.prevSource) {
        queryClient.setQueryData([context.sourceKey], context.prevSource);
      }
      if (error.message.includes('401') || error.message.includes('403')) {
        sessionStorage.removeItem('admin_token');
        setLocation('/admin/login');
      } else {
        toast({
          title: 'Error',
          description: 'Failed to change proposal status.',
          variant: 'destructive',
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [suggestedChangesUrl] });
      queryClient.invalidateQueries({ queryKey: [changesetUrl] });
      queryClient.invalidateQueries({ queryKey: [discardedConvsUrl] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stream/stats'] });
    },
    onSuccess: (_data, variables) => {
      const statusLabel =
        variables.status === 'approved'
          ? 'approved and added to changeset'
          : variables.status === 'ignored'
            ? 'ignored'
            : 'reset to pending';
      toast({
        title: 'Proposal Status Changed',
        description: `Proposal has been ${statusLabel}.`,
      });
    },
  });

  // PR Generation mutation
  const generatePRMutation = useMutation({
    mutationFn: async (prData: PRSubmitData & { proposalIds: number[] }) => {
      // First create a batch
      const batchResponse = await adminApiRequest('POST', '/api/admin/stream/batches', {
        proposalIds: prData.proposalIds,
      });
      const batchData = await batchResponse.json();

      // Then generate PR from the batch
      const prResponse = await adminApiRequest(
        'POST',
        `/api/admin/stream/batches/${batchData.batch.id}/generate-pr`,
        prData
      );
      return await prResponse.json();
    },
    onSuccess: () => {
      toast({
        title: 'Pull Request Created',
        description: 'Your PR has been created successfully as a draft.',
      });
      // Refresh changeset tab (removes submitted proposals)
      queryClient.invalidateQueries({ queryKey: [changesetUrl] });
      // Refresh suggested changes (updates counts)
      queryClient.invalidateQueries({ queryKey: [suggestedChangesUrl] });
      // Refresh discarded (updates counts)
      queryClient.invalidateQueries({ queryKey: [discardedConvsUrl] });
      // Refresh PR history with exact query key match
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stream/batches?status=submitted'] });
      // Refresh general batches query (if exists)
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stream/batches'] });
    },
    onError: (error: Error) => {
      if (error.message.includes('401') || error.message.includes('403')) {
        sessionStorage.removeItem('admin_token');
        setLocation('/admin/login');
      } else {
        toast({
          title: 'Error',
          description: error.message || 'Failed to generate PR.',
          variant: 'destructive',
        });
      }
    },
  });

  // Handler functions
  const handleEditProposal = (proposal: any) => {
    setEditingProposal(proposal);
    setEditModalOpen(true);
  };

  const handleSaveEdit = (proposalId: number, text: string) => {
    editProposalMutation.mutate({ proposalId, text });
  };

  const handleApproveProposal = (
    proposalId: number,
    sourceTab: 'pending' | 'changeset' | 'discarded' = 'pending'
  ) => {
    changeProposalStatusMutation.mutate({ proposalId, status: 'approved', sourceTab });
  };

  const handleIgnoreProposal = (
    proposalId: number,
    sourceTab: 'pending' | 'changeset' | 'discarded' = 'pending'
  ) => {
    changeProposalStatusMutation.mutate({ proposalId, status: 'ignored', sourceTab });
  };

  const handleResetProposal = (
    proposalId: number,
    sourceTab: 'pending' | 'changeset' | 'discarded' = 'changeset'
  ) => {
    changeProposalStatusMutation.mutate({ proposalId, status: 'pending', sourceTab });
  };

  const handlePRSubmit = async (prData: PRSubmitData) => {
    // Collect all approved proposal IDs from changeset
    const allApprovedProposals: any[] = [];
    changeset?.data?.forEach((conv: any) => {
      if (conv.proposals) {
        conv.proposals.forEach((proposal: any) => {
          if (proposal.status === 'approved') {
            allApprovedProposals.push(proposal);
          }
        });
      }
    });

    const proposalIds = allApprovedProposals.map((p) => p.id);

    await generatePRMutation.mutateAsync({
      ...prData,
      proposalIds,
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading updates...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex justify-between items-center p-4 border-b bg-white">
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <div className="flex items-center gap-4">
          <input
            type="search"
            placeholder="Search..."
            className="px-3 py-2 w-64 border rounded-md text-sm"
            style={{
              borderColor: 'var(--border-color)',
              background: 'var(--bg-surface)',
            }}
          />
        </div>
      </header>

      <main className="p-8 space-y-8">
        <div className="grid gap-6 mb-8 md:grid-cols-3">
          <div className="admin-card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Processed</h2>
            <p className="text-2xl font-bold text-gray-900">
              {streamStats?.processed || 0} / {streamStats?.total_messages || 0}
            </p>
            <p className="text-sm text-gray-600 mt-1">Messages Processed</p>
          </div>
          <div className="admin-card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Unprocessed</h2>
            <p className="text-2xl font-bold text-gray-900">{streamStats?.queued || 0}</p>
            <p className="text-sm text-gray-600 mt-1">Awaiting Review</p>
          </div>
          <div className="admin-card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Proposals</h2>
            <p className="text-2xl font-bold text-gray-900">{streamStats?.proposals?.total || 0}</p>
            <p className="text-sm text-gray-600 mt-1">Documentation Updates</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap justify-end gap-3">
          <button
            onClick={handleProcessStreams}
            disabled={processStreamsMutation.isPending || streamStats?.is_processing}
            className="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {processStreamsMutation.isPending || streamStats?.is_processing
              ? 'Processing...'
              : 'Process Messages'}
          </button>
          <button
            onClick={handleSyncDocs}
            disabled={syncDocsMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {syncDocsMutation.isPending ? 'Syncing...' : 'Sync Docs'}
          </button>
          <button
            onClick={handleClearProcessed}
            disabled={clearProcessedMutation.isPending}
            className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {clearProcessedMutation.isPending ? 'Clearing...' : 'Clear Processed'}
          </button>
          <button
            onClick={handleReprocessProposals}
            disabled={reprocessProposalsMutation.isPending}
            className="px-4 py-2 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Re-run all proposals through the post-processing pipeline using raw LLM output"
          >
            {reprocessProposalsMutation.isPending ? 'Reprocessing...' : 'Reprocess Proposals'}
          </button>
        </div>

        <Tabs defaultValue="suggested-changes" className="space-y-6">
          <div className="border-b border-gray-200">
            <nav className="flex flex-wrap gap-0" style={{ justifyContent: 'space-between' }}>
              <TabsList className="bg-transparent border-0 h-auto p-0 gap-2">
                <TabsTrigger
                  value="suggested-changes"
                  data-testid="tab-suggested-changes"
                  className="h-auto px-5 pt-3 pb-2 border-0 border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:text-blue-600 hover:text-gray-900 hover:border-gray-300 transition-all rounded-none bg-transparent data-[state=active]:bg-transparent flex flex-col items-center text-center"
                >
                  <span className="font-medium">Suggested Changes</span>
                  <small className="text-[0.65rem] text-gray-500 mt-1">
                    {suggestedChanges?.pagination?.total || 0} conversations •{' '}
                    {suggestedChanges?.totals?.total_messages_in_conversations || 0} messages
                  </small>
                </TabsTrigger>
                <TabsTrigger
                  value="discarded"
                  data-testid="tab-discarded"
                  className="h-auto px-5 pt-3 pb-2 border-0 border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:text-blue-600 hover:text-gray-900 hover:border-gray-300 transition-all rounded-none bg-transparent data-[state=active]:bg-transparent flex flex-col items-center text-center"
                >
                  <span className="font-medium">Discarded</span>
                  <small className="text-[0.65rem] text-gray-500 mt-1">
                    {discardedConvs?.pagination?.total || 0} conversations •{' '}
                    {discardedConvs?.totals?.total_messages_in_conversations || 0} messages
                  </small>
                </TabsTrigger>
                <TabsTrigger
                  value="changeset"
                  data-testid="tab-changeset"
                  className="h-auto px-5 pt-3 pb-2 border-0 border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:text-blue-600 hover:text-gray-900 hover:border-gray-300 transition-all rounded-none bg-transparent data-[state=active]:bg-transparent flex flex-col items-center text-center"
                >
                  <span className="font-medium">Changeset</span>
                  <small className="text-[0.65rem] text-gray-500 mt-1">
                    {changeset?.pagination?.total || 0} conversations •{' '}
                    {changeset?.totals?.total_messages_in_conversations || 0} messages
                  </small>
                </TabsTrigger>
                <TabsTrigger
                  value="unprocessed"
                  data-testid="tab-unprocessed"
                  className="h-auto px-5 pt-3 pb-2 border-0 border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:text-blue-600 hover:text-gray-900 hover:border-gray-300 transition-all rounded-none bg-transparent data-[state=active]:bg-transparent flex flex-col items-center text-center"
                >
                  <span className="font-medium">Unprocessed Messages</span>
                  <small className="text-[0.65rem] text-gray-500 mt-1">
                    {streamStats?.queued || 0} pending messages
                  </small>
                </TabsTrigger>
                <TabsTrigger
                  value="llm-cache"
                  data-testid="tab-llm-cache"
                  className="h-auto px-5 pt-3 pb-2 border-0 border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:text-blue-600 hover:text-gray-900 hover:border-gray-300 transition-all rounded-none bg-transparent data-[state=active]:bg-transparent flex flex-col items-center text-center"
                >
                  <span className="font-medium">LLM Cache ({llmCacheStats?.totalCached || 0})</span>
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  data-testid="tab-history"
                  className="h-auto px-5 pt-3 pb-2 border-0 border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:text-blue-600 hover:text-gray-900 hover:border-gray-300 transition-all rounded-none bg-transparent data-[state=active]:bg-transparent flex flex-col items-center text-center"
                >
                  <span className="font-medium">PR History</span>
                  <small className="text-[0.65rem] text-gray-500 mt-1">
                    {batchHistory?.batches?.length || 0} pull requests
                  </small>
                </TabsTrigger>
              </TabsList>
            </nav>
          </div>

          {/* SUGGESTED CHANGES TAB - Conversations with pending proposals */}
          <TabsContent value="suggested-changes" className="space-y-4">
            {!suggestedChanges || suggestedChanges?.data?.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  No suggested changes. All proposals have been reviewed!
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {suggestedChanges.data.map((conv: any) => (
                  <div key={conv.conversation_id} className="admin-card p-6 space-y-6">
                    {/* Conversation Header */}
                    <div className="flex items-start justify-between border-b pb-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-gray-900">
                            Conversation Thread
                          </h3>
                          <span className="inline-flex items-center rounded-md bg-blue-100 border border-blue-200 px-2 py-1 text-xs font-medium text-blue-800">
                            {conv.category}
                          </span>
                          {conv.proposals?.length > 0 && (
                            <span className="admin-badge inline-flex items-center gap-1 bg-green-100 border border-green-200 px-2 py-1 text-xs text-green-800">
                              <FileText className="w-3 h-3" />
                              {conv.proposals.length}{' '}
                              {conv.proposals.length === 1 ? 'Proposal' : 'Proposals'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          Messages: {conv.message_count} • Created{' '}
                          {new Date(conv.created_at).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 font-mono">
                        {conv.conversation_id}
                      </span>
                    </div>

                    {/* Thread Analysis */}
                    {conv.messages?.[0]?.doc_value_reason && (
                      <div className="rounded-md bg-amber-100 border border-amber-200 p-4">
                        <p className="text-xs text-gray-700 leading-relaxed">
                          <strong className="font-semibold text-gray-900">Thread Analysis:</strong>{' '}
                          {conv.messages[0].doc_value_reason}
                        </p>
                      </div>
                    )}

                    {/* Messages */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                        Messages
                      </h4>
                      {conv.messages.map((msg: any, _idx: number) => (
                        <div
                          key={msg.id}
                          className="rounded-md bg-gray-50 border border-gray-100 p-4 space-y-2"
                        >
                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium text-gray-900">{msg.author}</span>
                            <span className="text-gray-400">·</span>
                            <span className="text-gray-600">{msg.channel}</span>
                            <span className="text-gray-400">·</span>
                            <span className="text-gray-600">
                              {new Date(msg.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 leading-relaxed">{msg.content}</p>
                        </div>
                      ))}
                    </div>

                    {/* RAG Context */}
                    {conv.rag_context && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                          RAG Analysis
                        </h4>
                        <div className="rounded-md bg-blue-100 border border-blue-200 p-4 space-y-3">
                          <p className="text-xs text-gray-600">
                            Retrieved {conv.rag_context.retrieved_docs?.length || 0} relevant
                            documents • {conv.rag_context.total_tokens || 0} tokens
                          </p>
                          {(expandedRagDocs.has(conv.conversation_id)
                            ? conv.rag_context.retrieved_docs
                            : conv.rag_context.retrieved_docs?.slice(0, 3)
                          )?.map((doc: any, idx: number) => (
                            <div key={idx} className="text-xs border-l-2 border-blue-400 pl-3 py-1">
                              <p className="font-medium text-gray-900">{doc.title}</p>
                              <p className="text-gray-600">
                                {doc.filePath} • Similarity: {(doc.similarity * 100).toFixed(1)}%
                              </p>
                            </div>
                          ))}
                          {conv.rag_context.retrieved_docs?.length > 3 && (
                            <button
                              onClick={() => {
                                const newExpanded = new Set(expandedRagDocs);
                                if (newExpanded.has(conv.conversation_id)) {
                                  newExpanded.delete(conv.conversation_id);
                                } else {
                                  newExpanded.add(conv.conversation_id);
                                }
                                setExpandedRagDocs(newExpanded);
                              }}
                              className="flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 font-medium"
                            >
                              {expandedRagDocs.has(conv.conversation_id) ? (
                                <>
                                  <ChevronUp className="w-3 h-3" /> Show Less
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="w-3 h-3" /> Show All (
                                  {conv.rag_context.retrieved_docs.length - 3} more)
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Proposals */}
                    {conv.proposals?.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                          Documentation Proposals
                        </h4>
                        {conv.proposals.map((proposal: any) => {
                          const isNone = proposal.update_type === 'NONE';
                          const cardClass = isNone
                            ? 'bg-gray-50/50 border-gray-100'
                            : 'bg-green-100 border-green-200';
                          const textClass = isNone ? 'text-gray-700' : 'text-gray-700';
                          const headingClass = isNone ? 'text-gray-900' : 'text-gray-900';

                          return (
                            <div
                              key={proposal.id}
                              className={`rounded-md ${cardClass} border p-4 space-y-3`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`text-xs font-mono bg-white px-2 py-1 rounded border ${
                                        isNone
                                          ? 'text-gray-600'
                                          : proposal.update_type === 'INSERT'
                                            ? 'text-blue-800 font-semibold'
                                            : proposal.update_type === 'DELETE'
                                              ? 'text-red-800 font-semibold'
                                              : 'text-green-800 font-semibold'
                                      }`}
                                    >
                                      {isNone
                                        ? 'NO CHANGES NEEDED'
                                        : proposal.update_type === 'INSERT'
                                          ? 'NEW SECTION'
                                          : proposal.update_type === 'UPDATE'
                                            ? 'SECTION UPDATE'
                                            : proposal.update_type === 'DELETE'
                                              ? 'SECTION DELETION'
                                              : proposal.update_type}
                                    </span>
                                    <button
                                      onClick={() => handleOpenFilePreview(proposal.page)}
                                      className={`text-xs ${textClass} font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer flex items-center gap-1`}
                                      title="Click to preview file content"
                                    >
                                      <FileText className="w-3 h-3" />
                                      {proposal.page}
                                    </button>
                                    {gitStats?.gitUrl && (
                                      <button
                                        onClick={() => handleOpenInNewTab(proposal.page)}
                                        className="text-gray-500 hover:text-blue-600"
                                        title="Open in GitHub"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                  {proposal.section && (
                                    <p className={`text-xs ${textClass}`}>
                                      Section: {proposal.section}
                                    </p>
                                  )}
                                </div>
                                {!isNone && (
                                  <ProposalActionButtons
                                    proposalId={proposal.id}
                                    status={proposal.status || 'pending'}
                                    onEdit={() => handleEditProposal(proposal)}
                                    onApprove={() => handleApproveProposal(proposal.id)}
                                    onIgnore={() => handleIgnoreProposal(proposal.id)}
                                    onReset={() => handleResetProposal(proposal.id)}
                                    disabled={changeProposalStatusMutation.isPending}
                                  />
                                )}
                              </div>
                              {proposal.suggested_text && (
                                <div className="bg-white border border-gray-100 rounded p-3 text-xs space-y-2">
                                  <p className="font-semibold text-gray-900">Suggested Text:</p>
                                  <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                      {expandedProposalText.has(proposal.id)
                                        ? proposal.suggested_text
                                        : proposal.suggested_text.substring(0, 300) +
                                          (proposal.suggested_text.length > 300 ? '...' : '')}
                                    </ReactMarkdown>
                                  </div>
                                  {proposal.suggested_text.length > 300 && (
                                    <button
                                      onClick={() => {
                                        const newExpanded = new Set(expandedProposalText);
                                        if (newExpanded.has(proposal.id)) {
                                          newExpanded.delete(proposal.id);
                                        } else {
                                          newExpanded.add(proposal.id);
                                        }
                                        setExpandedProposalText(newExpanded);
                                      }}
                                      className={`flex items-center gap-1 text-xs ${textClass} hover:${headingClass} font-medium`}
                                    >
                                      {expandedProposalText.has(proposal.id) ? (
                                        <>
                                          <ChevronUp className="w-3 h-3" /> Show Less
                                        </>
                                      ) : (
                                        <>
                                          <ChevronDown className="w-3 h-3" /> Show Full Text
                                        </>
                                      )}
                                    </button>
                                  )}
                                </div>
                              )}
                              {proposal.reasoning && (
                                <div className="bg-white rounded p-3 text-xs space-y-2">
                                  <p className={`font-semibold ${headingClass}`}>
                                    {isNone ? 'Why No Changes Needed:' : 'Reasoning:'}
                                  </p>
                                  <div className="prose prose-sm max-w-none text-gray-700">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                      {expandedProposalReasoning.has(proposal.id)
                                        ? proposal.reasoning
                                        : proposal.reasoning.substring(0, 200) +
                                          (proposal.reasoning.length > 200 ? '...' : '')}
                                    </ReactMarkdown>
                                  </div>
                                  {proposal.reasoning.length > 200 && (
                                    <button
                                      onClick={() => {
                                        const newExpanded = new Set(expandedProposalReasoning);
                                        if (newExpanded.has(proposal.id)) {
                                          newExpanded.delete(proposal.id);
                                        } else {
                                          newExpanded.add(proposal.id);
                                        }
                                        setExpandedProposalReasoning(newExpanded);
                                      }}
                                      className={`flex items-center gap-1 text-xs ${textClass} hover:${headingClass} font-medium`}
                                    >
                                      {expandedProposalReasoning.has(proposal.id) ? (
                                        <>
                                          <ChevronUp className="w-3 h-3" /> Show Less
                                        </>
                                      ) : (
                                        <>
                                          <ChevronDown className="w-3 h-3" /> Show Full Reasoning
                                        </>
                                      )}
                                    </button>
                                  )}
                                </div>
                              )}
                              <div className={`flex items-center gap-2 text-xs ${textClass}`}>
                                <span>Model: {proposal.model_used || 'gemini-2.5-flash'}</span>
                                <span>•</span>
                                <span>
                                  Created: {new Date(proposal.created_at).toLocaleString()}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* Pagination */}
            <div className="flex justify-center gap-2 mt-6">
              <Button
                onClick={() => setProposalsPage((p) => Math.max(1, p - 1))}
                disabled={proposalsPage === 1}
                variant="outline"
                size="sm"
              >
                Previous
              </Button>
              <span className="flex items-center text-sm text-muted-foreground px-4">
                Page {proposalsPage} of {suggestedChanges?.pagination?.totalPages || 1}
              </span>
              <Button
                onClick={() => setProposalsPage((p) => p + 1)}
                disabled={proposalsPage >= (suggestedChanges?.pagination?.totalPages || 1)}
                variant="outline"
                size="sm"
              >
                Next
              </Button>
            </div>
          </TabsContent>

          {/* CHANGESET TAB - Approved proposals ready for PR generation */}
          <TabsContent value="changeset" className="space-y-4">
            {!changeset || changeset?.data?.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  No approved changes yet. Review suggested changes to build your changeset!
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Generate PR Button */}
                <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="space-y-1">
                    <h3 className="font-semibold text-green-900">Ready to Generate Pull Request</h3>
                    <p className="text-sm text-green-700">
                      {changeset.totals?.total_approved_proposals || 0} approved proposals across{' '}
                      {changeset.pagination?.total || 0} conversations
                    </p>
                  </div>
                  <Button
                    onClick={() => setPrModalOpen(true)}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Generate PR
                  </Button>
                </div>

                {changeset.data.map((conv: any) => (
                  <div
                    key={conv.conversation_id}
                    className="admin-card p-6 space-y-6 border-l-4 border-green-500"
                  >
                    {/* Conversation Header */}
                    <div className="flex items-start justify-between border-b pb-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-gray-900">
                            Conversation Thread
                          </h3>
                          <span className="inline-flex items-center rounded-md bg-blue-100 border border-blue-200 px-2 py-1 text-xs font-medium text-blue-800">
                            {conv.category}
                          </span>
                          {conv.proposals?.length > 0 && (
                            <span className="admin-badge inline-flex items-center gap-1 bg-green-100 border border-green-200 px-2 py-1 text-xs text-green-800">
                              <FileText className="w-3 h-3" />
                              {conv.proposals.length}{' '}
                              {conv.proposals.length === 1 ? 'Proposal' : 'Proposals'}
                            </span>
                          )}
                          <Button
                            onClick={() => {
                              const newExpanded = new Set(expandedConversationDetails);
                              if (newExpanded.has(conv.conversation_id)) {
                                newExpanded.delete(conv.conversation_id);
                              } else {
                                newExpanded.add(conv.conversation_id);
                              }
                              setExpandedConversationDetails(newExpanded);
                            }}
                            variant="outline"
                            size="sm"
                            className="h-7 px-3 border-2 border-gray-400 bg-white hover:bg-gray-50 hover:border-gray-600 text-gray-900 font-medium"
                          >
                            {expandedConversationDetails.has(conv.conversation_id) ? (
                              <>
                                <EyeOff className="w-3 h-3 mr-1" /> Hide Details
                              </>
                            ) : (
                              <>
                                <Eye className="w-3 h-3 mr-1" /> Show Details
                              </>
                            )}
                          </Button>
                        </div>
                        <p className="text-xs text-gray-500">
                          Messages: {conv.message_count} • Created{' '}
                          {new Date(conv.created_at).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 font-mono">
                        {conv.conversation_id}
                      </span>
                    </div>

                    {/* Thread Analysis */}
                    {conv.messages?.[0]?.doc_value_reason && (
                      <div className="rounded-md bg-amber-100 border border-amber-200 p-4">
                        <p className="text-xs text-gray-700 leading-relaxed">
                          <strong className="font-semibold text-gray-900">Thread Analysis:</strong>{' '}
                          {conv.messages[0].doc_value_reason}
                        </p>
                      </div>
                    )}

                    {/* Messages - Hidden by default, toggle with eye button */}
                    {expandedConversationDetails.has(conv.conversation_id) && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                          Messages
                        </h4>
                        {conv.messages.map((msg: any, _idx: number) => (
                          <div
                            key={msg.id}
                            className="rounded-md bg-gray-50 border border-gray-100 p-4 space-y-2"
                          >
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-medium text-gray-900">{msg.author}</span>
                              <span className="text-gray-400">·</span>
                              <span className="text-gray-600">{msg.channel}</span>
                              <span className="text-gray-400">·</span>
                              <span className="text-gray-600">
                                {new Date(msg.timestamp).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-sm text-gray-700 leading-relaxed">{msg.content}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* RAG Context - Hidden by default, toggle with eye button */}
                    {expandedConversationDetails.has(conv.conversation_id) && conv.rag_context && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                          RAG Analysis
                        </h4>
                        <div className="rounded-md bg-blue-100 border border-blue-200 p-4 space-y-3">
                          <p className="text-xs text-gray-600">
                            Retrieved {conv.rag_context.retrieved_docs?.length || 0} relevant
                            documents • {conv.rag_context.total_tokens || 0} tokens
                          </p>
                          {(expandedRagDocs.has(conv.conversation_id)
                            ? conv.rag_context.retrieved_docs
                            : conv.rag_context.retrieved_docs?.slice(0, 3)
                          )?.map((doc: any, idx: number) => (
                            <div key={idx} className="text-xs border-l-2 border-blue-400 pl-3 py-1">
                              <p className="font-medium text-gray-900">{doc.title}</p>
                              <p className="text-gray-600">
                                {doc.filePath} • Similarity: {(doc.similarity * 100).toFixed(1)}%
                              </p>
                            </div>
                          ))}
                          {conv.rag_context.retrieved_docs?.length > 3 && (
                            <button
                              onClick={() => {
                                const newExpanded = new Set(expandedRagDocs);
                                if (newExpanded.has(conv.conversation_id)) {
                                  newExpanded.delete(conv.conversation_id);
                                } else {
                                  newExpanded.add(conv.conversation_id);
                                }
                                setExpandedRagDocs(newExpanded);
                              }}
                              className="flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 font-medium"
                            >
                              {expandedRagDocs.has(conv.conversation_id) ? (
                                <>
                                  <ChevronUp className="w-3 h-3" /> Show Less
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="w-3 h-3" /> Show All (
                                  {conv.rag_context.retrieved_docs.length - 3} more)
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Proposals - Show only approved proposals in Changeset tab */}
                    {conv.proposals?.filter((p: any) => p.status === 'approved').length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                          Approved Documentation Proposals
                        </h4>
                        {conv.proposals
                          .filter((p: any) => p.status === 'approved')
                          .map((proposal: any) => {
                            const isNone = proposal.update_type === 'NONE';
                            const cardClass = isNone
                              ? 'bg-gray-50/50 border-gray-100'
                              : 'bg-green-100 border-green-200';
                            const textClass = isNone ? 'text-gray-700' : 'text-gray-700';
                            const headingClass = isNone ? 'text-gray-900' : 'text-gray-900';

                            return (
                              <div
                                key={proposal.id}
                                className={`rounded-md ${cardClass} border p-4 space-y-3`}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`text-xs font-mono bg-white px-2 py-1 rounded border ${isNone ? 'text-gray-600' : 'text-green-800 font-semibold'}`}
                                      >
                                        {isNone ? 'NO CHANGES NEEDED' : proposal.update_type}
                                      </span>
                                      <span className={`text-xs ${textClass} font-medium`}>
                                        {proposal.page}
                                      </span>
                                    </div>
                                    {proposal.section && (
                                      <p className={`text-xs ${textClass}`}>
                                        Section: {proposal.section}
                                      </p>
                                    )}
                                  </div>
                                  {!isNone && (
                                    <ProposalActionButtons
                                      proposalId={proposal.id}
                                      status={proposal.status || 'pending'}
                                      onEdit={() => handleEditProposal(proposal)}
                                      onApprove={() => handleApproveProposal(proposal.id)}
                                      onIgnore={() => handleIgnoreProposal(proposal.id)}
                                      onReset={() => handleResetProposal(proposal.id)}
                                      disabled={changeProposalStatusMutation.isPending}
                                    />
                                  )}
                                </div>
                                {proposal.suggested_text && (
                                  <div className="bg-white border border-gray-100 rounded p-3 text-xs space-y-2">
                                    <p className="font-semibold text-gray-900">Suggested Text:</p>
                                    <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">
                                      {expandedProposalText.has(proposal.id)
                                        ? proposal.suggested_text
                                        : proposal.suggested_text.substring(0, 300) +
                                          (proposal.suggested_text.length > 300 ? '...' : '')}
                                    </p>
                                    {proposal.suggested_text.length > 300 && (
                                      <button
                                        onClick={() => {
                                          const newExpanded = new Set(expandedProposalText);
                                          if (newExpanded.has(proposal.id)) {
                                            newExpanded.delete(proposal.id);
                                          } else {
                                            newExpanded.add(proposal.id);
                                          }
                                          setExpandedProposalText(newExpanded);
                                        }}
                                        className={`flex items-center gap-1 text-xs ${textClass} hover:${headingClass} font-medium`}
                                      >
                                        {expandedProposalText.has(proposal.id) ? (
                                          <>
                                            <ChevronUp className="w-3 h-3" /> Show Less
                                          </>
                                        ) : (
                                          <>
                                            <ChevronDown className="w-3 h-3" /> Show Full Text
                                          </>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                )}
                                {proposal.reasoning && (
                                  <div className="bg-white rounded p-3 text-xs space-y-2">
                                    <p className={`font-semibold ${headingClass}`}>
                                      {isNone ? 'Why No Changes Needed:' : 'Reasoning:'}
                                    </p>
                                    <p className="text-gray-700 whitespace-pre-wrap">
                                      {expandedProposalReasoning.has(proposal.id)
                                        ? proposal.reasoning
                                        : proposal.reasoning.substring(0, 200) +
                                          (proposal.reasoning.length > 200 ? '...' : '')}
                                    </p>
                                    {proposal.reasoning.length > 200 && (
                                      <button
                                        onClick={() => {
                                          const newExpanded = new Set(expandedProposalReasoning);
                                          if (newExpanded.has(proposal.id)) {
                                            newExpanded.delete(proposal.id);
                                          } else {
                                            newExpanded.add(proposal.id);
                                          }
                                          setExpandedProposalReasoning(newExpanded);
                                        }}
                                        className={`flex items-center gap-1 text-xs ${textClass} hover:${headingClass} font-medium`}
                                      >
                                        {expandedProposalReasoning.has(proposal.id) ? (
                                          <>
                                            <ChevronUp className="w-3 h-3" /> Show Less
                                          </>
                                        ) : (
                                          <>
                                            <ChevronDown className="w-3 h-3" /> Show Full Reasoning
                                          </>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                )}
                                <div className={`flex items-center gap-2 text-xs ${textClass}`}>
                                  <span>Model: {proposal.model_used || 'gemini-2.5-flash'}</span>
                                  <span>•</span>
                                  <span>
                                    Created: {new Date(proposal.created_at).toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* Pagination */}
            <div className="flex justify-center gap-2 mt-6">
              <Button
                onClick={() => setChangesetPage((p) => Math.max(1, p - 1))}
                disabled={changesetPage === 1}
                variant="outline"
                size="sm"
              >
                Previous
              </Button>
              <span className="flex items-center text-sm text-muted-foreground px-4">
                Page {changesetPage} of {changeset?.pagination?.totalPages || 1}
              </span>
              <Button
                onClick={() => setChangesetPage((p) => p + 1)}
                disabled={changesetPage >= (changeset?.pagination?.totalPages || 1)}
                variant="outline"
                size="sm"
              >
                Next
              </Button>
            </div>
          </TabsContent>

          {/* DISCARDED TAB - Ignored proposals */}
          <TabsContent value="discarded" className="space-y-4">
            {!discardedConvs || discardedConvs?.data?.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No discarded proposals yet.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {discardedConvs.data.map((conv: any) => (
                  <div key={conv.conversation_id} className="admin-card p-6 space-y-6">
                    {/* Conversation Header */}
                    <div className="flex items-start justify-between border-b pb-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-gray-900">
                            Conversation Thread
                          </h3>
                          <span className="inline-flex items-center rounded-md bg-blue-100 border border-blue-200 px-2 py-1 text-xs font-medium text-blue-800">
                            {conv.category}
                          </span>
                          {conv.proposals?.length > 0 && (
                            <span className="admin-badge inline-flex items-center gap-1 bg-green-100 border border-green-200 px-2 py-1 text-xs text-green-800">
                              <FileText className="w-3 h-3" />
                              {conv.proposals.length}{' '}
                              {conv.proposals.length === 1 ? 'Proposal' : 'Proposals'}
                            </span>
                          )}
                          <Button
                            onClick={() => {
                              const newExpanded = new Set(expandedConversationDetails);
                              if (newExpanded.has(conv.conversation_id)) {
                                newExpanded.delete(conv.conversation_id);
                              } else {
                                newExpanded.add(conv.conversation_id);
                              }
                              setExpandedConversationDetails(newExpanded);
                            }}
                            variant="outline"
                            size="sm"
                            className="h-7 px-3 border-2 border-gray-400 bg-white hover:bg-gray-50 hover:border-gray-600 text-gray-900 font-medium"
                          >
                            {expandedConversationDetails.has(conv.conversation_id) ? (
                              <>
                                <EyeOff className="w-3 h-3 mr-1" /> Hide Details
                              </>
                            ) : (
                              <>
                                <Eye className="w-3 h-3 mr-1" /> Show Details
                              </>
                            )}
                          </Button>
                        </div>
                        <p className="text-xs text-gray-500">
                          Messages: {conv.message_count} • Created{' '}
                          {new Date(conv.created_at).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 font-mono">
                        {conv.conversation_id}
                      </span>
                    </div>

                    {/* Thread Analysis */}
                    {conv.messages?.[0]?.doc_value_reason && (
                      <div className="rounded-md bg-amber-100 border border-amber-200 p-4">
                        <p className="text-xs text-gray-700 leading-relaxed">
                          <strong className="font-semibold text-gray-900">Thread Analysis:</strong>{' '}
                          {conv.messages[0].doc_value_reason}
                        </p>
                      </div>
                    )}

                    {/* Messages - Hidden by default, toggle with eye button */}
                    {expandedConversationDetails.has(conv.conversation_id) && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                          Messages
                        </h4>
                        {conv.messages.map((msg: any, _idx: number) => (
                          <div
                            key={msg.id}
                            className="rounded-md bg-gray-50 border border-gray-100 p-4 space-y-2"
                          >
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-medium text-gray-900">{msg.author}</span>
                              <span className="text-gray-400">·</span>
                              <span className="text-gray-600">{msg.channel}</span>
                              <span className="text-gray-400">·</span>
                              <span className="text-gray-600">
                                {new Date(msg.timestamp).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-sm text-gray-700 leading-relaxed">{msg.content}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* RAG Context - Hidden by default, toggle with eye button */}
                    {expandedConversationDetails.has(conv.conversation_id) && conv.rag_context && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                          RAG Analysis
                        </h4>
                        <div className="rounded-md bg-blue-100 border border-blue-200 p-4 space-y-3">
                          <p className="text-xs text-gray-600">
                            Retrieved {conv.rag_context.retrieved_docs?.length || 0} relevant
                            documents • {conv.rag_context.total_tokens || 0} tokens
                          </p>
                          {(expandedRagDocs.has(conv.conversation_id)
                            ? conv.rag_context.retrieved_docs
                            : conv.rag_context.retrieved_docs?.slice(0, 3)
                          )?.map((doc: any, idx: number) => (
                            <div key={idx} className="text-xs border-l-2 border-blue-400 pl-3 py-1">
                              <p className="font-medium text-gray-900">{doc.title}</p>
                              <p className="text-gray-600">
                                {doc.filePath} • Similarity: {(doc.similarity * 100).toFixed(1)}%
                              </p>
                            </div>
                          ))}
                          {conv.rag_context.retrieved_docs?.length > 3 && (
                            <button
                              onClick={() => {
                                const newExpanded = new Set(expandedRagDocs);
                                if (newExpanded.has(conv.conversation_id)) {
                                  newExpanded.delete(conv.conversation_id);
                                } else {
                                  newExpanded.add(conv.conversation_id);
                                }
                                setExpandedRagDocs(newExpanded);
                              }}
                              className="flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 font-medium"
                            >
                              {expandedRagDocs.has(conv.conversation_id) ? (
                                <>
                                  <ChevronUp className="w-3 h-3" /> Show Less
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="w-3 h-3" /> Show All (
                                  {conv.rag_context.retrieved_docs.length - 3} more)
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Proposal Rejection Reason */}
                    {conv.rag_context?.proposals_rejected && conv.rag_context?.rejection_reason && (
                      <div className="rounded-md bg-orange-100 border border-orange-200 p-4">
                        <h4 className="text-sm font-semibold text-gray-900 mb-2">
                          No Documentation Changes Needed
                        </h4>
                        <p className="text-xs text-gray-700 leading-relaxed">
                          <strong className="font-semibold">Reason:</strong>{' '}
                          {conv.rag_context.rejection_reason}
                        </p>
                      </div>
                    )}

                    {/* Proposals - Show only ignored proposals in Discarded tab */}
                    {conv.proposals?.filter((p: any) => p.status === 'ignored').length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                          Discarded Documentation Proposals
                        </h4>
                        {conv.proposals
                          .filter((p: any) => p.status === 'ignored')
                          .map((proposal: any) => {
                            const cardClass = 'bg-red-50 border-red-200';
                            const textClass = 'text-gray-700';
                            const headingClass = 'text-gray-900';

                            return (
                              <div
                                key={proposal.id}
                                className={`rounded-md ${cardClass} border p-4 space-y-3`}
                              >
                                <div className="flex items-start justify-between">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <span
                                        className={`text-xs font-mono bg-white px-2 py-1 rounded border text-red-800 font-semibold`}
                                      >
                                        DISCARDED
                                      </span>
                                      <span className={`text-xs ${textClass} font-medium`}>
                                        {proposal.page}
                                      </span>
                                    </div>
                                    {proposal.section && (
                                      <p className={`text-xs ${textClass}`}>
                                        Section: {proposal.section}
                                      </p>
                                    )}
                                  </div>
                                  <ProposalActionButtons
                                    proposalId={proposal.id}
                                    status={proposal.status || 'pending'}
                                    onEdit={() => handleEditProposal(proposal)}
                                    onApprove={() => handleApproveProposal(proposal.id)}
                                    onIgnore={() => handleIgnoreProposal(proposal.id)}
                                    onReset={() => handleResetProposal(proposal.id)}
                                    disabled={changeProposalStatusMutation.isPending}
                                  />
                                </div>
                                {/* Discard Reason */}
                                {proposal.discard_reason && (
                                  <div className="bg-white border border-red-200 rounded p-3 text-xs space-y-1">
                                    <p className="font-semibold text-gray-900">Discard Reason:</p>
                                    <p className="text-gray-700">{proposal.discard_reason}</p>
                                  </div>
                                )}
                                {proposal.suggested_text && (
                                  <div className="bg-white border border-gray-100 rounded p-3 text-xs space-y-2">
                                    <p className="font-semibold text-gray-900">Suggested Text:</p>
                                    <p className="text-gray-700 whitespace-pre-wrap leading-relaxed">
                                      {expandedProposalText.has(proposal.id)
                                        ? proposal.suggested_text
                                        : proposal.suggested_text.substring(0, 300) +
                                          (proposal.suggested_text.length > 300 ? '...' : '')}
                                    </p>
                                    {proposal.suggested_text.length > 300 && (
                                      <button
                                        onClick={() => {
                                          const newExpanded = new Set(expandedProposalText);
                                          if (newExpanded.has(proposal.id)) {
                                            newExpanded.delete(proposal.id);
                                          } else {
                                            newExpanded.add(proposal.id);
                                          }
                                          setExpandedProposalText(newExpanded);
                                        }}
                                        className={`flex items-center gap-1 text-xs ${textClass} hover:${headingClass} font-medium`}
                                      >
                                        {expandedProposalText.has(proposal.id) ? (
                                          <>
                                            <ChevronUp className="w-3 h-3" /> Show Less
                                          </>
                                        ) : (
                                          <>
                                            <ChevronDown className="w-3 h-3" /> Show Full Text
                                          </>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                )}
                                {proposal.reasoning && (
                                  <div className="bg-white rounded p-3 text-xs space-y-2">
                                    <p className={`font-semibold ${headingClass}`}>Reasoning:</p>
                                    <p className="text-gray-700 whitespace-pre-wrap">
                                      {expandedProposalReasoning.has(proposal.id)
                                        ? proposal.reasoning
                                        : proposal.reasoning.substring(0, 200) +
                                          (proposal.reasoning.length > 200 ? '...' : '')}
                                    </p>
                                    {proposal.reasoning.length > 200 && (
                                      <button
                                        onClick={() => {
                                          const newExpanded = new Set(expandedProposalReasoning);
                                          if (newExpanded.has(proposal.id)) {
                                            newExpanded.delete(proposal.id);
                                          } else {
                                            newExpanded.add(proposal.id);
                                          }
                                          setExpandedProposalReasoning(newExpanded);
                                        }}
                                        className={`flex items-center gap-1 text-xs ${textClass} hover:${headingClass} font-medium`}
                                      >
                                        {expandedProposalReasoning.has(proposal.id) ? (
                                          <>
                                            <ChevronUp className="w-3 h-3" /> Show Less
                                          </>
                                        ) : (
                                          <>
                                            <ChevronDown className="w-3 h-3" /> Show Full Reasoning
                                          </>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                )}
                                <div className={`flex items-center gap-2 text-xs ${textClass}`}>
                                  <span>Model: {proposal.model_used || 'gemini-2.5-flash'}</span>
                                  <span>•</span>
                                  <span>
                                    Created: {new Date(proposal.created_at).toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* Pagination */}
            {discardedConvs?.pagination && discardedConvs.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between border-t pt-4 mt-6">
                <div className="text-sm text-muted-foreground">
                  Showing{' '}
                  {(discardedConvs.pagination.page - 1) * discardedConvs.pagination.limit + 1} -{' '}
                  {Math.min(
                    discardedConvs.pagination.page * discardedConvs.pagination.limit,
                    discardedConvs.pagination.total
                  )}{' '}
                  of {discardedConvs.pagination.total}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDiscardedPage(discardedPage - 1)}
                    disabled={discardedPage <= 1}
                  >
                    Previous
                  </Button>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-muted-foreground">
                      Page {discardedConvs.pagination.page} of{' '}
                      {discardedConvs.pagination.totalPages}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDiscardedPage(discardedPage + 1)}
                    disabled={discardedPage >= discardedConvs.pagination.totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="unprocessed" className="space-y-4">
            {!unprocessedMessages || unprocessedMessages?.data?.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No unprocessed messages</p>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {unprocessedMessages.data.map((msg: any) => (
                    <div key={msg.id} className="admin-card p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-gray-900">{msg.author}</span>
                            <span className="text-xs text-gray-400">·</span>
                            <span className="text-xs text-gray-600">{msg.channel}</span>
                            <span className="text-xs text-gray-400">·</span>
                            <span className="text-xs text-gray-600">
                              {new Date(msg.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500">
                            Stream: {msg.stream_id}
                            {msg.metadata?.replyToMessageId && (
                              <span className="ml-2 text-blue-600">
                                • Replying to: [{msg.metadata.replyToMessageId}]
                              </span>
                            )}
                          </p>
                        </div>
                        <span className="text-xs bg-yellow-100 border border-yellow-200 text-yellow-800 px-2 py-1 rounded">
                          {msg.processing_status}
                        </span>
                      </div>
                      <div className="bg-gray-50 border border-gray-100 rounded p-3">
                        <p className="text-sm whitespace-pre-wrap text-gray-700">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {unprocessedMessages?.pagination &&
                  unprocessedMessages.pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between border-t pt-4">
                      <div className="text-sm text-muted-foreground">
                        Showing{' '}
                        {(unprocessedMessages.pagination.page - 1) *
                          unprocessedMessages.pagination.limit +
                          1}{' '}
                        -{' '}
                        {Math.min(
                          unprocessedMessages.pagination.page *
                            unprocessedMessages.pagination.limit,
                          unprocessedMessages.pagination.total
                        )}{' '}
                        of {unprocessedMessages.pagination.total}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setUnprocessedPage(unprocessedPage - 1)}
                          disabled={unprocessedPage <= 1}
                        >
                          Previous
                        </Button>
                        <div className="flex items-center gap-1">
                          <span className="text-sm text-muted-foreground">
                            Page {unprocessedMessages.pagination.page} of{' '}
                            {unprocessedMessages.pagination.totalPages}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setUnprocessedPage(unprocessedPage + 1)}
                          disabled={unprocessedPage >= unprocessedMessages.pagination.totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
              </>
            )}
          </TabsContent>

          <TabsContent value="llm-cache" className="space-y-4">
            {!llmCacheStats ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Loading cache statistics...</p>
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-5 mb-6">
                  <StatsCard
                    title="Total Cached"
                    value={llmCacheStats.totalCached}
                    icon={Database}
                    description="Total LLM responses"
                  />
                  <StatsCard
                    title="Index"
                    value={llmCacheStats.byPurpose?.index || 0}
                    icon={FileText}
                    description="Documentation indexes"
                  />
                  <StatsCard
                    title="Embeddings"
                    value={llmCacheStats.byPurpose?.embeddings || 0}
                    icon={Database}
                    description="Vector embeddings"
                  />
                  <StatsCard
                    title="Analysis"
                    value={llmCacheStats.byPurpose?.analysis || 0}
                    icon={CheckCircle2}
                    description="Message analyses"
                  />
                  <StatsCard
                    title="Changes"
                    value={llmCacheStats.byPurpose?.changegeneration || 0}
                    icon={FileText}
                    description="Change generation"
                  />
                </div>

                <div className="flex items-center gap-4 mb-4 flex-wrap">
                  <Select
                    value={cachePurposeFilter}
                    onValueChange={(value: any) => setCachePurposeFilter(value)}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="Select purpose" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Purposes</SelectItem>
                      <SelectItem value="analysis">
                        Analysis ({llmCacheStats.byPurpose?.analysis || 0})
                      </SelectItem>
                      <SelectItem value="changegeneration">
                        Change Generation ({llmCacheStats.byPurpose?.changegeneration || 0})
                      </SelectItem>
                      <SelectItem value="review">
                        Review ({llmCacheStats.byPurpose?.review || 0})
                      </SelectItem>
                      <SelectItem value="embeddings">
                        Embeddings ({llmCacheStats.byPurpose?.embeddings || 0})
                      </SelectItem>
                      <SelectItem value="index">
                        Index ({llmCacheStats.byPurpose?.index || 0})
                      </SelectItem>
                      <SelectItem value="general">
                        General ({llmCacheStats.byPurpose?.general || 0})
                      </SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="relative flex-1 min-w-[300px]">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      placeholder="Search in prompts..."
                      value={cacheSearchText}
                      onChange={(e) => setCacheSearchText(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  <Button
                    onClick={() =>
                      handleClearCache(
                        cachePurposeFilter === 'all' ? undefined : cachePurposeFilter
                      )
                    }
                    variant="destructive"
                    size="sm"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {cachePurposeFilter === 'all'
                      ? 'Clear All Cache'
                      : `Clear ${cachePurposeFilter}`}
                  </Button>
                </div>

                {(() => {
                  const filteredData =
                    cachePurposeFilter === 'all'
                      ? llmCacheData || []
                      : llmCacheData?.filter(
                          (group: any) => group.purpose === cachePurposeFilter
                        ) || [];

                  let allRequests = filteredData.flatMap((group: any) =>
                    group.requests.map((req: any) => ({ ...req, purpose: group.purpose }))
                  );

                  // Apply search filter
                  if (cacheSearchText.trim()) {
                    const searchLower = cacheSearchText.toLowerCase();
                    allRequests = allRequests.filter(
                      (req: any) =>
                        req.prompt.toLowerCase().includes(searchLower) ||
                        req.response.toLowerCase().includes(searchLower)
                    );
                  }

                  if (!llmCacheData || allRequests.length === 0) {
                    return (
                      <div className="text-center py-12">
                        <p className="text-muted-foreground">
                          {cacheSearchText.trim()
                            ? `No results found for "${cacheSearchText}"`
                            : cachePurposeFilter === 'all'
                              ? 'No cached LLM requests yet.'
                              : `No cached ${cachePurposeFilter} requests yet.`}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Showing {allRequests.length} cached request
                        {allRequests.length !== 1 ? 's' : ''}
                        {cacheSearchText.trim() && ` matching "${cacheSearchText}"`}
                      </p>
                      {allRequests.map((cached: any) => (
                        <div key={cached.hash} className="rounded-lg border bg-card p-4 space-y-3">
                          <div className="flex items-start justify-between">
                            <div className="space-y-1 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-mono bg-muted px-2 py-1 rounded">
                                  {cached.hash.substring(0, 12)}...
                                </span>
                                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded capitalize border border-blue-200">
                                  {cached.purpose}
                                </span>
                                {cached.model && (
                                  <span className="text-xs text-muted-foreground">
                                    {cached.model}
                                  </span>
                                )}
                                {cached.tokensUsed && (
                                  <span className="text-xs text-muted-foreground">
                                    {cached.tokensUsed.toLocaleString()} tokens
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {new Date(cached.timestamp).toLocaleString()}
                              </p>
                            </div>
                          </div>

                          <details className="text-sm">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium">
                              View prompt ({cached.prompt.length.toLocaleString()} characters)
                            </summary>
                            <div className="mt-2 border rounded">
                              <pre className="p-3 bg-muted rounded text-xs overflow-auto max-h-[400px] whitespace-pre-wrap break-words">
                                {cached.prompt}
                              </pre>
                            </div>
                          </details>

                          <details className="text-sm">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-medium">
                              View response ({cached.response.length.toLocaleString()} characters)
                            </summary>
                            <div className="mt-2 border rounded">
                              <pre className="p-3 bg-muted rounded text-xs overflow-auto max-h-[500px] whitespace-pre-wrap break-words">
                                {(() => {
                                  try {
                                    // Try to parse and pretty-print JSON responses
                                    const parsed = JSON.parse(cached.response);
                                    return JSON.stringify(parsed, null, 2);
                                  } catch {
                                    // If not JSON, return as-is
                                    return cached.response;
                                  }
                                })()}
                              </pre>
                            </div>
                          </details>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </>
            )}
          </TabsContent>

          {/* PR HISTORY TAB - Submitted changeset batches */}
          <TabsContent value="history" className="space-y-4">
            {!batchHistory?.batches?.length ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  No pull requests generated yet. Create your first PR from the Changeset tab!
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {batchHistory.batches.map((batch: any) => (
                  <div key={batch.id} className="admin-card p-6 space-y-4">
                    {/* Batch Header */}
                    <div className="flex items-start justify-between border-b pb-4">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-gray-900">
                            {batch.prTitle || `Batch ${batch.batchId}`}
                          </h3>
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                              batch.status === 'submitted'
                                ? 'bg-blue-100 border border-blue-200 text-blue-800'
                                : batch.status === 'merged'
                                  ? 'bg-green-100 border border-green-200 text-green-800'
                                  : 'bg-gray-100 border border-gray-200 text-gray-800'
                            }`}
                          >
                            {batch.status.toUpperCase()}
                          </span>
                        </div>
                        {batch.prUrl && (
                          <a
                            href={batch.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1"
                          >
                            PR #{batch.prNumber}
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                              />
                            </svg>
                          </a>
                        )}
                        <p className="text-sm text-gray-600">
                          Submitted {new Date(batch.submittedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    {/* Batch Statistics */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <div className="text-xs text-blue-700 mb-1">Total Proposals</div>
                        <div className="text-2xl font-bold text-blue-900">
                          {batch.totalProposals}
                        </div>
                      </div>
                      <div className="p-3 bg-green-50 rounded-lg">
                        <div className="text-xs text-green-700 mb-1">Applied Successfully</div>
                        <div className="text-2xl font-bold text-green-900">
                          {batch.proposals?.filter((p: any) => p.prApplicationStatus === 'success')
                            .length || batch.totalProposals}
                        </div>
                      </div>
                      <div className="p-3 bg-red-50 rounded-lg">
                        <div className="text-xs text-red-700 mb-1">Failed</div>
                        <div className="text-2xl font-bold text-red-900">
                          {batch.failures?.length || 0}
                        </div>
                      </div>
                    </div>

                    {/* Affected Files - Collapsible */}
                    <details className="group">
                      <summary className="cursor-pointer p-3 bg-gray-50 hover:bg-gray-100 rounded-md border border-gray-200 transition-colors">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-gray-900">
                            Affected Files ({batch.affectedFiles?.length || 0})
                          </span>
                          <ChevronDown className="w-4 h-4 text-gray-600 group-open:rotate-180 transition-transform" />
                        </div>
                      </summary>
                      <div className="mt-2 p-3 bg-white border border-gray-200 rounded-md">
                        <ul className="space-y-1">
                          {(batch.affectedFiles || []).map((file: string, idx: number) => (
                            <li key={idx} className="flex items-center gap-2 text-sm">
                              <FileText className="w-3 h-3 text-gray-500 flex-shrink-0" />
                              <span className="font-mono text-gray-900 text-xs">{file}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </details>

                    {/* Repository Info */}
                    <div className="text-xs text-gray-600 border-t pt-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="font-semibold">Target:</span> {batch.targetRepo || 'N/A'}
                        </div>
                        <div>
                          <span className="font-semibold">Branch:</span>{' '}
                          {batch.branchName || batch.baseBranch || 'main'}
                        </div>
                      </div>
                    </div>

                    {/* Failed Proposals Warning */}
                    {batch.failures && batch.failures.length > 0 && (
                      <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
                          <div className="text-sm">
                            <p className="font-semibold text-yellow-900 mb-1">
                              {batch.failures.length} proposals failed to apply
                            </p>
                            <ul className="text-xs text-yellow-800 space-y-1">
                              {batch.failures.slice(0, 3).map((failure: any, idx: number) => (
                                <li key={idx}>
                                  • {failure.failureType}: {failure.errorMessage}
                                </li>
                              ))}
                              {batch.failures.length > 3 && (
                                <li className="text-yellow-600">
                                  ...and {batch.failures.length - 3} more
                                </li>
                              )}
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Edit Proposal Modal */}
      <EditProposalModal
        proposal={editingProposal}
        isOpen={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setEditingProposal(null);
        }}
        onSave={handleSaveEdit}
        isSaving={editProposalMutation.isPending}
      />

      {/* PR Preview Modal */}
      <PRPreviewModal
        isOpen={prModalOpen}
        onClose={() => setPrModalOpen(false)}
        approvedProposals={(() => {
          const allApprovedProposals: any[] = [];
          changeset?.data?.forEach((conv: any) => {
            if (conv.proposals) {
              conv.proposals.forEach((proposal: any) => {
                if (proposal.status === 'approved') {
                  allApprovedProposals.push(proposal);
                }
              });
            }
          });
          return allApprovedProposals;
        })()}
        onSubmit={handlePRSubmit}
      />

      {/* File Preview Dialog */}
      <Dialog open={filePreviewOpen} onOpenChange={setFilePreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden bg-white [&>button]:text-gray-900 [&>button]:hover:bg-gray-100">
          <DialogHeader>
            <DialogTitle className="text-gray-900 flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {previewFilePath}
            </DialogTitle>
            <DialogDescription className="text-gray-600 flex items-center gap-2">
              Current file content
              {gitStats?.gitUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenInNewTab(previewFilePath)}
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
            {!fileLoading && !fileError && fileContent && (
              <div className="prose prose-sm max-w-none text-gray-900">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{fileContent}</ReactMarkdown>
              </div>
            )}
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
    </div>
  );
}
