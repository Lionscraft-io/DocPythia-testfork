import { Header } from '@/components/Header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  GitBranch,
  FileText,
  Database,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface GitStats {
  gitUrl: string;
  branch: string;
  lastSyncAt: string | null;
  lastCommitHash: string | null;
  status: string;
  totalDocuments: number;
  documentsWithEmbeddings: number;
}

export default function Documentation() {
  const [searchQuery, setSearchQuery] = useState<string>('');

  const { data: gitStats, isLoading } = useQuery<GitStats>({
    queryKey: ['/api/docs/git-stats'],
  });

  const extractRepoName = (gitUrl: string): string => {
    try {
      // Extract repo name from URL like "https://github.com/org-name/documentation-repo"
      const parts = gitUrl.split('/');
      const repoWithExt = parts[parts.length - 1];
      const owner = parts[parts.length - 2];
      const repo = repoWithExt.replace('.git', '');
      return `${owner}/${repo}`;
    } catch {
      return gitUrl;
    }
  };

  const formatTimeSince = (dateString: string | null): string => {
    if (!dateString) return 'Never';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
    if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge
            variant="outline"
            className="gap-1 border-green-500 text-green-700 dark:text-green-400"
          >
            <CheckCircle className="h-3 w-3" />
            Synced
          </Badge>
        );
      case 'in-progress':
        return (
          <Badge
            variant="outline"
            className="gap-1 border-blue-500 text-blue-700 dark:text-blue-400"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            Syncing
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="outline" className="gap-1 border-red-500 text-red-700 dark:text-red-400">
            <AlertCircle className="h-3 w-3" />
            Failed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1">
            {status}
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen flex flex-col">
        <Header searchValue={searchQuery} onSearchChange={setSearchQuery} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">Loading documentation statistics...</p>
        </div>
      </div>
    );
  }

  if (!gitStats) {
    return (
      <div className="h-screen flex flex-col">
        <Header searchValue={searchQuery} onSearchChange={setSearchQuery} />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">No documentation data available</p>
        </div>
      </div>
    );
  }

  const repoName = extractRepoName(gitStats.gitUrl);
  const embeddingPercentage =
    gitStats.totalDocuments > 0
      ? Math.round((gitStats.documentsWithEmbeddings / gitStats.totalDocuments) * 100)
      : 0;

  return (
    <div className="h-screen flex flex-col">
      <Header searchValue={searchQuery} onSearchChange={setSearchQuery} />

      <div className="flex-1 overflow-y-auto bg-background">
        <div className="container px-6 md:px-8 py-8">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight mb-2">
              Documentation Sync Statistics
            </h1>
            <p className="text-muted-foreground">
              Real-time statistics for Git-synced documentation repositories
            </p>
          </div>

          {/* Repository Info Card */}
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <GitBranch className="h-5 w-5" />
                    {repoName}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Branch:{' '}
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">{gitStats.branch}</code>
                  </CardDescription>
                </div>
                {getStatusBadge(gitStats.status)}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Repository URL</span>
                  <a
                    href={gitStats.gitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline font-mono text-xs"
                  >
                    {gitStats.gitUrl}
                  </a>
                </div>
                {gitStats.lastCommitHash && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Latest Commit</span>
                    <code className="text-xs bg-muted px-2 py-1 rounded">
                      {gitStats.lastCommitHash.substring(0, 8)}
                    </code>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last Synced</span>
                  <span className="font-medium">{formatTimeSince(gitStats.lastSyncAt)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Statistics Grid */}
          <div className="grid gap-6 md:grid-cols-3 mb-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Documents</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{gitStats.totalDocuments.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground mt-1">Files synced from repository</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Documents with Embeddings</CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {gitStats.documentsWithEmbeddings.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {embeddingPercentage}% of total documents
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Sync Status</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold capitalize">{gitStats.status}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {gitStats.lastSyncAt ? formatTimeSince(gitStats.lastSyncAt) : 'Never synced'}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
