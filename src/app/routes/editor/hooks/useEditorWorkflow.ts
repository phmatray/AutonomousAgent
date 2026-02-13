import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMachine } from '@xstate/react';
import { useEditorStore } from '@/features/workflow-editor/stores/editor-store';
import {
  createWorkflow,
  updateWorkflow,
  getWorkflow,
  executeWorkflow,
  preflightWorkflow,
} from '@/lib/api/workflow';
import { getAuthStatus } from '@/lib/api/github';
import { useRouter } from '@/lib/router';
import { editorFlowMachine } from '@/app/routes/editor/editor-flow-machine';
import { editorDomainMachine } from '@/app/routes/editor/editor-domain-machine';
import {
  parseImportedWorkflow,
  serializeWorkflowForExport,
  toEditorGraph,
} from '@/app/routes/editor/workflow-io';
import { WorkflowCatalogContext } from '@/app/state/workflow-catalog-machine';
import type { Workflow, WorkflowPreflightIssue } from '@/types/workflow';
import { getNodeLabel } from '@/features/workflow-editor/nodes/catalog';

interface PendingDeleteInfo {
  label: string;
  edgeCount: number;
}

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
  importInputRef: RefObject<HTMLInputElement | null>;
  setWorkflowName: (name: string) => void;
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

  const [domainState, sendDomainEvent] = useMachine(editorDomainMachine);
  const workflowId = domainState.context.workflowId;
  const workflowName = domainState.context.workflowName;
  const isDirty = domainState.context.isDirty;
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const pendingDeleteNodeId = useEditorStore((s) => s.pendingDeleteNodeId);
  const confirmDelete = useEditorStore((s) => s.confirmDelete);
  const cancelDelete = useEditorStore((s) => s.cancelDelete);
  const setGraph = useEditorStore((s) => s.setGraph);
  const clearGraph = useEditorStore((s) => s.clearGraph);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const suppressGraphDirtyRef = useRef(false);

  const { data: fetchedWorkflow, isFetched: hasFetchedWorkflow } = useQuery<Workflow | null>({
    queryKey: ['workflow', urlWorkflowId],
    queryFn: () => (urlWorkflowId ? getWorkflow(urlWorkflowId) : null),
    initialData: () => {
      if (!urlWorkflowId) return null;
      return catalogWorkflows.find((workflow) => workflow.id === urlWorkflowId);
    },
    enabled: !!urlWorkflowId,
    retry: false,
  });

  useEffect(() => {
    if (urlWorkflowId) {
      if (fetchedWorkflow) {
        const { nodes: editorNodes, edges: editorEdges } = toEditorGraph(fetchedWorkflow);

        suppressGraphDirtyRef.current = true;
        setGraph(editorNodes, editorEdges);
        sendDomainEvent({
          type: 'WORKFLOW_LOADED',
          id: fetchedWorkflow.id,
          name: fetchedWorkflow.name,
        });
      } else if (hasFetchedWorkflow) {
        suppressGraphDirtyRef.current = true;
        clearGraph();
        sendDomainEvent({ type: 'WORKFLOW_CLEARED' });
      }
    } else if (workflowId) {
      suppressGraphDirtyRef.current = true;
      clearGraph();
      sendDomainEvent({ type: 'WORKFLOW_CLEARED' });
    }
  }, [
    fetchedWorkflow,
    hasFetchedWorkflow,
    urlWorkflowId,
    setGraph,
    clearGraph,
    workflowId,
    sendDomainEvent,
  ]);

  useEffect(() => {
    if (suppressGraphDirtyRef.current) {
      suppressGraphDirtyRef.current = false;
      return;
    }
    sendDomainEvent({ type: 'GRAPH_CHANGED' });
  }, [nodes, edges, sendDomainEvent]);

  const pendingDeleteInfo = useMemo(() => {
    if (!pendingDeleteNodeId) return null;
    const node = nodes.find((n) => n.id === pendingDeleteNodeId);
    const edgeCount = edges.filter(
      (e) => e.source === pendingDeleteNodeId || e.target === pendingDeleteNodeId,
    ).length;
    return { label: node ? getNodeLabel(node.data.nodeType) : 'this node', edgeCount };
  }, [pendingDeleteNodeId, nodes, edges]);

  const [preflightIssues, setPreflightIssues] = useState<WorkflowPreflightIssue[]>([]);
  const [flowState, sendFlowEvent] = useMachine(editorFlowMachine);
  const importInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isWorkflowNameValid = workflowName.trim().length > 0;

  const buildWorkflowPayload = useCallback(
    (): Workflow => ({
      id: workflowId || '',
      name: workflowName,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.nodeType,
        config: n.data.config || undefined,
        position: n.position ? { x: n.position.x, y: n.position.y } : undefined,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || undefined,
        targetHandle: e.targetHandle || undefined,
      })),
      version: 1,
      createdAt: '',
      updatedAt: '',
    }),
    [workflowId, workflowName, nodes, edges],
  );

  const isSaving = flowState.matches('saving');
  const isExecuting = flowState.matches('executing');
  const isBusy = isSaving || isExecuting;
  const canSave = isWorkflowNameValid && !isBusy && (!workflowId || isDirty);

  const handleSave = useCallback(async () => {
    if (!isWorkflowNameValid) {
      sendFlowEvent({ type: 'SAVE_FAILURE', message: 'Workflow name is required' });
      return;
    }
    if (isBusy) return;

    sendFlowEvent({ type: 'SAVE_REQUEST' });
    try {
      const workflowData = buildWorkflowPayload();
      const savedWorkflow = workflowId
        ? await updateWorkflow(workflowId, workflowData)
        : await createWorkflow(workflowData);

      if (!workflowId && savedWorkflow.id) {
        sendDomainEvent({
          type: 'WORKFLOW_CREATED',
          id: savedWorkflow.id,
          name: savedWorkflow.name,
        });
        navigate('editor', { id: savedWorkflow.id });
      }

      sendDomainEvent({
        type: 'WORKFLOW_SAVED',
        id: savedWorkflow.id,
        name: savedWorkflow.name,
      });
      sendFlowEvent({ type: 'SAVE_SUCCESS' });

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => sendFlowEvent({ type: 'SAVE_GLOW_TIMEOUT' }), 1200);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save workflow';
      sendFlowEvent({ type: 'SAVE_FAILURE', message });
    }
  }, [
    isWorkflowNameValid,
    isBusy,
    buildWorkflowPayload,
    workflowId,
    navigate,
    sendDomainEvent,
    sendFlowEvent,
  ]);

  const handleExecute = useCallback(async () => {
    if (!isWorkflowNameValid || isBusy) return;

    const requiresGitHubAuth = nodes.some((node) => node.data.nodeType.startsWith('github.'));
    if (requiresGitHubAuth) {
      try {
        const authStatus = await getAuthStatus();
        if (!authStatus.authenticated) {
          sendFlowEvent({
            type: 'EXECUTE_FAILURE',
            message: 'GitHub is not authenticated. Open Settings and save a GitHub token first.',
          });
          return;
        }
      } catch {
        sendFlowEvent({
          type: 'EXECUTE_FAILURE',
          message: 'Could not verify GitHub authentication. Open Settings and retry.',
        });
        return;
      }
    }

    sendFlowEvent({ type: 'EXECUTE_REQUEST' });
    try {
      const payload = buildWorkflowPayload();
      const preflight = await preflightWorkflow(payload);
      setPreflightIssues(preflight.issues);

      const preflightErrors = preflight.issues.filter((issue) => issue.level === 'ERROR');
      if (preflightErrors.length > 0) {
        sendFlowEvent({
          type: 'EXECUTE_FAILURE',
          message: `Preflight failed with ${preflightErrors.length} error${preflightErrors.length === 1 ? '' : 's'}.`,
        });
        return;
      }

      let targetWorkflowId = workflowId;
      if (!targetWorkflowId) {
        const createdWorkflow = await createWorkflow(payload);
        targetWorkflowId = createdWorkflow.id;
        sendDomainEvent({
          type: 'WORKFLOW_CREATED',
          id: createdWorkflow.id,
          name: createdWorkflow.name,
        });
        navigate('editor', { id: createdWorkflow.id });
      }

      const execution = await executeWorkflow(targetWorkflowId, 'manual');
      sendFlowEvent({ type: 'EXECUTE_SUCCESS' });

      if (execution?.id) {
        navigate('monitoring', { id: execution.id });
      } else {
        navigate('monitoring');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to execute workflow';
      sendFlowEvent({ type: 'EXECUTE_FAILURE', message });
    }
  }, [
    isWorkflowNameValid,
    isBusy,
    workflowId,
    buildWorkflowPayload,
    nodes,
    navigate,
    sendDomainEvent,
    sendFlowEvent,
  ]);

  const handleExport = useCallback(() => {
    const payload = buildWorkflowPayload();
    const json = serializeWorkflowForExport(payload);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safeName = workflowName.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-');
    anchor.href = url;
    anchor.download = `${safeName || 'workflow'}.workflow.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [buildWorkflowPayload, workflowName]);

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
        const { nodes: editorNodes, edges: editorEdges } = toEditorGraph(normalized);

        suppressGraphDirtyRef.current = true;
        setGraph(editorNodes, editorEdges);
        sendDomainEvent({ type: 'WORKFLOW_IMPORTED', name: normalized.name });
        navigate('editor');
        sendFlowEvent({ type: 'CLEAR_ERROR' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to import workflow JSON';
        sendFlowEvent({ type: 'SAVE_FAILURE', message });
      } finally {
        event.target.value = '';
      }
    },
    [navigate, sendDomainEvent, sendFlowEvent, setGraph],
  );

  const setWorkflowName = useCallback(
    (name: string) => {
      sendDomainEvent({ type: 'WORKFLOW_NAME_CHANGED', name });
    },
    [sendDomainEvent],
  );

  const dismissPreflightIssues = useCallback(() => {
    setPreflightIssues([]);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  return {
    workflowName,
    isWorkflowNameValid,
    isDirty,
    selectedNodeId,
    pendingDeleteNodeId,
    pendingDeleteInfo,
    preflightIssues,
    saveGlow: flowState.context.saveGlow,
    flowError: flowState.context.error,
    canSave,
    isSaving,
    isExecuting,
    isBusy,
    importInputRef,
    setWorkflowName,
    dismissPreflightIssues,
    confirmDelete,
    cancelDelete,
    handleImportClick,
    handleImportFile,
    handleExport,
    handleSave,
    handleExecute,
  };
}
