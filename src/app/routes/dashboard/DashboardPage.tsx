import { useQuery } from '@tanstack/react-query';
import { listWorkflows } from '@/lib/api/workflow';
import type { Workflow } from '@/types/workflow';

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-900 text-green-300',
    draft: 'bg-gray-700 text-gray-300',
    error: 'bg-red-900 text-red-300',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? colors.draft}`}
    >
      {status}
    </span>
  );
}

function WorkflowCard({ workflow }: { workflow: Workflow }) {
  return (
    <article
      className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-indigo-500 transition-colors cursor-pointer"
      role="article"
      aria-label={`Workflow: ${workflow.name}`}
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-white font-medium">{workflow.name}</h3>
        <StatusBadge status="draft" />
      </div>
      {workflow.description && (
        <p className="text-sm text-gray-400 mb-3">{workflow.description}</p>
      )}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{workflow.nodes.length} nodes</span>
        <span>v{workflow.version}</span>
      </div>
    </article>
  );
}

function EmptyState({ onNavigateToEditor }: { onNavigateToEditor: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
        <span className="text-2xl text-gray-500" aria-hidden="true">+</span>
      </div>
      <h3 className="text-lg text-white mb-2">No workflows yet</h3>
      <p className="text-sm text-gray-400 mb-4 max-w-sm">
        Create your first autonomous workflow to start automating issue resolution.
      </p>
      <button
        type="button"
        onClick={onNavigateToEditor}
        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        Create Workflow
      </button>
    </div>
  );
}

export function DashboardPage() {
  const {
    data: workflows,
    isLoading,
    error,
  } = useQuery<Workflow[]>({
    queryKey: ['workflows'],
    queryFn: listWorkflows,
    retry: false,
  });

  const navigateToEditor = () => {
    window.location.hash = '#/editor';
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Workflows</h1>
            <p className="text-sm text-gray-400 mt-1">
              Manage your autonomous development workflows
            </p>
          </div>
          <button
            type="button"
            onClick={navigateToEditor}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            New Workflow
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20" role="status" aria-label="Loading workflows">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="sr-only">Loading workflows...</span>
          </div>
        )}

        {error && !isLoading && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 text-center">
            <p className="text-gray-400 mb-2">Could not load workflows</p>
            <p className="text-xs text-gray-500">
              Backend services may not be running. The workflow editor is still available.
            </p>
            <button
              type="button"
              onClick={navigateToEditor}
              className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              Open Editor
            </button>
          </div>
        )}

        {!isLoading && !error && workflows?.length === 0 && (
          <EmptyState onNavigateToEditor={navigateToEditor} />
        )}

        {!isLoading && workflows && workflows.length > 0 && (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            role="list"
            aria-label="Workflow list"
          >
            {workflows.map((wf) => (
              <div key={wf.id} role="listitem">
                <WorkflowCard workflow={wf} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
