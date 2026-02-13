import { useCallback, useEffect, useState, type ChangeEvent, type RefObject } from 'react';
import { useRouter } from '@/lib/router';
import { WorkflowCatalogContext } from '@/app/state/workflow-catalog-machine';
import { useWorkflowDomainState } from '@/app/routes/editor/hooks/use-editor-workflow/useWorkflowDomainState';
import { useWorkflowFlowState } from '@/app/routes/editor/hooks/use-editor-workflow/useWorkflowFlowState';
import { useWorkflowLoading } from '@/app/routes/editor/hooks/use-editor-workflow/useWorkflowLoading';
import { useWorkflowPersistence } from '@/app/routes/editor/hooks/use-editor-workflow/useWorkflowPersistence';
import { useWorkflowExecution } from '@/app/routes/editor/hooks/use-editor-workflow/useWorkflowExecution';
import { useWorkflowImportExport } from '@/app/routes/editor/hooks/use-editor-workflow/useWorkflowImportExport';
import type { PendingDeleteInfo } from '@/app/routes/editor/hooks/use-editor-workflow/types';
import type { WorkflowPreflightIssue } from '@/types/workflow';

interface UseEditorWorkflowResult {
  workflowName: string;
  isWorkflowNameValid: boolean;
  isDirty: boolean;
  selectedNodeId: string | null;
  pendingDeleteNodeId: string | null;
  pendingDeleteInfo: PendingDeleteInfo | null;
  preflightIssues: WorkflowPreflightIssue[];
  saveGlow: boolean;
  flowError: string | null;
  canSave: boolean;
  isSaving: boolean;
  isExecuting: boolean;
  isBusy: boolean;
  lastSavedAt: number | null;
  importInputRef: RefObject<HTMLInputElement | null>;
  setWorkflowName: (name: string) => void;
  focusNode: (nodeId: string) => void;
  dismissPreflightIssues: () => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  handleImportClick: () => void;
  handleImportFile: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleExport: () => void;
  handleSave: () => Promise<void>;
  handleExecute: () => Promise<void>;
}

export function useEditorWorkflow(): UseEditorWorkflowResult {
  const { params, navigate } = useRouter();
  const urlWorkflowId = params.get('id');
  const catalogWorkflows = WorkflowCatalogContext.useSelector((state) => state.context.workflows);

  const { snapshot: graph, controls } = useWorkflowDomainState();
  const flow = useWorkflowFlowState();
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const { markGraphDirty } = useWorkflowLoading({
    urlWorkflowId,
    workflowId: graph.workflowId,
    controls,
    initialCatalogWorkflows: catalogWorkflows,
  });

  useEffect(() => {
    markGraphDirty();
  }, [markGraphDirty, graph.nodes, graph.edges]);

  const {
    isWorkflowNameValid,
    canSave,
    handleSave,
  } = useWorkflowPersistence({
    graph,
    controls,
    flow,
    navigate,
  });

  const {
    preflightIssues,
    dismissPreflightIssues,
    handleExecute,
  } = useWorkflowExecution({
    graph,
    controls,
    flow,
    isWorkflowNameValid,
    navigate,
  });

  const {
    importInputRef,
    handleImportClick,
    handleImportFile,
    handleExport,
  } = useWorkflowImportExport({
    graph,
    controls,
    flow,
    navigate,
  });

  const setWorkflowName = useCallback(
    (name: string) => {
      controls.sendDomainEvent({ type: 'WORKFLOW_NAME_CHANGED', name });
    },
    [controls],
  );

  const focusNode = useCallback(
    (nodeId: string) => {
      controls.setSelectedNode(nodeId);
    },
    [controls],
  );

  useEffect(() => {
    if (!flow.saveGlow) return;
    setLastSavedAt(Date.now());
  }, [flow.saveGlow]);

  return {
    workflowName: graph.workflowName,
    isWorkflowNameValid,
    isDirty: graph.isDirty,
    selectedNodeId: graph.selectedNodeId,
    pendingDeleteNodeId: graph.pendingDeleteNodeId,
    pendingDeleteInfo: graph.pendingDeleteInfo,
    preflightIssues,
    saveGlow: flow.saveGlow,
    flowError: flow.flowError,
    canSave,
    isSaving: flow.isSaving,
    isExecuting: flow.isExecuting,
    isBusy: flow.isBusy,
    lastSavedAt,
    importInputRef,
    setWorkflowName,
    focusNode,
    dismissPreflightIssues,
    confirmDelete: controls.confirmDelete,
    cancelDelete: controls.cancelDelete,
    handleImportClick,
    handleImportFile,
    handleExport,
    handleSave,
    handleExecute,
  };
}
