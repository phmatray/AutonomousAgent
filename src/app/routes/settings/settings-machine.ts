import { assign, fromPromise, setup } from 'xstate';
import { authenticateGitHub, getAuthStatus } from '@/lib/api/github';

interface AuthStatus {
  authenticated: boolean;
  username?: string;
}

interface SettingsContext {
  authStatus: AuthStatus | null;
  statusError: boolean;
  token: string;
  showToken: boolean;
  saveFeedback: 'idle' | 'success' | 'error';
}

type SettingsEvent =
  | { type: 'TOKEN_CHANGED'; value: string }
  | { type: 'TOGGLE_SHOW_TOKEN' }
  | { type: 'SUBMIT_TOKEN' }
  | { type: 'RETRY_STATUS' }
  | { type: 'CLEAR_SAVE_FEEDBACK' };

export const settingsMachine = setup({
  types: {} as {
    context: SettingsContext;
    events: SettingsEvent;
  },
  actors: {
    fetchAuthStatus: fromPromise(async () => getAuthStatus()),
    saveToken: fromPromise(async ({ input }: { input: { token: string } }) =>
      authenticateGitHub(input.token),
    ),
  },
}).createMachine({
  id: 'settings',
  context: {
    authStatus: null,
    statusError: false,
    token: '',
    showToken: false,
    saveFeedback: 'idle',
  },
  initial: 'checkingStatus',
  on: {
    TOKEN_CHANGED: {
      actions: assign({
        token: ({ event }) => event.value,
      }),
    },
    TOGGLE_SHOW_TOKEN: {
      actions: assign({
        showToken: ({ context }) => !context.showToken,
      }),
    },
    CLEAR_SAVE_FEEDBACK: {
      actions: assign({
        saveFeedback: 'idle',
      }),
    },
  },
  states: {
    checkingStatus: {
      invoke: {
        src: 'fetchAuthStatus',
        onDone: {
          target: 'idle',
          actions: assign({
            authStatus: ({ event }) => event.output,
            statusError: false,
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            statusError: true,
          }),
        },
      },
    },
    idle: {
      on: {
        RETRY_STATUS: {
          target: 'checkingStatus',
        },
        SUBMIT_TOKEN: {
          guard: ({ context }) => context.token.trim().length > 0,
          target: 'savingToken',
          actions: assign({
            saveFeedback: 'idle',
          }),
        },
      },
    },
    savingToken: {
      invoke: {
        src: 'saveToken',
        input: ({ context }) => ({ token: context.token.trim() }),
        onDone: {
          target: 'checkingStatus',
          actions: assign({
            token: '',
            showToken: false,
            saveFeedback: 'success',
          }),
        },
        onError: {
          target: 'idle',
          actions: assign({
            saveFeedback: 'error',
          }),
        },
      },
    },
  },
});
