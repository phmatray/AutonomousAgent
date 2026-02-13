import { useRouter } from '@/lib/router';
import { Clock3, PlayCircle, Trash2 } from 'lucide-react';
import type { Workflow } from '@/types/workflow';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CenteredPage, PageHeader } from '@/app/components/PageLayout';
import { useWorkflowCatalogActorRef, WorkflowCatalogContext } from '@/app/state/workflow-catalog-machine';
import { executeWorkflow, updateWorkflow } from '@/lib/api/workflow';

type SortOption = 'updated-desc' | 'name-asc' | 'name-desc' | 'nodes-desc';
type WorkflowStatus = 'draft' | 'published';
type TriggerMode = 'manual' | 'cron' | 'webhook' | 'state' | 'unknown';

interface TriggerDetails {
  mode: TriggerMode;
  label: string;
  isScheduled: boolean;
  schedule?: string;
  timezone?: string;
  nextRunAt?: string;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    published: 'bg-green-900 text-green-300',
    draft: 'bg-gray-700 text-gray-300',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? colors.draft}`}
    >
      {status}
    </span>
  );
}

function getWorkflowStatus(workflow: Workflow): WorkflowStatus {
  const rawStatus = (workflow as Workflow & { status?: string }).status?.toLowerCase();
  if (rawStatus === 'published' || rawStatus === 'draft') {
    return rawStatus;
  }
  return 'draft';
}

function getWorkflowTriggerDetails(workflow: Workflow): TriggerDetails {
  const persistedSchedule = workflow.schedule;
  if (persistedSchedule?.triggerType) {
    const triggerType = persistedSchedule.triggerType.toLowerCase();
    if (triggerType === 'cron') {
      return {
        mode: 'cron',
        label: 'Cron schedule',
        isScheduled: true,
        schedule: persistedSchedule.cronExpression,
        timezone: persistedSchedule.timezone,
        nextRunAt: persistedSchedule.nextRunAt,
      };
    }
    if (triggerType === 'webhook') {
      return {
        mode: 'webhook',
        label: 'Webhook trigger',
        isScheduled: false,
      };
    }
    if (triggerType === 'state_idle') {
      return {
        mode: 'state',
        label: 'State trigger',
        isScheduled: false,
      };
    }
    if (triggerType === 'manual') {
      return {
        mode: 'manual',
        label: 'On demand',
        isScheduled: false,
      };
    }
  }

  const triggerNode = workflow.nodes.find(
    (node) => node.type === 'trigger.cron' || node.type === 'trigger',
  );

  if (!triggerNode) {
    return {
      mode: 'manual',
      label: 'On demand',
      isScheduled: false,
    };
  }

  const config = triggerNode.config as Record<string, unknown> | undefined;
  const schedule = typeof config?.schedule === 'string' ? config.schedule.trim() : '';
  const timezone = typeof config?.timezone === 'string' ? config.timezone.trim() : '';

  if (triggerNode.type === 'trigger.cron') {
    return {
      mode: 'cron',
      label: 'Cron schedule',
      isScheduled: true,
      schedule: schedule || undefined,
      timezone: timezone || undefined,
    };
  }

  const triggerTypeRaw = typeof config?.trigger_type === 'string'
    ? config.trigger_type.trim().toLowerCase()
    : 'manual';
  const mode = (['manual', 'cron', 'webhook', 'state'].includes(triggerTypeRaw)
    ? triggerTypeRaw
    : 'unknown') as TriggerMode;

  if (mode === 'cron') {
    return {
      mode,
      label: 'Cron schedule',
      isScheduled: true,
      schedule: schedule || undefined,
      timezone: timezone || undefined,
    };
  }

  if (mode === 'webhook') {
    return {
      mode,
      label: 'Webhook trigger',
      isScheduled: false,
    };
  }

  if (mode === 'state') {
    return {
      mode,
      label: 'State trigger',
      isScheduled: false,
    };
  }

  if (mode === 'unknown') {
    return {
      mode,
      label: 'Custom trigger',
      isScheduled: false,
    };
  }

  return {
    mode: 'manual',
    label: 'On demand',
    isScheduled: false,
  };
}

function formatNextRunTimestamp(nextRunAt?: string): string | null {
  if (!nextRunAt) return null;
  const date = new Date(nextRunAt);
  if (Number.isNaN(date.getTime())) return nextRunAt;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function TriggerBadge({ details }: { details: TriggerDetails }) {
  const toneByMode: Record<TriggerMode, string> = {
    manual: 'bg-gray-700 text-gray-200 border-gray-600',
    cron: 'bg-sky-900/50 text-sky-200 border-sky-700',
    webhook: 'bg-amber-900/50 text-amber-200 border-amber-700',
    state: 'bg-emerald-900/50 text-emerald-200 border-emerald-700',
    unknown: 'bg-gray-700 text-gray-200 border-gray-600',
  };

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneByMode[details.mode]}`}>
      {details.isScheduled ? <Clock3 size={12} aria-hidden="true" /> : <PlayCircle size={12} aria-hidden="true" />}
      {details.label}
    </span>
  );
}

function WorkflowCard({
  workflow,
  isUpdatingStatus,
  isRunning,
  onClick,
  onTogglePublish,
  onRun,
  onDelete
}: {
  workflow: Workflow;
  isUpdatingStatus: boolean;
  isRunning: boolean;
  onClick: () => void;
  onTogglePublish: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onRun: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onDelete: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const status = getWorkflowStatus(workflow);
  const isPublished = status === 'published';
  const triggerDetails = getWorkflowTriggerDetails(workflow);
  const scheduleSummary = triggerDetails.isScheduled
    ? triggerDetails.schedule ?? 'Schedule not configured'
    : null;
  const nextRunLabel = triggerDetails.isScheduled
    ? formatNextRunTimestamp(triggerDetails.nextRunAt) ?? 'Waiting for scheduler'
    : null;

  return (
    <article
      className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-indigo-500 transition-colors relative group"
      role="article"
      aria-label={`Workflow: ${workflow.name}`}
    >
      <button
        type="button"
        onClick={onClick}
        className="w-full h-full pr-8 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
        aria-label={`Open workflow ${workflow.name}`}
      >
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-white font-medium">{workflow.name}</h3>
          <StatusBadge status={status} />
        </div>
        <div className="mb-2">
          <TriggerBadge details={triggerDetails} />
        </div>
        {workflow.description && (
          <p className="text-sm text-gray-400 mb-3">{workflow.description}</p>
        )}
        {scheduleSummary && (
          <p className="text-xs text-sky-200/90 mb-3">
            Schedule: <span className="font-mono">{scheduleSummary}</span>
            {triggerDetails.timezone ? ` (${triggerDetails.timezone})` : ''}
          </p>
        )}
        {nextRunLabel && (
          <p className="text-xs text-sky-100/90 mb-3">
            Next run: {nextRunLabel}
          </p>
        )}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{workflow.nodes.length} nodes</span>
          <span>v{workflow.version}</span>
        </div>
      </button>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onTogglePublish}
          disabled={isUpdatingStatus}
          className="px-2.5 py-1 text-xs rounded border border-gray-600 text-gray-200 hover:border-indigo-500 hover:text-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={isPublished ? 'Move workflow to draft' : 'Publish workflow'}
        >
          {isUpdatingStatus
            ? 'Saving...'
            : isPublished
              ? 'Move to Draft'
              : 'Publish'}
        </button>
        <button
          type="button"
          onClick={onRun}
          disabled={!isPublished || isRunning}
          className="px-2.5 py-1 text-xs rounded border border-indigo-600 text-indigo-300 hover:bg-indigo-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={`Run workflow ${workflow.name}`}
          title={!isPublished ? 'Publish workflow before running' : undefined}
        >
          {isRunning ? 'Running...' : 'Run'}
        </button>
      </div>
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 p-1.5 rounded bg-gray-900/80 text-gray-400 hover:text-red-400 hover:bg-red-900/20 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-all focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500"
        aria-label="Delete workflow"
        title="Delete workflow"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </article>
  );
}

function KpiChips({ workflows }: { workflows: Workflow[] }) {
  const stats = useMemo(() => {
    return workflows.reduce(
      (acc, workflow) => {
        const status = getWorkflowStatus(workflow);
        const triggerDetails = getWorkflowTriggerDetails(workflow);
        acc.total += 1;
        if (status === 'published') acc.published += 1;
        if (status === 'draft') acc.draft += 1;
        if (triggerDetails.isScheduled) acc.scheduled += 1;
        else acc.onDemand += 1;
        return acc;
      },
      { total: 0, published: 0, draft: 0, scheduled: 0, onDemand: 0 },
    );
  }, [workflows]);

  return (
    <div className="mb-4 flex flex-wrap gap-2" aria-label="Workflow summary">
      <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-800 border border-gray-700 text-gray-200">
        Total {stats.total}
      </span>
      <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-green-900/40 border border-green-800 text-green-300">
        Published {stats.published}
      </span>
      <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-800 border border-gray-700 text-gray-300">
        Draft {stats.draft}
      </span>
      <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-sky-900/40 border border-sky-800 text-sky-200">
        Scheduled {stats.scheduled}
      </span>
      <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-800 border border-gray-700 text-gray-300">
        On-demand {stats.onDemand}
      </span>
    </div>
  );
}

function SearchAndSortControls({
  searchQuery,
  sortBy,
  onSearchChange,
  onSortChange,
}: {
  searchQuery: string;
  sortBy: SortOption;
  onSearchChange: (value: string) => void;
  onSortChange: (value: SortOption) => void;
}) {
  return (
    <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
      <label className="flex-1">
        <span className="sr-only">Search workflows</span>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search workflows..."
          className="h-10 w-full px-3 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </label>
      <label className="sm:w-56">
        <span className="sr-only">Sort workflows</span>
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          className="h-10 w-full px-3 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          aria-label="Sort workflows"
        >
          <option value="updated-desc">Most recently updated</option>
          <option value="name-asc">Name (A-Z)</option>
          <option value="name-desc">Name (Z-A)</option>
          <option value="nodes-desc">Most nodes</option>
        </select>
      </label>
    </div>
  );
}

function EmptyState({ onNavigateToEditor }: { onNavigateToEditor: (id?: string) => void }) {
  return (
    <section className="rounded-xl border border-gray-700 bg-gray-900/70 p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gray-800">
          <span className="text-xl text-gray-500" aria-hidden="true">+</span>
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-white">No workflows yet</h3>
          <p className="mt-1 text-sm text-gray-300">
            Create your first scheduled or on-demand workflow to automate engineering tasks.
          </p>
          <ul className="mt-4 space-y-1 text-sm text-gray-300">
            <li>1. Add a trigger node (manual, cron, webhook, or state).</li>
            <li>2. Connect GitHub and Claude actions.</li>
            <li>3. Publish to enable execution.</li>
          </ul>
          <button
            type="button"
            onClick={() => onNavigateToEditor()}
            className="mt-5 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            Create Workflow
          </button>
        </div>
      </div>
    </section>
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
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('updated-desc');
  const [statusUpdateWorkflowId, setStatusUpdateWorkflowId] = useState<string | null>(null);
  const [runningWorkflowId, setRunningWorkflowId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

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

  const handleTogglePublish = async (e: React.MouseEvent, workflow: Workflow) => {
    e.stopPropagation();
    setPageError(null);
    setStatusUpdateWorkflowId(workflow.id);
    try {
      const current = getWorkflowStatus(workflow);
      const nextStatus: WorkflowStatus = current === 'published' ? 'draft' : 'published';
      await updateWorkflow(workflow.id, { ...workflow, status: nextStatus });
      actorRef.send({ type: 'REFRESH' });
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Failed to update workflow status');
    } finally {
      setStatusUpdateWorkflowId(null);
    }
  };

  const handleRunWorkflow = async (e: React.MouseEvent, workflow: Workflow) => {
    e.stopPropagation();
    setPageError(null);
    if (getWorkflowStatus(workflow) !== 'published') {
      setPageError('Only published workflows can run from this page.');
      return;
    }

    setRunningWorkflowId(workflow.id);
    try {
      const execution = await executeWorkflow(workflow.id, 'manual');
      if (execution?.id) {
        navigate('monitoring', { id: execution.id });
      } else {
        navigate('monitoring');
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Failed to run workflow');
    } finally {
      setRunningWorkflowId(null);
    }
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

  const visibleWorkflows = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const filtered = normalizedSearch
      ? workflows.filter((workflow) => {
        const name = workflow.name.toLowerCase();
        const description = workflow.description?.toLowerCase() ?? '';
        return name.includes(normalizedSearch) || description.includes(normalizedSearch);
      })
      : workflows;

    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'name-asc':
          return a.name.localeCompare(b.name);
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'nodes-desc':
          return b.nodes.length - a.nodes.length;
        case 'updated-desc':
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
  }, [workflows, searchQuery, sortBy]);

  return (
    <CenteredPage width="lg">
      <PageHeader
        title="Workflow Scheduler"
        description="Manage scheduled and on-demand workflow automations"
        actions={(
          <button
            type="button"
            onClick={() => navigateToEditor()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            New Workflow
          </button>
        )}
        metadata={!isLoading && !loadError && workflows.length > 0 ? <KpiChips workflows={workflows} /> : null}
      />

      {(actionError || pageError) && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300" role="alert">
          {pageError ?? actionError}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-20" role="status" aria-label="Loading workflows">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="sr-only">Loading workflows...</span>
        </div>
      )}

      {loadError && !isLoading && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 text-center">
          <p className="text-gray-300 mb-2">Could not load workflows</p>
          <p className="text-xs text-gray-400">
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
        <>
          <SearchAndSortControls
            searchQuery={searchQuery}
            sortBy={sortBy}
            onSearchChange={setSearchQuery}
            onSortChange={setSortBy}
          />

          {visibleWorkflows.length === 0 ? (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-8 text-center">
              <p className="text-gray-300">No workflows match your search.</p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-3 px-3 py-1.5 bg-gray-700 text-white text-sm rounded hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Clear Search
              </button>
            </div>
          ) : (
            <div
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
              role="list"
              aria-label="Workflow list"
            >
              {visibleWorkflows.map((wf) => (
                <div key={wf.id} role="listitem">
                  <WorkflowCard
                    workflow={wf}
                    isUpdatingStatus={statusUpdateWorkflowId === wf.id}
                    isRunning={runningWorkflowId === wf.id}
                    onClick={() => navigateToEditor(wf.id)}
                    onTogglePublish={(e) => void handleTogglePublish(e, wf)}
                    onRun={(e) => void handleRunWorkflow(e, wf)}
                    onDelete={(e) => handleDeleteClick(e, wf)}
                  />
                </div>
              ))}
            </div>
          )}
        </>
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
    </CenteredPage>
  );
}
