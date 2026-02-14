import type { ExecutionStatus, WorkflowExecution } from '@/types/workflow';

export const SIDEBAR_WIDTH_STORAGE_KEY = 'autonomous-agent.monitoring.sidebar-width';
export const LOG_DENSITY_STORAGE_KEY = 'autonomous-agent.monitoring.log-density';
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 288;
export const MAX_DEBUG_BUNDLE_CREDENTIAL_EVENTS = 200;
export const LOG_DENSITY_MODES = ['compact', 'expanded'] as const;
export type LogDensityMode = (typeof LOG_DENSITY_MODES)[number];

export const EXECUTION_STATUS_FILTERS: Array<'ALL' | ExecutionStatus> = [
  'ALL',
  'RUNNING',
  'FAILED',
  'COMPLETED',
  'CANCELLED',
  'SCHEDULED',
  'PAUSED',
  'IDLE',
];

export interface ExecutionContextEntry {
  node_id?: string;
  status?: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  retry_count?: number;
  policy?: {
    max_retries?: number;
    retry_delay_ms?: number;
    backoff?: string;
    timeout_secs?: number | null;
    continue_on_error?: boolean;
  };
  resolved_config?: Record<string, unknown> | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
}

export interface TimelineNodeState {
  executionId: string;
  workflowId: string;
  nodeId: string;
  nodeType: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  retryCount?: number | null;
  error?: string | null;
}

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function loadSidebarWidth(): number {
  if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
  const rawValue = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (!rawValue) return SIDEBAR_DEFAULT_WIDTH;

  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue)) return SIDEBAR_DEFAULT_WIDTH;

  return clampSidebarWidth(parsedValue);
}

export function loadLogDensityMode(): LogDensityMode {
  if (typeof window === 'undefined') return 'compact';
  const rawValue = window.localStorage.getItem(LOG_DENSITY_STORAGE_KEY);
  if (rawValue === 'expanded') return 'expanded';
  return 'compact';
}

export function formatExportError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Failed to export debug bundle';
  }
}

export function toDateBoundaryIso(localDate: string, endOfDay: boolean): string | null {
  const trimmed = localDate.trim();
  if (!trimmed) return null;

  const date = new Date(`${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function getExecutionContextEntries(context: unknown): ExecutionContextEntry[] {
  if (!Array.isArray(context)) return [];
  return context.filter((entry): entry is ExecutionContextEntry =>
    typeof entry === 'object' && entry !== null,
  );
}

export function toTimelineState(entry: ExecutionContextEntry): TimelineNodeState {
  return {
    executionId: '',
    workflowId: '',
    nodeId: entry.node_id ?? 'unknown',
    nodeType: 'node',
    status: (entry.status as TimelineNodeState['status']) ?? 'SKIPPED',
    startedAt: entry.started_at ?? new Date().toISOString(),
    completedAt: entry.completed_at ?? null,
    durationMs: entry.duration_ms ?? null,
    retryCount: entry.retry_count ?? null,
    error: entry.error ?? null,
  };
}

export function upsertTimelineNode(
  nodes: TimelineNodeState[],
  incoming: TimelineNodeState,
): TimelineNodeState[] {
  const index = nodes.findIndex((node) => node.nodeId === incoming.nodeId);
  if (index < 0) {
    return [...nodes, incoming];
  }

  const next = [...nodes];
  next[index] = {
    ...next[index],
    ...incoming,
    startedAt: incoming.startedAt || next[index].startedAt,
  };
  return next;
}

export function countExecutionsByStatus(executions: WorkflowExecution[]): Record<ExecutionStatus, number> {
  const counts: Record<ExecutionStatus, number> = {
    IDLE: 0,
    SCHEDULED: 0,
    RUNNING: 0,
    PAUSED: 0,
    COMPLETED: 0,
    FAILED: 0,
    CANCELLED: 0,
  };
  for (const execution of executions) {
    counts[execution.status] += 1;
  }
  return counts;
}

export function filterExecutions(
  executions: WorkflowExecution[],
  searchQuery: string,
  statusFilter: 'ALL' | ExecutionStatus,
): WorkflowExecution[] {
  const normalizedSearch = searchQuery.trim().toLowerCase();
  return executions.filter((execution) => {
    if (statusFilter !== 'ALL' && execution.status !== statusFilter) {
      return false;
    }
    if (!normalizedSearch) return true;

    return execution.id.toLowerCase().includes(normalizedSearch)
      || execution.workflowId.toLowerCase().includes(normalizedSearch)
      || execution.status.toLowerCase().includes(normalizedSearch);
  });
}
