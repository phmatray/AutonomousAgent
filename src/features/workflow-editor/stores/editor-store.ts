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
} from '@xyflow/react';
import type { NodeType } from '@/types/workflow';
import { getNodeLabel } from '@/features/workflow-editor/nodes/catalog';
import type { TemplateVariable } from '@/components/ui/form';
import {
  getConnectionStrokeColor,
  getAvailableVariablesForNode,
  isConnectionValid,
  validateNodeConfigForNode,
  type NodeValidationResult,
} from '@/features/workflow-editor/domain';

interface NodeData extends Record<string, unknown> {
  label: string;
  nodeType: NodeType;
  config: Record<string, unknown>;
  executionStatus?: 'idle' | 'running' | 'completed' | 'error' | 'scheduled';
}

export type WorkflowNode = Node<NodeData>;
export type WorkflowEdge = Edge;
export type { FieldValidationError, NodeValidationResult } from '@/features/workflow-editor/domain';

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
    const strokeColor = getConnectionStrokeColor(connection, nodes);

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
    const defaultConfig =
      type === 'trigger'
        ? { trigger_type: 'manual' }
        : type === 'trigger.cron'
          ? { schedule: '0 * * * *', timezone: 'UTC' }
          : {};
    const newNode: WorkflowNode = {
      id,
      type: 'workflowNode',
      position,
      data: {
        label: getNodeLabel(type),
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
    return getAvailableVariablesForNode(nodeId, nodes, edges);
  },

  validateNodeConfig: (nodeId: string): NodeValidationResult => {
    const { nodes } = get();
    return validateNodeConfigForNode(nodeId, nodes);
  },
}));
