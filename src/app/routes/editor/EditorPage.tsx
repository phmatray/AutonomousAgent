import { useCallback } from 'react';
import { WorkflowCanvas } from '@/features/workflow-editor/components/WorkflowCanvas';
import { NodePalette } from '@/features/workflow-editor/components/NodePalette';
import { NodeConfigPanel } from '@/features/workflow-editor/components/NodeConfigPanel';
import { useEditorStore } from '@/features/workflow-editor/stores/editor-store';

export function EditorPage() {
  const workflowName = useEditorStore((s) => s.workflowName);
  const setWorkflowName = useEditorStore((s) => s.setWorkflowName);
  const isDirty = useEditorStore((s) => s.isDirty);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);

  const handleDragStart = useCallback(() => {
    // Could add visual feedback here
  }, []);

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <label htmlFor="workflow-name" className="sr-only">
            Workflow name
          </label>
          <input
            id="workflow-name"
            type="text"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="bg-transparent border-none text-white text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded px-2 py-1"
            aria-label="Workflow name"
          />
          {isDirty && (
            <span className="text-xs text-yellow-400" aria-live="polite">
              Unsaved changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-4 py-1.5 text-sm bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Save workflow"
          >
            Save
          </button>
          <button
            type="button"
            className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-500 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Execute workflow"
          >
            Execute
          </button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <NodePalette onDragStart={handleDragStart} />
        <WorkflowCanvas />
        {selectedNodeId && <NodeConfigPanel />}
      </div>
    </div>
  );
}
