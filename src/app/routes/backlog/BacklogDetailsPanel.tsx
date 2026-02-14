import type {
  BacklogEffort,
  BacklogImpact,
  BacklogItem,
  BacklogPriority,
  BacklogTriageStatus,
} from '@/types/workflow';
import { Badge, Button } from '@/components/ui/primitives';

interface BacklogDetailsPanelProps {
  item: BacklogItem;
  onClose: () => void;
  onCreateLinkedWorkflow: (backlogItemId: string) => void;
  onOpenLinkedWorkflow: (workflowId: string) => void;
  onUpdateTriage: (
    backlogItemId: string,
    patch: {
      triageStatus?: BacklogTriageStatus;
      priority?: BacklogPriority;
      effort?: BacklogEffort;
      impact?: BacklogImpact;
      rank?: number;
    },
  ) => void;
  isCreatingLinkedWorkflow: boolean;
  isUpdatingTriage: boolean;
  createLinkedWorkflowError?: string | null;
  linkedWorkflowFeedback?: string | null;
}

export function BacklogDetailsPanel({
  item,
  onClose,
  onCreateLinkedWorkflow,
  onOpenLinkedWorkflow,
  onUpdateTriage,
  isCreatingLinkedWorkflow,
  isUpdatingTriage,
  createLinkedWorkflowError,
  linkedWorkflowFeedback,
}: BacklogDetailsPanelProps) {
  const updatedDate = new Date(item.updated_at);
  const updatedLabel = Number.isNaN(updatedDate.getTime())
    ? item.updated_at
    : new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(updatedDate);

  return (
    <aside
      className="w-full lg:w-96 lg:min-w-96 bg-gray-900 border border-gray-700 rounded-lg p-4 h-fit lg:sticky lg:top-4"
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

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge tone="info">{item.triage_status}</Badge>
        <Badge tone={item.priority === 'critical' || item.priority === 'high' ? 'warning' : 'default'}>
          {item.priority}
        </Badge>
        <Badge>effort: {item.effort}</Badge>
        <Badge>impact: {item.impact}</Badge>
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

      <div className="mb-4 grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-300">
          Triage
          <select
            disabled={isUpdatingTriage}
            value={item.triage_status}
            onChange={(event) => onUpdateTriage(item.id, {
              triageStatus: event.target.value as BacklogTriageStatus,
            })}
            className="mt-1 h-8 w-full rounded border border-gray-700 bg-gray-800 px-2 text-xs text-white"
          >
            <option value="inbox">Inbox</option>
            <option value="ready">Ready</option>
            <option value="in_progress">In Progress</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
          </select>
        </label>
        <label className="text-xs text-gray-300">
          Priority
          <select
            disabled={isUpdatingTriage}
            value={item.priority}
            onChange={(event) => onUpdateTriage(item.id, {
              priority: event.target.value as BacklogPriority,
            })}
            className="mt-1 h-8 w-full rounded border border-gray-700 bg-gray-800 px-2 text-xs text-white"
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="text-xs text-gray-300">
          Effort
          <select
            disabled={isUpdatingTriage}
            value={item.effort}
            onChange={(event) => onUpdateTriage(item.id, {
              effort: event.target.value as BacklogEffort,
            })}
            className="mt-1 h-8 w-full rounded border border-gray-700 bg-gray-800 px-2 text-xs text-white"
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
        <label className="text-xs text-gray-300">
          Impact
          <select
            disabled={isUpdatingTriage}
            value={item.impact}
            onChange={(event) => onUpdateTriage(item.id, {
              impact: event.target.value as BacklogImpact,
            })}
            className="mt-1 h-8 w-full rounded border border-gray-700 bg-gray-800 px-2 text-xs text-white"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
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
          <dt className="text-gray-400">Updated</dt>
          <dd className="text-gray-200">{updatedLabel}</dd>
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
