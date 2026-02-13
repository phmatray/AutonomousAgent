import type { BacklogItem } from '@/types/workflow';

interface BacklogDetailsPanelProps {
  item: BacklogItem;
  onClose: () => void;
}

export function BacklogDetailsPanel({ item, onClose }: BacklogDetailsPanelProps) {
  return (
    <aside
      className="w-full lg:w-96 lg:min-w-96 bg-gray-900 border border-gray-700 rounded-lg p-4 h-fit"
      aria-label={`Backlog item ${item.issue_number} details`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs text-gray-400 font-mono">
            #{item.issue_number} - {item.owner}/{item.repo}
          </p>
          <h2 className="text-lg font-semibold text-white mt-1">{item.title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-white transition-colors focus:outline-none focus:underline"
          aria-label="Close backlog details"
        >
          Close
        </button>
      </div>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-gray-400">Repository</dt>
          <dd className="text-gray-200 font-mono">{item.owner}/{item.repo}</dd>
        </div>
        <div>
          <dt className="text-gray-400">State</dt>
          <dd className="text-gray-200">{item.state}</dd>
        </div>
        <div>
          <dt className="text-gray-400">Labels</dt>
          <dd className="text-gray-200">
            {item.labels.length > 0 ? item.labels.join(', ') : 'None'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-400">Assignees</dt>
          <dd className="text-gray-200">
            {item.assignees.length > 0 ? item.assignees.join(', ') : 'None'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-400">Linked Workflow</dt>
          <dd className="text-gray-200 font-mono">
            {item.linked_workflow_id ?? 'Not linked'}
          </dd>
        </div>
        <div>
          <dt className="text-gray-400">Body</dt>
          <dd className="text-gray-200 whitespace-pre-wrap break-words max-h-64 overflow-y-auto pr-1">
            {item.body?.trim() || 'No description provided.'}
          </dd>
        </div>
      </dl>

      <a
        href={item.html_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex mt-4 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
      >
        Open on GitHub
      </a>
    </aside>
  );
}
