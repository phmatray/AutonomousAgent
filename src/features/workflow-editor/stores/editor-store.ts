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

interface NodeData extends Record<string, unknown> {
  label: string;
  nodeType: NodeType;
  config: Record<string, unknown>;
}

export type WorkflowNode = Node<NodeData>;
export type WorkflowEdge = Edge;

interface EditorState {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;
  workflowId: string | null;
  workflowName: string;
  isDirty: boolean;

  onNodesChange: OnNodesChange<WorkflowNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  setSelectedNode: (id: string | null) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  removeNode: (id: string) => void;
  updateNodeConfig: (id: string, config: Record<string, unknown>) => void;
  setWorkflow: (id: string, name: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  setWorkflowName: (name: string) => void;
  clearEditor: () => void;
}

const NODE_LABELS: Record<NodeType, string> = {
  'github.sync': 'Sync Repository',
  'github.readIssues': 'Read Issues',
  'github.createPR': 'Create PR',
  'git.worktree': 'Git Worktree',
  'git.branch': 'Git Branch',
  'git.commit': 'Git Commit',
  'claude.analyze': 'Claude Analyze',
  'claude.plan': 'Claude Plan',
  'claude.apply': 'Claude Apply',
  trigger: 'Trigger',
  condition: 'Condition',
  loop: 'Loop',
  delay: 'Delay',
};

function isConnectionValid(connection: Connection, nodes: WorkflowNode[]): boolean {
  if (connection.source === connection.target) return false;
  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);
  if (!sourceNode || !targetNode) return false;
  return true;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
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
    if (!isConnectionValid(connection, get().nodes)) return;
    set({
      edges: addEdge(
        { ...connection, animated: true, style: { stroke: '#6366f1' } },
        get().edges,
      ),
      isDirty: true,
    });
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),

  addNode: (type, position) => {
    const id = `node-${Date.now()}`;
    const newNode: WorkflowNode = {
      id,
      type: 'workflowNode',
      position,
      data: {
        label: NODE_LABELS[type],
        nodeType: type,
        config: {},
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
      isDirty: true,
    });
  },

  updateNodeConfig: (id, config) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, config } } : n,
      ),
      isDirty: true,
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
      workflowId: null,
      workflowName: 'Untitled Workflow',
      isDirty: false,
    });
  },
}));
