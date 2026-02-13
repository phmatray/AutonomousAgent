import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardPage } from '../DashboardPage';
import { RouterProvider } from '@/lib/router';
import { WorkflowCatalogProvider } from '@/app/state/workflow-catalog-machine';
import { mockInvoke } from '@/test/mocks/tauri';
import type { Workflow } from '@/types/workflow';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

const mockWorkflow1: Workflow = {
  id: 'wf-1',
  name: 'Auto Developer',
  description: 'Automatically resolves GitHub issues',
  nodes: [
    { id: 'n1', type: 'trigger' },
    { id: 'n2', type: 'github.sync' },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockWorkflow2: Workflow = {
  id: 'wf-2',
  name: 'Code Review',
  nodes: [{ id: 'n1', type: 'trigger' }],
  edges: [],
  version: 2,
  createdAt: '2026-01-15T00:00:00Z',
  updatedAt: '2026-01-15T00:00:00Z',
};

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider>
        <WorkflowCatalogProvider>
          {ui}
        </WorkflowCatalogProvider>
      </RouterProvider>
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    window.location.hash = '';
  });

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------

  it('shows loading spinner while fetching workflows', () => {
    // Never resolve the invoke to keep loading state
    mockInvoke.mockReturnValue(new Promise(() => {}));
    renderWithQueryClient(<DashboardPage />);
    expect(screen.getByRole('status', { name: 'Loading workflows' })).toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // Empty state
  // ------------------------------------------------------------------

  it('shows empty state when there are no workflows', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    renderWithQueryClient(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('No workflows yet')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Create your first autonomous workflow/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Workflow' })).toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // Error state
  // ------------------------------------------------------------------

  it('shows error state when fetching fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('Connection refused'));
    renderWithQueryClient(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Could not load workflows')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Backend services may not be running/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Editor' })).toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // Workflow list rendering
  // ------------------------------------------------------------------

  it('renders workflow cards when data loads', async () => {
    mockInvoke.mockResolvedValueOnce([mockWorkflow1, mockWorkflow2]);
    renderWithQueryClient(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Auto Developer')).toBeInTheDocument();
    });
    expect(screen.getByText('Code Review')).toBeInTheDocument();
  });

  it('renders workflow descriptions', async () => {
    mockInvoke.mockResolvedValueOnce([mockWorkflow1]);
    renderWithQueryClient(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Automatically resolves GitHub issues')).toBeInTheDocument();
    });
  });

  it('renders node count for each workflow', async () => {
    mockInvoke.mockResolvedValueOnce([mockWorkflow1, mockWorkflow2]);
    renderWithQueryClient(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('2 nodes')).toBeInTheDocument();
    });
    expect(screen.getByText('1 nodes')).toBeInTheDocument();
  });

  it('renders version for each workflow', async () => {
    mockInvoke.mockResolvedValueOnce([mockWorkflow1, mockWorkflow2]);
    renderWithQueryClient(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('v1')).toBeInTheDocument();
    });
    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  it('renders a workflow list with correct aria attributes', async () => {
    mockInvoke.mockResolvedValueOnce([mockWorkflow1]);
    renderWithQueryClient(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Workflow list' })).toBeInTheDocument();
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('renders workflow card with aria-label', async () => {
    mockInvoke.mockResolvedValueOnce([mockWorkflow1]);
    renderWithQueryClient(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole('article', { name: 'Workflow: Auto Developer' })).toBeInTheDocument();
    });
  });

  // ------------------------------------------------------------------
  // Navigation / interactions
  // ------------------------------------------------------------------

  it('has a "New Workflow" button in the header', async () => {
    mockInvoke.mockResolvedValueOnce([mockWorkflow1]);
    renderWithQueryClient(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Auto Developer')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'New Workflow' })).toBeInTheDocument();
  });

  it('renders page title and subtitle', async () => {
    mockInvoke.mockResolvedValueOnce([]);
    renderWithQueryClient(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Workflows')).toBeInTheDocument();
    });
    expect(screen.getByText('Manage your autonomous development workflows')).toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // Delete flow
  // ------------------------------------------------------------------

  it('shows delete button on workflow cards', async () => {
    mockInvoke.mockResolvedValueOnce([mockWorkflow1]);
    renderWithQueryClient(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Auto Developer')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Delete workflow' })).toBeInTheDocument();
  });

  it('opens confirmation dialog when delete button is clicked', async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValueOnce([mockWorkflow1]);
    renderWithQueryClient(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Auto Developer')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Delete workflow' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete Workflow')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete "Auto Developer"/)).toBeInTheDocument();
  });

  it('closes confirmation dialog on cancel', async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValueOnce([mockWorkflow1]);
    renderWithQueryClient(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Auto Developer')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Delete workflow' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
