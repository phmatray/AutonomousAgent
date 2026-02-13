import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { NodeType } from '@/types/workflow';
import type { WorkflowNode } from '@/features/workflow-editor/stores/editor-store';

const CATEGORY_STYLES: Record<string, { bg: string; border: string; icon: string }> = {
  github: {
    bg: 'bg-gray-800',
    border: 'border-gray-500',
    icon: 'GH',
  },
  git: {
    bg: 'bg-orange-900',
    border: 'border-orange-500',
    icon: 'Git',
  },
  claude: {
    bg: 'bg-purple-900',
    border: 'border-purple-500',
    icon: 'AI',
  },
  control: {
    bg: 'bg-blue-900',
    border: 'border-blue-500',
    icon: 'Ctrl',
  },
};

function getCategory(nodeType: NodeType): string {
  if (nodeType.startsWith('github.')) return 'github';
  if (nodeType.startsWith('git.')) return 'git';
  if (nodeType.startsWith('claude.')) return 'claude';
  return 'control';
}

function WorkflowNodeComponent({ data, selected }: NodeProps<WorkflowNode>) {
  const category = getCategory(data.nodeType);
  const style = CATEGORY_STYLES[category];

  return (
    <div
      className={`
        rounded-lg border-2 ${style.border} ${style.bg}
        min-w-[180px] shadow-lg transition-shadow
        ${selected ? 'shadow-indigo-500/50 ring-2 ring-indigo-400' : ''}
      `}
      role="group"
      aria-label={`${data.label} workflow node`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-gray-600"
        aria-label="Input connection point"
      />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`
              inline-flex items-center justify-center
              w-8 h-8 rounded text-xs font-bold
              bg-white/10 text-white/80
            `}
            aria-hidden="true"
          >
            {style.icon}
          </span>
          <div className="flex flex-col">
            <span className="text-xs text-white/50 uppercase tracking-wider">
              {category}
            </span>
            <span className="text-sm font-medium text-white">
              {data.label}
            </span>
          </div>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-gray-600"
        aria-label="Output connection point"
      />
    </div>
  );
}

export default memo(WorkflowNodeComponent);
