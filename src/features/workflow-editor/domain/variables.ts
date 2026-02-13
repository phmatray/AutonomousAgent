import type { TemplateVariable } from '@/components/ui/form';
import { getNodeLabel, NODE_SCHEMAS } from '@/features/workflow-editor/nodes/catalog';
import type { EditorEdgeLike, EditorNodeLike } from '@/features/workflow-editor/domain/types';

export function getAvailableVariablesForNode(
  nodeId: string,
  nodes: EditorNodeLike[],
  edges: EditorEdgeLike[],
): TemplateVariable[] {
  const upstream = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const edge of edges) {
      if (edge.target === current && !upstream.has(edge.source)) {
        upstream.add(edge.source);
        queue.push(edge.source);
      }
    }
  }

  const variables: TemplateVariable[] = [];
  for (const upstreamNodeId of upstream) {
    const node = nodes.find((n) => n.id === upstreamNodeId);
    if (!node) continue;

    const schema = NODE_SCHEMAS[node.data.nodeType];
    if (!schema) continue;

    for (const output of schema.outputs) {
      variables.push({
        label: `${getNodeLabel(node.data.nodeType)} - ${output.name}`,
        value: `${upstreamNodeId}.${output.name}`,
        description: output.description,
      });
    }
  }

  return variables;
}
