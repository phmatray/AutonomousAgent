import { motion, AnimatePresence } from 'framer-motion';
import { useRef } from 'react';
import { WorkflowCanvas } from '@/features/workflow-editor/components/WorkflowCanvas';
import { NodePalette } from '@/features/workflow-editor/nodes/components/NodePalette';
import { NodeConfigPanel } from '@/features/workflow-editor/nodes/components/NodeConfigPanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useEditorWorkflow } from './hooks/useEditorWorkflow';
import { useEditorInteractions } from './hooks/useEditorInteractions';

export function EditorPage() {
  const fileMenuRef = useRef<HTMLDetailsElement>(null);
  const {
    workflowName,
    isWorkflowNameValid,
    isDirty,
    selectedNodeId,
    pendingDeleteNodeId,
    pendingDeleteInfo,
    preflightIssues,
    saveGlow,
    flowError,
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
  } = useEditorWorkflow();

  const {
    dragState,
    handleDragStart,
    handleQuickAddNode,
  } = useEditorInteractions({
    onSave: handleSave,
    onExecute: handleExecute,
  });

  const closeFileMenu = () => {
    if (fileMenuRef.current) {
      fileMenuRef.current.open = false;
    }
  };

  return (
    <div className="flex flex-col h-full relative min-w-0">
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
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.workflow.json,application/json"
            className="hidden"
            onChange={(event) => void handleImportFile(event)}
            aria-label="Import workflow JSON"
          />
          <details ref={fileMenuRef} className="relative">
            <summary className="list-none px-4 py-1.5 text-sm font-medium bg-bg-elevated text-text-secondary border border-border-primary rounded-lg hover:bg-bg-tertiary hover:text-text-primary hover:border-border-hover transition-all cursor-pointer select-none">
              File
            </summary>
            <div className="absolute right-0 mt-2 w-44 rounded-lg border border-border-primary bg-bg-secondary shadow-node z-20 p-1">
              <button
                type="button"
                onClick={() => {
                  closeFileMenu();
                  handleImportClick();
                }}
                className="w-full text-left px-3 py-2 text-sm rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
                aria-label="Import workflow"
              >
                Import JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  closeFileMenu();
                  handleExport();
                }}
                className="w-full text-left px-3 py-2 text-sm rounded-md text-text-secondary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
                aria-label="Export workflow"
              >
                Export JSON
              </button>
            </div>
          </details>
          <motion.button
            type="button"
            onClick={() => void handleSave()}
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
            onClick={() => void handleExecute()}
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
              onClick={dismissPreflightIssues}
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
