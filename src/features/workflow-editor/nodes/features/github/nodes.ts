import type { NodeFeatureDefinition } from '@/features/workflow-editor/nodes/features/types';

export const GITHUB_NODE_FEATURE: NodeFeatureDefinition = {
  key: 'github',
  label: 'GitHub',
  nodeTypes: [
    'github.sync',
    'github.readIssues',
    'github.readPullRequest',
    'backlog.syncIssues',
    'backlog.registerPullRequest',
    'github.createPR',
    'github.respondPullRequest',
  ],
};
