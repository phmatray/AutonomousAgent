import { useCallback, useEffect, useState } from 'react';
import { useEditorStore } from '@/features/workflow-editor/stores/editor-store';
import type { NodeType } from '@/types/workflow';

export interface DragState {
  type: NodeType;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface UseEditorInteractionsOptions {
  onSave: () => Promise<void>;
  onExecute: () => Promise<void>;
}

interface UseEditorInteractionsResult {
  dragState: DragState | null;
  handleDragStart: (type: NodeType, startX: number, startY: number) => void;
  handleQuickAddNode: (type: NodeType) => void;
}

export function useEditorInteractions({
  onSave,
  onExecute,
}: UseEditorInteractionsOptions): UseEditorInteractionsResult {
  const addNode = useEditorStore((s) => s.addNode);
  const nodeCount = useEditorStore((s) => s.nodes.length);
  const [dragState, setDragState] = useState<DragState | null>(null);

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
      const offset = (nodeCount % 6) * 28;
      addNode(type, { x: baseX + offset, y: baseY + offset });
    },
    [addNode, nodeCount],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === 's') {
        e.preventDefault();
        void onSave();
      }
      if (isMod && e.key === 'Enter') {
        e.preventDefault();
        void onExecute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSave, onExecute]);

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

  return {
    dragState,
    handleDragStart,
    handleQuickAddNode,
  };
}
