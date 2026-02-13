import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useMachine } from '@xstate/react';
import { WorkflowCanvas } from '@/features/workflow-editor/components/WorkflowCanvas';
import { NodePalette } from '@/features/workflow-editor/nodes/components/NodePalette';
import { NodeConfigPanel } from '@/features/workflow-editor/nodes/components/NodeConfigPanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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
import { editorFlowMachine } from './editor-flow-machine';
import { editorDomainMachine } from './editor-domain-machine';
import { parseImportedWorkflow, serializeWorkflowForExport, toEditorGraph } from './workflow-io';
import { WorkflowCatalogContext } from '@/app/state/workflow-catalog-machine';
import type { NodeType, Workflow, WorkflowPreflightIssue } from '@/types/workflow';
import { getNodeLabel } from '@/features/workflow-editor/nodes/catalog';

interface DragState {
  type: NodeType;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export function EditorPage() {
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
  const addNode = useEditorStore((s) => s.addNode);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const suppressGraphDirtyRef = useRef(false);

  // Fetch workflow if ID is provided in URL
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

  // Load workflow into editor when fetched
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
      // Clear editor if navigating to /editor without an ID
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

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [preflightIssues, setPreflightIssues] = useState<WorkflowPreflightIssue[]>([]);
  const [flowState, sendFlowEvent] = useMachine(editorFlowMachine);
  const importInputRef = useRef<HTMLInputElement>(null);
  const saveGlow = flowState.context.saveGlow;
  const flowError = flowState.context.error;
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

  const handleDragStart = useCallback((type: NodeType, startX: number, startY: number) => {
    setDragState({
      type,
      startX,
      startY,
      currentX: startX,
      currentY: startY,
    });
  }, []);

  const handleQuickAddNode = useCallback(
    (type: NodeType) => {
      const baseX = window.innerWidth < 768 ? 110 : 260;
      const baseY = window.innerWidth < 768 ? 120 : 160;
      const offset = (nodes.length % 6) * 28;
      addNode(type, { x: baseX + offset, y: baseY + offset });
    },
    [addNode, nodes.length],
  );

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

  const handleImportFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
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
  }, [navigate, sendDomainEvent, sendFlowEvent, setGraph]);

  // Keyboard shortcuts: Cmd+S for save, Cmd+Enter for execute
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if (isMod && e.key === 'Enter') {
        e.preventDefault();
        handleExecute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleExecute]);

  // Global mouse move handler
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      setDragState((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          currentX: e.clientX,
          currentY: e.clientY,
        };
      });
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState]);

  // Cleanup save timeout
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col h-full relative min-w-0">
      {/* Drag preview overlay */}
      <AnimatePresence>
        {dragState && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 0.8, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            className="fixed pointer-events-none z-50 px-3 py-2 rounded-lg border text-sm font-technical text-white bg-control border-control-hover shadow-glow"
            style={{
              left: dragState.currentX + 10,
              top: dragState.currentY + 10,
            }}
          >
            {dragState.type}
          </motion.div>
        )}
      </AnimatePresence>
      <header className="flex items-center justify-between px-5 py-3 bg-bg-secondary border-b border-border-primary">
        <div className="flex items-center gap-3">
          <span
            className="relative flex h-2.5 w-2.5"
            aria-label="Workflow status: idle"
          >
            <span className="animate-pulse-slow absolute inline-flex h-full w-full rounded-full bg-state-idle opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-state-idle" />
          </span>
          <label htmlFor="workflow-name" className="sr-only">
            Workflow name
          </label>
          <input
            id="workflow-name"
            type="text"
            value={workflowName}
            onChange={(e) => sendDomainEvent({ type: 'WORKFLOW_NAME_CHANGED', name: e.target.value })}
            className="bg-transparent border border-transparent text-text-primary text-lg font-display font-semibold rounded px-2 py-1 hover:border-border-primary focus:outline-none focus:ring-2 focus:ring-border-focus transition-colors"
            aria-label="Workflow name"
            aria-invalid={!isWorkflowNameValid}
          />
          {!isWorkflowNameValid && (
            <span className="text-xs text-state-error" role="alert">
              Workflow name is required
            </span>
          )}
          <AnimatePresence>
            {isDirty && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.2 }}
                className="text-xs font-technical text-state-warning px-2 py-0.5 rounded-full bg-state-warning/10 border border-state-warning/20"
                aria-live="polite"
              >
                Unsaved
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.workflow.json,application/json"
            className="hidden"
            onChange={handleImportFile}
            aria-label="Import workflow JSON"
          />
          <button
            type="button"
            onClick={handleImportClick}
            className="px-4 py-1.5 text-sm font-medium bg-bg-elevated text-text-secondary border border-border-primary rounded-lg hover:bg-bg-tertiary hover:text-text-primary hover:border-border-hover transition-all focus:outline-none focus:ring-2 focus:ring-border-focus"
            aria-label="Import workflow"
          >
            Import
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="px-4 py-1.5 text-sm font-medium bg-bg-elevated text-text-secondary border border-border-primary rounded-lg hover:bg-bg-tertiary hover:text-text-primary hover:border-border-hover transition-all focus:outline-none focus:ring-2 focus:ring-border-focus"
            aria-label="Export workflow"
          >
            Export
          </button>
          <motion.button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            animate={saveGlow ? {
              boxShadow: [
                '0 0 0px rgba(203, 166, 247, 0)',
                '0 0 20px rgba(203, 166, 247, 0.65)',
                '0 0 0px rgba(203, 166, 247, 0)',
              ],
            } : {}}
            transition={saveGlow ? { duration: 1.2, ease: 'easeInOut' } : {}}
            className={`px-4 py-1.5 text-sm font-medium border rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-border-focus disabled:opacity-50 disabled:cursor-not-allowed ${
              saveGlow
                ? 'bg-control/20 text-control-text border-control'
                : 'bg-bg-elevated text-text-secondary border-border-primary hover:bg-bg-tertiary hover:text-text-primary hover:border-border-hover'
            }`}
            aria-label="Save workflow (Cmd+S)"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </motion.button>
          {flowError && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="text-xs text-state-error"
              role="alert"
            >
              {flowError}
            </motion.span>
          )}
          <motion.button
            type="button"
            onClick={handleExecute}
            disabled={!isWorkflowNameValid || isBusy}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            className="px-4 py-1.5 text-sm font-medium bg-control text-white rounded-lg hover:bg-control-hover hover:shadow-glow-lg transition-all focus:outline-none focus:ring-2 focus:ring-border-focus disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Execute workflow (Cmd+Enter)"
          >
            {isExecuting ? 'Executing...' : 'Execute'}
          </motion.button>
        </div>
      </header>
      {preflightIssues.length > 0 && (
        <section className="px-5 py-2 bg-bg-secondary border-b border-border-primary">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Preflight Results
            </h3>
            <button
              type="button"
              onClick={() => setPreflightIssues([])}
              className="text-xs text-text-tertiary hover:text-text-secondary"
            >
              Dismiss
            </button>
          </div>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {preflightIssues.map((issue, index) => (
              <li
                key={`${issue.code}-${issue.nodeId ?? 'global'}-${index}`}
                className={`text-xs px-2 py-1 rounded border ${
                  issue.level === 'ERROR'
                    ? 'border-state-error/40 bg-state-error/10 text-state-error'
                    : 'border-state-warning/40 bg-state-warning/10 text-state-warning'
                }`}
              >
                <span className="font-mono mr-2">{issue.code}</span>
                {issue.nodeId ? <span className="font-mono mr-2">[{issue.nodeId}]</span> : null}
                <span>{issue.message}</span>
                {issue.hint ? <span className="ml-2 opacity-80">Hint: {issue.hint}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row min-w-0">
        <NodePalette onDragStart={handleDragStart} onQuickAdd={handleQuickAddNode} />
        <WorkflowCanvas dragState={dragState} />
        <AnimatePresence>
          {selectedNodeId && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="overflow-hidden flex-shrink-0 h-full min-h-0"
            >
              <NodeConfigPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <ConfirmDialog
        open={pendingDeleteNodeId !== null}
        title="Delete connected node?"
        message={
          pendingDeleteInfo
            ? `"${pendingDeleteInfo.label}" has ${pendingDeleteInfo.edgeCount} connected edge${pendingDeleteInfo.edgeCount !== 1 ? 's' : ''}. Deleting it will also remove ${pendingDeleteInfo.edgeCount === 1 ? 'this connection' : 'these connections'}.`
            : ''
        }
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}
