import { assign, setup } from 'xstate';

interface EditorFlowContext {
  saveGlow: boolean;
  error: string | null;
}

export type EditorFlowEvent =
  | { type: 'SAVE_REQUEST' }
  | { type: 'SAVE_SUCCESS' }
  | { type: 'SAVE_FAILURE'; message: string }
  | { type: 'SAVE_GLOW_TIMEOUT' }
  | { type: 'EXECUTE_REQUEST' }
  | { type: 'EXECUTE_SUCCESS' }
  | { type: 'EXECUTE_FAILURE'; message: string }
  | { type: 'CLEAR_ERROR' };

export const editorFlowMachine = setup({
  types: {} as {
    context: EditorFlowContext;
    events: EditorFlowEvent;
  },
}).createMachine({
  id: 'editorFlow',
  context: {
    saveGlow: false,
    error: null,
  },
  initial: 'idle',
  states: {
    idle: {
      on: {
        SAVE_REQUEST: {
          target: 'saving',
          actions: assign({
            error: null,
          }),
        },
        EXECUTE_REQUEST: {
          target: 'executing',
          actions: assign({
            error: null,
          }),
        },
        SAVE_GLOW_TIMEOUT: {
          actions: assign({
            saveGlow: false,
          }),
        },
        CLEAR_ERROR: {
          actions: assign({
            error: null,
          }),
        },
      },
    },
    saving: {
      on: {
        SAVE_SUCCESS: {
          target: 'idle',
          actions: assign({
            saveGlow: true,
            error: null,
          }),
        },
        SAVE_FAILURE: {
          target: 'idle',
          actions: assign({
            error: ({ event }) => event.message,
          }),
        },
      },
    },
    executing: {
      on: {
        EXECUTE_SUCCESS: {
          target: 'idle',
          actions: assign({
            error: null,
          }),
        },
        EXECUTE_FAILURE: {
          target: 'idle',
          actions: assign({
            error: ({ event }) => event.message,
          }),
        },
      },
    },
  },
});
