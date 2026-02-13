import type { WorkflowNode, WorkflowEdge } from '@/features/workflow-editor/stores/editor-store';
import type { WorkflowPreflightIssue } from '@/types/workflow';
import type { EditorDomainEvent } from '@/app/routes/editor/editor-domain-machine';
import type { EditorFlowEvent } from '@/app/routes/editor/editor-flow-machine';
import type { Route } from '@/lib/router';

export interface PendingDeleteInfo {
  label: string;
  edgeCount: number;
}

export interface WorkflowGraphSnapshot {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  workflowId: string | null;
  workflowName: string;
  isDirty: boolean;
  selectedNodeId: string | null;
  pendingDeleteNodeId: string | null;
  pendingDeleteInfo: PendingDeleteInfo | null;
}

export interface WorkflowDomainControls {
  setGraph: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  clearGraph: () => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  sendDomainEvent: (event: EditorDomainEvent) => void;
}

export interface WorkflowFlowControls {
  isSaving: boolean;
  isExecuting: boolean;
  isBusy: boolean;
  saveGlow: boolean;
  flowError: string | null;
  sendFlowEvent: (event: EditorFlowEvent) => void;
}

export interface WorkflowExecutionState {
  preflightIssues: WorkflowPreflightIssue[];
  dismissPreflightIssues: () => void;
}

export type NavigateFn = (route: Route, params?: Record<string, string>) => void;
