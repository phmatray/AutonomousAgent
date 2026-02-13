import type { NodeFeatureDefinition } from '@/features/workflow-editor/nodes/features/types';

export const CLAUDE_NODE_FEATURE: NodeFeatureDefinition = {
  key: 'claude',
  label: 'Claude AI',
  nodeTypes: ['claude.analyze', 'claude.plan', 'claude.apply'],
};
