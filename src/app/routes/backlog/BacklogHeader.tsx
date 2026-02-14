import { PageHeader } from '@/app/components/PageLayout';
import { Badge, Button } from '@/components/ui/primitives';

interface BacklogHeaderProps {
  itemCount: number;
  selectedCount: number;
  repositoryLabel?: string;
  isSyncing: boolean;
  onSync: () => void;
  syncDisabled: boolean;
}

export function BacklogHeader({
  itemCount,
  selectedCount,
  repositoryLabel,
  isSyncing,
  onSync,
  syncDisabled,
}: BacklogHeaderProps) {
  return (
    <PageHeader
      title="Backlog"
      description={`${itemCount} issue${itemCount !== 1 ? 's' : ''} in queue${selectedCount > 0 ? ` · ${selectedCount} selected` : ''}`}
      metadata={(
        <div className="flex flex-wrap items-center gap-2">
          {repositoryLabel ? <Badge tone="info">{repositoryLabel}</Badge> : <Badge>No repository selected</Badge>}
          <Badge tone={itemCount > 0 ? 'success' : 'default'}>{itemCount} visible</Badge>
          {selectedCount > 0 ? <Badge tone="warning">{selectedCount} selected</Badge> : null}
        </div>
      )}
      actions={(
        <Button
          onClick={onSync}
          disabled={syncDisabled || isSyncing}
          aria-label="Sync issues from GitHub"
        >
          {isSyncing ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" />
              Syncing...
            </span>
          ) : (
            'Sync Issues'
          )}
        </Button>
      )}
    />
  );
}
