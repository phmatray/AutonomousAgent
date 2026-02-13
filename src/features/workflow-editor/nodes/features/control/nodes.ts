import type { NodeFeatureDefinition } from '@/features/workflow-editor/nodes/features/types';

export const CONTROL_NODE_FEATURE: NodeFeatureDefinition = {
  key: 'control',
  label: 'Control Flow',
  nodeTypes: ['trigger', 'condition', 'loop', 'delay'],
};
