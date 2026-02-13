import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listRepositories, type GitHubRepo } from '@/lib/api/github';
import {
  listBacklogItems,
  syncGithubIssuesToBacklog,
  deleteBacklogItem,
} from '@/lib/api/backlog';
import type { BacklogItem } from '@/types/workflow';
import { BacklogHeader } from './BacklogHeader';
import { RepositorySelector } from './RepositorySelector';
import { BacklogFilters } from './BacklogFilters';
import { BacklogTable } from './BacklogTable';

export function BacklogPage() {
  const queryClient = useQueryClient();

  const [selectedOwner, setSelectedOwner] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

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

  const handleRepoSelect = (owner: string, repo: string) => {
    setSelectedOwner(owner);
    setSelectedRepo(repo);
    setStateFilter('');
    setLabelFilter('');
    setSearchQuery('');
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

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto">
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
          <div className="bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
            <BacklogTable
              items={backlogItems}
              onDelete={(id) => deleteMutation.mutate(id)}
              isDeleting={deleteMutation.isPending}
            />
          </div>
        )}
      </div>
    </div>
  );
}
