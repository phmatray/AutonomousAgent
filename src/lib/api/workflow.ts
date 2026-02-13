import { invoke } from '@tauri-apps/api/core';
import type {
  Workflow,
  WorkflowExecution,
  ExecutionLog,
  WorkflowPreflightResult,
} from '@/types/workflow';

export async function listWorkflows(): Promise<Workflow[]> {
  return invoke('list_workflows');
}

export async function getWorkflow(id: string): Promise<Workflow> {
  return invoke('get_workflow', { id });
}

export async function createWorkflow(
  workflow: Workflow,
): Promise<Workflow> {
  return invoke('create_workflow', { workflow });
}

export async function updateWorkflow(
  id: string,
  workflow: Partial<Workflow>,
): Promise<Workflow> {
  return invoke('update_workflow', { id, workflow });
}

export async function deleteWorkflow(id: string): Promise<void> {
  return invoke('delete_workflow', { id });
}

export async function executeWorkflow(
  workflowId: string,
  triggerType?: string,
): Promise<WorkflowExecution> {
  return invoke('execute_workflow', { workflowId, triggerType });
}

export async function preflightWorkflow(
  workflow: Workflow,
): Promise<WorkflowPreflightResult> {
  return invoke('preflight_workflow', { workflow });
}

export async function listExecutions(
  workflowId?: string,
): Promise<WorkflowExecution[]> {
  return invoke('list_executions', { workflowId });
}

export async function getExecutionLogs(
  executionId: string,
): Promise<ExecutionLog[]> {
  return invoke('get_execution_logs', { executionId });
}

export async function cancelExecution(executionId: string): Promise<void> {
  return invoke('cancel_execution', { executionId });
}

export async function copyDebugBundle(executionId: string): Promise<{ bundleJson: string }> {
  return invoke('copy_debug_bundle', { executionId });
}
