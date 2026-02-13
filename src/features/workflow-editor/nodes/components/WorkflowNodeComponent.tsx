import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Circle,
  Check,
  X,
} from 'lucide-react';
import type { WorkflowNode } from '@/features/workflow-editor/stores/editor-store';
import { getNodeLabel } from '@/features/workflow-editor/nodes/catalog';
import { getNodeFeature, type NodeFeature } from '@/features/workflow-editor/nodes/features';
import { NODE_ICONS } from '@/features/workflow-editor/nodes/icons';

interface CategoryStyle {
  bg: string;
  border: string;
  selectedBorder: string;
  iconBg: string;
  headerColor: string;
}

const CATEGORY_STYLES: Record<NodeFeature, CategoryStyle> = {
  github: {
    bg: 'bg-gradient-to-br from-github-bg to-bg-secondary',
    border: 'border-github-border',
    selectedBorder: 'border-github-accent',
    iconBg: 'bg-github-muted text-github',
    headerColor: 'text-github',
  },
  git: {
    bg: 'bg-gradient-to-br from-git-bg to-bg-secondary',
    border: 'border-git-border',
    selectedBorder: 'border-git-accent',
    iconBg: 'bg-git-muted text-git',
    headerColor: 'text-git',
  },
  claude: {
    bg: 'bg-gradient-to-br from-claude-bg to-bg-secondary',
    border: 'border-claude-border',
    selectedBorder: 'border-claude-accent',
    iconBg: 'bg-claude-muted text-claude',
    headerColor: 'text-claude',
  },
  control: {
    bg: 'bg-gradient-to-br from-bg-tertiary to-bg-secondary',
    border: 'border-border-primary',
    selectedBorder: 'border-control',
    iconBg: 'bg-control-muted text-control',
    headerColor: 'text-control',
  },
};

type ExecutionStatus = 'idle' | 'running' | 'completed' | 'error' | 'scheduled';

const EXECUTION_STYLES: Record<ExecutionStatus, { borderClass: string; cssAnimation: string; icon: LucideIcon; color: string; animate?: string }> = {
  idle: { borderClass: '', cssAnimation: '', icon: Circle, color: 'text-state-idle' },
  scheduled: { borderClass: 'border-state-scheduled', cssAnimation: 'node-state-scheduled', icon: Clock, color: 'text-state-scheduled' },
  running: { borderClass: 'border-state-running', cssAnimation: 'node-state-running', icon: Loader2, color: 'text-state-running', animate: 'animate-spin' },
  completed: { borderClass: 'border-state-success', cssAnimation: '', icon: CheckCircle2, color: 'text-state-success' },
  error: { borderClass: 'border-state-error', cssAnimation: '', icon: XCircle, color: 'text-state-error' },
};

function getConfigSummary(config: Record<string, unknown>): string | null {
  const entries = Object.entries(config).filter(([, v]) => v !== '' && v !== null && v !== undefined);
  if (entries.length === 0) return null;
  const [key, value] = entries[0];
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  const display = str.length > 30 ? str.slice(0, 30) + '...' : str;
  const suffix = entries.length > 1 ? ` +${entries.length - 1} more` : '';
  return `${key}: ${display}${suffix}`;
}

function WorkflowNodeComponent({ data, selected, dragging }: NodeProps<WorkflowNode>) {
  const [hasAppeared, setHasAppeared] = useState(false);
  const category = getNodeFeature(data.nodeType);
  const style = CATEGORY_STYLES[category];
  const NodeIcon = NODE_ICONS[data.nodeType] ?? Circle;
  const execStatus = (data.executionStatus ?? 'idle') as ExecutionStatus;
  const execStyle = EXECUTION_STYLES[execStatus];
  const ExecIcon = execStyle.icon;
  const configSummary = getConfigSummary(data.config);
  const nodeLabel = getNodeLabel(data.nodeType);

  const borderColor = execStatus !== 'idle' ? execStyle.borderClass : (selected ? style.selectedBorder : style.border);
  const statusLabel = execStatus !== 'idle' ? `, status: ${execStatus}` : '';

  return (
    <motion.div
      initial={!hasAppeared ? { opacity: 0, scale: 0.8 } : false}
      animate={{
        opacity: 1,
        scale: dragging ? 1.05 : 1,
        boxShadow: dragging
          ? '0 8px 30px rgba(203, 166, 247, 0.3)'
          : selected
            ? '0 4px 20px rgba(203, 166, 247, 0.35)'
            : '0 4px 12px rgba(0, 0, 0, 0.4)',
      }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 25,
        opacity: { duration: 0.2 },
      }}
      onAnimationComplete={() => setHasAppeared(true)}
      className={`
        rounded-lg border-2 ${borderColor} ${style.bg}
        min-w-[200px] max-w-[260px]
        ${execStyle.cssAnimation}
      `}
      role="group"
      aria-label={`${nodeLabel} workflow node${statusLabel}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-border-primary !border-2 !border-bg-elevated hover:!bg-control hover:!border-control !transition-colors"
        aria-label="Input connection point"
      />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-flex items-center justify-center w-8 h-8 rounded-md ${style.iconBg}`}
            aria-hidden="true"
          >
            <NodeIcon size={16} strokeWidth={2} />
          </span>
          <div className="flex flex-col min-w-0 flex-1">
            <span className={`text-[10px] font-technical font-medium uppercase tracking-widest ${style.headerColor}`}>
              {category}
            </span>
            <span className="text-sm font-medium text-text-primary truncate">
              {nodeLabel}
            </span>
          </div>
          {execStatus !== 'idle' && (
            <span className={`flex-shrink-0 ${execStyle.color}`} aria-label={`Status: ${execStatus}`}>
              <ExecIcon size={14} className={execStyle.animate ?? ''} />
            </span>
          )}
        </div>
        <div className="mt-2 pt-2 border-t border-border-secondary">
          {configSummary ? (
            <p className="text-[11px] text-text-tertiary font-technical truncate">
              {configSummary}
            </p>
          ) : (
            <p className="text-[11px] text-text-tertiary italic">
              Not configured
            </p>
          )}
        </div>
      </div>
      {data.nodeType === 'condition' ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            className="!w-4 !h-4 !bg-emerald-600 !border-2 !border-emerald-400 hover:!bg-emerald-500 hover:!border-emerald-300 !transition-colors !flex !items-center !justify-center"
            aria-label="True branch output"
          >
            <Check size={10} className="text-white pointer-events-none" strokeWidth={3} />
          </Handle>
          <Handle
            type="source"
            position={Position.Left}
            id="false"
            className="!w-4 !h-4 !bg-red-600 !border-2 !border-red-400 hover:!bg-red-500 hover:!border-red-300 !transition-colors !flex !items-center !justify-center"
            aria-label="False branch output"
          >
            <X size={10} className="text-white pointer-events-none" strokeWidth={3} />
          </Handle>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-3 !h-3 !bg-border-primary !border-2 !border-bg-elevated hover:!bg-control hover:!border-control !transition-colors"
          aria-label="Output connection point"
        />
      )}
    </motion.div>
  );
}

export default memo(WorkflowNodeComponent);
