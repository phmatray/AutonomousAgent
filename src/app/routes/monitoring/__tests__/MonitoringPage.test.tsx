import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonitoringPage } from '@/app/routes/monitoring/MonitoringPage';
import { RouterProvider } from '@/lib/router';
import { mockInvoke } from '@/test/mocks/tauri';
import type { ExecutionLog, WorkflowExecution } from '@/types/workflow';

const mockExecution: WorkflowExecution = {
  id: 'abcd1234-efgh-5678',
  workflowId: 'wf-1',
  status: 'FAILED',
  triggerType: 'manual',
  startedAt: '2026-02-13T10:00:00.000Z',
  completedAt: '2026-02-13T10:01:00.000Z',
  context: [
    {
      node_id: 'github.sync',
      status: 'COMPLETED',
      started_at: '2026-02-13T10:00:10.000Z',
      completed_at: '2026-02-13T10:00:30.000Z',
      duration_ms: 20000,
      retry_count: 0,
      output: {
        issues: [{ number: 42, title: 'Improve diagnostics UX' }],
      },
    },
    {
      node_id: 'claude.apply',
      status: 'FAILED',
      started_at: '2026-02-13T10:00:31.000Z',
      completed_at: '2026-02-13T10:01:00.000Z',
      duration_ms: 29000,
      retry_count: 1,
      error: 'Patch failed',
    },
  ],
};

const mockLogs: ExecutionLog[] = [
  {
    id: 1,
    executionId: mockExecution.id,
    level: 'INFO',
    message: 'Execution started',
    timestamp: '2026-02-13T10:00:00.000Z',
  },
];

function installLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  });
}

function renderMonitoringPage() {
  window.location.hash = '#/monitoring';
  return render(
    <RouterProvider>
      <MonitoringPage />
    </RouterProvider>,
  );
}

describe('MonitoringPage advanced diagnostics', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    installLocalStorageMock();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    mockInvoke.mockImplementation((command: string) => {
      if (command === 'list_executions') {
        return Promise.resolve([mockExecution]);
      }
      if (command === 'get_execution_logs') {
        return Promise.resolve(mockLogs);
      }
      if (command === 'copy_debug_bundle') {
        return Promise.resolve({ bundleJson: '{"ok":true}' });
      }
      if (command === 'cancel_workflow_execution') {
        return Promise.resolve(undefined);
      }
      throw new Error(`Unhandled command: ${command}`);
    });
  });

  it('keeps monitoring default view simple and hides verbose diagnostics', async () => {
    const user = userEvent.setup();
    renderMonitoringPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Execution abcd1234, status: FAILED/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Execution abcd1234, status: FAILED/ }));

    await waitFor(() => {
      expect(screen.getByText('Execution Timeline')).toBeInTheDocument();
    });
    expect(screen.getByText('Execution Logs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show advanced diagnostics' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Run Inspector')).not.toBeInTheDocument();
    expect(screen.queryByText('Node Outputs')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Export Mode')).not.toBeInTheDocument();
  });

  it('reveals advanced diagnostics on demand and preserves debug bundle export', async () => {
    const user = userEvent.setup();
    renderMonitoringPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Execution abcd1234, status: FAILED/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Execution abcd1234, status: FAILED/ }));
    await user.click(screen.getByRole('button', { name: 'Show advanced diagnostics' }));

    expect(screen.getByRole('button', { name: 'Hide advanced diagnostics' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Run Inspector')).toBeInTheDocument();
    expect(screen.getByText('Node Outputs')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Export Mode'), 'credentialFiltered');
    await user.selectOptions(screen.getByLabelText('Provider'), 'github');
    await user.selectOptions(screen.getByLabelText('Action'), 'save_token');
    await user.selectOptions(screen.getByLabelText('Result'), 'failure');
    await user.type(screen.getByLabelText('From date'), '2026-01-01');
    await user.type(screen.getByLabelText('To date'), '2026-01-31');
    await user.clear(screen.getByLabelText('Max events'));
    await user.type(screen.getByLabelText('Max events'), '25');

    await user.click(screen.getByRole('button', { name: 'Copy debug bundle' }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('copy_debug_bundle', {
        executionId: mockExecution.id,
        credentialAuditFilter: expect.objectContaining({
          provider: 'github',
          action: 'save_token',
          result: 'failure',
          limit: 25,
          fromTimestamp: expect.any(String),
          toTimestamp: expect.any(String),
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Debug bundle copied to clipboard.')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Hide advanced diagnostics' }));
    expect(screen.queryByText('Run Inspector')).not.toBeInTheDocument();
  });
});
