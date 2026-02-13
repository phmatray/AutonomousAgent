import { invoke } from '@tauri-apps/api/core';
import type {
  BacklogEffort,
  BacklogImpact,
  BacklogItem,
  BacklogPriority,
  BacklogTriageStatus,
  Workflow,
} from '@/types/workflow';

export interface BacklogFilters {
  owner?: string;
  repo?: string;
  stateFilter?: string;
  label?: string;
  search?: string;
  triageStatus?: BacklogTriageStatus;
  priority?: BacklogPriority;
  linked?: boolean;
}

export async function listBacklogItems(
  filters: BacklogFilters = {},
): Promise<BacklogItem[]> {
  return invoke('list_backlog_items', {
    filters: {
      owner: filters.owner ?? null,
      repo: filters.repo ?? null,
      stateFilter: filters.stateFilter ?? null,
      label: filters.label ?? null,
      search: filters.search ?? null,
      triageStatus: filters.triageStatus ?? null,
      priority: filters.priority ?? null,
      linked: filters.linked ?? null,
    },
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

export interface CreateLinkedWorkflowResult {
  workflow: Workflow;
  backlogItem: BacklogItem;
  usedFallbackGuidelines: boolean;
}

export async function createLinkedWorkflowFromBacklog(
  backlogItemId: string,
): Promise<CreateLinkedWorkflowResult> {
  return invoke('create_linked_workflow_from_backlog', { backlogItemId });
}

export async function deleteBacklogItem(id: string): Promise<void> {
  return invoke('delete_backlog_item', { id });
}

export interface BacklogTriagePatch {
  triageStatus?: BacklogTriageStatus;
  priority?: BacklogPriority;
  effort?: BacklogEffort;
  impact?: BacklogImpact;
  rank?: number;
}

export async function updateBacklogItemTriage(
  backlogItemId: string,
  patch: BacklogTriagePatch,
): Promise<BacklogItem> {
  return invoke('update_backlog_item_triage', {
    backlogItemId,
    triageStatus: patch.triageStatus ?? null,
    priority: patch.priority ?? null,
    effort: patch.effort ?? null,
    impact: patch.impact ?? null,
    rank: patch.rank ?? null,
  });
}

export async function bulkUpdateBacklogTriage(
  ids: string[],
  patch: BacklogTriagePatch & { archive?: boolean },
): Promise<number> {
  return invoke('bulk_update_backlog_triage', {
    request: {
      ids,
      triageStatus: patch.triageStatus ?? null,
      priority: patch.priority ?? null,
      effort: patch.effort ?? null,
      impact: patch.impact ?? null,
      rank: patch.rank ?? null,
      archive: patch.archive ?? null,
    },
  });
}
