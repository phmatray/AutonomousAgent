import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listRepositories, type GitHubRepo } from '@/lib/api/github';
import type { Route } from '@/lib/router';
import type {
  BacklogItem,
  BacklogPriority,
  BacklogTriageStatus,
} from '@/types/workflow';
import {
  bulkUpdateTriage,
  createWorkflowFromBacklog,
  invalidateBacklogQueries,
  listBacklogItemsForView,
  removeBacklogItem,
  syncIssuesToBacklog,
  updateBacklogTriage,
} from '@/features/backlog/application/backlog-use-cases';
import {
  collectAvailableLabels,
  computeSavedViewCounts,
  selectItemsForView,
  type SavedView,
} from '@/features/backlog/domain/views';
import { buildBacklogRecommendations } from '@/features/backlog/domain/recommendations';
import { queryKeys } from '@/lib/query-keys';

interface UseBacklogModelParams {
  params: URLSearchParams;
  navigate: (route: Route, queryParams?: Record<string, string>) => void;
}

export function useBacklogModel({ params, navigate }: UseBacklogModelParams) {
  const queryClient = useQueryClient();

  const [selectedOwner, setSelectedOwner] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [savedView, setSavedView] = useState<SavedView>('all');
  const [stateFilter, setStateFilter] = useState('');
  const [triageFilter, setTriageFilter] = useState<'' | BacklogTriageStatus>('');
  const [priorityFilter, setPriorityFilter] = useState<'' | BacklogPriority>('');
  const [labelFilter, setLabelFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkTriageStatus, setBulkTriageStatus] = useState<'' | BacklogTriageStatus>('');
  const [bulkPriority, setBulkPriority] = useState<'' | BacklogPriority>('');
  const [linkedWorkflowFeedback, setLinkedWorkflowFeedback] = useState<string | null>(null);
  const [pendingDeleteItemId, setPendingDeleteItemId] = useState<string | null>(null);
  const selectedItemId = params.get('item');

  const { data: repositories = [], isLoading: reposLoading } = useQuery<GitHubRepo[]>({
    queryKey: queryKeys.repositories,
    queryFn: listRepositories,
    retry: false,
  });

  const { data: backlogItems = [], isLoading: backlogLoading } = useQuery<BacklogItem[]>({
    queryKey: queryKeys.backlogItems({
      owner: selectedOwner,
      repo: selectedRepo,
      stateFilter,
      triageFilter,
      priorityFilter,
      labelFilter,
      searchQuery,
    }),
    queryFn: () =>
      listBacklogItemsForView({
        owner: selectedOwner || undefined,
        repo: selectedRepo || undefined,
        stateFilter: stateFilter || undefined,
        triageStatus: triageFilter || undefined,
        priority: priorityFilter || undefined,
        label: labelFilter || undefined,
        search: searchQuery || undefined,
      }),
    retry: false,
  });

  const syncMutation = useMutation({
    mutationFn: () => syncIssuesToBacklog(selectedOwner, selectedRepo),
    onSuccess: () => {
      invalidateBacklogQueries(queryClient);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeBacklogItem(id),
    onSuccess: () => {
      invalidateBacklogQueries(queryClient);
    },
  });

  const updateTriageMutation = useMutation({
    mutationFn: ({
      backlogItemId,
      patch,
    }: {
      backlogItemId: string;
      patch: {
        triageStatus?: BacklogTriageStatus;
        priority?: BacklogPriority;
        rank?: number;
        effort?: 'small' | 'medium' | 'large';
        impact?: 'low' | 'medium' | 'high';
      };
    }) => updateBacklogTriage(backlogItemId, patch),
    onSuccess: () => {
      invalidateBacklogQueries(queryClient);
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: ({
      ids,
      patch,
    }: {
      ids: string[];
      patch: {
        triageStatus?: BacklogTriageStatus;
        priority?: BacklogPriority;
        archive?: boolean;
      };
    }) => bulkUpdateTriage(ids, patch),
    onSuccess: () => {
      invalidateBacklogQueries(queryClient);
    },
  });

  const createWorkflowMutation = useMutation({
    mutationFn: (backlogItemId: string) => createWorkflowFromBacklog(backlogItemId),
    onMutate: () => {
      setLinkedWorkflowFeedback(null);
    },
    onSuccess: (result) => {
      invalidateBacklogQueries(queryClient);
      setLinkedWorkflowFeedback(
        result.usedFallbackGuidelines
          ? 'Workflow linked with template guidelines (Claude unavailable).'
          : 'Workflow linked with AI-generated markdown guidelines.',
      );
    },
  });

  const handleRepoSelect = (owner: string, repo: string) => {
    setSelectedOwner(owner);
    setSelectedRepo(repo);
    setSavedView('all');
    setStateFilter('');
    setTriageFilter('');
    setPriorityFilter('');
    setLabelFilter('');
    setSearchQuery('');
    setSelectedIds([]);
    setLinkedWorkflowFeedback(null);
  };

  const availableLabels = useMemo(() => {
    return collectAvailableLabels(backlogItems);
  }, [backlogItems]);

  const recommendedItems = useMemo(
    () => buildBacklogRecommendations(backlogItems),
    [backlogItems],
  );

  const viewItems = useMemo(
    () => selectItemsForView(backlogItems, recommendedItems, savedView),
    [backlogItems, recommendedItems, savedView],
  );

  const selectedItem = useMemo(
    () => viewItems.find((item) => item.id === selectedItemId) ?? null,
    [viewItems, selectedItemId],
  );

  useEffect(() => {
    if (!selectedItemId || backlogLoading) return;
    if (!selectedItem) {
      navigate('backlog');
    }
  }, [backlogLoading, navigate, selectedItem, selectedItemId]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => viewItems.some((item) => item.id === id)));
  }, [viewItems]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return;
      }

      if (viewItems.length === 0) return;

      const selectedIndex = selectedItemId
        ? viewItems.findIndex((item) => item.id === selectedItemId)
        : -1;

      if (event.key === 'j') {
        event.preventDefault();
        const nextIndex = selectedIndex < 0
          ? 0
          : Math.min(viewItems.length - 1, selectedIndex + 1);
        navigate('backlog', { item: viewItems[nextIndex].id });
        return;
      }

      if (event.key === 'k') {
        event.preventDefault();
        const nextIndex = selectedIndex < 0
          ? 0
          : Math.max(0, selectedIndex - 1);
        navigate('backlog', { item: viewItems[nextIndex].id });
        return;
      }

      if (event.key === 'e' && selectedItemId) {
        event.preventDefault();
        navigate('backlog', { item: selectedItemId });
        return;
      }

      if (event.key === 'l' && selectedItem) {
        event.preventDefault();
        if (selectedItem.linked_workflow_id) {
          navigate('editor', { id: selectedItem.linked_workflow_id });
        } else {
          createWorkflowMutation.mutate(selectedItem.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [createWorkflowMutation, navigate, selectedItem, selectedItemId, viewItems]);

  const openDetails = (itemId: string) => {
    setLinkedWorkflowFeedback(null);
    navigate('backlog', { item: itemId });
  };

  const closeDetails = () => {
    setLinkedWorkflowFeedback(null);
    navigate('backlog');
  };

  const requestDelete = (itemId: string) => {
    setPendingDeleteItemId(itemId);
  };

  const cancelDelete = () => {
    setPendingDeleteItemId(null);
  };

  const confirmDelete = () => {
    if (!pendingDeleteItemId) return;
    deleteMutation.mutate(pendingDeleteItemId);
    setPendingDeleteItemId(null);
  };

  const openWorkflow = (workflowId: string) => {
    navigate('editor', { id: workflowId });
  };

  const startAutomationFromRecommendation = async (item: BacklogItem) => {
    setLinkedWorkflowFeedback(null);
    try {
      if (item.linked_workflow_id) {
        navigate('editor', { id: item.linked_workflow_id });
        return;
      }
      const result = await createWorkflowMutation.mutateAsync(item.id);
      navigate('editor', { id: result.workflow.id });
    } catch (error) {
      setLinkedWorkflowFeedback(
        error instanceof Error ? error.message : 'Failed to start automation from recommendation.',
      );
    }
  };

  const toggleSelectedId = (id: string) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === viewItems.length) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(viewItems.map((item) => item.id));
  };

  const applyBulkUpdate = () => {
    if (selectedIds.length === 0) return;
    if (!bulkTriageStatus && !bulkPriority) return;
    bulkUpdateMutation.mutate({
      ids: selectedIds,
      patch: {
        triageStatus: bulkTriageStatus || undefined,
        priority: bulkPriority || undefined,
      },
    });
  };

  const archiveSelected = () => {
    if (selectedIds.length === 0) return;
    bulkUpdateMutation.mutate({
      ids: selectedIds,
      patch: {
        archive: true,
      },
    });
    setSelectedIds([]);
  };

  const linkSelected = async () => {
    if (selectedIds.length === 0) return;
    setLinkedWorkflowFeedback(null);
    try {
      for (const id of selectedIds) {
        await createWorkflowMutation.mutateAsync(id);
      }
      setSelectedIds([]);
    } catch (error) {
      setLinkedWorkflowFeedback(
        error instanceof Error ? error.message : 'Failed to auto-link selected items.',
      );
    }
  };

  const pendingDeleteItem = useMemo(
    () => viewItems.find((item) => item.id === pendingDeleteItemId) ?? null,
    [viewItems, pendingDeleteItemId],
  );
  const repositoryLabel = selectedOwner && selectedRepo
    ? `${selectedOwner}/${selectedRepo}`
    : undefined;
  const hasActiveBacklogFilters = Boolean(
    savedView !== 'all'
    || stateFilter
    || triageFilter
    || priorityFilter
    || labelFilter
    || searchQuery.trim(),
  );

  const savedViewCounts = useMemo(
    () => computeSavedViewCounts(backlogItems, recommendedItems.length),
    [backlogItems, recommendedItems.length],
  );

  const clearFilters = () => {
    setSavedView('all');
    setStateFilter('');
    setTriageFilter('');
    setPriorityFilter('');
    setLabelFilter('');
    setSearchQuery('');
  };

  return {
    repositories,
    reposLoading,
    backlogLoading,
    backlogItems,
    selectedOwner,
    selectedRepo,
    savedView,
    stateFilter,
    triageFilter,
    priorityFilter,
    labelFilter,
    searchQuery,
    selectedIds,
    bulkTriageStatus,
    bulkPriority,
    linkedWorkflowFeedback,
    selectedItemId,
    viewItems,
    selectedItem,
    availableLabels,
    recommendedItems,
    savedViewCounts,
    pendingDeleteItem,
    repositoryLabel,
    hasActiveBacklogFilters,
    syncMutation,
    deleteMutation,
    updateTriageMutation,
    bulkUpdateMutation,
    createWorkflowMutation,
    setSavedView,
    setStateFilter,
    setTriageFilter,
    setPriorityFilter,
    setLabelFilter,
    setSearchQuery,
    setBulkTriageStatus,
    setBulkPriority,
    setSelectedIds,
    handleRepoSelect,
    openDetails,
    closeDetails,
    requestDelete,
    cancelDelete,
    confirmDelete,
    openWorkflow,
    startAutomationFromRecommendation,
    toggleSelectedId,
    toggleSelectAll,
    applyBulkUpdate,
    archiveSelected,
    linkSelected,
    clearFilters,
  };
}
