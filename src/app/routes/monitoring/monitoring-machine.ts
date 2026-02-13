import { assign, fromPromise, setup } from 'xstate';
import { cancelExecution, getExecutionLogs, listExecutions } from '@/lib/api/workflow';
import type { ExecutionLog, WorkflowExecution } from '@/types/workflow';

interface MonitoringContext {
  executions: WorkflowExecution[];
  executionsError: string | null;
  selectedExecutionId: string | null;
  requestedExecutionId: string | null;
  logs: ExecutionLog[];
  streamingLogs: ExecutionLog[];
  logsError: string | null;
  cancelError: string | null;
}

type ExecutionPatch = Partial<WorkflowExecution> & Pick<WorkflowExecution, 'id'>;

type MonitoringEvent =
  | { type: 'REQUESTED_EXECUTION_CHANGED'; executionId: string | null }
  | { type: 'RETRY_EXECUTIONS' }
  | { type: 'REFRESH_EXECUTIONS' }
  | { type: 'SELECT_EXECUTION'; executionId: string }
  | { type: 'STREAM_LOG_RECEIVED'; log: ExecutionLog }
  | { type: 'EXECUTION_STATUS_RECEIVED'; execution: ExecutionPatch }
  | { type: 'CANCEL_SELECTED' };

function executionTimestamp(execution: WorkflowExecution): number {
  const candidate = execution.startedAt ?? execution.completedAt ?? '';
  const value = new Date(candidate).getTime();
  return Number.isFinite(value) ? value : 0;
}

function sortExecutions(executions: WorkflowExecution[]): WorkflowExecution[] {
  return [...executions].sort((left, right) => executionTimestamp(right) - executionTimestamp(left));
}

function syncSelection(
  context: MonitoringContext,
  executions: WorkflowExecution[],
): Partial<MonitoringContext> {
  const has = (executionId: string | null) =>
    !!executionId && executions.some((execution) => execution.id === executionId);

  let selectedExecutionId = context.selectedExecutionId;
  if (has(context.requestedExecutionId)) {
    selectedExecutionId = context.requestedExecutionId;
  }

  if (!has(selectedExecutionId)) {
    selectedExecutionId = null;
  }

  const selectionChanged = selectedExecutionId !== context.selectedExecutionId;
  return {
    selectedExecutionId,
    logs: selectionChanged ? [] : context.logs,
    streamingLogs: selectionChanged ? [] : context.streamingLogs,
  };
}

function upsertExecution(executions: WorkflowExecution[], patch: ExecutionPatch): WorkflowExecution[] {
  let found = false;
  const merged = executions.map((execution) => {
    if (execution.id !== patch.id) return execution;
    found = true;
    return {
      ...execution,
      ...patch,
      workflowId: patch.workflowId ?? execution.workflowId,
      status: patch.status ?? execution.status,
      triggerType: patch.triggerType ?? execution.triggerType,
      startedAt: patch.startedAt ?? execution.startedAt,
      completedAt: patch.completedAt ?? execution.completedAt,
      error: patch.error ?? execution.error,
      currentNodeId: patch.currentNodeId ?? execution.currentNodeId,
      context: patch.context ?? execution.context,
    };
  });

  if (!found) {
    merged.push({
      id: patch.id,
      workflowId: patch.workflowId ?? 'unknown',
      status: patch.status ?? 'RUNNING',
      triggerType: patch.triggerType,
      startedAt: patch.startedAt,
      completedAt: patch.completedAt,
      error: patch.error,
      currentNodeId: patch.currentNodeId,
      context: patch.context,
    });
  }

  return sortExecutions(merged);
}

export const monitoringMachine = setup({
  types: {} as {
    context: MonitoringContext;
    events: MonitoringEvent;
  },
  actors: {
    fetchExecutions: fromPromise(async () => listExecutions()),
    fetchLogs: fromPromise(async ({ input }: { input: { executionId: string } }) =>
      getExecutionLogs(input.executionId),
    ),
    cancelSelectedExecution: fromPromise(async ({ input }: { input: { executionId: string } }) => {
      await cancelExecution(input.executionId);
      return input.executionId;
    }),
  },
}).createMachine({
  id: 'monitoring',
  context: {
    executions: [],
    executionsError: null,
    selectedExecutionId: null,
    requestedExecutionId: null,
    logs: [],
    streamingLogs: [],
    logsError: null,
    cancelError: null,
  },
  initial: 'loadingExecutions',
  on: {
    REQUESTED_EXECUTION_CHANGED: {
      actions: assign({
        requestedExecutionId: ({ event }) => event.executionId,
      }),
    },
    STREAM_LOG_RECEIVED: {
      guard: ({ context, event }) => context.selectedExecutionId === event.log.executionId,
      actions: assign({
        streamingLogs: ({ context, event }) => [...context.streamingLogs, event.log],
      }),
    },
    EXECUTION_STATUS_RECEIVED: {
      actions: assign(({ context, event }) => {
        const executions = upsertExecution(context.executions, event.execution);
        return {
          executions,
          ...syncSelection(context, executions),
        };
      }),
    },
    SELECT_EXECUTION: {
      target: '.loadingLogs',
      actions: assign({
        selectedExecutionId: ({ event }) => event.executionId,
        logs: [],
        streamingLogs: [],
        logsError: null,
        cancelError: null,
      }),
    },
  },
  states: {
    loadingExecutions: {
      invoke: {
        src: 'fetchExecutions',
        onDone: {
          target: 'ready',
          actions: assign(({ context, event }) => {
            const executions = sortExecutions(event.output);
            return {
              executions,
              executionsError: null,
              ...syncSelection(context, executions),
            };
          }),
        },
        onError: {
          target: 'executionsError',
          actions: assign({
            executionsError: ({ event }) => event.error instanceof Error
              ? event.error.message
              : 'Could not load executions',
          }),
        },
      },
    },
    executionsError: {
      on: {
        RETRY_EXECUTIONS: {
          target: 'loadingExecutions',
        },
      },
    },
    ready: {
      on: {
        REFRESH_EXECUTIONS: {
          target: 'refreshingExecutions',
        },
        CANCEL_SELECTED: {
          guard: ({ context }) => context.selectedExecutionId !== null,
          target: 'cancellingExecution',
        },
      },
    },
    refreshingExecutions: {
      invoke: {
        src: 'fetchExecutions',
        onDone: {
          target: 'ready',
          actions: assign(({ context, event }) => {
            const executions = sortExecutions(event.output);
            return {
              executions,
              executionsError: null,
              ...syncSelection(context, executions),
            };
          }),
        },
        onError: {
          target: 'ready',
          actions: assign({
            executionsError: ({ event }) => event.error instanceof Error
              ? event.error.message
              : 'Could not load executions',
          }),
        },
      },
    },
    loadingLogs: {
      invoke: {
        src: 'fetchLogs',
        input: ({ context }) => ({ executionId: context.selectedExecutionId ?? '' }),
        onDone: {
          target: 'ready',
          actions: assign({
            logs: ({ event }) => event.output,
            logsError: null,
          }),
        },
        onError: {
          target: 'ready',
          actions: assign({
            logsError: ({ event }) => event.error instanceof Error
              ? event.error.message
              : 'Could not load logs',
          }),
        },
      },
    },
    cancellingExecution: {
      invoke: {
        src: 'cancelSelectedExecution',
        input: ({ context }) => ({ executionId: context.selectedExecutionId ?? '' }),
        onDone: {
          target: 'ready',
          actions: assign({
            cancelError: null,
          }),
        },
        onError: {
          target: 'ready',
          actions: assign({
            cancelError: ({ event }) => event.error instanceof Error
              ? event.error.message
              : 'Could not cancel execution',
          }),
        },
      },
    },
  },
});
