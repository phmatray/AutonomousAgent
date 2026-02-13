import { useCallback, useRef, type ChangeEvent, type RefObject } from 'react';
import { buildWorkflowPayload } from '@/app/routes/editor/hooks/use-editor-workflow/buildWorkflowPayload';
import { parseImportedWorkflow, serializeWorkflowForExport, toEditorGraph } from '@/app/routes/editor/workflow-io';
import type {
  NavigateFn,
  WorkflowDomainControls,
  WorkflowFlowControls,
  WorkflowGraphSnapshot,
} from '@/app/routes/editor/hooks/use-editor-workflow/types';

interface UseWorkflowImportExportParams {
  graph: WorkflowGraphSnapshot;
  controls: WorkflowDomainControls;
  flow: WorkflowFlowControls;
  navigate: NavigateFn;
}

interface UseWorkflowImportExportResult {
  importInputRef: RefObject<HTMLInputElement | null>;
  handleImportClick: () => void;
  handleImportFile: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleExport: () => void;
}

export function useWorkflowImportExport({
  graph,
  controls,
  flow,
  navigate,
}: UseWorkflowImportExportParams): UseWorkflowImportExportResult {
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    const payload = buildWorkflowPayload({
      workflowId: graph.workflowId,
      workflowName: graph.workflowName,
      nodes: graph.nodes,
      edges: graph.edges,
    });
    const json = serializeWorkflowForExport(payload);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safeName = graph.workflowName.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-');
    anchor.href = url;
    anchor.download = `${safeName || 'workflow'}.workflow.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [graph]);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const normalized = parseImportedWorkflow(text);
        const { nodes, edges } = toEditorGraph(normalized);

        controls.setGraph(nodes, edges);
        controls.sendDomainEvent({ type: 'WORKFLOW_IMPORTED', name: normalized.name });
        navigate('editor');
        flow.sendFlowEvent({ type: 'CLEAR_ERROR' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to import workflow JSON';
        flow.sendFlowEvent({ type: 'SAVE_FAILURE', message });
      } finally {
        event.target.value = '';
      }
    },
    [controls, flow, navigate],
  );

  return {
    importInputRef,
    handleImportClick,
    handleImportFile,
    handleExport,
  };
}
