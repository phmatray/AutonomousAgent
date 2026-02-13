// Workflow type definitions

export type NodeType =
  | 'trigger.cron'
  | 'backlog.syncIssues'
  | 'github.sync'
  | 'github.readIssues'
  | 'github.createPR'
  | 'git.worktree'
  | 'git.branch'
  | 'git.commit'
  | 'claude.analyze'
  | 'claude.plan'
  | 'claude.apply'
  | 'trigger'
  | 'condition'
  | 'loop'
  | 'delay';

export type ExecutionStatus =
  | 'IDLE'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type WorkflowLifecycleStatus = 'draft' | 'published';

export interface WorkflowNode {
  id: string;
  type: NodeType;
  config?: Record<string, any>;
  inputs?: Record<string, any>;
  position?: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface WorkflowSettings {
  timeout?: number;
  retryPolicy?: {
    maxAttempts: number;
    backoff: 'linear' | 'exponential';
    delay: number;
  };
  errorHandling?: 'stop' | 'continue' | 'retry';
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  status?: WorkflowLifecycleStatus;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  config?: Record<string, any>;
  settings?: WorkflowSettings;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  triggerType?: string;
  startedAt?: string;
  completedAt?: string;
  error?: any;
  context?: unknown;
  currentNodeId?: string;
}

export interface NodeExecution {
  id: string;
  executionId: string;
  nodeId: string;
  status: ExecutionStatus;
  input?: any;
  output?: any;
  error?: any;
  startedAt?: string;
  completedAt?: string;
  retryCount: number;
}

export interface WorkflowPreflightIssue {
  level: 'ERROR' | 'WARN';
  code: string;
  message: string;
  nodeId?: string;
  hint?: string;
}

export interface WorkflowPreflightResult {
  valid: boolean;
  issues: WorkflowPreflightIssue[];
  generatedAt: string;
}

export interface ExecutionLog {
  id: number;
  executionId: string;
  nodeId?: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface BacklogItem {
  id: string;
  owner: string;
  repo: string;
  issue_number: number;
  title: string;
  body?: string;
  state: string;
  labels: string[];
  assignees: string[];
  html_url: string;
  linked_workflow_id?: string;
  resolution_guidelines_md?: string;
  synced_at: string;
  created_at: string;
  updated_at: string;
}
