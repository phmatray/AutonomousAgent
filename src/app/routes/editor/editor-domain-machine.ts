import { assign, setup } from 'xstate';

interface EditorDomainContext {
  workflowId: string | null;
  workflowName: string;
  isDirty: boolean;
}

type EditorDomainEvent =
  | { type: 'WORKFLOW_LOADED'; id: string; name: string }
  | { type: 'WORKFLOW_CREATED'; id: string; name: string }
  | { type: 'WORKFLOW_IMPORTED'; name: string }
  | { type: 'WORKFLOW_CLEARED' }
  | { type: 'WORKFLOW_NAME_CHANGED'; name: string }
  | { type: 'GRAPH_CHANGED' }
  | { type: 'WORKFLOW_SAVED'; id?: string; name?: string };

export const editorDomainMachine = setup({
  types: {} as {
    context: EditorDomainContext;
    events: EditorDomainEvent;
  },
}).createMachine({
  id: 'editorDomain',
  context: {
    workflowId: null,
    workflowName: 'Untitled Workflow',
    isDirty: false,
  },
  initial: 'ready',
  states: {
    ready: {
      on: {
        WORKFLOW_LOADED: {
          actions: assign({
            workflowId: ({ event }) => event.id,
            workflowName: ({ event }) => event.name,
            isDirty: false,
          }),
        },
        WORKFLOW_CREATED: {
          actions: assign({
            workflowId: ({ event }) => event.id,
            workflowName: ({ event }) => event.name,
            isDirty: false,
          }),
        },
        WORKFLOW_IMPORTED: {
          actions: assign({
            workflowId: null,
            workflowName: ({ event }) => event.name,
            isDirty: true,
          }),
        },
        WORKFLOW_CLEARED: {
          actions: assign({
            workflowId: null,
            workflowName: 'Untitled Workflow',
            isDirty: false,
          }),
        },
        WORKFLOW_NAME_CHANGED: {
          actions: assign({
            workflowName: ({ event }) => event.name,
            isDirty: true,
          }),
        },
        GRAPH_CHANGED: {
          actions: assign({
            isDirty: true,
          }),
        },
        WORKFLOW_SAVED: {
          actions: assign({
            workflowId: ({ context, event }) => event.id ?? context.workflowId,
            workflowName: ({ context, event }) => event.name ?? context.workflowName,
            isDirty: false,
          }),
        },
      },
    },
  },
});
