import { useEffect, useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listRepositories, type GitHubRepo } from '@/lib/api/github';
import {
  listBacklogItems,
  syncGithubIssuesToBacklog,
  deleteBacklogItem,
  createLinkedWorkflowFromBacklog,
} from '@/lib/api/backlog';
import type { BacklogItem } from '@/types/workflow';
import { BacklogHeader } from './BacklogHeader';
import { RepositorySelector } from './RepositorySelector';
import { BacklogFilters } from './BacklogFilters';
import { BacklogTable } from './BacklogTable';
import { BacklogDetailsPanel } from './BacklogDetailsPanel';
import { useRouter } from '@/lib/router';
import { CenteredPage } from '@/app/components/PageLayout';

export function BacklogPage() {
  const { params, navigate } = useRouter();
  const queryClient = useQueryClient();

  const [selectedOwner, setSelectedOwner] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [linkedWorkflowFeedback, setLinkedWorkflowFeedback] = useState<string | null>(null);
  const selectedItemId = params.get('item');

  const { data: repositories = [], isLoading: reposLoading } = useQuery<GitHubRepo[]>({
    queryKey: ['repositories'],
    queryFn: listRepositories,
    retry: false,
  });

  const { data: backlogItems = [], isLoading: backlogLoading } = useQuery<BacklogItem[]>({
    queryKey: ['backlog-items', selectedOwner, selectedRepo, stateFilter, labelFilter, searchQuery],
    queryFn: () =>
      listBacklogItems({
        owner: selectedOwner || undefined,
        repo: selectedRepo || undefined,
        stateFilter: stateFilter || undefined,
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
    setStateFilter('');
    setLabelFilter('');
    setSearchQuery('');
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

  const selectedItem = useMemo(
    () => backlogItems.find((item) => item.id === selectedItemId) ?? null,
    [backlogItems, selectedItemId],
  );

  useEffect(() => {
    if (!selectedItemId || backlogLoading) return;
    if (!selectedItem) {
      navigate('backlog');
    }
  }, [backlogLoading, navigate, selectedItem, selectedItemId]);

  const openDetails = (itemId: string) => {
    setLinkedWorkflowFeedback(null);
    navigate('backlog', { item: itemId });
  };

  const closeDetails = () => {
    setLinkedWorkflowFeedback(null);
    navigate('backlog');
  };

  const openWorkflow = (workflowId: string) => {
    navigate('editor', { id: workflowId });
  };

  return (
    <CenteredPage width="xl">
      <BacklogHeader
        itemCount={backlogItems.length}
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
        <BacklogFilters
          stateFilter={stateFilter}
          onStateFilterChange={setStateFilter}
          labelFilter={labelFilter}
          onLabelFilterChange={setLabelFilter}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          availableLabels={availableLabels}
        />
      )}

      {syncMutation.isError && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300" role="alert">
          Failed to sync issues: {String(syncMutation.error)}
        </div>
      )}

      {backlogLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-label="Loading backlog">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="sr-only">Loading backlog...</span>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden flex-1 min-w-0">
            <BacklogTable
              items={backlogItems}
              selectedItemId={selectedItemId}
              onViewDetails={openDetails}
              onDelete={(id) => deleteMutation.mutate(id)}
              isDeleting={deleteMutation.isPending}
            />
          </div>
          {selectedItem && (
            <BacklogDetailsPanel
              item={selectedItem}
              onClose={closeDetails}
              onCreateLinkedWorkflow={(backlogItemId) => createWorkflowMutation.mutate(backlogItemId)}
              onOpenLinkedWorkflow={openWorkflow}
              isCreatingLinkedWorkflow={createWorkflowMutation.isPending}
              createLinkedWorkflowError={
                createWorkflowMutation.isError ? String(createWorkflowMutation.error) : null
              }
              linkedWorkflowFeedback={linkedWorkflowFeedback}
            />
          )}
        </div>
      )}
    </CenteredPage>
  );
}
