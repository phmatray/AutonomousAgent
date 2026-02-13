import type { BacklogItem } from '@/types/workflow';

interface BacklogTableProps {
  items: BacklogItem[];
  selectedItemId?: string | null;
  onViewDetails: (itemId: string) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

const STATE_STYLES: Record<string, string> = {
  open: 'bg-green-900 text-green-300',
  closed: 'bg-purple-900 text-purple-300',
};

export function BacklogTable({
  items,
  selectedItemId,
  onViewDetails,
  onDelete,
  isDeleting,
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

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left" role="table">
        <thead>
          <tr className="border-b border-gray-700 text-gray-400">
            <th className="px-4 py-3 font-medium" scope="col">#</th>
            <th className="px-4 py-3 font-medium" scope="col">Title</th>
            <th className="px-4 py-3 font-medium" scope="col">Repository</th>
            <th className="px-4 py-3 font-medium" scope="col">State</th>
            <th className="px-4 py-3 font-medium" scope="col">Labels</th>
            <th className="px-4 py-3 font-medium" scope="col">Linked Workflow</th>
            <th className="px-4 py-3 font-medium" scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className={`border-b border-gray-800 transition-colors ${
                selectedItemId === item.id ? 'bg-indigo-950/20' : 'hover:bg-gray-800/50'
              }`}
            >
              <td className="px-4 py-3 text-gray-400 font-mono">
                {item.issue_number}
              </td>
              <td className="px-4 py-3">
                <a
                  href={item.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white hover:text-indigo-400 transition-colors"
                  aria-label={`Issue #${item.issue_number}: ${item.title} (opens in new tab)`}
                >
                  {item.title}
                </a>
              </td>
              <td className="px-4 py-3">
                <span className="text-xs font-mono text-gray-300">
                  {item.owner}/{item.repo}
                </span>
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATE_STYLES[item.state] ?? 'bg-gray-700 text-gray-300'}`}
                >
                  {item.state}
                </span>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {item.labels.map((label) => (
                    <span
                      key={label}
                      className="inline-block px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-300"
                    >
                      {label}
                    </span>
                  ))}
                  {item.labels.length === 0 && (
                    <span className="text-gray-600 text-xs">--</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                {item.linked_workflow_id ? (
                  <span className="text-indigo-400 text-xs font-mono">
                    {item.linked_workflow_id.slice(0, 8)}
                  </span>
                ) : (
                  <span className="text-gray-600 text-xs">None</span>
                )}
              </td>
              <td className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => onViewDetails(item.id)}
                  className="mr-3 text-xs text-indigo-400 hover:text-indigo-300 transition-colors focus:outline-none focus:underline"
                  aria-label={`View issue #${item.issue_number} details`}
                >
                  Details
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  disabled={isDeleting}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 focus:outline-none focus:underline"
                  aria-label={`Remove issue #${item.issue_number} from backlog`}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
