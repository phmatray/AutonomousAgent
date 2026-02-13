import { describe, it, expect, beforeEach } from 'vitest';
import { mockInvoke } from '@/test/mocks/tauri';
import {
  listBacklogItems,
  syncGithubIssuesToBacklog,
  linkBacklogToWorkflow,
  createLinkedWorkflowFromBacklog,
  deleteBacklogItem,
} from '@/lib/api/backlog';
import type { BacklogItem } from '@/types/workflow';

const mockBacklogItem: BacklogItem = {
  id: 'bl-1',
  owner: 'testuser',
  repo: 'my-repo',
  issue_number: 42,
  title: 'Fix workflow engine bug',
  body: 'There is a bug when executing parallel nodes.',
  state: 'open',
  labels: ['bug'],
  assignees: ['testuser'],
  html_url: 'https://github.com/testuser/my-repo/issues/42',
  synced_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('backlog API', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe('listBacklogItems', () => {
    it('calls invoke with default null filters when no filters provided', async () => {
      mockInvoke.mockResolvedValueOnce([mockBacklogItem]);

      const result = await listBacklogItems();

      expect(mockInvoke).toHaveBeenCalledWith('list_backlog_items', {
        owner: null,
        repo: null,
        stateFilter: null,
        label: null,
        search: null,
      });
      expect(result).toEqual([mockBacklogItem]);
    });

    it('calls invoke with provided filters', async () => {
      mockInvoke.mockResolvedValueOnce([mockBacklogItem]);

      const result = await listBacklogItems({
        owner: 'testuser',
        repo: 'my-repo',
        stateFilter: 'open',
        label: 'bug',
        search: 'workflow',
      });

      expect(mockInvoke).toHaveBeenCalledWith('list_backlog_items', {
        owner: 'testuser',
        repo: 'my-repo',
        stateFilter: 'open',
        label: 'bug',
        search: 'workflow',
      });
      expect(result).toEqual([mockBacklogItem]);
    });

    it('replaces undefined filter values with null', async () => {
      mockInvoke.mockResolvedValueOnce([]);

      await listBacklogItems({ owner: 'testuser' });

      expect(mockInvoke).toHaveBeenCalledWith('list_backlog_items', {
        owner: 'testuser',
        repo: null,
        stateFilter: null,
        label: null,
        search: null,
      });
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Database error'));

      await expect(listBacklogItems()).rejects.toThrow('Database error');
    });
  });

  describe('syncGithubIssuesToBacklog', () => {
    it('calls invoke with owner and repo', async () => {
      mockInvoke.mockResolvedValueOnce([mockBacklogItem]);

      const result = await syncGithubIssuesToBacklog('testuser', 'my-repo');

      expect(mockInvoke).toHaveBeenCalledWith('sync_github_issues_to_backlog', {
        owner: 'testuser',
        repo: 'my-repo',
      });
      expect(result).toEqual([mockBacklogItem]);
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Not authenticated'));

      await expect(syncGithubIssuesToBacklog('testuser', 'my-repo')).rejects.toThrow(
        'Not authenticated',
      );
    });
  });

  describe('linkBacklogToWorkflow', () => {
    it('calls invoke with backlogItemId and workflowId', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      await linkBacklogToWorkflow('bl-1', 'wf-1');

      expect(mockInvoke).toHaveBeenCalledWith('link_backlog_to_workflow', {
        backlogItemId: 'bl-1',
        workflowId: 'wf-1',
      });
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Backlog item not found'));

      await expect(linkBacklogToWorkflow('bl-nonexistent', 'wf-1')).rejects.toThrow(
        'Backlog item not found',
      );
    });
  });

  describe('createLinkedWorkflowFromBacklog', () => {
    it('calls invoke with backlogItemId and returns payload', async () => {
      const resultPayload = {
        workflow: {
          id: 'wf-123',
          name: 'Issue #42 Fix workflow engine bug',
          nodes: [],
          edges: [],
          version: 1,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        backlogItem: {
          ...mockBacklogItem,
          linked_workflow_id: 'wf-123',
          resolution_guidelines_md: '# Resolution Guidelines\n\n## Problem Summary',
        },
        usedFallbackGuidelines: false,
      };
      mockInvoke.mockResolvedValueOnce(resultPayload);

      const result = await createLinkedWorkflowFromBacklog('bl-1');

      expect(mockInvoke).toHaveBeenCalledWith('create_linked_workflow_from_backlog', {
        backlogItemId: 'bl-1',
      });
      expect(result).toEqual(resultPayload);
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Failed to generate guidelines'));

      await expect(createLinkedWorkflowFromBacklog('bl-1')).rejects.toThrow(
        'Failed to generate guidelines',
      );
    });
  });

  describe('deleteBacklogItem', () => {
    it('calls invoke with correct id', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      await deleteBacklogItem('bl-1');

      expect(mockInvoke).toHaveBeenCalledWith('delete_backlog_item', { id: 'bl-1' });
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Item not found'));

      await expect(deleteBacklogItem('bl-nonexistent')).rejects.toThrow('Item not found');
    });
  });
});
