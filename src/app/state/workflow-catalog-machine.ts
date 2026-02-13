import { createActorContext } from '@xstate/react';
import { createElement, type ReactNode } from 'react';
import { assign, fromPromise, setup, type ActorRefFrom } from 'xstate';
import { listWorkflows, deleteWorkflow } from '@/lib/api/workflow';
import type { Workflow } from '@/types/workflow';

interface WorkflowCatalogContext {
  workflows: Workflow[];
  loadError: string | null;
  actionError: string | null;
  pendingDeleteId: string | null;
}

type WorkflowCatalogEvent =
  | { type: 'RETRY' }
  | { type: 'REFRESH' }
  | { type: 'REQUEST_DELETE'; id: string }
  | { type: 'CANCEL_DELETE' }
  | { type: 'CONFIRM_DELETE' };

export const workflowCatalogMachine = setup({
  types: {} as {
    context: WorkflowCatalogContext;
    events: WorkflowCatalogEvent;
  },
  actors: {
    loadWorkflows: fromPromise(async () => listWorkflows()),
    deleteWorkflowById: fromPromise(async ({ input }: { input: { id: string } }) => {
      await deleteWorkflow(input.id);
      return input.id;
    }),
  },
}).createMachine({
  id: 'workflowCatalog',
  context: {
    workflows: [],
    loadError: null,
    actionError: null,
    pendingDeleteId: null,
  },
  initial: 'loading',
  states: {
    loading: {
      invoke: {
        src: 'loadWorkflows',
        onDone: {
          target: 'ready',
          actions: assign({
            workflows: ({ event }) => event.output,
            loadError: null,
          }),
        },
        onError: {
          target: 'failure',
          actions: assign({
            loadError: ({ event }) => event.error instanceof Error
              ? event.error.message
              : 'Could not load workflows',
          }),
        },
      },
    },
    failure: {
      on: {
        RETRY: {
          target: 'loading',
        },
        REFRESH: {
          target: 'loading',
        },
      },
    },
    ready: {
      on: {
        REFRESH: {
          target: 'loading',
        },
        REQUEST_DELETE: {
          actions: assign({
            pendingDeleteId: ({ event }) => event.id,
            actionError: null,
          }),
        },
        CANCEL_DELETE: {
          actions: assign({
            pendingDeleteId: null,
          }),
        },
        CONFIRM_DELETE: {
          guard: ({ context }) => context.pendingDeleteId !== null,
          target: 'deleting',
        },
      },
    },
    deleting: {
      invoke: {
        src: 'deleteWorkflowById',
        input: ({ context }) => ({ id: context.pendingDeleteId ?? '' }),
        onDone: {
          target: 'loading',
          actions: assign({
            pendingDeleteId: null,
            actionError: null,
          }),
        },
        onError: {
          target: 'ready',
          actions: assign({
            pendingDeleteId: null,
            actionError: 'Failed to delete workflow',
          }),
        },
      },
    },
  },
});

export const WorkflowCatalogContext = createActorContext(workflowCatalogMachine);

export function WorkflowCatalogProvider({ children }: { children: ReactNode }) {
  return createElement(WorkflowCatalogContext.Provider, null, children);
}

export function useWorkflowCatalogActorRef(): ActorRefFrom<typeof workflowCatalogMachine> {
  return WorkflowCatalogContext.useActorRef();
}
