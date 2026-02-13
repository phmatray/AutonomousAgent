import { useCallback, useRef, useMemo, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEditorStore, type WorkflowNode } from '@/features/workflow-editor/stores/editor-store';
import WorkflowNodeComponent from './nodes/WorkflowNodeComponent';
import type { NodeType } from '@/types/workflow';

const nodeTypes = {
  workflowNode: WorkflowNodeComponent,
};

export function WorkflowCanvas() {
  const reactFlowRef = useRef<ReactFlowInstance<WorkflowNode> | null>(null);
  const nodes = useEditorStore((s) => s.nodes);
  const edges = useEditorStore((s) => s.edges);
  const onNodesChange = useEditorStore((s) => s.onNodesChange);
  const onEdgesChange = useEditorStore((s) => s.onEdgesChange);
  const onConnect = useEditorStore((s) => s.onConnect);
  const setSelectedNode = useEditorStore((s) => s.setSelectedNode);
  const addNode = useEditorStore((s) => s.addNode);

  const onInit = useCallback((instance: ReactFlowInstance<WorkflowNode>) => {
    reactFlowRef.current = instance;
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

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/workflow-node') as NodeType;
      if (!type || !reactFlowRef.current) return;

      const position = reactFlowRef.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addNode(type, position);
    },
    [addNode],
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      animated: true,
      style: { stroke: '#6366f1', strokeWidth: 2 },
    }),
    [],
  );

  return (
    <div
      className="flex-1 h-full"
      role="application"
      aria-label="Workflow canvas"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={onInit}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-gray-950"
      >
        <Background color="#374151" gap={20} size={1} />
        <Controls
          className="!bg-gray-800 !border-gray-600 !shadow-lg [&_button]:!bg-gray-700 [&_button]:!border-gray-600 [&_button]:!text-white [&_button:hover]:!bg-gray-600"
          aria-label="Canvas controls"
        />
        <MiniMap
          className="!bg-gray-800 !border-gray-600"
          nodeColor="#6366f1"
          maskColor="rgba(0, 0, 0, 0.5)"
          aria-label="Minimap overview"
        />
      </ReactFlow>
    </div>
  );
}
