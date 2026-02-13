import { create } from 'zustand';
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Connection,
} from '@xyflow/react';
import type { NodeType } from '@/types/workflow';
import { NODE_METADATA, NODE_SCHEMAS } from '@/features/workflow-editor/config-schemas';
import type { TemplateVariable } from '@/components/ui/form';

interface NodeData extends Record<string, unknown> {
  label: string;
  nodeType: NodeType;
  config: Record<string, unknown>;
  executionStatus?: 'idle' | 'running' | 'completed' | 'error' | 'scheduled';
}

export type WorkflowNode = Node<NodeData>;
export type WorkflowEdge = Edge;

export interface FieldValidationError {
  key: string;
  message: string;
}

export interface NodeValidationResult {
  valid: boolean;
  errors: FieldValidationError[];
}

interface EditorState {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;
  pendingDeleteNodeId: string | null;
  workflowId: string | null;
  workflowName: string;
  isDirty: boolean;

  onNodesChange: OnNodesChange<WorkflowNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  setSelectedNode: (id: string | null) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  removeNode: (id: string) => void;
  requestDeleteNode: (id: string) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  updateNodeConfig: (id: string, config: Record<string, unknown>) => void;
  setGraph: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  clearGraph: () => void;
  setWorkflow: (id: string, name: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  setWorkflowName: (name: string) => void;
  clearEditor: () => void;
  getAvailableVariables: (nodeId: string) => TemplateVariable[];
  validateNodeConfig: (nodeId: string) => NodeValidationResult;
}

const NODE_LABELS: Record<NodeType, string> = Object.entries(NODE_METADATA).reduce(
  (acc, [nodeType, meta]) => {
    acc[nodeType as NodeType] = meta.label;
    return acc;
  },
  {} as Record<NodeType, string>,
);

function isConnectionValid(connection: Connection, nodes: WorkflowNode[], edges: WorkflowEdge[]): boolean {
  if (connection.source === connection.target) return false;
  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);
  if (!sourceNode || !targetNode) return false;

  // For condition nodes, prevent multiple edges from the same sourceHandle
  if (sourceNode.data.nodeType === 'condition' && connection.sourceHandle) {
    const existingEdge = edges.find(
      (e) => e.source === connection.source && e.sourceHandle === connection.sourceHandle,
    );
    if (existingEdge) return false;
  }

  return true;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  pendingDeleteNodeId: null,
  workflowId: null,
  workflowName: 'Untitled Workflow',
  isDirty: false,

  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
      isDirty: true,
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
      isDirty: true,
    });
  },

  onConnect: (connection) => {
    const { nodes, edges } = get();
    if (!isConnectionValid(connection, nodes, edges)) return;

    // Color edges based on condition node sourceHandle
    const sourceNode = nodes.find((n) => n.id === connection.source);
    let strokeColor = '#6366f1';
    if (sourceNode?.data.nodeType === 'condition') {
      strokeColor = connection.sourceHandle === 'true' ? '#059669' : '#dc2626';
    }

    set({
      edges: addEdge(
        { ...connection, animated: true, style: { stroke: strokeColor } },
        edges,
      ),
      isDirty: true,
    });
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  addNode: (type, position) => {
    const id = `node-${Date.now()}`;
    // Set default config based on node type
    const defaultConfig = type === 'trigger' ? { trigger_type: 'manual' } : {};
    const newNode: WorkflowNode = {
      id,
      type: 'workflowNode',
      position,
      data: {
        label: NODE_LABELS[type],
        nodeType: type,
        config: defaultConfig,
      },
    };
    set({
      nodes: [...get().nodes, newNode],
      isDirty: true,
    });
  },

  removeNode: (id) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
      pendingDeleteNodeId: get().pendingDeleteNodeId === id ? null : get().pendingDeleteNodeId,
      isDirty: true,
    });
  },

  requestDeleteNode: (id) => {
    const { edges } = get();
    const hasConnectedEdges = edges.some((e) => e.source === id || e.target === id);
    if (hasConnectedEdges) {
      set({ pendingDeleteNodeId: id });
    } else {
      get().removeNode(id);
    }
  },

  confirmDelete: () => {
    const { pendingDeleteNodeId } = get();
    if (pendingDeleteNodeId) {
      get().removeNode(pendingDeleteNodeId);
    }
  },

  cancelDelete: () => {
    set({ pendingDeleteNodeId: null });
  },

  updateNodeConfig: (id, config) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, config } } : n,
      ),
      isDirty: true,
    });
  },

  setGraph: (nodes, edges) => {
    set({
      nodes,
      edges,
      selectedNodeId: null,
      pendingDeleteNodeId: null,
      isDirty: false,
    });
  },

  clearGraph: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      pendingDeleteNodeId: null,
      isDirty: false,
    });
  },

  setWorkflow: (id, name, nodes, edges) => {
    set({
      workflowId: id,
      workflowName: name,
      nodes,
      edges,
      isDirty: false,
    });
  },

  setWorkflowName: (name) => set({ workflowName: name, isDirty: true }),

  clearEditor: () => {
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      pendingDeleteNodeId: null,
      workflowId: null,
      workflowName: 'Untitled Workflow',
      isDirty: false,
    });
  },

  getAvailableVariables: (nodeId: string): TemplateVariable[] => {
    const { nodes, edges } = get();
    // Find all upstream nodes by traversing edges backwards
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
    for (const upId of upstream) {
      const node = nodes.find((n) => n.id === upId);
      if (!node) continue;
      const schema = NODE_SCHEMAS[node.data.nodeType];
      if (!schema) continue;
      for (const output of schema.outputs) {
        variables.push({
          label: `${node.data.label} - ${output.name}`,
          value: `${upId}.${output.name}`,
          description: output.description,
        });
      }
    }
    return variables;
  },

  validateNodeConfig: (nodeId: string): NodeValidationResult => {
    const { nodes } = get();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return { valid: true, errors: [] };

    const schema = NODE_SCHEMAS[node.data.nodeType];
    if (!schema) return { valid: true, errors: [] };

    const config = (node.data.config ?? {}) as Record<string, unknown>;
    const errors: FieldValidationError[] = [];

    for (const field of schema.fields) {
      const value = config[field.key];
      if (field.required) {
        const strVal = typeof value === 'string' ? value.trim() : String(value ?? '');
        if (!value || strVal === '' || strVal === 'undefined') {
          errors.push({ key: field.key, message: `${field.label} is required` });
        }
      }
      if (field.type === 'number' && value !== undefined && value !== '') {
        const num = Number(value);
        if (isNaN(num)) {
          errors.push({ key: field.key, message: `${field.label} must be a number` });
        }
      }
    }

    return { valid: errors.length === 0, errors };
  },
}));
