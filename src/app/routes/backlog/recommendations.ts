import type { BacklogItem } from '@/types/workflow';

export interface BacklogRecommendation {
  item: BacklogItem;
  score: number;
  rationale: string[];
}

function scorePriority(priority: BacklogItem['priority']): number {
  switch (priority) {
    case 'critical':
      return 30;
    case 'high':
      return 22;
    case 'medium':
      return 12;
    case 'low':
      return 4;
    default:
      return 0;
  }
}

function scoreTriageStatus(status: BacklogItem['triage_status']): number {
  switch (status) {
    case 'ready':
      return 32;
    case 'in_progress':
      return 20;
    case 'inbox':
      return 8;
    case 'blocked':
      return -40;
    case 'done':
      return -60;
    default:
      return 0;
  }
}

function scoreImpact(impact: BacklogItem['impact']): number {
  switch (impact) {
    case 'high':
      return 18;
    case 'medium':
      return 10;
    case 'low':
      return 3;
    default:
      return 0;
  }
}

function scoreEffort(effort: BacklogItem['effort']): number {
  switch (effort) {
    case 'small':
      return 12;
    case 'medium':
      return 6;
    case 'large':
      return -4;
    default:
      return 0;
  }
}

function scoreLabels(labels: string[]): number {
  const normalized = labels.map((label) => label.toLowerCase());
  let score = 0;

  if (normalized.includes('bug')) score += 8;
  if (normalized.includes('regression')) score += 8;
  if (normalized.includes('priority-high') || normalized.includes('priority-critical')) score += 12;
  if (normalized.includes('sprint-1') || normalized.includes('sprint-2')) score += 4;

  return score;
}

function buildRationale(item: BacklogItem): string[] {
  const rationale: string[] = [];

  if (item.triage_status === 'ready') rationale.push('Ready triage status indicates this can be automated now.');
  if (item.triage_status === 'in_progress') rationale.push('Already in progress, so completing automation is likely high leverage.');

  if (item.priority === 'critical' || item.priority === 'high') {
    rationale.push(`${item.priority === 'critical' ? 'Critical' : 'High'} priority raises urgency.`);
  }

  if (item.impact === 'high') rationale.push('High expected impact on delivery outcomes.');
  if (item.effort === 'small') rationale.push('Small effort suggests faster issue-to-PR turnaround.');

  if (!item.linked_workflow_id) {
    rationale.push('No linked workflow yet, so automation setup can unblock execution.');
  } else {
    rationale.push('Workflow already linked, so automation can be resumed immediately.');
  }

  if ((item.body ?? '').trim().length >= 80) {
    rationale.push('Issue description has enough detail for reliable execution.');
  }

  if (item.triage_status === 'blocked') rationale.push('Blocked triage status lowers readiness until dependency is resolved.');
  if (item.state !== 'open') rationale.push('Issue is not open, so this should not be automated first.');

  return rationale.slice(0, 3);
}

function scoreItem(item: BacklogItem): number {
  let score = 0;

  score += scorePriority(item.priority);
  score += scoreTriageStatus(item.triage_status);
  score += scoreImpact(item.impact);
  score += scoreEffort(item.effort);
  score += scoreLabels(item.labels);

  if (item.state === 'open') score += 8;
  if (!item.linked_workflow_id) score += 10;
  if ((item.body ?? '').trim().length >= 80) score += 4;

  return score;
}

export function buildBacklogRecommendations(items: BacklogItem[]): BacklogRecommendation[] {
  return items
    .filter((item) => item.state === 'open' && item.triage_status !== 'done' && item.triage_status !== 'blocked')
    .map((item) => ({
      item,
      score: scoreItem(item),
      rationale: buildRationale(item),
    }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      if (left.item.rank !== right.item.rank) return left.item.rank - right.item.rank;
      return left.item.issue_number - right.item.issue_number;
    });
}
