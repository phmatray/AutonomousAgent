import type { Workflow, WorkflowEdge, WorkflowNode } from '@/types/workflow';

const nodes: WorkflowNode[] = [
  {
    id: 'trigger',
    type: 'trigger',
    config: { trigger_type: 'webhook' },
    position: { x: 120, y: 80 },
  },
  {
    id: 'openedCheck',
    type: 'condition',
    config: {
      condition: '{{trigger.action}}',
      operator: 'eq',
      value: 'opened',
    },
    position: { x: 400, y: 80 },
  },
  {
    id: 'readPullRequest',
    type: 'github.readPullRequest',
    config: {
      owner: '{{trigger.owner}}',
      repo: '{{trigger.repo}}',
      pr_number: '{{trigger.pr_number}}',
    },
    position: { x: 700, y: 20 },
  },
  {
    id: 'registerBacklog',
    type: 'backlog.registerPullRequest',
    config: {
      owner: '{{trigger.owner}}',
      repo: '{{trigger.repo}}',
      pr_number: '{{readPullRequest.number}}',
      title: '{{readPullRequest.title}}',
      body: '{{readPullRequest.body}}',
      state: '{{readPullRequest.state}}',
      html_url: '{{readPullRequest.html_url}}',
    },
    position: { x: 980, y: 20 },
  },
  {
    id: 'reviewWithClaude',
    type: 'claude.analyze',
    config: {
      prompt:
        'Review this pull request and generate a single markdown comment to post on GitHub.\n\n' +
        'Repository: {{trigger.owner}}/{{trigger.repo}}\n' +
        'PR #{{readPullRequest.number}}: {{readPullRequest.title}}\n' +
        'State: {{readPullRequest.state}}\n' +
        'URL: {{readPullRequest.html_url}}\n\n' +
        'PR Body:\n{{readPullRequest.body}}\n\n' +
        'Respond with:\n' +
        '1) Short summary\n' +
        '2) Blocking concerns (if any)\n' +
        '3) Non-blocking suggestions\n' +
        '4) Final reviewer response ready to post\n\n' +
        'Return only the final reviewer response markdown.',
      timeout_secs: 180,
    },
    position: { x: 1260, y: 20 },
  },
  {
    id: 'respondToPr',
    type: 'github.respondPullRequest',
    config: {
      owner: '{{trigger.owner}}',
      repo: '{{trigger.repo}}',
      pr_number: '{{readPullRequest.number}}',
      body: '{{reviewWithClaude.analysis}}',
    },
    position: { x: 1540, y: 20 },
  },
];

const edges: WorkflowEdge[] = [
  { id: 'e1', source: 'trigger', target: 'openedCheck' },
  { id: 'e2', source: 'openedCheck', target: 'readPullRequest', sourceHandle: 'true' },
  { id: 'e3', source: 'readPullRequest', target: 'registerBacklog' },
  { id: 'e4', source: 'registerBacklog', target: 'reviewWithClaude' },
  { id: 'e5', source: 'reviewWithClaude', target: 'respondToPr' },
];

export function createPullRequestReviewWorkflow(): Omit<
  Workflow,
  'id' | 'createdAt' | 'updatedAt' | 'version'
> {
  return {
    name: 'PR Opened Intake and Review',
    description:
      'On pull request opened: register in backlog, draft Claude review, and post response to the PR.',
    nodes,
    edges,
    config: {
      trigger_source: 'github.pull_request',
    },
  };
}
