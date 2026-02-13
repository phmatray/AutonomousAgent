import { useMemo, useCallback } from 'react';
import { useMachine } from '@xstate/react';
import { useEditorStore } from '@/features/workflow-editor/stores/editor-store';
import { getNodeLabel } from '@/features/workflow-editor/nodes/catalog';
import { editorDomainMachine } from '@/app/routes/editor/editor-domain-machine';
import type { WorkflowDomainControls, WorkflowGraphSnapshot } from '@/app/routes/editor/hooks/use-editor-workflow/types';

interface UseWorkflowDomainStateResult {
  snapshot: WorkflowGraphSnapshot;
  controls: WorkflowDomainControls;
}

export function useWorkflowDomainState(): UseWorkflowDomainStateResult {
  const [domainState, sendDomainEvent] = useMachine(editorDomainMachine);
  const workflowId = domainState.context.workflowId;
  const workflowName = domainState.context.workflowName;
  const workflowStatus = domainState.context.workflowStatus;
  const isDirty = domainState.context.isDirty;

  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const pendingDeleteNodeId = useEditorStore((s) => s.pendingDeleteNodeId);
  const confirmDelete = useEditorStore((s) => s.confirmDelete);
  const cancelDelete = useEditorStore((s) => s.cancelDelete);
  const setGraph = useEditorStore((s) => s.setGraph);
  const clearGraph = useEditorStore((s) => s.clearGraph);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);

  const pendingDeleteInfo = useMemo(() => {
    if (!pendingDeleteNodeId) return null;
    const node = nodes.find((n) => n.id === pendingDeleteNodeId);
    const edgeCount = edges.filter(
      (edge) => edge.source === pendingDeleteNodeId || edge.target === pendingDeleteNodeId,
    ).length;
    return { label: node ? getNodeLabel(node.data.nodeType) : 'this node', edgeCount };
  }, [pendingDeleteNodeId, nodes, edges]);

  const dispatchDomainEvent = useCallback(
    (event: Parameters<typeof sendDomainEvent>[0]) => {
      sendDomainEvent(event);
    },
    [sendDomainEvent],
  );

  const controls = useMemo(
    () => ({
      setGraph,
      clearGraph,
      confirmDelete,
      cancelDelete,
      sendDomainEvent: dispatchDomainEvent,
    }),
    [setGraph, clearGraph, confirmDelete, cancelDelete, dispatchDomainEvent],
  );

  return {
    snapshot: {
      nodes,
      edges,
      workflowId,
      workflowName,
      workflowStatus,
      isDirty,
      selectedNodeId,
      pendingDeleteNodeId,
      pendingDeleteInfo,
    },
    controls,
  };
}
