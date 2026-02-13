import { NODE_METADATA } from '@/features/workflow-editor/nodes/catalog';
import type { NodeType } from '@/types/workflow';
import { CLAUDE_NODE_FEATURE } from '@/features/workflow-editor/nodes/features/claude/nodes';
import { CONTROL_NODE_FEATURE } from '@/features/workflow-editor/nodes/features/control/nodes';
import { GIT_NODE_FEATURE } from '@/features/workflow-editor/nodes/features/git/nodes';
import { GITHUB_NODE_FEATURE } from '@/features/workflow-editor/nodes/features/github/nodes';
import type { NodeFeature, NodeFeatureDefinition } from '@/features/workflow-editor/nodes/features/types';
export type { NodeFeature, NodeFeatureDefinition } from '@/features/workflow-editor/nodes/features/types';

export const NODE_FEATURES: NodeFeatureDefinition[] = [
  CONTROL_NODE_FEATURE,
  GITHUB_NODE_FEATURE,
  GIT_NODE_FEATURE,
  CLAUDE_NODE_FEATURE,
];

export const NODE_PALETTE_ORDER: NodeType[] = NODE_FEATURES.flatMap((feature) => feature.nodeTypes);

export function getNodeFeature(nodeType: NodeType): NodeFeature {
  return NODE_METADATA[nodeType]?.category ?? 'control';
}
