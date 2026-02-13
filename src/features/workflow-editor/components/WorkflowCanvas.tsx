import { useCallback, useRef, useMemo, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEditorStore, type WorkflowNode } from '@/features/workflow-editor/stores/editor-store';
import WorkflowNodeComponent from '../nodes/components/WorkflowNodeComponent';
import { AnimatedEdge } from './edges/AnimatedEdge';
import type { NodeType } from '@/types/workflow';

const nodeTypes = {
  workflowNode: WorkflowNodeComponent,
};

const edgeTypes = {
  animated: AnimatedEdge,
};

interface DragState {
  type: NodeType;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface WorkflowCanvasProps {
  dragState: DragState | null;
}

export function WorkflowCanvas({ dragState }: WorkflowCanvasProps) {
  const reactFlowRef = useRef<ReactFlowInstance<WorkflowNode> | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const onNodesChange = useEditorStore((s) => s.onNodesChange);
  const onEdgesChange = useEditorStore((s) => s.onEdgesChange);
  const onConnect = useEditorStore((s) => s.onConnect);
  const setSelectedNode = useEditorStore((s) => s.setSelectedNode);
  const addNode = useEditorStore((s) => s.addNode);
  const requestDeleteNode = useEditorStore((s) => s.requestDeleteNode);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);

  const onInit = useCallback((instance: ReactFlowInstance<WorkflowNode>) => {
    reactFlowRef.current = instance;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        if (selectedNodeId) {
          e.preventDefault();
          requestDeleteNode(selectedNodeId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, requestDeleteNode]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: WorkflowNode) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  const handleMouseUp = useCallback(
    (event: React.MouseEvent) => {
      if (!dragState) return;

      if (!reactFlowRef.current) {
        console.warn('ReactFlow instance not ready');
        return;
      }

      const position = reactFlowRef.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      console.log('Adding node at position:', position);
      addNode(dragState.type, position);
    },
    [dragState, addNode],
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'animated',
      style: { stroke: '#cba6f7', strokeWidth: 2 },
    }),
    [],
  );

  return (
    <div
      className={`flex-1 h-full w-full relative transition-all ${
        dragState ? 'ring-2 ring-control ring-inset' : ''
      } min-h-[320px] min-w-0 overflow-hidden`}
      role="application"
      aria-label="Workflow canvas"
      style={{ minHeight: '100%', minWidth: 0 }}
      onMouseUp={handleMouseUp}
    >
      {/* Atmospheric background layers */}
      <div className="absolute inset-0 bg-bg-primary" />
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'radial-gradient(ellipse at 20% 50%, rgba(203, 166, 247, 0.1) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(137, 180, 250, 0.08) 0%, transparent 50%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage:
            'radial-gradient(circle, #45475a 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="absolute inset-0 w-full h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={onInit}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          panOnDrag={[1, 2]}
          proOptions={{ hideAttribution: true }}
          className="w-full h-full !bg-transparent"
          deleteKeyCode={null}
        >
          <Background color="#45475a" gap={24} size={1} />
          {!isMobile && (
            <>
              <Controls aria-label="Canvas controls" />
              <MiniMap
                nodeColor="#cba6f7"
                maskColor="rgba(17, 17, 27, 0.72)"
                aria-label="Minimap overview"
              />
            </>
          )}
        </ReactFlow>
      </div>
    </div>
  );
}
