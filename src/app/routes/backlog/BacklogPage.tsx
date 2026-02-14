import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listRepositories, type GitHubRepo } from '@/lib/api/github';
import {
  listBacklogItems,
  syncGithubIssuesToBacklog,
  deleteBacklogItem,
  createLinkedWorkflowFromBacklog,
  updateBacklogItemTriage,
  bulkUpdateBacklogTriage,
} from '@/lib/api/backlog';
import type {
  BacklogItem,
  BacklogPriority,
  BacklogTriageStatus,
} from '@/types/workflow';
import { BacklogHeader } from './BacklogHeader';
import { RepositorySelector } from './RepositorySelector';
import { BacklogFilters } from './BacklogFilters';
import { BacklogTable } from './BacklogTable';
import { BacklogDetailsPanel } from './BacklogDetailsPanel';
import { RecommendedIssuesPanel } from './RecommendedIssuesPanel';
import { buildBacklogRecommendations } from './recommendations';
import { useRouter } from '@/lib/router';
import {
  CenteredPage,
  PageEmptyState,
  PageLoadingState,
  PageNotice,
} from '@/app/components/PageLayout';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/primitives';

type SavedView = 'all' | 'recommended' | 'now' | 'next' | 'blocked' | 'unlinked';

function matchesSavedView(item: BacklogItem, view: SavedView): boolean {
  if (view === 'all') return true;
  if (view === 'recommended') return true;
  if (view === 'blocked') return item.triage_status === 'blocked';
  if (view === 'unlinked') return !item.linked_workflow_id;
  if (view === 'now') {
    return (item.priority === 'critical' || item.priority === 'high')
      && (item.triage_status === 'ready' || item.triage_status === 'in_progress');
  }
  if (view === 'next') {
    return item.triage_status === 'ready' && item.priority === 'medium';
  }
  return true;
}

export function BacklogPage() {
  const { params, navigate } = useRouter();
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
    queryKey: ['repositories'],
    queryFn: listRepositories,
    retry: false,
  });

  const { data: backlogItems = [], isLoading: backlogLoading } = useQuery<BacklogItem[]>({
    queryKey: [
      'backlog-items',
      selectedOwner,
      selectedRepo,
      stateFilter,
      triageFilter,
      priorityFilter,
      labelFilter,
      searchQuery,
    ],
    queryFn: () =>
      listBacklogItems({
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
    mutationFn: () => syncGithubIssuesToBacklog(selectedOwner, selectedRepo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backlog-items'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBacklogItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backlog-items'] });
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
    }) => updateBacklogItemTriage(backlogItemId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backlog-items'] });
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
    }) => bulkUpdateBacklogTriage(ids, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backlog-items'] });
    },
  });

  const createWorkflowMutation = useMutation({
    mutationFn: (backlogItemId: string) => createLinkedWorkflowFromBacklog(backlogItemId),
    onMutate: () => {
      setLinkedWorkflowFeedback(null);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['backlog-items'] });
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
    const labelSet = new Set<string>();
    for (const item of backlogItems) {
      for (const label of item.labels) {
        labelSet.add(label);
      }
    }
    return Array.from(labelSet).sort();
  }, [backlogItems]);

  const recommendedItems = useMemo(
    () => buildBacklogRecommendations(backlogItems),
    [backlogItems],
  );

  const viewItems = useMemo(
    () => {
      if (savedView === 'recommended') {
        return recommendedItems.map((entry) => entry.item);
      }
      return backlogItems.filter((item) => matchesSavedView(item, savedView));
    },
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
    () => ({
      all: backlogItems.length,
      recommended: recommendedItems.length,
      now: backlogItems.filter((item) => matchesSavedView(item, 'now')).length,
      next: backlogItems.filter((item) => matchesSavedView(item, 'next')).length,
      blocked: backlogItems.filter((item) => matchesSavedView(item, 'blocked')).length,
      unlinked: backlogItems.filter((item) => matchesSavedView(item, 'unlinked')).length,
    }),
    [backlogItems, recommendedItems.length],
  );

  return (
    <CenteredPage width="xl">
      <BacklogHeader
        itemCount={viewItems.length}
        selectedCount={selectedIds.length}
        repositoryLabel={repositoryLabel}
        isSyncing={syncMutation.isPending}
        onSync={() => syncMutation.mutate()}
        syncDisabled={!selectedOwner || !selectedRepo}
      />

      <RepositorySelector
        repositories={repositories}
        isLoading={reposLoading}
        selectedOwner={selectedOwner}
        selectedRepo={selectedRepo}
        onSelect={handleRepoSelect}
      />

      {(selectedOwner && selectedRepo) && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {([
              ['all', 'All'],
              ['recommended', 'Recommended'],
              ['now', 'Now'],
              ['next', 'Next'],
              ['blocked', 'Blocked'],
              ['unlinked', 'Unlinked'],
            ] as Array<[SavedView, string]>).map(([view, label]) => (
              <button
                key={view}
                type="button"
                onClick={() => setSavedView(view)}
                className={`rounded border px-3 py-1.5 text-xs ${savedView === view
                  ? 'border-indigo-500 bg-indigo-900/30 text-indigo-200'
                  : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600'
                }`}
              >
                {label} ({savedViewCounts[view]})
              </button>
            ))}
          </div>

          <BacklogFilters
            stateFilter={stateFilter}
            onStateFilterChange={setStateFilter}
            triageFilter={triageFilter}
            onTriageFilterChange={setTriageFilter}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={setPriorityFilter}
            labelFilter={labelFilter}
            onLabelFilterChange={setLabelFilter}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            availableLabels={availableLabels}
            onClearFilters={() => {
              setSavedView('all');
              setStateFilter('');
              setTriageFilter('');
              setPriorityFilter('');
              setLabelFilter('');
              setSearchQuery('');
            }}
          />

          <RecommendedIssuesPanel
            recommendations={recommendedItems.slice(0, 5)}
            onViewDetails={openDetails}
            onStartAutomation={startAutomationFromRecommendation}
            isStartingAutomation={createWorkflowMutation.isPending}
          />

          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2">
            <span className="text-xs text-gray-400">Bulk actions ({selectedIds.length})</span>
            <select
              value={bulkTriageStatus}
              onChange={(event) => setBulkTriageStatus(event.target.value as '' | BacklogTriageStatus)}
              className="h-8 rounded border border-gray-700 bg-gray-800 px-2 text-xs text-white"
            >
              <option value="">Set triage...</option>
              <option value="inbox">Inbox</option>
              <option value="ready">Ready</option>
              <option value="in_progress">In Progress</option>
              <option value="blocked">Blocked</option>
              <option value="done">Done</option>
            </select>
            <select
              value={bulkPriority}
              onChange={(event) => setBulkPriority(event.target.value as '' | BacklogPriority)}
              className="h-8 rounded border border-gray-700 bg-gray-800 px-2 text-xs text-white"
            >
              <option value="">Set priority...</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <Button
              onClick={applyBulkUpdate}
              disabled={selectedIds.length === 0 || bulkUpdateMutation.isPending}
              variant="secondary"
            >
              Apply
            </Button>
            <Button
              onClick={linkSelected}
              disabled={selectedIds.length === 0 || createWorkflowMutation.isPending}
              variant="secondary"
            >
              Auto-link Workflows
            </Button>
            <Button
              onClick={archiveSelected}
              disabled={selectedIds.length === 0 || bulkUpdateMutation.isPending}
              variant="secondary"
              className="text-red-300 border-red-800/70"
            >
              Archive Selected
            </Button>
            <Button
              onClick={() => setSelectedIds([])}
              disabled={selectedIds.length === 0}
              variant="ghost"
              size="sm"
            >
              Clear Selection
            </Button>
            <span className="text-xs text-gray-500 ml-auto">Shortcuts: j/k move, e open, l link</span>
          </div>
        </>
      )}
      {!selectedOwner || !selectedRepo ? (
        <PageNotice tone="info" title="Select a repository">
          Choose a repository before syncing issues or running targeted backlog actions.
        </PageNotice>
      ) : null}
      {linkedWorkflowFeedback ? (
        <PageNotice tone="success" title="Workflow link update">
          {linkedWorkflowFeedback}
        </PageNotice>
      ) : null}

      {syncMutation.isError && (
        <PageNotice tone="danger" title="Issue sync failed">
          Failed to sync issues: {String(syncMutation.error)}
        </PageNotice>
      )}

      {backlogLoading ? (
        <PageLoadingState label="Loading backlog" />
      ) : viewItems.length === 0 ? (
        <PageEmptyState
          title="No backlog items in this view"
          description={
            hasActiveBacklogFilters
              ? 'Try resetting filters or selecting a different saved view.'
              : 'Sync repository issues from GitHub to start triaging work.'
          }
          actions={hasActiveBacklogFilters ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSavedView('all');
                setStateFilter('');
                setTriageFilter('');
                setPriorityFilter('');
                setLabelFilter('');
                setSearchQuery('');
              }}
            >
              Reset Filters
            </Button>
          ) : undefined}
        />
      ) : (
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden flex-1 min-w-0">
            <BacklogTable
              items={viewItems}
              selectedItemId={selectedItemId}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelectedId}
              onToggleSelectAll={toggleSelectAll}
              onViewDetails={openDetails}
              onRequestDelete={requestDelete}
              onUpdateTriage={(backlogItemId, patch) => {
                updateTriageMutation.mutate({ backlogItemId, patch });
              }}
              isDeleting={deleteMutation.isPending}
              isUpdatingTriage={updateTriageMutation.isPending || bulkUpdateMutation.isPending}
            />
          </div>
          {selectedItem && (
            <BacklogDetailsPanel
              item={selectedItem}
              onClose={closeDetails}
              onCreateLinkedWorkflow={(backlogItemId) => createWorkflowMutation.mutate(backlogItemId)}
              onOpenLinkedWorkflow={openWorkflow}
              onUpdateTriage={(backlogItemId, patch) => {
                updateTriageMutation.mutate({ backlogItemId, patch });
              }}
              isCreatingLinkedWorkflow={createWorkflowMutation.isPending}
              isUpdatingTriage={updateTriageMutation.isPending || bulkUpdateMutation.isPending}
              createLinkedWorkflowError={
                createWorkflowMutation.isError ? String(createWorkflowMutation.error) : null
              }
              linkedWorkflowFeedback={linkedWorkflowFeedback}
            />
          )}
        </div>
      )}
      <ConfirmDialog
        open={pendingDeleteItem !== null}
        title="Remove Backlog Item"
        message={
          pendingDeleteItem
            ? `Remove issue #${pendingDeleteItem.issue_number} from backlog? This does not delete the issue on GitHub.`
            : ''
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        confirmDisabled={deleteMutation.isPending}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </CenteredPage>
  );
}
