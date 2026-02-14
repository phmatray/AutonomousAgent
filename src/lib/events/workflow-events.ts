import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ExecutionLog, RuntimeNodeEvent, WorkflowExecution } from '@/types/workflow';

export type WorkflowExecutionStatusEvent = Partial<WorkflowExecution> & { id: string };

export async function onWorkflowExecutionStatus(
  handler: (payload: WorkflowExecutionStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<WorkflowExecutionStatusEvent>('workflow:execution-status', (event) => {
    handler(event.payload);
  });
}

export async function onExecutionLogStream(
  executionId: string,
  handler: (payload: ExecutionLog) => void,
): Promise<UnlistenFn> {
  return listen<ExecutionLog>(`execution-log-${executionId}`, (event) => {
    handler(event.payload);
  });
}

export async function onWorkflowNodeStarted(
  handler: (payload: RuntimeNodeEvent) => void,
): Promise<UnlistenFn> {
  return listen<RuntimeNodeEvent>('workflow:node-started', (event) => {
    handler(event.payload);
  });
}

export async function onWorkflowNodeFinished(
  handler: (payload: RuntimeNodeEvent) => void,
): Promise<UnlistenFn> {
  return listen<RuntimeNodeEvent>('workflow:node-finished', (event) => {
    handler(event.payload);
  });
}
