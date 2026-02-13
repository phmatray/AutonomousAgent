import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeType } from '@/types/workflow';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeConfigPanel } from '../NodeConfigPanel';
import { useEditorStore } from '@/features/workflow-editor/stores/editor-store';
import { listGitHubCredentials } from '@/lib/api/github';

vi.mock('@/lib/api/github', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/github')>('@/lib/api/github');
  return {
    ...actual,
    listGitHubCredentials: vi.fn(),
  };
});

// Helper to set up the editor store with a selected node
function setupStoreWithNode(
  nodeType: NodeType,
  config: Record<string, unknown> = {},
  label = 'Test Node',
) {
  const nodeId = 'test-node-1';
  act(() => {
    useEditorStore.setState({
      selectedNodeId: nodeId,
      nodes: [
        {
          id: nodeId,
          type: 'workflowNode',
          position: { x: 0, y: 0 },
          data: {
            label,
            nodeType,
            config,
          },
        },
      ],
      edges: [],
    });
  });
  return nodeId;
}

describe('NodeConfigPanel', () => {
  beforeEach(() => {
    vi.mocked(listGitHubCredentials).mockResolvedValue([]);
    act(() => {
      useEditorStore.setState({
        selectedNodeId: null,
        nodes: [],
        edges: [],
        pendingDeleteNodeId: null,
      });
    });
  });

  // ------------------------------------------------------------------
  // Rendering and visibility
  // ------------------------------------------------------------------

  it('returns null when no node is selected', () => {
    const { container } = render(<NodeConfigPanel />);
    expect(container.innerHTML).toBe('');
  });

  it('renders when a node is selected', () => {
    setupStoreWithNode('trigger', { trigger_type: 'manual' }, 'My Trigger');
    render(<NodeConfigPanel />);
    expect(screen.getByText('My Trigger')).toBeInTheDocument();
  });

  it('renders the node type identifier', async () => {
    setupStoreWithNode('github.sync', {}, 'Sync Repository');
    render(<NodeConfigPanel />);
    await waitFor(() => expect(listGitHubCredentials).toHaveBeenCalled());
    expect(screen.getByText('github.sync')).toBeInTheDocument();
  });

  it('renders the node id', () => {
    const nodeId = setupStoreWithNode('trigger');
    render(<NodeConfigPanel />);
    expect(screen.getByText(nodeId)).toBeInTheDocument();
  });

  it('has accessible aria-label on the aside', () => {
    setupStoreWithNode('trigger');
    render(<NodeConfigPanel />);
    expect(screen.getByRole('complementary', { name: 'Node configuration' })).toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // Form fields rendering
  // ------------------------------------------------------------------

  it('renders trigger node config fields', () => {
    setupStoreWithNode('trigger', { trigger_type: 'manual' });
    render(<NodeConfigPanel />);
    expect(screen.getByText('Trigger Type')).toBeInTheDocument();
  });

  it('renders github.sync config fields', async () => {
    setupStoreWithNode('github.sync', {});
    render(<NodeConfigPanel />);
    await waitFor(() => expect(listGitHubCredentials).toHaveBeenCalled());
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Repository')).toBeInTheDocument();
    expect(screen.getByText('Local Path')).toBeInTheDocument();
  });

  it('renders delay node config fields', () => {
    setupStoreWithNode('delay', { seconds: 5 });
    render(<NodeConfigPanel />);
    expect(screen.getByText('Seconds')).toBeInTheDocument();
  });

  it('renders condition node branch help', () => {
    setupStoreWithNode('condition', {});
    render(<NodeConfigPanel />);
    expect(screen.getByText('Branch Outputs')).toBeInTheDocument();
    expect(screen.getByText(/true branch/)).toBeInTheDocument();
    expect(screen.getByText(/false branch/)).toBeInTheDocument();
  });

  it('does not render condition help for non-condition nodes', () => {
    setupStoreWithNode('trigger', {});
    render(<NodeConfigPanel />);
    expect(screen.queryByText('Branch Outputs')).not.toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------

  it('shows validation errors for missing required fields', async () => {
    setupStoreWithNode('github.sync', {});
    render(<NodeConfigPanel />);
    await waitFor(() => expect(listGitHubCredentials).toHaveBeenCalled());
    // github.sync requires owner, repo, path
    expect(screen.getByText(/field.*need attention/i)).toBeInTheDocument();
    expect(screen.getByText('Owner is required')).toBeInTheDocument();
    expect(screen.getByText('Repository is required')).toBeInTheDocument();
    expect(screen.getByText('Local Path is required')).toBeInTheDocument();
  });

  it('shows valid state when all required fields are filled', async () => {
    setupStoreWithNode('github.sync', {
      owner: 'octocat',
      repo: 'my-repo',
      path: '/tmp/repos',
    });
    render(<NodeConfigPanel />);
    await waitFor(() => expect(listGitHubCredentials).toHaveBeenCalled());
    expect(screen.getByText('Configuration valid')).toBeInTheDocument();
  });

  it('shows validation errors for condition node missing required condition', () => {
    setupStoreWithNode('condition', {});
    render(<NodeConfigPanel />);
    expect(screen.getByText('Condition is required')).toBeInTheDocument();
  });

  it('shows valid for trigger node (no required fields)', () => {
    setupStoreWithNode('trigger', { trigger_type: 'manual' });
    render(<NodeConfigPanel />);
    expect(screen.getByText('Configuration valid')).toBeInTheDocument();
  });

  // ------------------------------------------------------------------
  // Delete button
  // ------------------------------------------------------------------

  it('renders a delete button', () => {
    setupStoreWithNode('trigger', {}, 'My Trigger');
    render(<NodeConfigPanel />);
    expect(
      screen.getByRole('button', { name: 'Delete My Trigger node' }),
    ).toBeInTheDocument();
  });

  it('calls requestDeleteNode when delete button is clicked', async () => {
    const user = userEvent.setup();
    setupStoreWithNode('trigger', {}, 'My Trigger');
    const requestDeleteNode = vi.fn();
    act(() => {
      useEditorStore.setState({ requestDeleteNode });
    });

    render(<NodeConfigPanel />);
    await user.click(screen.getByRole('button', { name: 'Delete My Trigger node' }));

    expect(requestDeleteNode).toHaveBeenCalledWith('test-node-1');
  });

  // ------------------------------------------------------------------
  // Raw JSON toggle
  // ------------------------------------------------------------------

  it('renders "Show Raw JSON" toggle button', () => {
    setupStoreWithNode('trigger', {});
    render(<NodeConfigPanel />);
    expect(screen.getByText('Show Raw JSON')).toBeInTheDocument();
  });

  it('toggles to raw JSON editor when clicked', async () => {
    const user = userEvent.setup();
    setupStoreWithNode('trigger', { trigger_type: 'manual' });
    render(<NodeConfigPanel />);

    await user.click(screen.getByText('Show Raw JSON'));

    expect(screen.getByLabelText('Raw JSON configuration')).toBeInTheDocument();
    expect(screen.getByText('Show Form')).toBeInTheDocument();
  });

  it('toggles back to form view', async () => {
    const user = userEvent.setup();
    setupStoreWithNode('trigger', { trigger_type: 'manual' });
    render(<NodeConfigPanel />);

    await user.click(screen.getByText('Show Raw JSON'));
    expect(screen.getByText('Show Form')).toBeInTheDocument();

    await user.click(screen.getByText('Show Form'));
    expect(screen.getByText('Show Raw JSON')).toBeInTheDocument();
    expect(screen.getByText('Trigger Type')).toBeInTheDocument();
  });

  it('shows parse error for invalid JSON', async () => {
    const user = userEvent.setup();
    setupStoreWithNode('trigger', { trigger_type: 'manual' });
    render(<NodeConfigPanel />);

    await user.click(screen.getByText('Show Raw JSON'));
    const textarea = screen.getByLabelText('Raw JSON configuration') as HTMLTextAreaElement;

    // Use fireEvent.change instead of userEvent.type to avoid brace parsing issues
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(textarea, { target: { value: '{invalid json' } });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
