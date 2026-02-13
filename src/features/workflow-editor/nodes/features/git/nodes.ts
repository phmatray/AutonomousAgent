import type { NodeFeatureDefinition } from '@/features/workflow-editor/nodes/features/types';

export const GIT_NODE_FEATURE: NodeFeatureDefinition = {
  key: 'git',
  label: 'Git',
  nodeTypes: ['git.worktree', 'git.branch', 'git.commit'],
};
