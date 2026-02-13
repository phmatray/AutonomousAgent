import { invoke } from '@tauri-apps/api/core';
import type {
  Workflow,
  WorkflowExecution,
  ExecutionLog,
  WorkflowPreflightResult,
} from '@/types/workflow';

export interface DebugBundleCredentialAuditFilter {
  provider?: string;
  action?: string;
  result?: 'all' | 'success' | 'failure';
  fromTimestamp?: string;
  toTimestamp?: string;
  limit?: number;
}

interface WorkflowCommandPayloads {
  list_workflows: undefined;
  get_workflow: { id: string };
  create_workflow: { workflow: Workflow };
  update_workflow: { id: string; workflow: Partial<Workflow> };
  delete_workflow: { id: string };
  execute_workflow: { workflowId: string; triggerType?: string; triggerPayload?: unknown };
  preflight_workflow: { workflow: Workflow };
  list_executions: { workflowId?: string };
  get_execution_logs: { executionId: string };
  cancel_workflow_execution: { executionId: string };
  copy_debug_bundle: {
    executionId: string;
    credentialAuditFilter?: DebugBundleCredentialAuditFilter;
  };
}

interface WorkflowCommandResults {
  list_workflows: Workflow[];
  get_workflow: Workflow | null;
  create_workflow: Workflow;
  update_workflow: Workflow;
  delete_workflow: void;
  execute_workflow: WorkflowExecution;
  preflight_workflow: WorkflowPreflightResult;
  list_executions: WorkflowExecution[];
  get_execution_logs: ExecutionLog[];
  cancel_workflow_execution: void;
  copy_debug_bundle: { bundleJson: string };
}

async function invokeWorkflowCommand<K extends keyof WorkflowCommandPayloads>(
  command: K,
  payload: WorkflowCommandPayloads[K],
): Promise<WorkflowCommandResults[K]> {
  if (payload === undefined) {
    return invoke(command);
  }
  return invoke(command, payload);
}

export async function listWorkflows(): Promise<Workflow[]> {
  return invokeWorkflowCommand('list_workflows', undefined);
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  return invokeWorkflowCommand('get_workflow', { id });
}

export async function createWorkflow(
  workflow: Workflow,
): Promise<Workflow> {
  return invokeWorkflowCommand('create_workflow', { workflow });
}

export async function updateWorkflow(
  id: string,
  workflow: Partial<Workflow>,
): Promise<Workflow> {
  return invokeWorkflowCommand('update_workflow', { id, workflow });
}

export async function deleteWorkflow(id: string): Promise<void> {
  return invokeWorkflowCommand('delete_workflow', { id });
}

export async function executeWorkflow(
  workflowId: string,
  triggerType?: string,
  triggerPayload?: unknown,
): Promise<WorkflowExecution> {
  return invokeWorkflowCommand('execute_workflow', { workflowId, triggerType, triggerPayload });
}

export async function preflightWorkflow(
  workflow: Workflow,
): Promise<WorkflowPreflightResult> {
  return invokeWorkflowCommand('preflight_workflow', { workflow });
}

export async function listExecutions(
  workflowId?: string,
): Promise<WorkflowExecution[]> {
  return invokeWorkflowCommand('list_executions', { workflowId });
}

export async function getExecutionLogs(
  executionId: string,
): Promise<ExecutionLog[]> {
  return invokeWorkflowCommand('get_execution_logs', { executionId });
}

export async function cancelExecution(executionId: string): Promise<void> {
  return invokeWorkflowCommand('cancel_workflow_execution', { executionId });
}

export async function copyDebugBundle(
  executionId: string,
  credentialAuditFilter?: DebugBundleCredentialAuditFilter,
): Promise<{ bundleJson: string }> {
  return invokeWorkflowCommand('copy_debug_bundle', {
    executionId,
    credentialAuditFilter,
  });
}
