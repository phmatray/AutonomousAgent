import type {
  BacklogItem,
  BacklogPriority,
  BacklogTriageStatus,
} from '@/types/workflow';

interface BacklogTableProps {
  items: BacklogItem[];
  selectedItemId?: string | null;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onViewDetails: (itemId: string) => void;
  onRequestDelete: (id: string) => void;
  onUpdateTriage: (
    itemId: string,
    patch: {
      triageStatus?: BacklogTriageStatus;
      priority?: BacklogPriority;
      rank?: number;
    },
  ) => void;
  isDeleting: boolean;
  isUpdatingTriage: boolean;
}

const STATE_STYLES: Record<string, string> = {
  open: 'bg-green-900 text-green-300',
  closed: 'bg-purple-900 text-purple-300',
};

const PRIORITY_STYLES: Record<BacklogPriority, string> = {
  critical: 'text-red-300',
  high: 'text-orange-300',
  medium: 'text-blue-300',
  low: 'text-gray-300',
};

function formatRelativeTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export function BacklogTable({
  items,
  selectedItemId,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onViewDetails,
  onRequestDelete,
  onUpdateTriage,
  isDeleting,
  isUpdatingTriage,
}: BacklogTableProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
          <span className="text-2xl text-gray-500" aria-hidden="true">?</span>
        </div>
        <h3 className="text-lg text-white mb-2">No issues found</h3>
        <p className="text-sm text-gray-400 max-w-sm">
          Select a repository and sync issues from GitHub to populate your backlog.
        </p>
      </div>
    );
  }

  const allSelected = selectedIds.length > 0 && selectedIds.length === items.length;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left" role="table">
        <thead>
          <tr className="border-b border-gray-700 text-gray-400">
            <th className="sticky top-0 bg-gray-900 px-3 py-3 font-medium" scope="col">
              <input
                type="checkbox"
                aria-label="Select all backlog items"
                checked={allSelected}
                onChange={onToggleSelectAll}
                className="h-4 w-4 rounded border-gray-600 bg-gray-800"
              />
            </th>
            <th className="sticky top-0 bg-gray-900 px-3 py-3 font-medium" scope="col">#</th>
            <th className="sticky top-0 bg-gray-900 px-3 py-3 font-medium" scope="col">Title</th>
            <th className="sticky top-0 bg-gray-900 px-3 py-3 font-medium" scope="col">Triage</th>
            <th className="sticky top-0 bg-gray-900 px-3 py-3 font-medium" scope="col">Priority</th>
            <th className="sticky top-0 bg-gray-900 px-3 py-3 font-medium" scope="col">Rank</th>
            <th className="sticky top-0 bg-gray-900 px-3 py-3 font-medium" scope="col">State</th>
            <th className="sticky top-0 bg-gray-900 px-3 py-3 font-medium" scope="col">Updated</th>
            <th className="sticky top-0 bg-gray-900 px-3 py-3 font-medium" scope="col">Linked Workflow</th>
            <th className="sticky top-0 bg-gray-900 px-3 py-3 font-medium" scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <tr
                key={item.id}
                className={`border-b border-gray-800 transition-colors ${
                  selectedItemId === item.id ? 'bg-indigo-950/20' : 'hover:bg-gray-800/50'
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
                tabIndex={0}
                aria-label={`Open details for issue #${item.issue_number}`}
                title="Open issue details"
                onClick={() => onViewDetails(item.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onViewDetails(item.id);
                  }
                }}
              >
                <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleSelect(item.id)}
                    aria-label={`Select issue #${item.issue_number}`}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-800"
                  />
                </td>
                <td className="px-3 py-3 text-gray-400 font-mono">
                  {item.issue_number}
                </td>
                <td className="px-3 py-3 min-w-[260px]">
                  <a
                    href={item.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="text-white hover:text-indigo-400 transition-colors"
                    aria-label={`Issue #${item.issue_number}: ${item.title} (opens in new tab)`}
                  >
                    {item.title}
                  </a>
                  <p className="text-xs font-mono text-gray-500 mt-1">{item.owner}/{item.repo}</p>
                  {item.labels.length > 0 ? (
                    <p className="text-xs text-gray-500 mt-1">
                      {item.labels.slice(0, 3).join(', ')}
                      {item.labels.length > 3 ? ` +${item.labels.length - 3}` : ''}
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                  <select
                    value={item.triage_status}
                    disabled={isUpdatingTriage}
                    onChange={(event) => onUpdateTriage(item.id, {
                      triageStatus: event.target.value as BacklogTriageStatus,
                    })}
                    className="h-8 bg-gray-800 border border-gray-700 rounded px-2 text-xs text-white"
                    aria-label={`Set triage status for issue #${item.issue_number}`}
                  >
                    <option value="inbox">Inbox</option>
                    <option value="ready">Ready</option>
                    <option value="in_progress">In Progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="done">Done</option>
                  </select>
                </td>
                <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                  <select
                    value={item.priority}
                    disabled={isUpdatingTriage}
                    onChange={(event) => onUpdateTriage(item.id, {
                      priority: event.target.value as BacklogPriority,
                    })}
                    className={`h-8 bg-gray-800 border border-gray-700 rounded px-2 text-xs ${PRIORITY_STYLES[item.priority]}`}
                    aria-label={`Set priority for issue #${item.issue_number}`}
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </td>
                <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="number"
                    value={item.rank}
                    disabled={isUpdatingTriage}
                    onChange={(event) => {
                      const rank = Number.parseInt(event.target.value, 10);
                      if (Number.isFinite(rank)) {
                        onUpdateTriage(item.id, { rank });
                      }
                    }}
                    className="h-8 w-20 bg-gray-800 border border-gray-700 rounded px-2 text-xs text-white"
                    aria-label={`Set rank for issue #${item.issue_number}`}
                  />
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATE_STYLES[item.state] ?? 'bg-gray-700 text-gray-300'}`}
                  >
                    {item.state}
                  </span>
                </td>
                <td className="px-3 py-3 text-xs text-gray-400">
                  {formatRelativeTimestamp(item.updated_at)}
                </td>
                <td className="px-3 py-3">
                  {item.linked_workflow_id ? (
                    <span className="text-indigo-400 text-xs font-mono">
                      {item.linked_workflow_id.slice(0, 8)}
                    </span>
                  ) : (
                    <span className="text-gray-600 text-xs">None</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onViewDetails(item.id);
                    }}
                    className="mr-3 text-xs text-indigo-400 hover:text-indigo-300 transition-colors focus:outline-none focus:underline"
                    aria-label={`View issue #${item.issue_number} details`}
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRequestDelete(item.id);
                    }}
                    disabled={isDeleting}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 focus:outline-none focus:underline"
                    aria-label={`Remove issue #${item.issue_number} from backlog`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
