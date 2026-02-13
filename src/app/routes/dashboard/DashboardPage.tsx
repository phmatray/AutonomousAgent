import { useRouter } from '@/lib/router';
import { Trash2 } from 'lucide-react';
import type { Workflow } from '@/types/workflow';
import { useEffect, useMemo } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useWorkflowCatalogActorRef, WorkflowCatalogContext } from '@/app/state/workflow-catalog-machine';

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

function WorkflowCard({
  workflow,
  onClick,
  onDelete
}: {
  workflow: Workflow;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <article
      className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-indigo-500 transition-colors cursor-pointer relative group"
      role="article"
      aria-label={`Workflow: ${workflow.name}`}
    >
      <div onClick={onClick} className="w-full h-full">
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
      </div>
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 p-1.5 rounded bg-gray-900/80 text-gray-400 hover:text-red-400 hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500"
        aria-label="Delete workflow"
        title="Delete workflow"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </article>
  );
}

function EmptyState({ onNavigateToEditor }: { onNavigateToEditor: (id?: string) => void }) {
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
        onClick={() => onNavigateToEditor()}
        className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        Create Workflow
      </button>
    </div>
  );
}

export function DashboardPage() {
  const { navigate } = useRouter();
  const actorRef = useWorkflowCatalogActorRef();
  const workflows = WorkflowCatalogContext.useSelector((state) => state.context.workflows);
  const loadError = WorkflowCatalogContext.useSelector((state) => state.context.loadError);
  const actionError = WorkflowCatalogContext.useSelector((state) => state.context.actionError);
  const pendingDeleteId = WorkflowCatalogContext.useSelector((state) => state.context.pendingDeleteId);
  const isLoading = WorkflowCatalogContext.useSelector((state) => state.matches('loading'));
  const isDeleting = WorkflowCatalogContext.useSelector((state) => state.matches('deleting'));

  useEffect(() => {
    actorRef.send({ type: 'REFRESH' });
  }, [actorRef]);

  const navigateToEditor = (workflowId?: string) => {
    if (workflowId) {
      navigate('editor', { id: workflowId });
    } else {
      navigate('editor');
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, workflow: Workflow) => {
    e.stopPropagation(); // Prevent card click from firing
    actorRef.send({ type: 'REQUEST_DELETE', id: workflow.id });
  };

  const confirmDelete = () => {
    actorRef.send({ type: 'CONFIRM_DELETE' });
  };

  const cancelDelete = () => {
    actorRef.send({ type: 'CANCEL_DELETE' });
  };

  const workflowToDelete = useMemo(
    () => workflows.find((workflow) => workflow.id === pendingDeleteId) ?? null,
    [workflows, pendingDeleteId],
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          {actionError && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300" role="alert">
              {actionError}
            </div>
          )}
          <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Workflows</h1>
            <p className="text-sm text-gray-400 mt-1">
              Manage your autonomous development workflows
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigateToEditor()}
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

        {loadError && !isLoading && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 text-center">
            <p className="text-gray-400 mb-2">Could not load workflows</p>
            <p className="text-xs text-gray-500">
              Backend services may not be running. The workflow editor is still available.
            </p>
            <button
              type="button"
              onClick={() => actorRef.send({ type: 'RETRY' })}
              disabled={isLoading}
              className="mt-4 mr-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Retrying...' : 'Retry'}
            </button>
            <button
              type="button"
              onClick={() => navigateToEditor()}
              className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              Open Editor
            </button>
          </div>
        )}

        {!isLoading && !loadError && workflows.length === 0 && (
          <EmptyState onNavigateToEditor={navigateToEditor} />
        )}

        {!isLoading && workflows.length > 0 && (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            role="list"
            aria-label="Workflow list"
          >
            {workflows.map((wf) => (
              <div key={wf.id} role="listitem">
                <WorkflowCard
                  workflow={wf}
                  onClick={() => navigateToEditor(wf.id)}
                  onDelete={(e) => handleDeleteClick(e, wf)}
                />
              </div>
            ))}
          </div>
        )}

        <ConfirmDialog
          open={!!workflowToDelete}
          title="Delete Workflow"
          message={`Are you sure you want to delete "${workflowToDelete?.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
          confirmDisabled={isDeleting}
        />
      </div>
    </div>
  );
}
