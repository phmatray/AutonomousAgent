import { mockIPC } from '@tauri-apps/api/mocks';

type RecordAny = Record<string, unknown>;

export interface E2EState {
  workflows: RecordAny[];
  auth: RecordAny;
  executions: RecordAny[];
  logsByExecutionId: Record<string, RecordAny[]>;
  invokeLog: Array<{ cmd: string; args: RecordAny }>;
}

function createState(): E2EState {
  return {
    workflows: [],
    auth: { authenticated: false },
    executions: [],
    logsByExecutionId: {},
    invokeLog: [],
  };
}

export function installWebDriverTauriMock() {
  if (window.__E2E_STATE__) {
    return;
  }

  const state = createState();
  window.__E2E_STATE__ = state;

  mockIPC((cmd, payload = {}) => {
    const args = (payload ?? {}) as RecordAny;
    state.invokeLog.push({ cmd, args });

    if (cmd === 'is_initialized') {
      return {
        database: true,
        github_auth_attempted: true,
      };
    }

    if (cmd === 'list_workflows') return state.workflows;

    if (cmd === 'get_workflow') {
      const id = args.id as string | undefined;
      return state.workflows.find((wf) => wf.id === id) ?? null;
    }

    if (cmd === 'create_workflow') {
      const workflow = (args.workflow ?? {}) as RecordAny;
      const created = {
        ...workflow,
        id: (workflow.id as string | undefined)?.trim() ? workflow.id : 'wf-created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.workflows.push(created);
      return created;
    }

    if (cmd === 'update_workflow') {
      const id = args.id as string;
      const workflow = (args.workflow ?? {}) as RecordAny;
      const index = state.workflows.findIndex((wf) => wf.id === id);

      if (index >= 0) {
        state.workflows[index] = { ...state.workflows[index], ...workflow, id };
        return state.workflows[index];
      }

      return { ...workflow, id };
    }

    if (cmd === 'delete_workflow') {
      const id = args.id as string;
      state.workflows = state.workflows.filter((wf) => wf.id !== id);
      return;
    }

    if (cmd === 'get_auth_status') return state.auth;

    if (cmd === 'authenticate_github') {
      state.auth = { authenticated: true, username: 'e2e-user' };
      return { success: true, username: 'e2e-user' };
    }

    if (cmd === 'execute_workflow') {
      const workflowId = (args.workflowId as string | undefined) ?? 'wf-created';
      const execution = {
        id: `exec-${Date.now()}`,
        workflowId,
        status: 'RUNNING',
        triggerType: (args.triggerType as string | undefined) ?? 'manual',
        startedAt: new Date().toISOString(),
      };
      state.executions = [execution, ...state.executions];
      return execution;
    }

    if (cmd === 'list_executions') return state.executions;

    if (cmd === 'get_execution_logs') {
      const executionId = args.executionId as string;
      return state.logsByExecutionId[executionId] ?? [];
    }

    if (cmd === 'cancel_execution') return null;

    throw new Error(`Unhandled mocked command: ${cmd}`);
  }, { shouldMockEvents: true });
}
