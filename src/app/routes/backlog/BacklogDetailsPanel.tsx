import type { BacklogItem } from '@/types/workflow';
import { Button } from '@/components/ui/primitives';

interface BacklogDetailsPanelProps {
  item: BacklogItem;
  onClose: () => void;
  onCreateLinkedWorkflow: (backlogItemId: string) => void;
  onOpenLinkedWorkflow: (workflowId: string) => void;
  isCreatingLinkedWorkflow: boolean;
  createLinkedWorkflowError?: string | null;
  linkedWorkflowFeedback?: string | null;
}

export function BacklogDetailsPanel({
  item,
  onClose,
  onCreateLinkedWorkflow,
  onOpenLinkedWorkflow,
  isCreatingLinkedWorkflow,
  createLinkedWorkflowError,
  linkedWorkflowFeedback,
}: BacklogDetailsPanelProps) {
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

      <div className="mb-4 space-y-2">
        {item.linked_workflow_id ? (
          <Button
            onClick={() => onOpenLinkedWorkflow(item.linked_workflow_id!)}
            className="w-full"
          >
            Open Linked Workflow
          </Button>
        ) : (
          <Button
            onClick={() => onCreateLinkedWorkflow(item.id)}
            disabled={isCreatingLinkedWorkflow}
            className="w-full"
          >
            {isCreatingLinkedWorkflow ? 'Creating Workflow...' : 'Create Linked Workflow'}
          </Button>
        )}
        {linkedWorkflowFeedback ? (
          <p className="text-xs text-green-300" role="status">{linkedWorkflowFeedback}</p>
        ) : null}
        {createLinkedWorkflowError ? (
          <p className="text-xs text-red-300" role="alert">{createLinkedWorkflowError}</p>
        ) : null}
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
          <dt className="text-gray-400">Resolution Guidelines (Markdown)</dt>
          <dd className="text-gray-200">
            {item.resolution_guidelines_md ? (
              <pre className="mt-1 max-h-64 overflow-y-auto rounded border border-gray-700 bg-gray-950/70 p-3 text-xs whitespace-pre-wrap break-words">
                {item.resolution_guidelines_md}
              </pre>
            ) : (
              'Not generated yet'
            )}
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
