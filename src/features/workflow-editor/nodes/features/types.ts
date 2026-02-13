import type { NodeType } from '@/types/workflow';

export type NodeFeature = 'control' | 'github' | 'git' | 'claude';

export interface NodeFeatureDefinition {
  key: NodeFeature;
  label: string;
  nodeTypes: NodeType[];
}
