import { invoke } from '@tauri-apps/api/core';
import type { BacklogItem } from '@/types/workflow';

export interface BacklogFilters {
  owner?: string;
  repo?: string;
  stateFilter?: string;
  label?: string;
  search?: string;
}

export async function listBacklogItems(
  filters: BacklogFilters = {},
): Promise<BacklogItem[]> {
  return invoke('list_backlog_items', {
    owner: filters.owner ?? null,
    repo: filters.repo ?? null,
    stateFilter: filters.stateFilter ?? null,
    label: filters.label ?? null,
    search: filters.search ?? null,
  });
}

export async function syncGithubIssuesToBacklog(
  owner: string,
  repo: string,
): Promise<BacklogItem[]> {
  return invoke('sync_github_issues_to_backlog', { owner, repo });
}

export async function linkBacklogToWorkflow(
  backlogItemId: string,
  workflowId: string,
): Promise<void> {
  return invoke('link_backlog_to_workflow', { backlogItemId, workflowId });
}

export async function deleteBacklogItem(id: string): Promise<void> {
  return invoke('delete_backlog_item', { id });
}
