import type { Connection } from '@xyflow/react';
import type { EditorEdgeLike, EditorNodeLike } from '@/features/workflow-editor/domain/types';
import { getNodeInputMode, getNodeOutputMode } from '@/features/workflow-editor/nodes/catalog';

export function isConnectionValid(
  connection: Connection,
  nodes: EditorNodeLike[],
  edges: EditorEdgeLike[],
): boolean {
  if (connection.source === connection.target) return false;

  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);
  if (!sourceNode || !targetNode) return false;

  const targetInputMode = getNodeInputMode(targetNode.data.nodeType);
  if (targetInputMode === 'none') {
    return false;
  }

  const sourceOutputMode = getNodeOutputMode(sourceNode.data.nodeType);
  if (sourceOutputMode === 'branching' && connection.sourceHandle) {
    const existingEdge = edges.find(
      (edge) => edge.source === connection.source && edge.sourceHandle === connection.sourceHandle,
    );
    if (existingEdge) return false;
  }

  return true;
}

export function getConnectionStrokeColor(
  connection: Connection,
  nodes: EditorNodeLike[],
): string {
  const sourceNode = nodes.find((node) => node.id === connection.source);
  if (sourceNode && getNodeOutputMode(sourceNode.data.nodeType) === 'branching') {
    return connection.sourceHandle === 'true' ? '#a6e3a1' : '#f38ba8';
  }

  return '#cba6f7';
}
