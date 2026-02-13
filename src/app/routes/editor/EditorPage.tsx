import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMutation, useQuery } from '@tanstack/react-query';
import { WorkflowCanvas } from '@/features/workflow-editor/components/WorkflowCanvas';
import { NodePalette } from '@/features/workflow-editor/components/NodePalette';
import { NodeConfigPanel } from '@/features/workflow-editor/components/NodeConfigPanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useEditorStore } from '@/features/workflow-editor/stores/editor-store';
import { createWorkflow, updateWorkflow, getWorkflow, executeWorkflow } from '@/lib/api/workflow';
import { useRouter } from '@/lib/router';
import type { NodeType, Workflow } from '@/types/workflow';

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

  const workflowId = useEditorStore((s) => s.workflowId);
  const workflowName = useEditorStore((s) => s.workflowName);
  const setWorkflowName = useEditorStore((s) => s.setWorkflowName);
  const isDirty = useEditorStore((s) => s.isDirty);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const pendingDeleteNodeId = useEditorStore((s) => s.pendingDeleteNodeId);
  const confirmDelete = useEditorStore((s) => s.confirmDelete);
  const cancelDelete = useEditorStore((s) => s.cancelDelete);
  const setWorkflow = useEditorStore((s) => s.setWorkflow);
  const clearEditor = useEditorStore((s) => s.clearEditor);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);

  // Fetch workflow if ID is provided in URL
  const { data: fetchedWorkflow, isFetched: hasFetchedWorkflow } = useQuery<Workflow | null>({
    queryKey: ['workflow', urlWorkflowId],
    queryFn: () => (urlWorkflowId ? getWorkflow(urlWorkflowId) : null),
    enabled: !!urlWorkflowId,
    retry: false,
  });

  // Load workflow into editor when fetched
  useEffect(() => {
    if (urlWorkflowId) {
      if (fetchedWorkflow) {
        const editorNodes = fetchedWorkflow.nodes.map((node) => ({
          id: node.id,
          type: 'workflowNode' as const,
          position: node.position || { x: 0, y: 0 },
          data: {
            label: node.type,
            nodeType: node.type as NodeType,
            config: (node.config as Record<string, unknown>) || {},
          },
        }));

        const editorEdges = fetchedWorkflow.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle || undefined,
          targetHandle: edge.targetHandle || undefined,
        }));

        setWorkflow(fetchedWorkflow.id, fetchedWorkflow.name, editorNodes, editorEdges);
      } else if (hasFetchedWorkflow) {
        clearEditor();
      }
    } else if (workflowId) {
      // Clear editor if navigating to /editor without an ID
      clearEditor();
    }
  }, [fetchedWorkflow, hasFetchedWorkflow, urlWorkflowId, setWorkflow, clearEditor, workflowId]);

  const pendingDeleteInfo = useMemo(() => {
    if (!pendingDeleteNodeId) return null;
    const node = nodes.find((n) => n.id === pendingDeleteNodeId);
    const edgeCount = edges.filter(
      (e) => e.source === pendingDeleteNodeId || e.target === pendingDeleteNodeId,
    ).length;
    return { label: node?.data.label ?? 'this node', edgeCount };
  }, [pendingDeleteNodeId, nodes, edges]);

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [saveGlow, setSaveGlow] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const executeInFlightRef = useRef(false);
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

  const saveWorkflowMutation = useMutation({
    mutationFn: async () => {
      const workflowData = buildWorkflowPayload();

      if (workflowId) {
        // Update existing workflow
        return updateWorkflow(workflowId, workflowData);
      } else {
        // Create new workflow
        return createWorkflow(workflowData);
      }
    },
    onSuccess: (savedWorkflow) => {
      // Update the workflow ID if it was a new workflow
      if (!workflowId && savedWorkflow.id) {
        setWorkflow(savedWorkflow.id, savedWorkflow.name, nodes, edges);
        navigate('editor', { id: savedWorkflow.id });
      }
      // Mark as clean (not dirty)
      useEditorStore.setState({ isDirty: false });
      // Trigger save glow animation
      setSaveGlow(true);
      setSaveError(null);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => setSaveGlow(false), 1200);
    },
    onError: (error: Error) => {
      setSaveError(error.message || 'Failed to save workflow');
      setTimeout(() => setSaveError(null), 5000);
    },
  });

  const executeWorkflowMutation = useMutation({
    mutationFn: async () => {
      let targetWorkflowId = workflowId;
      if (!targetWorkflowId) {
        const createdWorkflow = await createWorkflow(buildWorkflowPayload());
        targetWorkflowId = createdWorkflow.id;
        setWorkflow(createdWorkflow.id, createdWorkflow.name, nodes, edges);
        navigate('editor', { id: createdWorkflow.id });
      }
      return executeWorkflow(targetWorkflowId, 'manual');
    },
    onSettled: () => {
      executeInFlightRef.current = false;
    },
    onSuccess: (execution) => {
      if (execution?.id) {
        navigate('monitoring', { id: execution.id });
      } else {
        navigate('monitoring');
      }
    },
  });
  const canSave = isDirty && isWorkflowNameValid && !saveWorkflowMutation.isPending;

  const handleSave = useCallback(() => {
    if (!isWorkflowNameValid) {
      setSaveError('Workflow name is required');
      return;
    }
    if (!saveWorkflowMutation.isPending) {
      saveWorkflowMutation.mutate();
    }
  }, [isWorkflowNameValid, saveWorkflowMutation]);

  const handleExecute = useCallback(() => {
    if (!isWorkflowNameValid || saveWorkflowMutation.isPending || executeInFlightRef.current) return;
    executeInFlightRef.current = true;
    executeWorkflowMutation.mutate();
  }, [isWorkflowNameValid, saveWorkflowMutation.isPending, executeWorkflowMutation]);

  const handleDragStart = useCallback((type: NodeType, startX: number, startY: number) => {
    setDragState({
      type,
      startX,
      startY,
      currentX: startX,
      currentY: startY,
    });
  }, []);

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
    <div className="flex flex-col h-full relative">
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
            onChange={(e) => setWorkflowName(e.target.value)}
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
          <motion.button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            animate={saveGlow ? {
              boxShadow: [
                '0 0 0px rgba(99, 102, 241, 0)',
                '0 0 20px rgba(99, 102, 241, 0.6)',
                '0 0 0px rgba(99, 102, 241, 0)',
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
            {saveWorkflowMutation.isPending ? 'Saving...' : 'Save'}
          </motion.button>
          {saveError && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="text-xs text-state-error"
              role="alert"
            >
              {saveError}
            </motion.span>
          )}
          <motion.button
            type="button"
            onClick={handleExecute}
            disabled={!isWorkflowNameValid || saveWorkflowMutation.isPending || executeWorkflowMutation.isPending}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            className="px-4 py-1.5 text-sm font-medium bg-control text-white rounded-lg hover:bg-control-hover hover:shadow-glow-lg transition-all focus:outline-none focus:ring-2 focus:ring-border-focus disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Execute workflow (Cmd+Enter)"
          >
            {executeWorkflowMutation.isPending ? 'Executing...' : 'Execute'}
          </motion.button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <NodePalette onDragStart={handleDragStart} />
        <WorkflowCanvas dragState={dragState} />
        <AnimatePresence>
          {selectedNodeId && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="overflow-hidden flex-shrink-0"
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
