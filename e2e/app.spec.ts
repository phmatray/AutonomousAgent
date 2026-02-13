import { test, expect } from '@playwright/test';

const mockWorkflow = {
  id: 'wf-123',
  name: 'Sample Workflow',
  description: 'End-to-end test workflow',
  nodes: [],
  edges: [],
  version: 1,
  createdAt: new Date('2026-02-13T10:00:00Z').toISOString(),
  updatedAt: new Date('2026-02-13T10:00:00Z').toISOString(),
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type RecordAny = Record<string, unknown>;

    const state = {
      workflows: [] as RecordAny[],
      auth: { authenticated: false } as RecordAny,
      executions: [] as RecordAny[],
      logsByExecutionId: {} as Record<string, RecordAny[]>,
      invokeLog: [] as Array<{ cmd: string; args: RecordAny }>,
      listeners: new Map<number, (payload: unknown) => void>(),
      nextCallbackId: 1,
    };

    (window as Window & { __E2E_STATE__?: typeof state }).__E2E_STATE__ = state;

    (window as Window & { __TAURI_EVENT_PLUGIN_INTERNALS__?: { unregisterListener: () => void } }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };

    (window as Window & {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string, args?: RecordAny) => Promise<unknown>;
        transformCallback: (callback: (payload: unknown) => void) => number;
        unregisterCallback: (id: number) => void;
        convertFileSrc: (path: string) => string;
      };
    }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: RecordAny = {}) => {
        state.invokeLog.push({ cmd, args });

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
        if (cmd === 'list_executions') return state.executions;
        if (cmd === 'get_execution_logs') {
          const executionId = args.executionId as string;
          return state.logsByExecutionId[executionId] ?? [];
        }
        if (cmd === 'plugin:event|listen') return 1;
        if (cmd === 'plugin:event|unlisten') return null;
        if (cmd === 'cancel_execution') return null;
        if (cmd === 'is_initialized') {
          return {
            database: true,
            github_auth_attempted: true,
          };
        }

        throw new Error(`Unhandled mocked command: ${cmd}`);
      },
      transformCallback: (callback: (payload: unknown) => void) => {
        const id = state.nextCallbackId++;
        state.listeners.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number) => {
        state.listeners.delete(id);
      },
      convertFileSrc: (path: string) => path,
    };
  });
});

test('shows dashboard empty state and navigates to editor', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
  await expect(page.getByText('No workflows yet')).toBeVisible();

  await page.getByRole('button', { name: 'Create Workflow' }).click();

  await expect(page).toHaveURL(/#\/editor/);
  await expect(page.getByLabel('Workflow name')).toHaveValue('Untitled Workflow');
});

test('saves a workflow from editor and calls create_workflow', async ({ page }) => {
  await page.goto('/#/editor');

  const workflowName = page.getByLabel('Workflow name');
  await workflowName.fill('E2E Saved Workflow');
  await expect(page.getByText('Unsaved')).toBeVisible();

  await page.getByRole('button', { name: 'Save workflow (Cmd+S)' }).click();

  await expect(page.getByText('Unsaved')).toBeHidden();

  const createCalls = await page.evaluate(() => {
    const state = (window as Window & {
      __E2E_STATE__?: {
        invokeLog: Array<{ cmd: string; args: { workflow?: { name?: string } } }>;
      };
    }).__E2E_STATE__;

    return (state?.invokeLog ?? []).filter((entry) => entry.cmd === 'create_workflow');
  });

  expect(createCalls).toHaveLength(1);
  expect(createCalls[0]?.args?.workflow?.name).toBe('E2E Saved Workflow');
});

test('authenticates token in settings and updates status', async ({ page }) => {
  await page.goto('/#/settings');

  await expect(page.getByText('Not authenticated')).toBeVisible();

  await page.getByLabel('Personal Access Token').fill('ghp_example_token');
  await page.getByRole('button', { name: 'Save Token' }).click();

  await expect(page.getByText('Token saved successfully')).toBeVisible();
  await expect(page.getByText('Connected as e2e-user')).toBeVisible();
});

// Ensure route buttons continue to switch pages correctly across releases.
test('navigates through top-level routes', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('menuitem', { name: 'Monitoring' }).click();
  await expect(page).toHaveURL(/#\/monitoring/);
  await expect(page.getByRole('heading', { name: 'Executions' })).toBeVisible();

  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/#\/settings/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.getByRole('menuitem', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL(/#\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
});

test('clears stale editor state when workflow id does not exist', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((workflow) => {
    const state = (window as Window & { __E2E_STATE__?: { workflows: unknown[] } }).__E2E_STATE__;
    if (state) state.workflows = [workflow];
  }, mockWorkflow);

  await page.goto('/#/editor?id=wf-123');
  await expect(page.getByLabel('Workflow name')).toHaveValue('Sample Workflow');

  await page.goto('/#/editor?id=wf-missing');
  await expect(page.getByLabel('Workflow name')).toHaveValue('Untitled Workflow');
});

test('updates editor URL with workflow id after first save', async ({ page }) => {
  await page.goto('/#/editor');

  await page.getByLabel('Workflow name').fill('URL Sync Workflow');
  await page.getByRole('button', { name: 'Save workflow (Cmd+S)' }).click();

  await expect(page).toHaveURL(/#\/editor\?id=wf-created/);
});
