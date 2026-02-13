import { useCallback, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WorkflowCanvas } from '@/features/workflow-editor/components/WorkflowCanvas';
import { NodePalette } from '@/features/workflow-editor/components/NodePalette';
import { NodeConfigPanel } from '@/features/workflow-editor/components/NodeConfigPanel';
import { useEditorStore } from '@/features/workflow-editor/stores/editor-store';
import type { NodeType } from '@/types/workflow';

interface DragState {
  type: NodeType;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export function EditorPage() {
  const workflowName = useEditorStore((s) => s.workflowName);
  const setWorkflowName = useEditorStore((s) => s.setWorkflowName);
  const isDirty = useEditorStore((s) => s.isDirty);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [saveGlow, setSaveGlow] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSave = useCallback(() => {
    // Trigger save glow animation
    setSaveGlow(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => setSaveGlow(false), 1200);
  }, []);

  const handleExecute = useCallback(() => {
    // Placeholder for execute action
  }, []);

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
          />
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
            animate={saveGlow ? {
              boxShadow: [
                '0 0 0px rgba(99, 102, 241, 0)',
                '0 0 20px rgba(99, 102, 241, 0.6)',
                '0 0 0px rgba(99, 102, 241, 0)',
              ],
            } : {}}
            transition={saveGlow ? { duration: 1.2, ease: 'easeInOut' } : {}}
            className={`px-4 py-1.5 text-sm font-medium border rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-border-focus ${
              saveGlow
                ? 'bg-control/20 text-control-text border-control'
                : 'bg-bg-elevated text-text-secondary border-border-primary hover:bg-bg-tertiary hover:text-text-primary hover:border-border-hover'
            }`}
            aria-label="Save workflow (Cmd+S)"
          >
            Save
          </motion.button>
          <motion.button
            type="button"
            onClick={handleExecute}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            className="px-4 py-1.5 text-sm font-medium bg-control text-white rounded-lg hover:bg-control-hover hover:shadow-glow-lg transition-all focus:outline-none focus:ring-2 focus:ring-border-focus"
            aria-label="Execute workflow (Cmd+Enter)"
          >
            Execute
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
    </div>
  );
}
