import { useCallback } from 'react';
import { createWorkflow, updateWorkflow } from '@/lib/api/workflow';
import { buildWorkflowPayload } from '@/app/routes/editor/hooks/use-editor-workflow/buildWorkflowPayload';
import type {
  NavigateFn,
  WorkflowDomainControls,
  WorkflowFlowControls,
  WorkflowGraphSnapshot,
} from '@/app/routes/editor/hooks/use-editor-workflow/types';

interface UseWorkflowPersistenceParams {
  graph: WorkflowGraphSnapshot;
  controls: WorkflowDomainControls;
  flow: WorkflowFlowControls;
  navigate: NavigateFn;
}

export function useWorkflowPersistence({
  graph,
  controls,
  flow,
  navigate,
}: UseWorkflowPersistenceParams) {
  const isWorkflowNameValid = graph.workflowName.trim().length > 0;
  const canSave = isWorkflowNameValid && !flow.isBusy && (!graph.workflowId || graph.isDirty);

  const handleSave = useCallback(async () => {
    if (!isWorkflowNameValid) {
      flow.sendFlowEvent({ type: 'SAVE_FAILURE', message: 'Workflow name is required' });
      return;
    }
    if (flow.isBusy) return;

    flow.sendFlowEvent({ type: 'SAVE_REQUEST' });
    try {
      const payload = buildWorkflowPayload({
        workflowId: graph.workflowId,
        workflowName: graph.workflowName,
        nodes: graph.nodes,
        edges: graph.edges,
      });

      const savedWorkflow = graph.workflowId
        ? await updateWorkflow(graph.workflowId, payload)
        : await createWorkflow(payload);

      if (!graph.workflowId && savedWorkflow.id) {
        controls.sendDomainEvent({
          type: 'WORKFLOW_CREATED',
          id: savedWorkflow.id,
          name: savedWorkflow.name,
        });
        navigate('editor', { id: savedWorkflow.id });
      }

      controls.sendDomainEvent({
        type: 'WORKFLOW_SAVED',
        id: savedWorkflow.id,
        name: savedWorkflow.name,
      });
      flow.sendFlowEvent({ type: 'SAVE_SUCCESS' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save workflow';
      flow.sendFlowEvent({ type: 'SAVE_FAILURE', message });
    }
  }, [canSave, controls, flow, graph, isWorkflowNameValid, navigate]);

  return {
    isWorkflowNameValid,
    canSave,
    handleSave,
  };
}
