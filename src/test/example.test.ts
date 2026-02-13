import { describe, it, expect, beforeEach } from 'vitest';
import { mockInvoke } from './mocks/tauri';

describe('test setup', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('should run a basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should have mocked Tauri invoke', () => {
    expect(mockInvoke).toBeDefined();
    expect(typeof mockInvoke).toBe('function');
  });

  it('should be able to mock Tauri invoke responses', async () => {
    mockInvoke.mockResolvedValueOnce([{ id: '1', name: 'Test Workflow' }]);

    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke('list_workflows');

    expect(mockInvoke).toHaveBeenCalledWith('list_workflows');
    expect(result).toEqual([{ id: '1', name: 'Test Workflow' }]);
  });
});
