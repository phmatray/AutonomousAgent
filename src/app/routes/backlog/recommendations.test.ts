import { describe, expect, it } from 'vitest';
import type { BacklogItem } from '@/types/workflow';
import { buildBacklogRecommendations } from './recommendations';

function createItem(overrides: Partial<BacklogItem>): BacklogItem {
  return {
    id: `item-${overrides.issue_number ?? 1}`,
    owner: 'acme',
    repo: 'agent',
    issue_number: 1,
    title: 'Example issue',
    body: 'Detailed issue context with implementation notes and acceptance criteria.',
    state: 'open',
    labels: [],
    assignees: [],
    html_url: 'https://github.com/acme/agent/issues/1',
    linked_workflow_id: undefined,
    resolution_guidelines_md: undefined,
    triage_status: 'inbox',
    priority: 'medium',
    effort: 'medium',
    impact: 'medium',
    rank: 50,
    synced_at: '2026-02-13T00:00:00Z',
    created_at: '2026-02-13T00:00:00Z',
    updated_at: '2026-02-13T00:00:00Z',
    ...overrides,
  };
}

describe('buildBacklogRecommendations', () => {
  it('ranks ready high-priority items above inbox medium-priority items', () => {
    const ready = createItem({
      id: 'ready',
      issue_number: 11,
      triage_status: 'ready',
      priority: 'high',
      impact: 'high',
      effort: 'small',
    });

    const inbox = createItem({
      id: 'inbox',
      issue_number: 12,
      triage_status: 'inbox',
      priority: 'medium',
      impact: 'medium',
      effort: 'medium',
    });

    const recommendations = buildBacklogRecommendations([inbox, ready]);

    expect(recommendations).toHaveLength(2);
    expect(recommendations[0].item.id).toBe('ready');
    expect(recommendations[1].item.id).toBe('inbox');
  });

  it('filters blocked, done, and closed issues from recommendations', () => {
    const blocked = createItem({ id: 'blocked', issue_number: 20, triage_status: 'blocked' });
    const done = createItem({ id: 'done', issue_number: 21, triage_status: 'done' });
    const closed = createItem({ id: 'closed', issue_number: 22, state: 'closed' });
    const ready = createItem({ id: 'ready', issue_number: 23, triage_status: 'ready' });

    const recommendations = buildBacklogRecommendations([blocked, done, closed, ready]);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].item.id).toBe('ready');
  });

  it('includes human-readable rationale for each recommendation', () => {
    const item = createItem({
      id: 'explainable',
      issue_number: 30,
      triage_status: 'ready',
      priority: 'critical',
      impact: 'high',
      effort: 'small',
      linked_workflow_id: undefined,
    });

    const [recommendation] = buildBacklogRecommendations([item]);

    expect(recommendation.rationale.length).toBeGreaterThan(0);
    expect(recommendation.rationale.join(' ')).toContain('Ready triage status');
    expect(recommendation.rationale.join(' ')).toContain('priority');
  });
});
