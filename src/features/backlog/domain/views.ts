import type { BacklogItem } from '@/types/workflow';
import type { BacklogRecommendation } from '@/app/routes/backlog/recommendations';

export type SavedView = 'all' | 'recommended' | 'now' | 'next' | 'blocked' | 'unlinked';

export const SAVED_VIEW_OPTIONS: Array<[SavedView, string]> = [
  ['all', 'All'],
  ['recommended', 'Recommended'],
  ['now', 'Now'],
  ['next', 'Next'],
  ['blocked', 'Blocked'],
  ['unlinked', 'Unlinked'],
];

export function matchesSavedView(item: BacklogItem, view: SavedView): boolean {
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

export function collectAvailableLabels(items: BacklogItem[]): string[] {
  const labelSet = new Set<string>();
  for (const item of items) {
    for (const label of item.labels) {
      labelSet.add(label);
    }
  }
  return Array.from(labelSet).sort();
}

export function selectItemsForView(
  backlogItems: BacklogItem[],
  recommendedItems: BacklogRecommendation[],
  savedView: SavedView,
): BacklogItem[] {
  if (savedView === 'recommended') {
    return recommendedItems.map((entry) => entry.item);
  }
  return backlogItems.filter((item) => matchesSavedView(item, savedView));
}

export function computeSavedViewCounts(
  backlogItems: BacklogItem[],
  recommendedCount: number,
): Record<SavedView, number> {
  return {
    all: backlogItems.length,
    recommended: recommendedCount,
    now: backlogItems.filter((item) => matchesSavedView(item, 'now')).length,
    next: backlogItems.filter((item) => matchesSavedView(item, 'next')).length,
    blocked: backlogItems.filter((item) => matchesSavedView(item, 'blocked')).length,
    unlinked: backlogItems.filter((item) => matchesSavedView(item, 'unlinked')).length,
  };
}
