export const queryKeys = {
  repositories: ['repositories'] as const,
  backlogItemsRoot: ['backlog-items'] as const,
  dashboardExecutionHealth: ['dashboard-execution-health'] as const,
  backlogItems(params: {
    owner: string;
    repo: string;
    stateFilter: string;
    triageFilter: string;
    priorityFilter: string;
    labelFilter: string;
    searchQuery: string;
  }) {
    return [
      ...queryKeys.backlogItemsRoot,
      params.owner,
      params.repo,
      params.stateFilter,
      params.triageFilter,
      params.priorityFilter,
      params.labelFilter,
      params.searchQuery,
    ] as const;
  },
};
