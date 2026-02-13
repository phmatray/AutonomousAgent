import { mockIPC } from '@tauri-apps/api/mocks';

type RecordAny = Record<string, unknown>;

export interface E2EState {
  workflows: RecordAny[];
  auth: RecordAny;
  executions: RecordAny[];
  logsByExecutionId: Record<string, RecordAny[]>;
  credentialAuditEvents: RecordAny[];
  invokeLog: Array<{ cmd: string; args: RecordAny }>;
  commandFailures: Record<string, string>;
  commandDelaysMs: Record<string, number>;
}

function createState(): E2EState {
  return {
    workflows: [],
    auth: { authenticated: false },
    executions: [],
    logsByExecutionId: {},
    credentialAuditEvents: [],
    invokeLog: [],
    commandFailures: {},
    commandDelaysMs: {},
  };
}

function parseJsonQueryParam<T>(name: string): T | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(name);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function installWebDriverTauriMock() {
  if (window.__E2E_STATE__) {
    return;
  }

  const state = createState();
  const preloadedState = parseJsonQueryParam<Partial<E2EState>>('e2e_state');
  const preloadedFailures = parseJsonQueryParam<Record<string, string>>('e2e_fail');
  const preloadedDelays = parseJsonQueryParam<Record<string, number>>('e2e_delay');

  if (preloadedState) {
    Object.assign(state, preloadedState);
  }
  if (preloadedFailures) {
    state.commandFailures = { ...state.commandFailures, ...preloadedFailures };
  }
  if (preloadedDelays) {
    state.commandDelaysMs = { ...state.commandDelaysMs, ...preloadedDelays };
  }

  window.__E2E_STATE__ = state;

  mockIPC(async (cmd, payload = {}) => {
    const args = (payload ?? {}) as RecordAny;
    state.invokeLog.push({ cmd, args });

    const delayMs = state.commandDelaysMs[cmd];
    if (typeof delayMs === 'number' && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const failureMessage = state.commandFailures[cmd];
    if (failureMessage) {
      throw new Error(failureMessage);
    }

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
    if (cmd === 'get_saved_github_token') {
      return {
        token: state.auth?.authenticated ? 'ghp_e2e_savedtoken' : null,
      };
    }

    if (cmd === 'authenticate_github') {
      state.auth = { authenticated: true, username: 'e2e-user' };
      state.credentialAuditEvents.unshift({
        id: `audit-${Date.now()}`,
        provider: 'github',
        action: 'save_token',
        success: true,
        timestamp: new Date().toISOString(),
      });
      return { success: true, username: 'e2e-user' };
    }

    if (cmd === 'delete_github_token') {
      state.auth = { authenticated: false };
      state.credentialAuditEvents.unshift({
        id: `audit-${Date.now()}`,
        provider: 'github',
        action: 'delete_token',
        success: true,
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    if (cmd === 'verify_github_token') {
      const token = String(args.token ?? '');
      if (!token.trim()) {
        throw new Error('GitHub token cannot be empty');
      }
      state.auth = { authenticated: true, username: 'e2e-user' };
      state.credentialAuditEvents.unshift({
        id: `audit-${Date.now()}`,
        provider: 'github',
        action: 'verify_reveal',
        success: true,
        timestamp: new Date().toISOString(),
      });
      return { valid: true, username: 'e2e-user' };
    }

    if (cmd === 'list_credential_audit_events') {
      const limitRaw = Number(args.limit ?? 20);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
      return state.credentialAuditEvents.slice(0, limit);
    }

    if (cmd === 'list_github_credentials') {
      if (!state.auth?.authenticated) return [];
      return [{
        id: 'e2e-user',
        username: 'e2e-user',
        label: 'e2e-user',
        is_default: true,
      }];
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

    if (cmd === 'preflight_workflow') {
      return {
        valid: true,
        issues: [],
        generatedAt: new Date().toISOString(),
      };
    }

    if (cmd === 'list_executions') return state.executions;

    if (cmd === 'get_execution_logs') {
      const executionId = args.executionId as string;
      return state.logsByExecutionId[executionId] ?? [];
    }

    if (cmd === 'cancel_workflow_execution') return null;

    throw new Error(`Unhandled mocked command: ${cmd}`);
  }, { shouldMockEvents: true });
}
