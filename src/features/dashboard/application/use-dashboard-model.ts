import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Route } from '@/lib/router';
import type { Workflow } from '@/types/workflow';
import { listExecutions } from '@/lib/api/workflow';
import { onWorkflowExecutionStatus } from '@/lib/events/workflow-events';
import { queryKeys } from '@/lib/query-keys';
import { useWorkflowCatalogActorRef, WorkflowCatalogContext } from '@/app/state/workflow-catalog-machine';
import {
  filterAndSortWorkflows,
  type SortOption,
  type TriggerFilter,
  type VisibilityFilter,
} from '@/features/dashboard/domain/workflows';
import {
  runPublishedWorkflow,
  toggleWorkflowPublishStatus,
} from '@/features/dashboard/application/workflow-actions';

interface UseDashboardModelParams {
  navigate: (route: Route, queryParams?: Record<string, string>) => void;
}

export function useDashboardModel({ navigate }: UseDashboardModelParams) {
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

  const handleDeleteClick = (e: MouseEvent, workflow: Workflow) => {
    e.stopPropagation();
    actorRef.send({ type: 'REQUEST_DELETE', id: workflow.id });
  };

  const handleTogglePublish = async (e: MouseEvent, workflow: Workflow) => {
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

  const handleRunWorkflow = async (e: MouseEvent, workflow: Workflow) => {
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

  const retryWorkflowCatalogLoad = () => {
    actorRef.send({ type: 'RETRY' });
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

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setTriggerFilter('all');
    setSortBy('updated-desc');
  };

  return {
    workflows,
    loadError,
    actionError,
    isLoading,
    isDeleting,
    searchQuery,
    sortBy,
    statusFilter,
    triggerFilter,
    statusUpdateWorkflowId,
    runningWorkflowId,
    pageError,
    executionHealthData,
    isExecutionHealthLoading,
    isExecutionHealthError,
    workflowToDelete,
    visibleWorkflows,
    setSearchQuery,
    setSortBy,
    setStatusFilter,
    setTriggerFilter,
    navigateToEditor,
    handleDeleteClick,
    handleTogglePublish,
    handleRunWorkflow,
    confirmDelete,
    cancelDelete,
    retryWorkflowCatalogLoad,
    clearFilters,
  };
}
