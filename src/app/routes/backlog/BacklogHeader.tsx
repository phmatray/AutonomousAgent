import { PageHeader } from '@/app/components/PageLayout';

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
        <button
          type="button"
          onClick={onSync}
          disabled={syncDisabled || isSyncing}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
        </button>
      )}
    />
  );
}
