import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { UpdateCard } from '@/components/UpdateCard';
import { StatsCard } from '@/components/StatsCard';
import { FileText, CheckCircle2, Clock } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, adminApiRequest, getQueryFn } from '@/lib/queryClient';
import type { PendingUpdate } from '@shared/schema';

export default function AdminLegacy() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const token = sessionStorage.getItem('admin_token');
    if (!token) {
      setLocation('/admin/login');
    }
  }, [setLocation]);

  const {
    data: updates = [],
    isLoading,
    error,
  } = useQuery<PendingUpdate[]>({
    queryKey: ['/api/updates'],
    queryFn: getQueryFn({ on401: 'throw', requiresAuth: true }),
  });

  useEffect(() => {
    if (error && (error.message.includes('401') || error.message.includes('403'))) {
      sessionStorage.removeItem('admin_token');
      setLocation('/admin/login');
    }
  }, [error, setLocation]);

  const approveMutation = useMutation({
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

  const rejectMutation = useMutation({
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

  const editMutation = useMutation({
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

  const handleApprove = (id: string) => {
    approveMutation.mutate(id);
  };

  const handleReject = (id: string) => {
    rejectMutation.mutate(id);
  };

  const handleEdit = (id: string, data: { summary?: string; diffAfter?: string }) => {
    editMutation.mutate({ id, data });
  };

  const pendingCount = updates.filter((u) => u.status === 'pending').length;
  const approvedCount = updates.filter((u) => u.status === 'approved').length;
  const autoAppliedCount = updates.filter((u) => u.status === 'auto-applied').length;

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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading updates...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="container px-6 md:px-8 flex-1 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight mb-2" data-testid="heading-admin">
            Admin Dashboard (Legacy View)
          </h1>
          <p className="text-muted-foreground">
            Review and manage AI-suggested documentation updates
          </p>
        </div>

        <div className="grid gap-6 mb-8 md:grid-cols-4">
          <StatsCard
            title="Total Updates"
            value={updates.length}
            icon={FileText}
            description="All time"
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
            description="This week"
          />
          <StatsCard
            title="Auto-Applied"
            value={autoAppliedCount}
            icon={CheckCircle2}
            description="Minor changes"
          />
        </div>

        <Tabs defaultValue="pending" className="space-y-6">
          <TabsList>
            <TabsTrigger value="pending" data-testid="tab-pending">
              Pending ({pendingCount})
            </TabsTrigger>
            <TabsTrigger value="approved" data-testid="tab-approved">
              Approved
            </TabsTrigger>
            <TabsTrigger value="auto-applied" data-testid="tab-auto-applied">
              Auto-Applied
            </TabsTrigger>
            <TabsTrigger value="all" data-testid="tab-all">
              All Updates
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-4">
            {updates.filter((u) => u.status === 'pending').length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No pending updates</p>
              </div>
            ) : (
              updates
                .filter((u) => u.status === 'pending')
                .map((update) => (
                  <UpdateCard
                    key={update.id}
                    id={update.id}
                    type={update.type}
                    section={update.sectionId}
                    summary={update.summary}
                    source={update.source}
                    timestamp={formatTimestamp(update.createdAt)}
                    status={update.status}
                    diff={
                      update.diffBefore && update.diffAfter
                        ? { before: update.diffBefore, after: update.diffAfter }
                        : undefined
                    }
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onEdit={handleEdit}
                  />
                ))
            )}
          </TabsContent>

          <TabsContent value="approved" className="space-y-4">
            {updates
              .filter((u) => u.status === 'approved')
              .map((update) => (
                <UpdateCard
                  key={update.id}
                  id={update.id}
                  type={update.type}
                  section={update.sectionId}
                  summary={update.summary}
                  source={update.source}
                  timestamp={formatTimestamp(update.createdAt)}
                  status={update.status}
                  diff={
                    update.diffBefore && update.diffAfter
                      ? { before: update.diffBefore, after: update.diffAfter }
                      : undefined
                  }
                />
              ))}
          </TabsContent>

          <TabsContent value="auto-applied" className="space-y-4">
            {updates
              .filter((u) => u.status === 'auto-applied')
              .map((update) => (
                <UpdateCard
                  key={update.id}
                  id={update.id}
                  type={update.type}
                  section={update.sectionId}
                  summary={update.summary}
                  source={update.source}
                  timestamp={formatTimestamp(update.createdAt)}
                  status={update.status}
                />
              ))}
          </TabsContent>

          <TabsContent value="all" className="space-y-4">
            {updates.map((update) => (
              <UpdateCard
                key={update.id}
                id={update.id}
                type={update.type}
                section={update.sectionId}
                summary={update.summary}
                source={update.source}
                timestamp={formatTimestamp(update.createdAt)}
                status={update.status}
                diff={
                  update.diffBefore && update.diffAfter
                    ? { before: update.diffBefore, after: update.diffAfter }
                    : undefined
                }
                onApprove={update.status === 'pending' ? handleApprove : undefined}
                onReject={update.status === 'pending' ? handleReject : undefined}
              />
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
