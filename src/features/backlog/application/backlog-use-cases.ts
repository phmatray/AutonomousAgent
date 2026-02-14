import type { QueryClient } from '@tanstack/react-query';
import {
  bulkUpdateBacklogTriage,
  createLinkedWorkflowFromBacklog,
  deleteBacklogItem,
  listBacklogItems,
  syncGithubIssuesToBacklog,
  updateBacklogItemTriage,
  type BacklogFilters,
  type BacklogTriagePatch,
} from '@/lib/api/backlog';
import type { BacklogPriority, BacklogTriageStatus } from '@/types/workflow';

export function listBacklogItemsForView(filters: BacklogFilters) {
  return listBacklogItems(filters);
}

export function syncIssuesToBacklog(owner: string, repo: string) {
  return syncGithubIssuesToBacklog(owner, repo);
}

export function removeBacklogItem(id: string) {
  return deleteBacklogItem(id);
}

export function createWorkflowFromBacklog(backlogItemId: string) {
  return createLinkedWorkflowFromBacklog(backlogItemId);
}

export function updateBacklogTriage(backlogItemId: string, patch: BacklogTriagePatch) {
  return updateBacklogItemTriage(backlogItemId, patch);
}

export function bulkUpdateTriage(
  ids: string[],
  patch: {
    triageStatus?: BacklogTriageStatus;
    priority?: BacklogPriority;
    archive?: boolean;
  },
) {
  return bulkUpdateBacklogTriage(ids, patch);
}

export function invalidateBacklogQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ['backlog-items'] });
}
