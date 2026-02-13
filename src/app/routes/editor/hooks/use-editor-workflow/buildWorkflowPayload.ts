import type { Workflow } from '@/types/workflow';
import type { WorkflowEdge, WorkflowNode } from '@/features/workflow-editor/stores/editor-store';

interface BuildWorkflowPayloadInput {
  workflowId: string | null;
  workflowName: string;
  workflowStatus: 'draft' | 'published';
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export function buildWorkflowPayload({
  workflowId,
  workflowName,
  workflowStatus,
  nodes,
  edges,
}: BuildWorkflowPayloadInput): Workflow {
  return {
    id: workflowId || '',
    name: workflowName,
    status: workflowStatus,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType,
      config: node.data.config || undefined,
      position: node.position ? { x: node.position.x, y: node.position.y } : undefined,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || undefined,
      targetHandle: edge.targetHandle || undefined,
    })),
    version: 1,
    createdAt: '',
    updatedAt: '',
  };
}
