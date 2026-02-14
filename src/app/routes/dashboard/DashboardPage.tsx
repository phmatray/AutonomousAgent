import { useRouter } from '@/lib/router';
import { Clock3, PlayCircle, Trash2 } from 'lucide-react';
import type { Workflow } from '@/types/workflow';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  CenteredPage,
  PageEmptyState,
  PageHeader,
  PageLoadingState,
  PageNotice,
} from '@/app/components/PageLayout';
import { useWorkflowCatalogActorRef, WorkflowCatalogContext } from '@/app/state/workflow-catalog-machine';
import { listExecutions } from '@/lib/api/workflow';
import { Badge, Button, Input, SectionCard } from '@/components/ui/primitives';
import { onWorkflowExecutionStatus } from '@/lib/events/workflow-events';
import {
  filterAndSortWorkflows,
  formatNextRunTimestamp,
  formatWorkflowUpdatedAt,
  getWorkflowStatus,
  getWorkflowTriggerDetails,
  type SortOption,
  type TriggerDetails,
  type TriggerFilter,
  type TriggerMode,
  type VisibilityFilter,
} from '@/features/dashboard/domain/workflows';
import {
  runPublishedWorkflow,
  toggleWorkflowPublishStatus,
} from '@/features/dashboard/application/workflow-actions';
import { queryKeys } from '@/lib/query-keys';

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'published' ? 'success' : 'default';
  return (
    <Badge tone={tone}>
      {status}
    </Badge>
  );
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
          <span>Updated {formatWorkflowUpdatedAt(workflow.updatedAt)}</span>
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
      <Badge>Total {stats.total}</Badge>
      <Badge tone="success">Published {stats.published}</Badge>
      <Badge>Draft {stats.draft}</Badge>
      <Badge tone="info">Scheduled {stats.scheduled}</Badge>
      <Badge>On-demand {stats.onDemand}</Badge>
    </div>
  );
}

function formatExecutionTimestamp(value?: string): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function ExecutionHealthCard({ executions }: { executions: Awaited<ReturnType<typeof listExecutions>> }) {
  const summary = useMemo(() => {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const withTimestamps = executions
      .map((execution) => ({
        execution,
        timestamp: new Date(
          execution.startedAt
            ?? execution.completedAt
            ?? '',
        ).getTime(),
      }))
      .filter(({ timestamp }) => Number.isFinite(timestamp));

    const sorted = withTimestamps.sort((left, right) => right.timestamp - left.timestamp);
    const latest = sorted[0]?.execution;
    const failures24h = sorted.filter(({ execution, timestamp }) =>
      execution.status === 'FAILED' && timestamp >= dayAgo).length;
    const runningCount = executions.filter((execution) => execution.status === 'RUNNING').length;
    const completedCount = executions.filter((execution) => execution.status === 'COMPLETED').length;
    const failedCount = executions.filter((execution) => execution.status === 'FAILED').length;

    let successStreak = 0;
    for (const { execution } of sorted) {
      if (execution.status === 'COMPLETED') {
        successStreak += 1;
        continue;
      }
      if (execution.status === 'FAILED' || execution.status === 'CANCELLED') {
        break;
      }
    }

    return {
      total: executions.length,
      failures24h,
      runningCount,
      completedCount,
      failedCount,
      successStreak,
      latestStartedAt: latest?.startedAt ?? latest?.completedAt,
    };
  }, [executions]);

  return (
    <SectionCard className="mb-4 p-4" aria-label="Execution health">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Execution Health</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Last run: {formatExecutionTimestamp(summary.latestStartedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={summary.failures24h > 0 ? 'danger' : 'success'}>
            24h failures {summary.failures24h}
          </Badge>
          <Badge tone={summary.runningCount > 0 ? 'info' : 'default'}>
            Running {summary.runningCount}
          </Badge>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge>Executions {summary.total}</Badge>
        <Badge tone="success">Completed {summary.completedCount}</Badge>
        <Badge tone={summary.failedCount > 0 ? 'danger' : 'default'}>
          Failed {summary.failedCount}
        </Badge>
        <Badge tone={summary.successStreak > 0 ? 'success' : 'default'}>
          Success streak {summary.successStreak}
        </Badge>
      </div>
    </SectionCard>
  );
}

function SearchAndSortControls({
  searchQuery,
  sortBy,
  statusFilter,
  triggerFilter,
  matchingCount,
  onSearchChange,
  onSortChange,
  onStatusFilterChange,
  onTriggerFilterChange,
  onClearFilters,
}: {
  searchQuery: string;
  sortBy: SortOption;
  statusFilter: VisibilityFilter;
  triggerFilter: TriggerFilter;
  matchingCount: number;
  onSearchChange: (value: string) => void;
  onSortChange: (value: SortOption) => void;
  onStatusFilterChange: (value: VisibilityFilter) => void;
  onTriggerFilterChange: (value: TriggerFilter) => void;
  onClearFilters: () => void;
}) {
  const hasActiveFilters = Boolean(
    searchQuery.trim() || statusFilter !== 'all' || triggerFilter !== 'all',
  );

  return (
    <div className="mb-4 rounded-lg border border-gray-700 bg-gray-900/60 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-gray-400">
          Showing {matchingCount} matching workflow{matchingCount !== 1 ? 's' : ''}
        </p>
        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="text-xs"
          >
            Clear Filters
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="flex-1">
        <span className="sr-only">Search workflows</span>
        <Input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search workflows..."
          className="bg-gray-800 text-gray-200 placeholder:text-gray-500"
        />
        </label>
        <label className="lg:w-52">
          <span className="sr-only">Filter by publication state</span>
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value as VisibilityFilter)}
            className="h-10 w-full px-3 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            aria-label="Filter workflows by publication state"
          >
            <option value="all">All states</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </label>
        <label className="lg:w-52">
          <span className="sr-only">Filter by trigger type</span>
          <select
            value={triggerFilter}
            onChange={(e) => onTriggerFilterChange(e.target.value as TriggerFilter)}
            className="h-10 w-full px-3 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            aria-label="Filter workflows by trigger type"
          >
            <option value="all">All triggers</option>
            <option value="scheduled">Scheduled</option>
            <option value="on-demand">On-demand</option>
          </select>
        </label>
        <label className="lg:w-56">
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
    </div>
  );
}

function EmptyState({
  onNavigateToEditor,
  onNavigateToCredentials,
  onNavigateToBacklog,
}: {
  onNavigateToEditor: (id?: string) => void;
  onNavigateToCredentials: () => void;
  onNavigateToBacklog: () => void;
}) {
  return (
    <SectionCard className="rounded-xl bg-gray-900/70">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gray-800">
          <span className="text-xl text-gray-500" aria-hidden="true">+</span>
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-white">No workflows yet</h3>
          <p className="mt-1 text-sm text-gray-300">
            Create your first scheduled or on-demand workflow to automate engineering tasks.
          </p>
          <ol className="mt-4 space-y-2 text-sm text-gray-300">
            <li className="rounded-lg border border-gray-700 bg-gray-900/80 px-3 py-2">
              <span className="text-gray-100">1. Connect credentials</span>
              <span className="block text-xs text-gray-400 mt-0.5">Save GitHub token and Claude key.</span>
            </li>
            <li className="rounded-lg border border-gray-700 bg-gray-900/80 px-3 py-2">
              <span className="text-gray-100">2. Pull candidate issues</span>
              <span className="block text-xs text-gray-400 mt-0.5">Sync repository issues into backlog.</span>
            </li>
            <li className="rounded-lg border border-gray-700 bg-gray-900/80 px-3 py-2">
              <span className="text-gray-100">3. Build and publish workflow</span>
              <span className="block text-xs text-gray-400 mt-0.5">Add trigger and execution nodes, then publish.</span>
            </li>
          </ol>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              onClick={onNavigateToCredentials}
              variant="secondary"
              className="bg-gray-800 hover:bg-gray-700"
            >
              Connect Credentials
            </Button>
            <Button
              onClick={onNavigateToBacklog}
              variant="secondary"
              className="bg-gray-800 hover:bg-gray-700"
            >
              Sync Backlog
            </Button>
            <Button
              onClick={() => onNavigateToEditor()}
            >
              Create Workflow
            </Button>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

export function DashboardPage() {
  const { navigate } = useRouter();
  const queryClient = useQueryClient();
  const actorRef = useWorkflowCatalogActorRef();
  const workflows = WorkflowCatalogContext.useSelector((state) => state.context.workflows) ?? [];
  const loadError = WorkflowCatalogContext.useSelector((state) => state.context.loadError);
  const actionError = WorkflowCatalogContext.useSelector((state) => state.context.actionError);
  const pendingDeleteId = WorkflowCatalogContext.useSelector((state) => state.context.pendingDeleteId);
  const isLoading = WorkflowCatalogContext.useSelector((state) => state.matches('loading'));
  const isDeleting = WorkflowCatalogContext.useSelector((state) => state.matches('deleting'));
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('updated-desc');
  const [statusFilter, setStatusFilter] = useState<VisibilityFilter>('all');
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all');
  const [statusUpdateWorkflowId, setStatusUpdateWorkflowId] = useState<string | null>(null);
  const [runningWorkflowId, setRunningWorkflowId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const {
    data: executionHealthData = [],
    isLoading: isExecutionHealthLoading,
    isError: isExecutionHealthError,
  } = useQuery({
    queryKey: queryKeys.dashboardExecutionHealth,
    queryFn: async () => (await listExecutions()) ?? [],
    enabled: !isLoading && !loadError,
    retry: false,
  });

  useEffect(() => {
    actorRef.send({ type: 'REFRESH' });
  }, [actorRef]);

  useEffect(() => {
    let unlisten = () => {};
    onWorkflowExecutionStatus(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardExecutionHealth });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten();
    };
  }, [queryClient]);

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
      await toggleWorkflowPublishStatus(workflow);
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
    setRunningWorkflowId(workflow.id);
    try {
      const execution = await runPublishedWorkflow(workflow);
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
    return filterAndSortWorkflows(workflows, {
      searchQuery,
      sortBy,
      statusFilter,
      triggerFilter,
    });
  }, [searchQuery, sortBy, statusFilter, triggerFilter, workflows]);

  return (
    <CenteredPage width="lg">
      <PageHeader
        title="Workflow Scheduler"
        description="Manage scheduled and on-demand workflow automations"
        actions={(
          <Button
            onClick={() => navigateToEditor()}
          >
            New Workflow
          </Button>
        )}
        metadata={!isLoading && !loadError && workflows.length > 0 ? <KpiChips workflows={workflows} /> : null}
      />

      {(actionError || pageError) && (
        <PageNotice tone="danger" title="Workflow actions unavailable">
          {pageError ?? actionError}
        </PageNotice>
      )}

      {!isLoading && !loadError && !isExecutionHealthLoading && (
        isExecutionHealthError ? (
          <PageNotice tone="warning" title="Execution health unavailable">
            Execution health is temporarily unavailable.
          </PageNotice>
        ) : (
          <ExecutionHealthCard executions={executionHealthData} />
        )
      )}

      {isLoading && (
        <PageLoadingState label="Loading workflows" />
      )}

      {loadError && !isLoading && (
        <SectionCard className="text-center">
          <p className="text-gray-300 mb-2">Could not load workflows</p>
          <p className="text-xs text-gray-400">
            Backend services may not be running. The workflow editor is still available.
          </p>
          <Button
            onClick={() => actorRef.send({ type: 'RETRY' })}
            disabled={isLoading}
            variant="secondary"
            className="mt-4 mr-2"
          >
            {isLoading ? 'Retrying...' : 'Retry'}
          </Button>
          <Button
            onClick={() => navigateToEditor()}
            className="mt-4"
          >
            Open Editor
          </Button>
        </SectionCard>
      )}

      {!isLoading && !loadError && workflows.length === 0 && (
        <EmptyState
          onNavigateToEditor={navigateToEditor}
          onNavigateToCredentials={() => navigate('credentials')}
          onNavigateToBacklog={() => navigate('backlog')}
        />
      )}

      {!isLoading && workflows.length > 0 && (
        <>
          <SearchAndSortControls
            searchQuery={searchQuery}
            sortBy={sortBy}
            statusFilter={statusFilter}
            triggerFilter={triggerFilter}
            matchingCount={visibleWorkflows.length}
            onSearchChange={setSearchQuery}
            onSortChange={setSortBy}
            onStatusFilterChange={setStatusFilter}
            onTriggerFilterChange={setTriggerFilter}
            onClearFilters={() => {
              setSearchQuery('');
              setStatusFilter('all');
              setTriggerFilter('all');
              setSortBy('updated-desc');
            }}
          />

          {visibleWorkflows.length === 0 ? (
            <PageEmptyState
              title="No workflows match your filters"
              description="Try broadening search, publication state, or trigger mode."
              actions={(
                <Button
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('all');
                    setTriggerFilter('all');
                    setSortBy('updated-desc');
                  }}
                  variant="secondary"
                  size="sm"
                >
                  Reset Filters
                </Button>
              )}
            />
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
