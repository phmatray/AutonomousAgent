import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, type WorkflowNode, type WorkflowEdge } from '../editor-store';
import type { NodeType } from '@/types/workflow';

// Helper to reset store to default state before each test
function resetStore() {
  useEditorStore.setState({
    nodes: [],
    edges: [],
    selectedNodeId: null,
    pendingDeleteNodeId: null,
    workflowId: null,
    workflowName: 'Untitled Workflow',
    isDirty: false,
  });
}

// Helper to create a test node
function createTestNode(
  id: string,
  nodeType: NodeType,
  config: Record<string, unknown> = {},
  position = { x: 0, y: 0 },
): WorkflowNode {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label: `Test ${nodeType}`,
      nodeType,
      config,
    },
  };
}

// Helper to create a test edge
function createTestEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
): WorkflowEdge {
  return {
    id,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  };
}

describe('Editor Store', () => {
  beforeEach(() => {
    resetStore();
  });

  // =============================================
  // 1. Initial State
  // =============================================
  describe('Initial State', () => {
    it('starts with empty nodes and edges', () => {
      const state = useEditorStore.getState();
      expect(state.nodes).toEqual([]);
      expect(state.edges).toEqual([]);
    });

    it('starts with no selection', () => {
      const state = useEditorStore.getState();
      expect(state.selectedNodeId).toBeNull();
      expect(state.pendingDeleteNodeId).toBeNull();
    });

    it('starts with no workflow loaded', () => {
      const state = useEditorStore.getState();
      expect(state.workflowId).toBeNull();
      expect(state.workflowName).toBe('Untitled Workflow');
      expect(state.isDirty).toBe(false);
    });
  });

  // =============================================
  // 2. Node Addition
  // =============================================
  describe('addNode', () => {
    it('adds a node with correct structure', () => {
      useEditorStore.getState().addNode('github.sync', { x: 100, y: 200 });
      const state = useEditorStore.getState();

      expect(state.nodes).toHaveLength(1);
      const node = state.nodes[0];
      expect(node.id).toMatch(/^node-\d+$/);
      expect(node.type).toBe('workflowNode');
      expect(node.position).toEqual({ x: 100, y: 200 });
      expect(node.data.label).toBe('Sync Repository');
      expect(node.data.nodeType).toBe('github.sync');
      expect(node.data.config).toEqual({});
    });

    it('sets default config for trigger nodes', () => {
      useEditorStore.getState().addNode('trigger', { x: 0, y: 0 });
      const node = useEditorStore.getState().nodes[0];
      expect(node.data.config).toEqual({ trigger_type: 'manual' });
    });

    it('sets empty config for non-trigger nodes', () => {
      useEditorStore.getState().addNode('claude.plan', { x: 0, y: 0 });
      const node = useEditorStore.getState().nodes[0];
      expect(node.data.config).toEqual({});
    });

    it('marks state as dirty after adding a node', () => {
      expect(useEditorStore.getState().isDirty).toBe(false);
      useEditorStore.getState().addNode('github.sync', { x: 0, y: 0 });
      expect(useEditorStore.getState().isDirty).toBe(true);
    });

    it('generates unique IDs for multiple nodes', () => {
      // Mock Date.now to ensure distinct timestamps
      const originalNow = Date.now;
      let counter = 1000;
      Date.now = () => counter++;

      try {
        const store = useEditorStore.getState();
        store.addNode('trigger', { x: 0, y: 0 });
        store.addNode('github.sync', { x: 100, y: 0 });

        const state = useEditorStore.getState();
        expect(state.nodes).toHaveLength(2);
        expect(state.nodes[0].id).not.toBe(state.nodes[1].id);
      } finally {
        Date.now = originalNow;
      }
    });

    it('uses correct labels for all node types', () => {
      const expectedLabels: Record<NodeType, string> = {
        'backlog.syncIssues': 'Sync Issues to Backlog',
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

      for (const [nodeType, expectedLabel] of Object.entries(expectedLabels)) {
        resetStore();
        useEditorStore.getState().addNode(nodeType as NodeType, { x: 0, y: 0 });
        const node = useEditorStore.getState().nodes[0];
        expect(node.data.label).toBe(expectedLabel);
      }
    });

    it('appends to existing nodes', () => {
      useEditorStore.getState().addNode('trigger', { x: 0, y: 0 });
      useEditorStore.getState().addNode('github.sync', { x: 200, y: 0 });
      useEditorStore.getState().addNode('claude.plan', { x: 400, y: 0 });

      expect(useEditorStore.getState().nodes).toHaveLength(3);
    });
  });

  // =============================================
  // 3. Node Removal
  // =============================================
  describe('removeNode', () => {
    it('removes a node by id', () => {
      const node = createTestNode('node-1', 'github.sync');
      useEditorStore.setState({ nodes: [node] });

      useEditorStore.getState().removeNode('node-1');

      expect(useEditorStore.getState().nodes).toHaveLength(0);
    });

    it('removes connected edges when a node is removed', () => {
      const nodes = [
        createTestNode('node-1', 'trigger'),
        createTestNode('node-2', 'github.sync'),
        createTestNode('node-3', 'claude.plan'),
      ];
      const edges = [
        createTestEdge('e1', 'node-1', 'node-2'),
        createTestEdge('e2', 'node-2', 'node-3'),
      ];
      useEditorStore.setState({ nodes, edges });

      useEditorStore.getState().removeNode('node-2');

      const state = useEditorStore.getState();
      expect(state.nodes).toHaveLength(2);
      expect(state.edges).toHaveLength(0); // Both edges connected to node-2 removed
    });

    it('clears selectedNodeId if removed node was selected', () => {
      const node = createTestNode('node-1', 'github.sync');
      useEditorStore.setState({ nodes: [node], selectedNodeId: 'node-1' });

      useEditorStore.getState().removeNode('node-1');

      expect(useEditorStore.getState().selectedNodeId).toBeNull();
    });

    it('keeps selectedNodeId if removed node was not selected', () => {
      const nodes = [
        createTestNode('node-1', 'trigger'),
        createTestNode('node-2', 'github.sync'),
      ];
      useEditorStore.setState({ nodes, selectedNodeId: 'node-2' });

      useEditorStore.getState().removeNode('node-1');

      expect(useEditorStore.getState().selectedNodeId).toBe('node-2');
    });

    it('clears pendingDeleteNodeId if removed node was pending', () => {
      const node = createTestNode('node-1', 'github.sync');
      useEditorStore.setState({ nodes: [node], pendingDeleteNodeId: 'node-1' });

      useEditorStore.getState().removeNode('node-1');

      expect(useEditorStore.getState().pendingDeleteNodeId).toBeNull();
    });

    it('marks state as dirty', () => {
      const node = createTestNode('node-1', 'github.sync');
      useEditorStore.setState({ nodes: [node], isDirty: false });

      useEditorStore.getState().removeNode('node-1');

      expect(useEditorStore.getState().isDirty).toBe(true);
    });

    it('does not affect unrelated edges', () => {
      const nodes = [
        createTestNode('node-1', 'trigger'),
        createTestNode('node-2', 'github.sync'),
        createTestNode('node-3', 'claude.plan'),
      ];
      const edges = [
        createTestEdge('e1', 'node-1', 'node-2'),
        createTestEdge('e2', 'node-1', 'node-3'),
      ];
      useEditorStore.setState({ nodes, edges });

      useEditorStore.getState().removeNode('node-2');

      const state = useEditorStore.getState();
      expect(state.edges).toHaveLength(1);
      expect(state.edges[0].id).toBe('e2');
    });
  });

  // =============================================
  // 4. Delete Confirmation (requestDeleteNode)
  // =============================================
  describe('requestDeleteNode / confirmDelete / cancelDelete', () => {
    it('removes node immediately if it has no connected edges', () => {
      const node = createTestNode('node-1', 'github.sync');
      useEditorStore.setState({ nodes: [node] });

      useEditorStore.getState().requestDeleteNode('node-1');

      expect(useEditorStore.getState().nodes).toHaveLength(0);
      expect(useEditorStore.getState().pendingDeleteNodeId).toBeNull();
    });

    it('sets pendingDeleteNodeId if node has connected edges', () => {
      const nodes = [
        createTestNode('node-1', 'trigger'),
        createTestNode('node-2', 'github.sync'),
      ];
      const edges = [createTestEdge('e1', 'node-1', 'node-2')];
      useEditorStore.setState({ nodes, edges });

      useEditorStore.getState().requestDeleteNode('node-1');

      const state = useEditorStore.getState();
      expect(state.nodes).toHaveLength(2); // Not yet removed
      expect(state.pendingDeleteNodeId).toBe('node-1');
    });

    it('confirmDelete removes the pending node', () => {
      const nodes = [
        createTestNode('node-1', 'trigger'),
        createTestNode('node-2', 'github.sync'),
      ];
      const edges = [createTestEdge('e1', 'node-1', 'node-2')];
      useEditorStore.setState({ nodes, edges, pendingDeleteNodeId: 'node-1' });

      useEditorStore.getState().confirmDelete();

      const state = useEditorStore.getState();
      expect(state.nodes).toHaveLength(1);
      expect(state.nodes[0].id).toBe('node-2');
      expect(state.pendingDeleteNodeId).toBeNull();
    });

    it('confirmDelete does nothing if no pending node', () => {
      const node = createTestNode('node-1', 'github.sync');
      useEditorStore.setState({ nodes: [node] });

      useEditorStore.getState().confirmDelete();

      expect(useEditorStore.getState().nodes).toHaveLength(1);
    });

    it('cancelDelete clears pendingDeleteNodeId', () => {
      useEditorStore.setState({ pendingDeleteNodeId: 'node-1' });

      useEditorStore.getState().cancelDelete();

      expect(useEditorStore.getState().pendingDeleteNodeId).toBeNull();
    });
  });

  // =============================================
  // 5. Edge Creation (onConnect)
  // =============================================
  describe('onConnect', () => {
    it('creates an edge from a valid connection', () => {
      const nodes = [
        createTestNode('node-1', 'trigger'),
        createTestNode('node-2', 'github.sync'),
      ];
      useEditorStore.setState({ nodes });

      useEditorStore.getState().onConnect({
        source: 'node-1',
        target: 'node-2',
        sourceHandle: null,
        targetHandle: null,
      });

      const state = useEditorStore.getState();
      expect(state.edges).toHaveLength(1);
      expect(state.edges[0].source).toBe('node-1');
      expect(state.edges[0].target).toBe('node-2');
      expect(state.isDirty).toBe(true);
    });

    it('rejects self-connections', () => {
      const node = createTestNode('node-1', 'trigger');
      useEditorStore.setState({ nodes: [node] });

      useEditorStore.getState().onConnect({
        source: 'node-1',
        target: 'node-1',
        sourceHandle: null,
        targetHandle: null,
      });

      expect(useEditorStore.getState().edges).toHaveLength(0);
    });

    it('rejects connections with missing source node', () => {
      const node = createTestNode('node-2', 'github.sync');
      useEditorStore.setState({ nodes: [node] });

      useEditorStore.getState().onConnect({
        source: 'node-missing',
        target: 'node-2',
        sourceHandle: null,
        targetHandle: null,
      });

      expect(useEditorStore.getState().edges).toHaveLength(0);
    });

    it('rejects connections with missing target node', () => {
      const node = createTestNode('node-1', 'trigger');
      useEditorStore.setState({ nodes: [node] });

      useEditorStore.getState().onConnect({
        source: 'node-1',
        target: 'node-missing',
        sourceHandle: null,
        targetHandle: null,
      });

      expect(useEditorStore.getState().edges).toHaveLength(0);
    });

    it('prevents duplicate condition sourceHandle edges', () => {
      const nodes = [
        createTestNode('cond-1', 'condition'),
        createTestNode('node-2', 'github.sync'),
        createTestNode('node-3', 'claude.plan'),
      ];
      const existingEdge = createTestEdge('e1', 'cond-1', 'node-2', 'true');
      useEditorStore.setState({ nodes, edges: [existingEdge] });

      useEditorStore.getState().onConnect({
        source: 'cond-1',
        target: 'node-3',
        sourceHandle: 'true', // Same sourceHandle as existing edge
        targetHandle: null,
      });

      expect(useEditorStore.getState().edges).toHaveLength(1); // No new edge added
    });

    it('allows condition node connections from different sourceHandles', () => {
      const nodes = [
        createTestNode('cond-1', 'condition'),
        createTestNode('node-2', 'github.sync'),
        createTestNode('node-3', 'claude.plan'),
      ];
      const existingEdge = createTestEdge('e1', 'cond-1', 'node-2', 'true');
      useEditorStore.setState({ nodes, edges: [existingEdge] });

      useEditorStore.getState().onConnect({
        source: 'cond-1',
        target: 'node-3',
        sourceHandle: 'false', // Different sourceHandle
        targetHandle: null,
      });

      expect(useEditorStore.getState().edges).toHaveLength(2);
    });

    it('uses green stroke for condition true branch', () => {
      const nodes = [
        createTestNode('cond-1', 'condition'),
        createTestNode('node-2', 'github.sync'),
      ];
      useEditorStore.setState({ nodes });

      useEditorStore.getState().onConnect({
        source: 'cond-1',
        target: 'node-2',
        sourceHandle: 'true',
        targetHandle: null,
      });

      const edge = useEditorStore.getState().edges[0];
      expect(edge.style?.stroke).toBe('#a6e3a1');
    });

    it('uses red stroke for condition false branch', () => {
      const nodes = [
        createTestNode('cond-1', 'condition'),
        createTestNode('node-2', 'github.sync'),
      ];
      useEditorStore.setState({ nodes });

      useEditorStore.getState().onConnect({
        source: 'cond-1',
        target: 'node-2',
        sourceHandle: 'false',
        targetHandle: null,
      });

      const edge = useEditorStore.getState().edges[0];
      expect(edge.style?.stroke).toBe('#f38ba8');
    });

    it('uses default indigo stroke for non-condition nodes', () => {
      const nodes = [
        createTestNode('node-1', 'trigger'),
        createTestNode('node-2', 'github.sync'),
      ];
      useEditorStore.setState({ nodes });

      useEditorStore.getState().onConnect({
        source: 'node-1',
        target: 'node-2',
        sourceHandle: null,
        targetHandle: null,
      });

      const edge = useEditorStore.getState().edges[0];
      expect(edge.style?.stroke).toBe('#cba6f7');
    });

    it('sets animated to true on created edges', () => {
      const nodes = [
        createTestNode('node-1', 'trigger'),
        createTestNode('node-2', 'github.sync'),
      ];
      useEditorStore.setState({ nodes });

      useEditorStore.getState().onConnect({
        source: 'node-1',
        target: 'node-2',
        sourceHandle: null,
        targetHandle: null,
      });

      expect(useEditorStore.getState().edges[0].animated).toBe(true);
    });
  });

  // =============================================
  // 6. Edge Deletion (onEdgesChange)
  // =============================================
  describe('onEdgesChange', () => {
    it('applies edge removal changes', () => {
      const edges = [createTestEdge('e1', 'node-1', 'node-2')];
      useEditorStore.setState({ edges });

      useEditorStore.getState().onEdgesChange([
        { id: 'e1', type: 'remove' },
      ]);

      expect(useEditorStore.getState().edges).toHaveLength(0);
      expect(useEditorStore.getState().isDirty).toBe(true);
    });
  });

  // =============================================
  // 7. Node Selection
  // =============================================
  describe('setSelectedNode', () => {
    it('sets selected node id', () => {
      useEditorStore.getState().setSelectedNode('node-1');
      expect(useEditorStore.getState().selectedNodeId).toBe('node-1');
    });

    it('clears selected node when set to null', () => {
      useEditorStore.setState({ selectedNodeId: 'node-1' });
      useEditorStore.getState().setSelectedNode(null);
      expect(useEditorStore.getState().selectedNodeId).toBeNull();
    });

    it('changes selection to a different node', () => {
      useEditorStore.setState({ selectedNodeId: 'node-1' });
      useEditorStore.getState().setSelectedNode('node-2');
      expect(useEditorStore.getState().selectedNodeId).toBe('node-2');
    });
  });

  // =============================================
  // 8. Update Node Config
  // =============================================
  describe('updateNodeConfig', () => {
    it('updates config for a specific node', () => {
      const node = createTestNode('node-1', 'github.sync', { owner: 'old' });
      useEditorStore.setState({ nodes: [node] });

      useEditorStore.getState().updateNodeConfig('node-1', { owner: 'new-owner', repo: 'test' });

      const updated = useEditorStore.getState().nodes[0];
      expect(updated.data.config).toEqual({ owner: 'new-owner', repo: 'test' });
    });

    it('does not affect other nodes', () => {
      const nodes = [
        createTestNode('node-1', 'trigger', { trigger_type: 'manual' }),
        createTestNode('node-2', 'github.sync', { owner: 'original' }),
      ];
      useEditorStore.setState({ nodes });

      useEditorStore.getState().updateNodeConfig('node-2', { owner: 'updated' });

      const state = useEditorStore.getState();
      expect(state.nodes[0].data.config).toEqual({ trigger_type: 'manual' });
      expect(state.nodes[1].data.config).toEqual({ owner: 'updated' });
    });

    it('marks state as dirty', () => {
      const node = createTestNode('node-1', 'github.sync');
      useEditorStore.setState({ nodes: [node], isDirty: false });

      useEditorStore.getState().updateNodeConfig('node-1', { owner: 'test' });

      expect(useEditorStore.getState().isDirty).toBe(true);
    });
  });

  // =============================================
  // 9. setWorkflow
  // =============================================
  describe('setWorkflow', () => {
    it('loads a workflow into the editor', () => {
      const nodes = [createTestNode('node-1', 'trigger')];
      const edges = [createTestEdge('e1', 'node-1', 'node-2')];

      useEditorStore.getState().setWorkflow('wf-1', 'My Workflow', nodes, edges);

      const state = useEditorStore.getState();
      expect(state.workflowId).toBe('wf-1');
      expect(state.workflowName).toBe('My Workflow');
      expect(state.nodes).toEqual(nodes);
      expect(state.edges).toEqual(edges);
      expect(state.isDirty).toBe(false);
    });

    it('resets dirty flag when loading workflow', () => {
      useEditorStore.setState({ isDirty: true });

      useEditorStore.getState().setWorkflow('wf-1', 'Test', [], []);

      expect(useEditorStore.getState().isDirty).toBe(false);
    });
  });

  // =============================================
  // 10. setWorkflowName
  // =============================================
  describe('setWorkflowName', () => {
    it('updates workflow name', () => {
      useEditorStore.getState().setWorkflowName('New Name');
      expect(useEditorStore.getState().workflowName).toBe('New Name');
    });

    it('marks state as dirty', () => {
      useEditorStore.getState().setWorkflowName('Changed');
      expect(useEditorStore.getState().isDirty).toBe(true);
    });
  });

  // =============================================
  // 11. clearEditor
  // =============================================
  describe('clearEditor', () => {
    it('resets all state to defaults', () => {
      // Set up a non-default state
      useEditorStore.setState({
        nodes: [createTestNode('node-1', 'trigger')],
        edges: [createTestEdge('e1', 'node-1', 'node-2')],
        selectedNodeId: 'node-1',
        pendingDeleteNodeId: 'node-1',
        workflowId: 'wf-1',
        workflowName: 'My Workflow',
        isDirty: true,
      });

      useEditorStore.getState().clearEditor();

      const state = useEditorStore.getState();
      expect(state.nodes).toEqual([]);
      expect(state.edges).toEqual([]);
      expect(state.selectedNodeId).toBeNull();
      expect(state.pendingDeleteNodeId).toBeNull();
      expect(state.workflowId).toBeNull();
      expect(state.workflowName).toBe('Untitled Workflow');
      expect(state.isDirty).toBe(false);
    });
  });

  // =============================================
  // 12. onNodesChange
  // =============================================
  describe('onNodesChange', () => {
    it('applies node position changes', () => {
      const node = createTestNode('node-1', 'trigger', {}, { x: 0, y: 0 });
      useEditorStore.setState({ nodes: [node] });

      useEditorStore.getState().onNodesChange([
        {
          id: 'node-1',
          type: 'position',
          position: { x: 100, y: 200 },
        },
      ]);

      const updated = useEditorStore.getState().nodes[0];
      expect(updated.position).toEqual({ x: 100, y: 200 });
      expect(useEditorStore.getState().isDirty).toBe(true);
    });

    it('applies node removal changes', () => {
      const node = createTestNode('node-1', 'trigger');
      useEditorStore.setState({ nodes: [node] });

      useEditorStore.getState().onNodesChange([
        { id: 'node-1', type: 'remove' },
      ]);

      expect(useEditorStore.getState().nodes).toHaveLength(0);
    });
  });

  // =============================================
  // 13. getAvailableVariables
  // =============================================
  describe('getAvailableVariables', () => {
    it('returns empty array when no upstream nodes', () => {
      const node = createTestNode('node-1', 'trigger');
      useEditorStore.setState({ nodes: [node] });

      const variables = useEditorStore.getState().getAvailableVariables('node-1');

      expect(variables).toEqual([]);
    });

    it('returns variables from direct upstream node', () => {
      const nodes = [
        createTestNode('trigger-1', 'trigger'),
        createTestNode('sync-1', 'github.sync'),
      ];
      const edges = [createTestEdge('e1', 'trigger-1', 'sync-1')];
      useEditorStore.setState({ nodes, edges });

      const variables = useEditorStore.getState().getAvailableVariables('sync-1');

      // Trigger node has outputs: triggered_at, trigger_type
      expect(variables.length).toBeGreaterThan(0);
      expect(variables.some((v) => v.value === 'trigger-1.triggered_at')).toBe(true);
      expect(variables.some((v) => v.value === 'trigger-1.trigger_type')).toBe(true);
    });

    it('returns variables from transitive upstream nodes', () => {
      const nodes = [
        createTestNode('trigger-1', 'trigger'),
        createTestNode('sync-1', 'github.sync'),
        createTestNode('issues-1', 'github.readIssues'),
      ];
      const edges = [
        createTestEdge('e1', 'trigger-1', 'sync-1'),
        createTestEdge('e2', 'sync-1', 'issues-1'),
      ];
      useEditorStore.setState({ nodes, edges });

      const variables = useEditorStore.getState().getAvailableVariables('issues-1');

      // Should have variables from both trigger and sync nodes
      expect(variables.some((v) => v.value === 'trigger-1.triggered_at')).toBe(true);
      expect(variables.some((v) => v.value === 'sync-1.repo_path')).toBe(true);
      expect(variables.some((v) => v.value === 'sync-1.owner')).toBe(true);
      expect(variables.some((v) => v.value === 'sync-1.repo')).toBe(true);
    });

    it('does not include downstream node variables', () => {
      const nodes = [
        createTestNode('trigger-1', 'trigger'),
        createTestNode('sync-1', 'github.sync'),
      ];
      const edges = [createTestEdge('e1', 'trigger-1', 'sync-1')];
      useEditorStore.setState({ nodes, edges });

      const variables = useEditorStore.getState().getAvailableVariables('trigger-1');

      // Trigger is the first node, should have no upstream variables
      expect(variables).toHaveLength(0);
    });

    it('does not include variables from self', () => {
      const nodes = [
        createTestNode('trigger-1', 'trigger'),
        createTestNode('sync-1', 'github.sync'),
      ];
      const edges = [createTestEdge('e1', 'trigger-1', 'sync-1')];
      useEditorStore.setState({ nodes, edges });

      const variables = useEditorStore.getState().getAvailableVariables('sync-1');

      // Should not contain sync-1's own variables
      expect(variables.some((v) => v.value.startsWith('sync-1.'))).toBe(false);
    });

    it('handles diamond dependency graph', () => {
      // trigger -> sync -> issues
      // trigger -> sync -> plan
      // issues -> commit
      // plan -> commit
      const nodes = [
        createTestNode('trigger-1', 'trigger'),
        createTestNode('sync-1', 'github.sync'),
        createTestNode('issues-1', 'github.readIssues'),
        createTestNode('plan-1', 'claude.plan'),
        createTestNode('commit-1', 'git.commit'),
      ];
      const edges = [
        createTestEdge('e1', 'trigger-1', 'sync-1'),
        createTestEdge('e2', 'sync-1', 'issues-1'),
        createTestEdge('e3', 'sync-1', 'plan-1'),
        createTestEdge('e4', 'issues-1', 'commit-1'),
        createTestEdge('e5', 'plan-1', 'commit-1'),
      ];
      useEditorStore.setState({ nodes, edges });

      const variables = useEditorStore.getState().getAvailableVariables('commit-1');

      // Should have variables from all upstream nodes without duplicates
      const nodeIds = new Set(variables.map((v) => v.value.split('.')[0]));
      expect(nodeIds.has('trigger-1')).toBe(true);
      expect(nodeIds.has('sync-1')).toBe(true);
      expect(nodeIds.has('issues-1')).toBe(true);
      expect(nodeIds.has('plan-1')).toBe(true);
      expect(nodeIds.has('commit-1')).toBe(false); // Not self
    });

    it('returns variables with correct labels and descriptions', () => {
      const nodes = [
        createTestNode('trigger-1', 'trigger'),
        createTestNode('sync-1', 'github.sync'),
      ];
      nodes[0].data.label = 'Trigger';
      const edges = [createTestEdge('e1', 'trigger-1', 'sync-1')];
      useEditorStore.setState({ nodes, edges });

      const variables = useEditorStore.getState().getAvailableVariables('sync-1');

      const triggeredAtVar = variables.find((v) => v.value === 'trigger-1.triggered_at');
      expect(triggeredAtVar).toBeDefined();
      expect(triggeredAtVar!.label).toBe('Trigger - triggered_at');
      expect(triggeredAtVar!.description).toBeDefined();
    });
  });

  // =============================================
  // 14. validateNodeConfig
  // =============================================
  describe('validateNodeConfig', () => {
    it('returns valid for node with all required fields', () => {
      const node = createTestNode('node-1', 'github.sync', {
        owner: 'octocat',
        repo: 'my-project',
        path: '/tmp/repos',
      });
      useEditorStore.setState({ nodes: [node] });

      const result = useEditorStore.getState().validateNodeConfig('node-1');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns errors for missing required fields', () => {
      const node = createTestNode('node-1', 'github.sync', {});
      useEditorStore.setState({ nodes: [node] });

      const result = useEditorStore.getState().validateNodeConfig('node-1');

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // github.sync requires owner, repo, path
      const errorKeys = result.errors.map((e) => e.key);
      expect(errorKeys).toContain('owner');
      expect(errorKeys).toContain('repo');
      expect(errorKeys).toContain('path');
    });

    it('returns errors for empty string required fields', () => {
      const node = createTestNode('node-1', 'github.sync', {
        owner: '',
        repo: '  ',
        path: '/tmp',
      });
      useEditorStore.setState({ nodes: [node] });

      const result = useEditorStore.getState().validateNodeConfig('node-1');

      expect(result.valid).toBe(false);
      // owner and repo are empty/whitespace
      const errorKeys = result.errors.map((e) => e.key);
      expect(errorKeys).toContain('owner');
      expect(errorKeys).toContain('repo');
    });

    it('returns valid for non-existent node', () => {
      const result = useEditorStore.getState().validateNodeConfig('nonexistent');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates number fields are numeric', () => {
      const node = createTestNode('node-1', 'delay', {
        seconds: 'not-a-number',
      });
      useEditorStore.setState({ nodes: [node] });

      const result = useEditorStore.getState().validateNodeConfig('node-1');

      expect(result.valid).toBe(false);
      const numError = result.errors.find((e) => e.key === 'seconds');
      expect(numError).toBeDefined();
      expect(numError!.message).toContain('number');
    });

    it('accepts valid number fields', () => {
      const node = createTestNode('node-1', 'delay', {
        seconds: '5',
      });
      useEditorStore.setState({ nodes: [node] });

      const result = useEditorStore.getState().validateNodeConfig('node-1');

      expect(result.valid).toBe(true);
    });

    it('validates condition node required fields', () => {
      const node = createTestNode('node-1', 'condition', {});
      useEditorStore.setState({ nodes: [node] });

      const result = useEditorStore.getState().validateNodeConfig('node-1');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.key === 'condition')).toBe(true);
    });

    it('validates loop node required fields', () => {
      const node = createTestNode('node-1', 'loop', {});
      useEditorStore.setState({ nodes: [node] });

      const result = useEditorStore.getState().validateNodeConfig('node-1');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.key === 'items')).toBe(true);
    });

    it('validates trigger node with no required fields passes', () => {
      const node = createTestNode('node-1', 'trigger', {});
      useEditorStore.setState({ nodes: [node] });

      const result = useEditorStore.getState().validateNodeConfig('node-1');

      // Trigger has no required fields
      expect(result.valid).toBe(true);
    });

    it('returns error messages referencing field labels', () => {
      const node = createTestNode('node-1', 'github.sync', {});
      useEditorStore.setState({ nodes: [node] });

      const result = useEditorStore.getState().validateNodeConfig('node-1');

      const ownerError = result.errors.find((e) => e.key === 'owner');
      expect(ownerError!.message).toContain('Owner');
    });
  });

  // =============================================
  // 15. Dirty Flag Tracking
  // =============================================
  describe('Dirty Flag', () => {
    it('is false initially', () => {
      expect(useEditorStore.getState().isDirty).toBe(false);
    });

    it('becomes true on addNode', () => {
      useEditorStore.getState().addNode('trigger', { x: 0, y: 0 });
      expect(useEditorStore.getState().isDirty).toBe(true);
    });

    it('becomes true on removeNode', () => {
      const node = createTestNode('node-1', 'trigger');
      useEditorStore.setState({ nodes: [node], isDirty: false });
      useEditorStore.getState().removeNode('node-1');
      expect(useEditorStore.getState().isDirty).toBe(true);
    });

    it('becomes true on onConnect', () => {
      const nodes = [
        createTestNode('node-1', 'trigger'),
        createTestNode('node-2', 'github.sync'),
      ];
      useEditorStore.setState({ nodes, isDirty: false });
      useEditorStore.getState().onConnect({
        source: 'node-1',
        target: 'node-2',
        sourceHandle: null,
        targetHandle: null,
      });
      expect(useEditorStore.getState().isDirty).toBe(true);
    });

    it('becomes true on updateNodeConfig', () => {
      const node = createTestNode('node-1', 'trigger');
      useEditorStore.setState({ nodes: [node], isDirty: false });
      useEditorStore.getState().updateNodeConfig('node-1', { trigger_type: 'cron' });
      expect(useEditorStore.getState().isDirty).toBe(true);
    });

    it('becomes true on setWorkflowName', () => {
      useEditorStore.setState({ isDirty: false });
      useEditorStore.getState().setWorkflowName('New Name');
      expect(useEditorStore.getState().isDirty).toBe(true);
    });

    it('resets to false on setWorkflow', () => {
      useEditorStore.setState({ isDirty: true });
      useEditorStore.getState().setWorkflow('wf-1', 'Test', [], []);
      expect(useEditorStore.getState().isDirty).toBe(false);
    });

    it('resets to false on clearEditor', () => {
      useEditorStore.setState({ isDirty: true });
      useEditorStore.getState().clearEditor();
      expect(useEditorStore.getState().isDirty).toBe(false);
    });
  });

  // =============================================
  // 16. Integration / Complex Scenarios
  // =============================================
  describe('Integration Scenarios', () => {
    it('full workflow lifecycle: add nodes, connect, configure, validate', () => {
      // Use pre-created nodes with known IDs to avoid Date.now() collision
      const triggerNode = createTestNode('trigger-1', 'trigger', { trigger_type: 'manual' });
      const syncNode = createTestNode('sync-1', 'github.sync');
      useEditorStore.setState({ nodes: [triggerNode, syncNode], isDirty: true });

      // Connect
      useEditorStore.getState().onConnect({
        source: 'trigger-1',
        target: 'sync-1',
        sourceHandle: null,
        targetHandle: null,
      });
      expect(useEditorStore.getState().edges).toHaveLength(1);

      // Configure
      useEditorStore.getState().updateNodeConfig('sync-1', {
        owner: 'octocat',
        repo: 'hello-world',
        path: '/tmp/repos',
      });

      // Validate
      const validation = useEditorStore.getState().validateNodeConfig('sync-1');
      expect(validation.valid).toBe(true);

      // Check available variables for sync node
      const vars = useEditorStore.getState().getAvailableVariables('sync-1');
      expect(vars.some((v) => v.value === 'trigger-1.triggered_at')).toBe(true);
    });

    it('load workflow, modify, clear', () => {
      const nodes = [
        createTestNode('node-1', 'trigger'),
        createTestNode('node-2', 'github.sync'),
      ];
      const edges = [createTestEdge('e1', 'node-1', 'node-2')];

      // Load
      useEditorStore.getState().setWorkflow('wf-1', 'Test Workflow', nodes, edges);
      expect(useEditorStore.getState().isDirty).toBe(false);

      // Modify
      useEditorStore.getState().setWorkflowName('Modified Workflow');
      expect(useEditorStore.getState().isDirty).toBe(true);

      // Clear
      useEditorStore.getState().clearEditor();
      expect(useEditorStore.getState().nodes).toHaveLength(0);
      expect(useEditorStore.getState().edges).toHaveLength(0);
      expect(useEditorStore.getState().workflowId).toBeNull();
    });

    it('delete node with confirmation flow', () => {
      const nodes = [
        createTestNode('node-1', 'trigger'),
        createTestNode('node-2', 'github.sync'),
        createTestNode('node-3', 'claude.plan'),
      ];
      const edges = [
        createTestEdge('e1', 'node-1', 'node-2'),
        createTestEdge('e2', 'node-2', 'node-3'),
      ];
      useEditorStore.setState({ nodes, edges, selectedNodeId: 'node-2' });

      // Request delete (has edges, so goes to pending)
      useEditorStore.getState().requestDeleteNode('node-2');
      expect(useEditorStore.getState().pendingDeleteNodeId).toBe('node-2');
      expect(useEditorStore.getState().nodes).toHaveLength(3); // Still there

      // Confirm
      useEditorStore.getState().confirmDelete();
      expect(useEditorStore.getState().nodes).toHaveLength(2);
      expect(useEditorStore.getState().edges).toHaveLength(0);
      expect(useEditorStore.getState().selectedNodeId).toBeNull();
      expect(useEditorStore.getState().pendingDeleteNodeId).toBeNull();
    });
  });
});
