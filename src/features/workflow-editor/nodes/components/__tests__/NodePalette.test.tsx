import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { NodePalette } from '../NodePalette';
import type { NodeType } from '@/types/workflow';

describe('NodePalette', () => {
  let onDragStart: ReturnType<typeof vi.fn<(type: NodeType, x: number, y: number) => void>>;

  beforeEach(() => {
    onDragStart = vi.fn<(type: NodeType, x: number, y: number) => void>();
  });

  it('renders the "Nodes" heading', () => {
    render(<NodePalette onDragStart={onDragStart} />);
    expect(screen.getByText('Nodes')).toBeInTheDocument();
  });

  it('renders all four category headers', () => {
    render(<NodePalette onDragStart={onDragStart} />);
    expect(screen.getByText('Control Flow')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Git')).toBeInTheDocument();
    expect(screen.getByText('Claude AI')).toBeInTheDocument();
  });

  it('renders all 18 palette items', () => {
    render(<NodePalette onDragStart={onDragStart} />);
    const expectedLabels = [
      'Trigger', 'Cron Trigger', 'Condition', 'Loop', 'Delay',
      'Sync Repository', 'Read Issues', 'Read Pull Request', 'Sync Issues to Backlog',
      'Register PR in Backlog', 'Create PR', 'Respond to PR',
      'Git Worktree', 'Git Branch', 'Git Commit',
      'Claude Analyze', 'Claude Plan', 'Claude Apply',
    ];
    for (const label of expectedLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders node type identifiers', () => {
    render(<NodePalette onDragStart={onDragStart} />);
    expect(screen.getByText('trigger')).toBeInTheDocument();
    expect(screen.getByText('github.sync')).toBeInTheDocument();
    expect(screen.getByText('git.worktree')).toBeInTheDocument();
    expect(screen.getByText('claude.apply')).toBeInTheDocument();
  });

  it('has accessible aria-label on the aside', () => {
    render(<NodePalette onDragStart={onDragStart} />);
    expect(screen.getByRole('complementary', { name: 'Node palette' })).toBeInTheDocument();
  });

  it('renders accessible category lists', () => {
    render(<NodePalette onDragStart={onDragStart} />);
    expect(screen.getByRole('list', { name: 'Control Flow nodes' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'GitHub nodes' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Git nodes' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Claude AI nodes' })).toBeInTheDocument();
  });

  it('renders draggable buttons with aria-labels', () => {
    render(<NodePalette onDragStart={onDragStart} />);
    expect(screen.getByRole('button', { name: 'Drag to add Trigger node' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drag to add Loop node' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drag to add Create PR node' })).toBeInTheDocument();
  });

  it('calls onDragStart with correct type on mousedown', async () => {
    render(<NodePalette onDragStart={onDragStart} />);
    const triggerButton = screen.getByRole('button', { name: 'Drag to add Trigger node' });

    // Fire mousedown event
    const mouseDownEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 200,
    });
    triggerButton.dispatchEvent(mouseDownEvent);

    expect(onDragStart).toHaveBeenCalledWith('trigger', 100, 200);
  });

  it('calls onDragStart with github.sync type', () => {
    render(<NodePalette onDragStart={onDragStart} />);
    const syncButton = screen.getByRole('button', { name: 'Drag to add Sync Repository node' });

    const mouseDownEvent = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 75,
    });
    syncButton.dispatchEvent(mouseDownEvent);

    expect(onDragStart).toHaveBeenCalledWith('github.sync', 50, 75);
  });

  it('groups control flow nodes together', () => {
    render(<NodePalette onDragStart={onDragStart} />);
    const controlList = screen.getByRole('list', { name: 'Control Flow nodes' });
    const items = within(controlList).getAllByRole('listitem');
    expect(items).toHaveLength(5);
  });

  it('groups github nodes together', () => {
    render(<NodePalette onDragStart={onDragStart} />);
    const githubList = screen.getByRole('list', { name: 'GitHub nodes' });
    const items = within(githubList).getAllByRole('listitem');
    expect(items).toHaveLength(7);
  });

  it('groups git nodes together', () => {
    render(<NodePalette onDragStart={onDragStart} />);
    const gitList = screen.getByRole('list', { name: 'Git nodes' });
    const items = within(gitList).getAllByRole('listitem');
    expect(items).toHaveLength(3);
  });

  it('groups claude nodes together', () => {
    render(<NodePalette onDragStart={onDragStart} />);
    const claudeList = screen.getByRole('list', { name: 'Claude AI nodes' });
    const items = within(claudeList).getAllByRole('listitem');
    expect(items).toHaveLength(3);
  });
});
