import * as React from 'react';
const { useState, useEffect } = React;
import { useLocation } from 'wouter';
import { UpdateCard, type ProposalFeedback } from '@/components/UpdateCard';
import { StatsCard } from '@/components/StatsCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  FileText,
  CheckCircle2,
  Clock,
  XCircle,
  MessageSquare,
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  ExternalLink,
  RefreshCw,
  Download,
  Cpu,
  GitPullRequest,
  LogOut,
  Loader2,
  ArrowUp,
  ArrowDown,
  FileCode,
  Play,
  Search,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, adminApiRequest, getQueryFn } from '@/lib/queryClient';
import { PRPreviewModal, type PRSubmitData } from '@/components/PRPreviewModal';

// Get instance prefix from URL (e.g., /myinstance/admin -> /myinstance)
function getInstancePrefix(): string {
  const pathParts = window.location.pathname.split('/');
  // If path is like /myinstance/admin, return /myinstance
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

export default function Admin() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedConversation, setSelectedConversation] = useState<any>(null);
  const [conversationModalOpen, setConversationModalOpen] = useState(false);
  const [prModalOpen, setPrModalOpen] = useState(false);
  const [processingOverlay, setProcessingOverlay] = useState<{
    visible: boolean;
    title: string;
    message: string;
    progress?: { current: number; total: number };
  }>({ visible: false, title: '', message: '' });
  const [showScrollButtons, setShowScrollButtons] = useState(false);

  // Pagination state - items per page and current page per tab
  const ITEMS_PER_PAGE = 10;
  const [pendingPage, setPendingPage] = useState(1);
  const [approvedPage, setApprovedPage] = useState(1);
  const [ignoredPage, setIgnoredPage] = useState(1);
  const [allPage, setAllPage] = useState(1);

  // Search state - triggered by button or Enter key
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  const executeSearch = () => {
    setActiveSearch(searchQuery);
    setPendingPage(1);
    setApprovedPage(1);
    setIgnoredPage(1);
    setAllPage(1);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setActiveSearch('');
    setPendingPage(1);
    setApprovedPage(1);
    setIgnoredPage(1);
    setAllPage(1);
  };

  // Track scroll position for scroll buttons
  useEffect(() => {
    const handleScroll = () => {
      const scrollable = document.documentElement.scrollHeight > window.innerHeight;
      const scrolled = window.scrollY > 100;
      setShowScrollButtons(scrollable && scrolled);
    };
    window.addEventListener('scroll', handleScroll);
    handleScroll(); // Check initial state
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  const scrollToBottom = () =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });

  // Instance prefix for API calls
  const apiPrefix = getInstancePrefix();

  // Auth check
  useEffect(() => {
    const token = sessionStorage.getItem('admin_token');
    const instance = sessionStorage.getItem('admin_instance');
    if (!token) {
      // Redirect to instance-specific login if we know the instance, otherwise generic login
      setLocation(instance ? `/${instance}/admin/login` : '/login');
    }
  }, [setLocation]);

  // Build search param for queries
  const searchParam = activeSearch ? `&search=${encodeURIComponent(activeSearch)}` : '';

  // Query keys for each tab (used for cache manipulation)
  const pendingQueryKey = `${apiPrefix}/api/admin/stream/conversations?status=pending&limit=${ITEMS_PER_PAGE}&page=${pendingPage}${searchParam}`;
  const changesetQueryKey = `${apiPrefix}/api/admin/stream/conversations?status=changeset&limit=${ITEMS_PER_PAGE}&page=${approvedPage}${searchParam}`;
  const discardedQueryKey = `${apiPrefix}/api/admin/stream/conversations?status=discarded&limit=${ITEMS_PER_PAGE}&page=${ignoredPage}${searchParam}`;
  const allQueryKey = `${apiPrefix}/api/admin/stream/conversations?limit=${ITEMS_PER_PAGE}&page=${allPage}${searchParam}`;

  // Fetch conversations with server-side pagination
  const { data: pendingConvs, isLoading: loadingPending } = useQuery<{
    data: any[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: [pendingQueryKey],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
  });

  const { data: approvedConvs, isLoading: loadingApproved } = useQuery<{
    data: any[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: [changesetQueryKey],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
  });

  const { data: ignoredConvs, isLoading: loadingIgnored } = useQuery<{
    data: any[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: [discardedQueryKey],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
  });

  const { data: allConvs, isLoading: loadingAll } = useQuery<{
    data: any[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: [allQueryKey],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
  });

  const { data: batchHistory } = useQuery<any>({
    queryKey: [`${apiPrefix}/api/admin/stream/batches?status=submitted`],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch git stats for documentation URL (uses global config, not instance-prefixed)
  const { data: gitStats } = useQuery<{
    gitUrl: string;
    branch: string;
    lastSyncAt: string | null;
    totalDocuments: number;
  }>({
    queryKey: ['/api/docs/git-stats'],
  });

  // Fetch stream processing stats (includes is_processing flag)
  const { data: streamStats, refetch: refetchStreamStats } = useQuery<{
    total_messages: number;
    processed: number;
    queued: number;
    failed: number;
    is_processing: boolean;
    proposals: { total: number; approved: number; pending: number };
  }>({
    queryKey: [`${apiPrefix}/api/admin/stream/stats`],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
    // Poll faster when processing overlay is visible (1s) vs idle (5s)
    // Note: Can't reference streamStats here as it would cause temporal dead zone error
    refetchInterval: processingOverlay.visible ? 1000 : 5000,
  });

  // Update overlay with current progress when processing
  useEffect(() => {
    if (
      processingOverlay.visible &&
      streamStats &&
      processingOverlay.title.includes('Processing')
    ) {
      const processed = streamStats.processed || 0;
      const queued = streamStats.queued || 0;

      if (!streamStats.is_processing && queued === 0) {
        // Processing complete
        setProcessingOverlay((prev) => ({
          ...prev,
          message: `Completed! Processed ${processed} messages.`,
        }));
        // Auto-close after showing completion
        setTimeout(() => {
          setProcessingOverlay({ visible: false, title: '', message: '' });
          // Refresh conversations
          queryClient.invalidateQueries({
            queryKey: [pendingQueryKey],
          });
          queryClient.invalidateQueries({
            queryKey: [changesetQueryKey],
          });
        }, 1500);
      } else {
        setProcessingOverlay((prev) => ({
          ...prev,
          message: `Processing messages... ${processed} completed, ${queued} remaining`,
          progress: { current: processed, total: processed + queued },
        }));
      }
    }
  }, [streamStats, processingOverlay.visible, processingOverlay.title]);

  // Get conversations from server responses
  const pendingConversations = pendingConvs?.data || [];
  const approvedConversations = approvedConvs?.data || [];
  const ignoredConversations = ignoredConvs?.data || [];
  const allConversations = allConvs?.data || [];

  // Use server pagination totals for counts
  const pendingCount = pendingConvs?.pagination?.total || 0;
  const approvedCount = approvedConvs?.pagination?.total || 0;
  const ignoredCount = ignoredConvs?.pagination?.total || 0;
  const totalCount = allConvs?.pagination?.total || 0;

  const isLoading = loadingPending || loadingApproved || loadingIgnored || loadingAll;

  // Mutations (approve, reject, edit)
  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      return await adminApiRequest('POST', `/api/admin/stream/proposals/${id}/status`, {
        status: 'approved',
        reviewedBy: 'admin',
      });
    },
    onMutate: async (proposalId) => {
      await queryClient.cancelQueries({ queryKey: [pendingQueryKey] });
      const prevPending = queryClient.getQueryData([pendingQueryKey]);
      // Optimistically remove proposal from pending tab
      queryClient.setQueryData([pendingQueryKey], (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data
            .map((conv: any) => ({
              ...conv,
              proposals: conv.proposals?.filter((p: any) => p.id.toString() !== proposalId),
            }))
            .filter((conv: any) => conv.proposals?.length > 0),
        };
      });
      return { prevPending };
    },
    onError: (error: Error, _id, context) => {
      if (context?.prevPending) queryClient.setQueryData([pendingQueryKey], context.prevPending);
      toast({
        title: 'Error',
        description: error.message || 'Failed to approve update.',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [pendingQueryKey] });
      queryClient.invalidateQueries({ queryKey: [changesetQueryKey] });
      queryClient.invalidateQueries({ queryKey: [allQueryKey] });
    },
    onSuccess: () => {
      toast({
        title: 'Update Approved',
        description: 'The proposal has been approved and added to changeset.',
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, currentStatus }: { id: string; currentStatus: string }) => {
      // If currently approved or ignored, reset to pending; otherwise ignore
      const newStatus =
        currentStatus === 'approved' || currentStatus === 'ignored' ? 'pending' : 'ignored';
      return await adminApiRequest('POST', `/api/admin/stream/proposals/${id}/status`, {
        status: newStatus,
        reviewedBy: 'admin',
      });
    },
    onMutate: async ({ id: proposalId, currentStatus }) => {
      // Determine which tab the proposal is currently in
      const sourceKey =
        currentStatus === 'approved'
          ? changesetQueryKey
          : currentStatus === 'ignored'
            ? discardedQueryKey
            : pendingQueryKey;

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
              proposals: conv.proposals?.filter((p: any) => p.id.toString() !== proposalId),
            }))
            .filter((conv: any) => conv.proposals?.length > 0),
        };
      });
      return { prevSource, sourceKey };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.prevSource) queryClient.setQueryData([context.sourceKey], context.prevSource);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update proposal.',
        variant: 'destructive',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [pendingQueryKey] });
      queryClient.invalidateQueries({ queryKey: [changesetQueryKey] });
      queryClient.invalidateQueries({ queryKey: [discardedQueryKey] });
      queryClient.invalidateQueries({ queryKey: [allQueryKey] });
    },
    onSuccess: (_data, variables) => {
      let title, message, variant;

      if (variables.currentStatus === 'approved') {
        title = 'Reset to Pending';
        message = 'The proposal has been moved back to pending.';
        variant = 'default';
      } else if (variables.currentStatus === 'ignored') {
        title = 'Update Reset';
        message = 'The ignored proposal has been reset to pending.';
        variant = 'default';
      } else {
        title = 'Update Rejected';
        message = 'The proposal has been ignored.';
        variant = 'destructive';
      }

      toast({ title, description: message, variant: variant as any });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: { summary?: string; diffAfter?: string };
    }) => {
      // Only update the content text, reasoning/summary is not editable in the backend
      return await adminApiRequest('PATCH', `/api/admin/stream/proposals/${id}`, {
        suggestedText: data.diffAfter || '',
        editedBy: 'admin',
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [pendingQueryKey] });
      queryClient.invalidateQueries({ queryKey: [changesetQueryKey] });
      queryClient.invalidateQueries({ queryKey: [allQueryKey] });
    },
    onSuccess: () => {
      toast({
        title: 'Update Edited',
        description: 'The change proposal has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to edit update.',
        variant: 'destructive',
      });
    },
  });

  // Save ruleset feedback for quality improvement
  const feedbackMutation = useMutation({
    mutationFn: async (feedback: ProposalFeedback) => {
      return await adminApiRequest('POST', `${apiPrefix}/api/admin/quality/feedback`, {
        proposalId: feedback.proposalId,
        action: feedback.action,
        feedbackText: feedback.feedbackText,
        useForImprovement: feedback.useForImprovement,
      });
    },
    onSuccess: () => {
      // Feedback saved silently - no toast unless user wants it
    },
    onError: (error: Error) => {
      console.error('Failed to save feedback:', error);
      // Silent failure - feedback is optional enhancement
    },
  });

  const handleFeedback = (feedback: ProposalFeedback) => {
    if (feedback.feedbackText.trim() || feedback.useForImprovement) {
      feedbackMutation.mutate(feedback);
    }
  };

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
      queryClient.invalidateQueries({ queryKey: ['/api/docs/git-stats'] });
    },
    onError: (error: Error) => {
      if (error.message.includes('401') || error.message.includes('403')) {
        sessionStorage.removeItem('admin_token');
        setLocation('/login');
      } else {
        toast({
          title: 'Sync Failed',
          description: error.message || 'Failed to sync documentation.',
          variant: 'destructive',
        });
      }
    },
  });

  // Pull messages from streams (Zulip, Telegram)
  const pullMessagesMutation = useMutation({
    mutationFn: async () => {
      const prefix = getInstancePrefix();
      setProcessingOverlay({
        visible: true,
        title: 'Pulling Messages',
        message: 'Fetching streams configuration...',
      });

      // Get available streams and pull from each
      const streamsResponse = await adminApiRequest('GET', `${prefix}/api/admin/stream/streams`);
      const streamsData = await streamsResponse.json();

      // API returns array directly, not { streams: [...] }
      const streams = Array.isArray(streamsData) ? streamsData : streamsData.streams || [];
      const enabledStreams = streams.filter((s: any) => s.enabled);

      let totalImported = 0;
      for (let i = 0; i < enabledStreams.length; i++) {
        const stream = enabledStreams[i];
        setProcessingOverlay({
          visible: true,
          title: 'Pulling Messages',
          message: `Pulling from ${stream.streamId || stream.stream_id}...`,
          progress: { current: i, total: enabledStreams.length },
        });

        const response = await adminApiRequest('POST', `${prefix}/api/admin/stream/process`, {
          streamId: stream.streamId || stream.stream_id,
          batchSize: 100,
        });
        const result = await response.json();
        totalImported += result.imported || 0;
      }
      return { totalImported, streamCount: enabledStreams.length, totalStreams: streams.length };
    },
    onSuccess: (data) => {
      setProcessingOverlay({
        visible: true,
        title: 'Pulling Messages',
        message: `Done! Imported ${data.totalImported} messages from ${data.streamCount} streams.`,
      });
      setTimeout(() => {
        setProcessingOverlay({ visible: false, title: '', message: '' });
      }, 2000);
      toast({
        title: 'Messages Pulled',
        description: `Imported ${data.totalImported} new messages from ${data.streamCount} enabled streams.`,
      });
      refetchStreamStats();
    },
    onError: (error: Error) => {
      setProcessingOverlay({ visible: false, title: '', message: '' });
      toast({
        title: 'Pull Failed',
        description: error.message || 'Failed to pull messages from streams.',
        variant: 'destructive',
      });
    },
  });

  // Process messages to generate proposals
  const processMessagesMutation = useMutation({
    mutationFn: async () => {
      const prefix = getInstancePrefix();
      const queued = streamStats?.queued || 0;
      setProcessingOverlay({
        visible: true,
        title: 'Processing Messages',
        message: `Starting to process ${queued} messages with AI...`,
        progress: { current: 0, total: queued },
      });

      const response = await adminApiRequest(
        'POST',
        `${prefix}/api/admin/stream/process-batch`,
        {}
      );
      return await response.json();
    },
    onSuccess: (data) => {
      setProcessingOverlay({
        visible: true,
        title: 'Processing Messages',
        message: `Done! Processed ${data.messagesProcessed || 0} messages. New proposals generated.`,
      });
      setTimeout(() => {
        setProcessingOverlay({ visible: false, title: '', message: '' });
      }, 2000);
      toast({
        title: 'Processing Complete',
        description: `Processed ${data.messagesProcessed || 0} messages. Check proposals for new suggestions.`,
      });
      refetchStreamStats();
      queryClient.invalidateQueries({
        queryKey: [pendingQueryKey],
      });
      queryClient.invalidateQueries({
        queryKey: [changesetQueryKey],
      });
    },
    onError: (error: Error) => {
      setProcessingOverlay({ visible: false, title: '', message: '' });
      toast({
        title: 'Processing Failed',
        description: error.message || 'Failed to process messages.',
        variant: 'destructive',
      });
    },
  });

  const handleSyncDocs = () => {
    syncDocsMutation.mutate(false);
  };

  const handleApprove = (id: string) => approveMutation.mutate(id);
  const handleReject = (id: string, currentStatus: string) =>
    rejectMutation.mutate({ id, currentStatus });
  const handleEdit = (id: string, data: { summary?: string; diffAfter?: string }) => {
    editMutation.mutate({ id, data });
  };
  const handleViewContext = (context: any) => {
    setSelectedConversation(context);
    setConversationModalOpen(true);
  };
  const handleGeneratePR = () => {
    if (approvedCount === 0) {
      toast({
        title: 'No Approved Changes',
        description: 'Please approve some changes before generating a PR.',
        variant: 'destructive',
      });
      return;
    }
    setPrModalOpen(true);
  };
  const handlePRSubmit = async (prData: PRSubmitData) => {
    // Extract proposal IDs from all approved conversations
    const proposalIds: number[] = [];
    approvedConversations.forEach((conv: any) => {
      conv.proposals?.forEach((proposal: any) => {
        if (proposal.status === 'approved') {
          proposalIds.push(proposal.id);
        }
      });
    });

    if (proposalIds.length === 0) {
      toast({
        title: 'No Proposals',
        description: 'No approved proposals found.',
        variant: 'destructive',
      });
      return;
    }

    // Step 1: Create a draft batch
    const batchResponse = await adminApiRequest('POST', `${apiPrefix}/api/admin/stream/batches`, {
      proposalIds,
    });
    const batchData = (await batchResponse.json()) as { batch: { id: number } };

    // Step 2: Generate PR from the batch
    await adminApiRequest(
      'POST',
      `${apiPrefix}/api/admin/stream/batches/${batchData.batch.id}/generate-pr`,
      {
        ...prData,
        proposalIds,
      }
    );

    queryClient.invalidateQueries({ queryKey: [pendingQueryKey] });
    queryClient.invalidateQueries({ queryKey: [changesetQueryKey] });
    queryClient.invalidateQueries({ queryKey: [discardedQueryKey] });
    queryClient.invalidateQueries({ queryKey: [allQueryKey] });
    setPrModalOpen(false);
    toast({
      title: 'Pull Request Created',
      description: 'Your PR has been created successfully as a draft.',
    });
  };

  const formatTimestamp = (timestamp: Date | string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
    if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
  };

  // Pagination controls component
  const PaginationControls = ({
    currentPage,
    totalPages,
    totalItems,
    onPageChange,
  }: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    onPageChange: (page: number) => void;
  }) => {
    if (totalPages <= 1) return null;

    return (
      <div className="flex items-center justify-between border-t border-gray-200 pt-4 mt-4">
        <span className="text-sm text-gray-600">
          Showing {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, totalItems)}-
          {Math.min(currentPage * ITEMS_PER_PAGE, totalItems)} of {totalItems} conversations
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="border-gray-300"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-gray-700 px-2">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="border-gray-300"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <p className="text-gray-500">Loading updates...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="container px-6 md:px-8 flex-1 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1
                className="text-3xl font-bold tracking-tight mb-2 text-gray-900"
                data-testid="heading-admin"
              >
                Admin Dashboard
              </h1>
              <p className="text-gray-600">Review and manage AI-suggested documentation updates</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Quality Tools */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`${apiPrefix}/admin/ruleset`)}
                className="border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <FileCode className="h-4 w-4 mr-2" />
                Rulesets
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`${apiPrefix}/admin/pipeline`)}
                className="border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <Play className="h-4 w-4 mr-2" />
                Pipeline Debugger
              </Button>
              <div className="h-6 w-px bg-gray-300 mx-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation('/logout')}
                className="border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>

          {/* Control Panel */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            {/* Source Info */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 text-sm">
                <GitBranch className="h-4 w-4 text-gray-500" />
                <span className="text-gray-600">Source:</span>
                {gitStats?.gitUrl ? (
                  <>
                    <a
                      href={gitStats.gitUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      {gitStats.gitUrl.replace('https://github.com/', '')}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    {gitStats.branch && (
                      <>
                        <span className="text-gray-400">|</span>
                        <span className="font-medium text-gray-700">{gitStats.branch}</span>
                      </>
                    )}
                  </>
                ) : (
                  <span className="text-gray-400 italic">Not configured</span>
                )}
              </div>
              {gitStats?.totalDocuments !== undefined && gitStats.totalDocuments > 0 && (
                <span className="text-sm text-gray-500 bg-white px-2 py-1 rounded border border-gray-200">
                  {gitStats.totalDocuments} docs indexed
                </span>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                size="sm"
                onClick={handleSyncDocs}
                disabled={
                  syncDocsMutation.isPending ||
                  processingOverlay.visible ||
                  streamStats?.is_processing
                }
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${syncDocsMutation.isPending ? 'animate-spin' : ''}`}
                />
                {syncDocsMutation.isPending ? 'Syncing...' : 'Sync Docs'}
              </Button>

              <div className="h-6 w-px bg-gray-300" />

              <Button
                size="sm"
                variant="outline"
                onClick={() => pullMessagesMutation.mutate()}
                disabled={
                  pullMessagesMutation.isPending ||
                  processingOverlay.visible ||
                  streamStats?.is_processing
                }
                className="border-gray-300"
              >
                <Download
                  className={`h-4 w-4 mr-2 ${pullMessagesMutation.isPending ? 'animate-pulse' : ''}`}
                />
                {pullMessagesMutation.isPending ? 'Pulling...' : 'Pull Messages'}
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() => processMessagesMutation.mutate()}
                disabled={
                  processMessagesMutation.isPending ||
                  processingOverlay.visible ||
                  streamStats?.is_processing
                }
                className="border-gray-300"
              >
                <Cpu
                  className={`h-4 w-4 mr-2 ${processMessagesMutation.isPending || streamStats?.is_processing ? 'animate-pulse' : ''}`}
                />
                {streamStats?.is_processing
                  ? 'Processing...'
                  : processMessagesMutation.isPending
                    ? 'Starting...'
                    : 'Process Messages'}
              </Button>

              <div className="h-6 w-px bg-gray-300" />

              <Button
                size="sm"
                onClick={handleGeneratePR}
                disabled={
                  approvedCount === 0 || processingOverlay.visible || streamStats?.is_processing
                }
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <GitPullRequest className="h-4 w-4 mr-2" />
                Generate PR ({approvedCount} approved)
              </Button>

              {/* Processing status indicator */}
              {(streamStats?.is_processing ||
                pullMessagesMutation.isPending ||
                processMessagesMutation.isPending) && (
                <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 px-3 py-1.5 rounded-md border border-amber-200">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>
                    {streamStats?.is_processing
                      ? `Processing ${streamStats.queued || 0} messages...`
                      : 'Working...'}
                  </span>
                </div>
              )}

              {/* Queue stats */}
              {streamStats && !streamStats.is_processing && streamStats.queued > 0 && (
                <span className="text-sm text-gray-500">{streamStats.queued} messages queued</span>
              )}
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-6 mb-8 md:grid-cols-4">
          <StatsCard
            title="Total Updates"
            value={totalCount}
            icon={FileText}
            description="All proposals"
          />
          <StatsCard
            title="Pending Review"
            value={pendingCount}
            icon={Clock}
            description="Awaiting approval"
          />
          <StatsCard
            title="Approved"
            value={approvedCount}
            icon={CheckCircle2}
            description="Ready for PR"
          />
          <StatsCard
            title="Ignored"
            value={ignoredCount}
            icon={XCircle}
            description="Rejected proposals"
          />
        </div>

        {/* Search */}
        <div className="flex gap-2 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search proposals and messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && executeSearch()}
              className="w-full pl-10 pr-10 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={executeSearch}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
          >
            Search
          </button>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="pending" className="space-y-6">
          <TabsList className="bg-gray-100 border-gray-200">
            <TabsTrigger
              value="pending"
              data-testid="tab-pending"
              className="text-gray-700 data-[state=active]:bg-white data-[state=active]:text-gray-900"
            >
              Pending ({pendingCount})
            </TabsTrigger>
            <TabsTrigger
              value="approved"
              data-testid="tab-approved"
              className="text-gray-700 data-[state=active]:bg-white data-[state=active]:text-gray-900"
            >
              Approved ({approvedCount})
            </TabsTrigger>
            <TabsTrigger
              value="ignored"
              data-testid="tab-ignored"
              className="text-gray-700 data-[state=active]:bg-white data-[state=active]:text-gray-900"
            >
              Ignored ({ignoredCount})
            </TabsTrigger>
            <TabsTrigger
              value="all"
              data-testid="tab-all"
              className="text-gray-700 data-[state=active]:bg-white data-[state=active]:text-gray-900"
            >
              All Updates ({totalCount})
            </TabsTrigger>
            <TabsTrigger
              value="history"
              data-testid="tab-history"
              className="text-gray-700 data-[state=active]:bg-white data-[state=active]:text-gray-900"
            >
              PR History ({batchHistory?.batches?.length || 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-6">
            {pendingConversations.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">No pending updates</p>
              </div>
            ) : (
              <>
                {pendingConversations.map((conv: any) => (
                  <Card key={conv.conversation_id} className="bg-white border-gray-200">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-500">Conversation</span>
                          <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                            {conv.conversation_id.substring(0, 8)}
                          </span>
                          <span className="text-xs text-gray-500">•</span>
                          <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                            {conv.proposals?.length || 0} proposal
                            {conv.proposals?.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleViewContext({
                              conversation_id: conv.conversation_id,
                              category: conv.category,
                              messages: conv.messages || [],
                            })
                          }
                          className="text-xs border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          <MessageSquare className="mr-1 h-3 w-3" />
                          View Conversation Context
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {conv.proposals?.map((proposal: any) => (
                        <UpdateCard
                          key={proposal.id}
                          id={proposal.id.toString()}
                          type={
                            proposal.update_type === 'INSERT'
                              ? 'add'
                              : proposal.update_type === 'DELETE'
                                ? 'delete'
                                : proposal.update_type === 'UPDATE'
                                  ? 'major'
                                  : 'minor'
                          }
                          section={proposal.page || 'Unknown section'}
                          summary={proposal.reasoning || 'Documentation update'}
                          source={`${conv.category || 'Chat'}`}
                          timestamp={formatTimestamp(proposal.created_at || conv.created_at)}
                          status={
                            proposal.status === 'approved'
                              ? 'approved'
                              : proposal.status === 'ignored'
                                ? 'rejected'
                                : 'pending'
                          }
                          diff={{
                            before: '',
                            after: proposal.edited_text || proposal.suggested_text || '',
                          }}
                          gitUrl={gitStats?.gitUrl}
                          enrichment={proposal.enrichment}
                          onApprove={handleApprove}
                          onReject={(id) => handleReject(id, proposal.status)}
                          onEdit={handleEdit}
                          onFeedback={handleFeedback}
                        />
                      ))}
                    </CardContent>
                  </Card>
                ))}
                <PaginationControls
                  currentPage={pendingPage}
                  totalPages={pendingConvs?.pagination?.totalPages || 1}
                  totalItems={pendingCount}
                  onPageChange={setPendingPage}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="approved" className="space-y-6">
            {approvedConversations.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">No approved updates</p>
              </div>
            ) : (
              <>
                {approvedConversations.map((conv: any) => (
                  <Card key={conv.conversation_id} className="bg-white border-gray-200">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-500">Conversation</span>
                          <span className="text-xs font-mono bg-green-50 text-green-700 px-2 py-0.5 rounded">
                            {conv.conversation_id.substring(0, 8)}
                          </span>
                          <span className="text-xs text-gray-500">•</span>
                          <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                            {conv.proposals?.length || 0} proposal
                            {conv.proposals?.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleViewContext({
                              conversation_id: conv.conversation_id,
                              category: conv.category,
                              messages: conv.messages || [],
                            })
                          }
                          className="text-xs border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          <MessageSquare className="mr-1 h-3 w-3" />
                          View Conversation Context
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {conv.proposals?.map((proposal: any) => (
                        <UpdateCard
                          key={proposal.id}
                          id={proposal.id.toString()}
                          type={
                            proposal.update_type === 'INSERT'
                              ? 'add'
                              : proposal.update_type === 'DELETE'
                                ? 'delete'
                                : proposal.update_type === 'UPDATE'
                                  ? 'major'
                                  : 'minor'
                          }
                          section={proposal.page || 'Unknown section'}
                          summary={proposal.reasoning || 'Documentation update'}
                          source={`${conv.category || 'Chat'}`}
                          timestamp={formatTimestamp(proposal.created_at || conv.created_at)}
                          status={
                            proposal.status === 'approved'
                              ? 'approved'
                              : proposal.status === 'ignored'
                                ? 'rejected'
                                : 'pending'
                          }
                          diff={{
                            before: '',
                            after: proposal.edited_text || proposal.suggested_text || '',
                          }}
                          gitUrl={gitStats?.gitUrl}
                          enrichment={proposal.enrichment}
                          onEdit={handleEdit}
                          onReject={(id) => handleReject(id, proposal.status)}
                          onFeedback={handleFeedback}
                        />
                      ))}
                    </CardContent>
                  </Card>
                ))}
                <PaginationControls
                  currentPage={approvedPage}
                  totalPages={approvedConvs?.pagination?.totalPages || 1}
                  totalItems={approvedCount}
                  onPageChange={setApprovedPage}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="ignored" className="space-y-6">
            {ignoredConversations.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">No ignored updates</p>
              </div>
            ) : (
              <>
                {ignoredConversations.map((conv: any) => (
                  <Card key={conv.conversation_id} className="bg-white border-gray-200">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-500">Conversation</span>
                          <span className="text-xs font-mono bg-gray-50 text-gray-700 px-2 py-0.5 rounded">
                            {conv.conversation_id.substring(0, 8)}
                          </span>
                          <span className="text-xs text-gray-500">•</span>
                          <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                            {conv.proposals?.length || 0} proposal
                            {conv.proposals?.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleViewContext({
                              conversation_id: conv.conversation_id,
                              category: conv.category,
                              messages: conv.messages || [],
                            })
                          }
                          className="text-xs border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          <MessageSquare className="mr-1 h-3 w-3" />
                          View Conversation Context
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {conv.proposals?.map((proposal: any) => (
                        <UpdateCard
                          key={proposal.id}
                          id={proposal.id.toString()}
                          type={
                            proposal.update_type === 'INSERT'
                              ? 'add'
                              : proposal.update_type === 'DELETE'
                                ? 'delete'
                                : proposal.update_type === 'UPDATE'
                                  ? 'major'
                                  : 'minor'
                          }
                          section={proposal.page || 'Unknown section'}
                          summary={proposal.reasoning || 'Documentation update'}
                          source={`${conv.category || 'Chat'}`}
                          timestamp={formatTimestamp(proposal.created_at || conv.created_at)}
                          status={
                            proposal.status === 'approved'
                              ? 'approved'
                              : proposal.status === 'ignored'
                                ? 'rejected'
                                : 'pending'
                          }
                          diff={{
                            before: '',
                            after: proposal.edited_text || proposal.suggested_text || '',
                          }}
                          gitUrl={gitStats?.gitUrl}
                          enrichment={proposal.enrichment}
                          onReject={(id) => handleReject(id, proposal.status)}
                          onFeedback={handleFeedback}
                        />
                      ))}
                    </CardContent>
                  </Card>
                ))}
                <PaginationControls
                  currentPage={ignoredPage}
                  totalPages={ignoredConvs?.pagination?.totalPages || 1}
                  totalItems={ignoredCount}
                  onPageChange={setIgnoredPage}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="all" className="space-y-6">
            {allConversations.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500">No updates</p>
              </div>
            ) : (
              <>
                {allConversations.map((conv: any) => (
                  <Card key={conv.conversation_id} className="bg-white border-gray-200">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-gray-500">Conversation</span>
                          <span className="text-xs font-mono bg-gray-50 text-gray-700 px-2 py-0.5 rounded">
                            {conv.conversation_id.substring(0, 8)}
                          </span>
                          <span className="text-xs text-gray-500">•</span>
                          <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                            {conv.proposals?.length || 0} proposal
                            {conv.proposals?.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleViewContext({
                              conversation_id: conv.conversation_id,
                              category: conv.category,
                              messages: conv.messages || [],
                            })
                          }
                          className="text-xs border-gray-300 text-gray-700 hover:bg-gray-50"
                        >
                          <MessageSquare className="mr-1 h-3 w-3" />
                          View Conversation Context
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {conv.proposals?.map((proposal: any) => (
                        <UpdateCard
                          key={proposal.id}
                          id={proposal.id.toString()}
                          type={
                            proposal.update_type === 'INSERT'
                              ? 'add'
                              : proposal.update_type === 'DELETE'
                                ? 'delete'
                                : proposal.update_type === 'UPDATE'
                                  ? 'major'
                                  : 'minor'
                          }
                          section={proposal.page || 'Unknown section'}
                          summary={proposal.reasoning || 'Documentation update'}
                          source={`${conv.category || 'Chat'}`}
                          timestamp={formatTimestamp(proposal.created_at || conv.created_at)}
                          status={
                            proposal.status === 'approved'
                              ? 'approved'
                              : proposal.status === 'ignored'
                                ? 'rejected'
                                : 'pending'
                          }
                          diff={{
                            before: '',
                            after: proposal.edited_text || proposal.suggested_text || '',
                          }}
                          gitUrl={gitStats?.gitUrl}
                          enrichment={proposal.enrichment}
                          onApprove={proposal.status === 'pending' ? handleApprove : undefined}
                          onReject={(id) => handleReject(id, proposal.status)}
                          onEdit={proposal.status !== 'ignored' ? handleEdit : undefined}
                          onFeedback={handleFeedback}
                        />
                      ))}
                    </CardContent>
                  </Card>
                ))}
                <PaginationControls
                  currentPage={allPage}
                  totalPages={allConvs?.pagination?.totalPages || 1}
                  totalItems={totalCount}
                  onPageChange={setAllPage}
                />
              </>
            )}
          </TabsContent>

          {/* PR HISTORY TAB */}
          <TabsContent value="history" className="space-y-4">
            {!batchHistory?.batches?.length ? (
              <div className="text-center py-12">
                <p className="text-gray-500">
                  No pull requests generated yet. Create your first PR from the Approved tab!
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {batchHistory.batches.map((batch: any) => (
                  <Card key={batch.id} className="bg-white border-gray-200">
                    <CardContent className="p-6 space-y-4">
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
                            {batch.proposals?.filter(
                              (p: any) => p.prApplicationStatus === 'success'
                            ).length || batch.totalProposals}
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
                            <span className="font-semibold">Target:</span>{' '}
                            {batch.targetRepo || 'N/A'}
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
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Conversation Context Modal */}
        <Dialog open={conversationModalOpen} onOpenChange={setConversationModalOpen}>
          <DialogContent className="max-w-[95vw] max-h-[80vh] overflow-y-auto bg-white [&>button]:text-gray-900 [&>button]:hover:bg-gray-100">
            <DialogHeader>
              <DialogTitle className="text-gray-900">Conversation Context</DialogTitle>
              <DialogDescription className="text-gray-600">
                Messages that led to this documentation suggestion
              </DialogDescription>
            </DialogHeader>

            {selectedConversation && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">Category:</span>
                  <span className="text-sm bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    {selectedConversation.category}
                  </span>
                  <span className="text-xs text-gray-500 ml-auto font-mono">
                    {selectedConversation.conversation_id}
                  </span>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-gray-900">
                    Messages ({selectedConversation.messages.length})
                  </h4>
                  {selectedConversation.messages.map((msg: any, idx: number) => (
                    <div
                      key={msg.id || idx}
                      className="bg-gray-50 p-4 rounded border border-gray-200"
                    >
                      <div className="flex items-center gap-2 text-sm mb-2">
                        <span className="font-medium text-gray-900">{msg.author}</span>
                        <span className="text-gray-400">•</span>
                        <span className="text-gray-600">{msg.channel}</span>
                        <span className="text-gray-400">•</span>
                        <span className="text-gray-600">
                          {new Date(msg.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* PR Preview Modal */}
        <PRPreviewModal
          isOpen={prModalOpen}
          onClose={() => setPrModalOpen(false)}
          approvedProposals={(() => {
            const proposals: any[] = [];
            approvedConversations.forEach((conv: any) => {
              conv.proposals?.forEach((proposal: any) => {
                if (proposal.status === 'approved') {
                  proposals.push({
                    ...proposal,
                    id: proposal.id,
                    page: proposal.page,
                    suggested_text: proposal.suggested_text || proposal.edited_text,
                  });
                }
              });
            });
            return proposals;
          })()}
          onSubmit={handlePRSubmit}
        />

        {/* Processing Overlay - Blocks UI during operations */}
        {processingOverlay.visible && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 text-center">
              <div className="mb-4">
                <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                {processingOverlay.title}
              </h3>
              <p className="text-gray-600 mb-4">{processingOverlay.message}</p>
              {processingOverlay.progress && processingOverlay.progress.total > 0 && (
                <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
                  <div
                    className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, (processingOverlay.progress.current / processingOverlay.progress.total) * 100)}%`,
                    }}
                  />
                </div>
              )}
              {processingOverlay.progress && (
                <p className="text-sm text-gray-500">
                  {processingOverlay.progress.current} / {processingOverlay.progress.total}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Scroll to top/bottom buttons */}
        {showScrollButtons && (
          <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50">
            <Button
              variant="outline"
              size="icon"
              onClick={scrollToTop}
              className="bg-white shadow-lg hover:bg-gray-50 border-gray-300"
              title="Scroll to top"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={scrollToBottom}
              className="bg-white shadow-lg hover:bg-gray-50 border-gray-300"
              title="Scroll to bottom"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
