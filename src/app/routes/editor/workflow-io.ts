import type { NodeType, Workflow } from '@/types/workflow';
import { getNodeLabel } from '@/features/workflow-editor/nodes/catalog';

export const WORKFLOW_EXPORT_SCHEMA_VERSION = 1;

interface ExportEnvelopeV1 {
  schemaVersion: number;
  exportedAt: string;
  workflow: Workflow;
}

interface LegacyImportedWorkflow {
  name?: string;
  nodes?: Array<{
    id?: string;
    type?: string;
    node_type?: string;
    config?: Record<string, unknown>;
    position?: { x?: number; y?: number };
  }>;
  edges?: Array<{
    id?: string;
    source?: string;
    target?: string;
    sourceHandle?: string;
    targetHandle?: string;
    source_handle?: string;
    target_handle?: string;
  }>;
}

export interface NormalizedImportedWorkflow {
  name: string;
  nodes: Workflow['nodes'];
  edges: Workflow['edges'];
}

export interface EditorGraphData {
  nodes: Array<{
    id: string;
    type: 'workflowNode';
    position: { x: number; y: number };
    data: {
      label: string;
      nodeType: NodeType;
      config: Record<string, unknown>;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNodeType(value: unknown): NodeType {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Invalid workflow JSON: node type is missing');
  }
  return value as NodeType;
}

function getWorkflowPayload(raw: unknown): LegacyImportedWorkflow {
  if (!isObject(raw)) {
    throw new Error('Invalid workflow JSON: expected an object');
  }

  if ('schemaVersion' in raw) {
    const schemaVersion = raw.schemaVersion;
    if (schemaVersion !== WORKFLOW_EXPORT_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported workflow schemaVersion: ${String(schemaVersion)}. Expected ${WORKFLOW_EXPORT_SCHEMA_VERSION}.`,
      );
    }

    if (!isObject(raw.workflow)) {
      throw new Error('Invalid workflow JSON: missing workflow payload');
    }

    return raw.workflow as LegacyImportedWorkflow;
  }

  // Backward compatibility with pre-versioned exports.
  return raw as LegacyImportedWorkflow;
}

export function serializeWorkflowForExport(workflow: Workflow): string {
  const envelope: ExportEnvelopeV1 = {
    schemaVersion: WORKFLOW_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    workflow,
  };
  return JSON.stringify(envelope, null, 2);
}

export function parseImportedWorkflow(
  text: string,
  idFactory: (prefix: string, index: number) => string = (prefix, index) =>
    `${prefix}-${Date.now()}-${index}`,
): NormalizedImportedWorkflow {
  const raw = JSON.parse(text) as unknown;
  const payload = getWorkflowPayload(raw);

  if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
    throw new Error('Invalid workflow JSON: missing nodes/edges arrays');
  }

  const nodes: Workflow['nodes'] = payload.nodes.map((node, index) => {
    const nodeType = asNodeType(node.type ?? node.node_type);
    return {
      id: node.id || idFactory('node-imported', index),
      type: nodeType,
      config: node.config ?? {},
      position: node.position
        ? { x: node.position.x ?? 0, y: node.position.y ?? 0 }
        : { x: 0, y: 0 },
    };
  });

  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const edges: Workflow['edges'] = payload.edges
    .filter((edge) => edge.source && edge.target)
    .map((edge, index) => ({
      id: edge.id || idFactory('edge-imported', index),
      source: edge.source as string,
      target: edge.target as string,
      sourceHandle: edge.sourceHandle ?? edge.source_handle ?? undefined,
      targetHandle: edge.targetHandle ?? edge.target_handle ?? undefined,
    }))
    .filter((edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target));

  return {
    name: payload.name?.trim() || 'Imported Workflow',
    nodes,
    edges,
  };
}

export function toEditorGraph(workflow: Pick<Workflow, 'nodes' | 'edges'>): EditorGraphData {
  const nodes: EditorGraphData['nodes'] = workflow.nodes.map((node) => ({
    id: node.id,
    type: 'workflowNode',
    position: node.position ? { x: node.position.x, y: node.position.y } : { x: 0, y: 0 },
    data: {
      label: getNodeLabel(node.type),
      nodeType: node.type,
      config: node.config ?? {},
    },
  }));

  const edges: EditorGraphData['edges'] = workflow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
  }));

  return { nodes, edges };
}
