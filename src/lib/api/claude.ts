import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface ExecutionResult {
  id: string;
  status: string;
  started_at?: string;
}

export interface ClaudeOutput {
  execution_id: string;
  content: string;
  stream: 'stdout' | 'stderr';
}

export interface ClaudeExecutionComplete {
  execution_id: string;
  exit_code?: number;
  success: boolean;
}

export interface ClaudeCredentialStatus {
  configured: boolean;
  account_label?: string;
}

export async function executePlan(params: {
  prompt: string;
  workingDir?: string;
  timeoutSecs?: number;
}): Promise<ExecutionResult> {
  return invoke('execute_plan', params);
}

export async function cancelExecution(executionId: string): Promise<void> {
  return invoke('cancel_execution', { executionId });
}

export async function listRunningExecutions(): Promise<string[]> {
  return invoke('list_running_executions');
}

export async function getClaudeCredentialStatus(): Promise<ClaudeCredentialStatus> {
  return invoke('get_claude_credential_status');
}

export async function saveClaudeCredential(params: {
  apiKey: string;
  accountLabel?: string;
}): Promise<ClaudeCredentialStatus> {
  return invoke('save_claude_credential', {
    apiKey: params.apiKey,
    accountLabel: params.accountLabel ?? null,
  });
}

export function onClaudeStdout(
  callback: (event: ClaudeOutput) => void,
): Promise<UnlistenFn> {
  return listen<ClaudeOutput>('claude:output:stdout', (event) => {
    callback(event.payload);
  });
}

export function onClaudeStderr(
  callback: (event: ClaudeOutput) => void,
): Promise<UnlistenFn> {
  return listen<ClaudeOutput>('claude:output:stderr', (event) => {
    callback(event.payload);
  });
}

export function onClaudeComplete(
  callback: (event: ClaudeExecutionComplete) => void,
): Promise<UnlistenFn> {
  return listen<ClaudeExecutionComplete>('claude:execution:complete', (event) => {
    callback(event.payload);
  });
}
