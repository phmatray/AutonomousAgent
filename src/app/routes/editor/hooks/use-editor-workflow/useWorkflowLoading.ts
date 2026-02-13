import { useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWorkflow } from '@/lib/api/workflow';
import { toEditorGraph } from '@/app/routes/editor/workflow-io';
import type { Workflow } from '@/types/workflow';
import type { WorkflowDomainControls } from '@/app/routes/editor/hooks/use-editor-workflow/types';

interface UseWorkflowLoadingParams {
  urlWorkflowId: string | null;
  workflowId: string | null;
  controls: WorkflowDomainControls;
  initialCatalogWorkflows: Workflow[];
}

export function useWorkflowLoading({
  urlWorkflowId,
  workflowId,
  controls,
  initialCatalogWorkflows,
}: UseWorkflowLoadingParams) {
  const suppressGraphDirtyRef = useRef(false);

  const { data: fetchedWorkflow, isFetched: hasFetchedWorkflow } = useQuery<Workflow | null>({
    queryKey: ['workflow', urlWorkflowId],
    queryFn: () => (urlWorkflowId ? getWorkflow(urlWorkflowId) : null),
    initialData: () => {
      if (!urlWorkflowId) return null;
      return initialCatalogWorkflows.find((workflow) => workflow.id === urlWorkflowId);
    },
    enabled: !!urlWorkflowId,
    retry: false,
  });

  useEffect(() => {
    if (urlWorkflowId) {
      if (fetchedWorkflow) {
        const { nodes, edges } = toEditorGraph(fetchedWorkflow);
        suppressGraphDirtyRef.current = true;
        controls.setGraph(nodes, edges);
        controls.sendDomainEvent({
          type: 'WORKFLOW_LOADED',
          id: fetchedWorkflow.id,
          name: fetchedWorkflow.name,
        });
      } else if (hasFetchedWorkflow) {
        suppressGraphDirtyRef.current = true;
        controls.clearGraph();
        controls.sendDomainEvent({ type: 'WORKFLOW_CLEARED' });
      }
    } else if (workflowId) {
      suppressGraphDirtyRef.current = true;
      controls.clearGraph();
      controls.sendDomainEvent({ type: 'WORKFLOW_CLEARED' });
    }
  }, [controls, fetchedWorkflow, hasFetchedWorkflow, urlWorkflowId, workflowId]);

  const markGraphDirty = useCallback(() => {
    if (suppressGraphDirtyRef.current) {
      suppressGraphDirtyRef.current = false;
      return;
    }
    controls.sendDomainEvent({ type: 'GRAPH_CHANGED' });
  }, [controls]);

  return { markGraphDirty };
}
