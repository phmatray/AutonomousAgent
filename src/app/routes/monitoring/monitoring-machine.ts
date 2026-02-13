import { assign, fromCallback, fromPromise, setup } from 'xstate';
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

type MonitoringEvent =
  | { type: 'REQUESTED_EXECUTION_CHANGED'; executionId: string | null }
  | { type: 'RETRY_EXECUTIONS' }
  | { type: 'REFRESH_EXECUTIONS' }
  | { type: 'SELECT_EXECUTION'; executionId: string }
  | { type: 'STREAM_LOG_RECEIVED'; log: ExecutionLog }
  | { type: 'CANCEL_SELECTED' };

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
    pollExecutions: fromCallback(({ sendBack }) => {
      const timer = window.setInterval(() => {
        sendBack({ type: 'REFRESH_EXECUTIONS' });
      }, 3000);
      return () => window.clearInterval(timer);
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
      guard: ({ context }) => context.selectedExecutionId !== null,
      actions: assign({
        streamingLogs: ({ context, event }) => [...context.streamingLogs, event.log],
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
          actions: assign(({ context, event }) => ({
            executions: event.output,
            executionsError: null,
            ...syncSelection(context, event.output),
          })),
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
      invoke: {
        src: 'pollExecutions',
      },
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
          actions: assign(({ context, event }) => ({
            executions: event.output,
            executionsError: null,
            ...syncSelection(context, event.output),
          })),
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
