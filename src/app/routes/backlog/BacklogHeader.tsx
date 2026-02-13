import { PageHeader } from '@/app/components/PageLayout';
import { Button } from '@/components/ui/primitives';

interface BacklogHeaderProps {
  itemCount: number;
  isSyncing: boolean;
  onSync: () => void;
  syncDisabled: boolean;
}

export function BacklogHeader({
  itemCount,
  isSyncing,
  onSync,
  syncDisabled,
}: BacklogHeaderProps) {
  return (
    <PageHeader
      title="Backlog"
      description={`${itemCount} issue${itemCount !== 1 ? 's' : ''} synced from GitHub`}
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
