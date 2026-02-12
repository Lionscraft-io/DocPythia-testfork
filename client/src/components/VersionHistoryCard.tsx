import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { SectionVersion } from '@shared/schema';

interface VersionHistoryCardProps {
  version: SectionVersion;
  previousVersion?: SectionVersion;
  onRevert?: (versionId: string) => void;
}

export function VersionHistoryCard({
  version,
  previousVersion,
  onRevert,
}: VersionHistoryCardProps) {
  const [expanded, setExpanded] = useState(false);

  const opConfig: Record<string, { color: string; label: string }> = {
    add: { color: 'bg-chart-2', label: 'Added' },
    edit: { color: 'bg-chart-3', label: 'Edited' },
    delete: { color: 'bg-destructive', label: 'Deleted' },
    rollback: { color: 'bg-chart-4', label: 'Rolled Back' },
  };

  const config = opConfig[version.op] || { color: 'bg-muted', label: 'Unknown' };

  const formatTimestamp = (timestamp: Date | string) => {
    const date = new Date(timestamp);
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={`${config.color} text-white`}
            data-testid={`badge-op-${version.op}`}
          >
            {config.label}
          </Badge>
          <span className="text-sm font-medium" data-testid="text-title">
            {version.title}
          </span>
          <span className="text-xs text-muted-foreground" data-testid="text-timestamp">
            {formatTimestamp(version.createdAt)}
          </span>
          {version.createdBy && (
            <span className="text-xs text-muted-foreground" data-testid="text-created-by">
              by {version.createdBy}
            </span>
          )}
        </div>
        {version.op !== 'delete' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRevert?.(version.id)}
            data-testid={`button-revert-${version.id}`}
          >
            <RotateCcw className="mr-1 h-4 w-4" />
            Revert
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {previousVersion && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              data-testid={`button-toggle-diff-${version.id}`}
              className="text-xs"
            >
              {expanded ? (
                <>
                  <ChevronUp className="mr-1 h-3 w-3" />
                  Hide Changes
                </>
              ) : (
                <>
                  <ChevronDown className="mr-1 h-3 w-3" />
                  Show Changes
                </>
              )}
            </Button>

            {expanded && (
              <div className="mt-2 grid gap-2 rounded-md border p-3 text-xs font-mono md:grid-cols-2">
                <div>
                  <div className="mb-1 font-semibold text-muted-foreground">Previous:</div>
                  <div
                    className="rounded bg-muted p-2 max-h-48 overflow-y-auto"
                    data-testid="text-diff-before"
                  >
                    {previousVersion.content}
                  </div>
                </div>
                <div>
                  <div className="mb-1 font-semibold text-primary">Current:</div>
                  <div
                    className="rounded bg-primary/10 p-2 max-h-48 overflow-y-auto"
                    data-testid="text-diff-after"
                  >
                    {version.content}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {!previousVersion && version.op === 'add' && (
          <div className="text-xs text-muted-foreground">Initial version - no previous content</div>
        )}
      </CardContent>
    </Card>
  );
}
