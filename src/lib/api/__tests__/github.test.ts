import { describe, it, expect, beforeEach } from 'vitest';
import { mockInvoke } from '@/test/mocks/tauri';
import {
  authenticateGitHub,
  listRepositories,
  listIssues,
  createPullRequest,
  deleteGitHubToken,
  getAuthStatus,
  getSavedGitHubToken,
  listCredentialAuditEvents,
  verifyGitHubToken,
} from '@/lib/api/github';
import type { AuthResult, GitHubRepo, GitHubIssue, GitHubPR } from '@/lib/api/github';

const mockAuthResult: AuthResult = {
  success: true,
  username: 'testuser',
  avatar_url: 'https://avatars.githubusercontent.com/u/12345',
};

const mockRepo: GitHubRepo = {
  id: 1,
  name: 'my-repo',
  full_name: 'testuser/my-repo',
  owner: 'testuser',
  description: 'A test repository',
  default_branch: 'main',
  private: false,
};

const mockIssue: GitHubIssue = {
  number: 42,
  title: 'Fix bug in workflow engine',
  body: 'There is a bug when executing parallel nodes.',
  state: 'open',
  labels: ['bug', 'priority:high'],
  assignees: ['testuser'],
};

const mockPR: GitHubPR = {
  number: 10,
  html_url: 'https://github.com/testuser/my-repo/pull/10',
  title: 'Fix parallel node execution',
};

describe('github API', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe('authenticateGitHub', () => {
    it('calls invoke with token', async () => {
      mockInvoke.mockResolvedValueOnce(mockAuthResult);

      const result = await authenticateGitHub('ghp_testtoken123');

      expect(mockInvoke).toHaveBeenCalledWith('authenticate_github', {
        token: 'ghp_testtoken123',
      });
      expect(result).toEqual(mockAuthResult);
    });

    it('handles failed authentication', async () => {
      const failResult: AuthResult = { success: false };
      mockInvoke.mockResolvedValueOnce(failResult);

      const result = await authenticateGitHub('invalid-token');

      expect(result.success).toBe(false);
      expect(result.username).toBeUndefined();
    });

    it('propagates network errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Network error'));

      await expect(authenticateGitHub('ghp_token')).rejects.toThrow('Network error');
    });
  });

  describe('listRepositories', () => {
    it('calls invoke with correct command', async () => {
      mockInvoke.mockResolvedValueOnce([mockRepo]);

      const result = await listRepositories();

      expect(mockInvoke).toHaveBeenCalledWith('list_repositories');
      expect(result).toEqual([mockRepo]);
    });

    it('returns empty array when no repos', async () => {
      mockInvoke.mockResolvedValueOnce([]);

      const result = await listRepositories();

      expect(result).toEqual([]);
    });

    it('propagates auth errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Not authenticated'));

      await expect(listRepositories()).rejects.toThrow('Not authenticated');
    });
  });

  describe('listIssues', () => {
    it('calls invoke with owner and repo', async () => {
      mockInvoke.mockResolvedValueOnce([mockIssue]);

      const result = await listIssues('testuser', 'my-repo');

      expect(mockInvoke).toHaveBeenCalledWith('list_issues', {
        owner: 'testuser',
        repo: 'my-repo',
      });
      expect(result).toEqual([mockIssue]);
    });

    it('returns empty array when no issues', async () => {
      mockInvoke.mockResolvedValueOnce([]);

      const result = await listIssues('testuser', 'my-repo');

      expect(result).toEqual([]);
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Repository not found'));

      await expect(listIssues('testuser', 'nonexistent')).rejects.toThrow('Repository not found');
    });
  });

  describe('createPullRequest', () => {
    it('calls invoke with all PR parameters', async () => {
      mockInvoke.mockResolvedValueOnce(mockPR);

      const params = {
        owner: 'testuser',
        repo: 'my-repo',
        title: 'Fix parallel node execution',
        body: 'Resolves #42',
        head: 'fix/parallel-nodes',
        base: 'main',
      };

      const result = await createPullRequest(params);

      expect(mockInvoke).toHaveBeenCalledWith('create_pull_request', params);
      expect(result).toEqual(mockPR);
    });

    it('propagates errors for invalid parameters', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Validation Failed'));

      await expect(
        createPullRequest({
          owner: 'testuser',
          repo: 'my-repo',
          title: '',
          body: '',
          head: 'main',
          base: 'main',
        }),
      ).rejects.toThrow('Validation Failed');
    });
  });

  describe('getAuthStatus', () => {
    it('returns authenticated status with username', async () => {
      mockInvoke.mockResolvedValueOnce({
        authenticated: true,
        username: 'testuser',
      });

      const result = await getAuthStatus();

      expect(mockInvoke).toHaveBeenCalledWith('get_auth_status');
      expect(result.authenticated).toBe(true);
      expect(result.username).toBe('testuser');
    });

    it('returns unauthenticated status', async () => {
      mockInvoke.mockResolvedValueOnce({
        authenticated: false,
      });

      const result = await getAuthStatus();

      expect(result.authenticated).toBe(false);
      expect(result.username).toBeUndefined();
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Keyring access denied'));

      await expect(getAuthStatus()).rejects.toThrow('Keyring access denied');
    });
  });

  describe('getSavedGitHubToken', () => {
    it('returns stored token when present', async () => {
      mockInvoke.mockResolvedValueOnce({
        token: 'ghp_savedtoken123',
      });

      const result = await getSavedGitHubToken();

      expect(mockInvoke).toHaveBeenCalledWith('get_saved_github_token');
      expect(result).toBe('ghp_savedtoken123');
    });

    it('returns empty string when no token is stored', async () => {
      mockInvoke.mockResolvedValueOnce({
        token: null,
      });

      const result = await getSavedGitHubToken();

      expect(result).toBe('');
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Storage unavailable'));

      await expect(getSavedGitHubToken()).rejects.toThrow('Storage unavailable');
    });
  });

  describe('deleteGitHubToken', () => {
    it('calls invoke with delete command', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      await deleteGitHubToken();

      expect(mockInvoke).toHaveBeenCalledWith('delete_github_token');
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Delete failed'));

      await expect(deleteGitHubToken()).rejects.toThrow('Delete failed');
    });
  });

  describe('verifyGitHubToken', () => {
    it('calls invoke with token and returns validation result', async () => {
      mockInvoke.mockResolvedValueOnce({
        valid: true,
        username: 'testuser',
      });

      const result = await verifyGitHubToken('ghp_token123');

      expect(mockInvoke).toHaveBeenCalledWith('verify_github_token', {
        token: 'ghp_token123',
      });
      expect(result.valid).toBe(true);
      expect(result.username).toBe('testuser');
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Invalid token'));

      await expect(verifyGitHubToken('bad')).rejects.toThrow('Invalid token');
    });
  });

  describe('listCredentialAuditEvents', () => {
    it('calls invoke with default limit', async () => {
      mockInvoke.mockResolvedValueOnce([]);

      const result = await listCredentialAuditEvents();

      expect(mockInvoke).toHaveBeenCalledWith('list_credential_audit_events', {
        limit: 20,
      });
      expect(result).toEqual([]);
    });

    it('calls invoke with custom limit', async () => {
      mockInvoke.mockResolvedValueOnce([
        {
          id: '1',
          provider: 'github',
          action: 'save_token',
          success: true,
          timestamp: '2026-02-13T00:00:00Z',
        },
      ]);

      const result = await listCredentialAuditEvents(5);

      expect(mockInvoke).toHaveBeenCalledWith('list_credential_audit_events', {
        limit: 5,
      });
      expect(result).toHaveLength(1);
    });
  });
});
