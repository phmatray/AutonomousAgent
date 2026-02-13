import { describe, it, expect, beforeEach } from 'vitest';
import { mockInvoke } from '@/test/mocks/tauri';
import { isInitialized } from '@/lib/api/system';

describe('system API', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe('isInitialized', () => {
    it('calls invoke with correct command', async () => {
      mockInvoke.mockResolvedValueOnce({
        database: true,
        github_auth_attempted: true,
      });

      const result = await isInitialized();

      expect(mockInvoke).toHaveBeenCalledWith('is_initialized');
      expect(result).toEqual({
        database: true,
        github_auth_attempted: true,
      });
    });

    it('returns partially initialized state', async () => {
      mockInvoke.mockResolvedValueOnce({
        database: true,
        github_auth_attempted: false,
      });

      const result = await isInitialized();

      expect(result.database).toBe(true);
      expect(result.github_auth_attempted).toBe(false);
    });

    it('returns uninitialized state', async () => {
      mockInvoke.mockResolvedValueOnce({
        database: false,
        github_auth_attempted: false,
      });

      const result = await isInitialized();

      expect(result.database).toBe(false);
      expect(result.github_auth_attempted).toBe(false);
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('App state not available'));

      await expect(isInitialized()).rejects.toThrow('App state not available');
    });
  });
});
