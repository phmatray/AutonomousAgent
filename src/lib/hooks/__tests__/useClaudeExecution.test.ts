import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { useClaudeExecution } from '../useClaudeExecution';
import { mockInvoke, mockListen } from '@/test/mocks/tauri';

// Capture event listener callbacks registered via listen()
let eventListeners: Record<string, (event: { payload: unknown }) => void> = {};
let unlistenFns: Record<string, Mock> = {};

beforeEach(() => {
  mockInvoke.mockReset();
  mockListen.mockReset();
  eventListeners = {};
  unlistenFns = {};

  // When listen() is called, capture the callback and return an unlisten function
  mockListen.mockImplementation(async (eventName: string, callback: (event: { payload: unknown }) => void) => {
    eventListeners[eventName] = callback;
    const unlisten = vi.fn();
    unlistenFns[eventName] = unlisten;
    return unlisten;
  });
});

function emitEvent(eventName: string, payload: unknown) {
  const listener = eventListeners[eventName];
  if (listener) {
    listener({ payload });
  }
}

describe('useClaudeExecution', () => {
  describe('initial state', () => {
    it('should return correct initial values', () => {
      const { result } = renderHook(() => useClaudeExecution());

      expect(result.current.isRunning).toBe(false);
      expect(result.current.output).toBe('');
      expect(result.current.error).toBeNull();
      expect(result.current.executionId).toBeNull();
      expect(typeof result.current.execute).toBe('function');
      expect(typeof result.current.reset).toBe('function');
    });
  });

  describe('execute', () => {
    it('should set isRunning to true and clear previous state on execute', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-1', status: 'running' });

      const { result } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('test prompt');
      });

      expect(result.current.isRunning).toBe(true);
      expect(result.current.output).toBe('');
      expect(result.current.error).toBeNull();
      expect(result.current.executionId).toBe('exec-1');
    });

    it('should call executePlan with prompt and workingDir', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-2', status: 'running' });

      const { result } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('fix the bug', '/home/project');
      });

      expect(mockInvoke).toHaveBeenCalledWith('execute_plan', {
        prompt: 'fix the bug',
        workingDir: '/home/project',
      });
    });

    it('should call executePlan without workingDir when not provided', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-3', status: 'running' });

      const { result } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('analyze code');
      });

      expect(mockInvoke).toHaveBeenCalledWith('execute_plan', {
        prompt: 'analyze code',
        workingDir: undefined,
      });
    });

    it('should return the execution id', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-42', status: 'running' });

      const { result } = renderHook(() => useClaudeExecution());

      let returnedId = '';
      await act(async () => {
        returnedId = await result.current.execute('test');
      });

      expect(returnedId).toBe('exec-42');
    });

    it('should register event listeners before executing', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-5', status: 'running' });

      const { result } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('test');
      });

      expect(mockListen).toHaveBeenCalledWith('claude:output:stdout', expect.any(Function));
      expect(mockListen).toHaveBeenCalledWith('claude:output:stderr', expect.any(Function));
      expect(mockListen).toHaveBeenCalledWith('claude:execution:complete', expect.any(Function));
    });
  });

  describe('output accumulation', () => {
    it('should accumulate stdout output', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-6', status: 'running' });

      const { result } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('test');
      });

      act(() => {
        emitEvent('claude:output:stdout', {
          execution_id: 'exec-6',
          content: 'line 1',
          stream: 'stdout',
        });
      });

      expect(result.current.output).toBe('line 1\n');

      act(() => {
        emitEvent('claude:output:stdout', {
          execution_id: 'exec-6',
          content: 'line 2',
          stream: 'stdout',
        });
      });

      expect(result.current.output).toBe('line 1\nline 2\n');
    });

    it('should accumulate stderr output', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-7', status: 'running' });

      const { result } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('test');
      });

      act(() => {
        emitEvent('claude:output:stderr', {
          execution_id: 'exec-7',
          content: 'warning message',
          stream: 'stderr',
        });
      });

      expect(result.current.output).toBe('warning message\n');
    });

    it('should accumulate mixed stdout and stderr output', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-8', status: 'running' });

      const { result } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('test');
      });

      act(() => {
        emitEvent('claude:output:stdout', {
          execution_id: 'exec-8',
          content: 'stdout line',
          stream: 'stdout',
        });
      });

      act(() => {
        emitEvent('claude:output:stderr', {
          execution_id: 'exec-8',
          content: 'stderr line',
          stream: 'stderr',
        });
      });

      expect(result.current.output).toBe('stdout line\nstderr line\n');
    });
  });

  describe('completion', () => {
    it('should set isRunning to false on successful completion', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-9', status: 'running' });

      const { result } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('test');
      });

      expect(result.current.isRunning).toBe(true);

      act(() => {
        emitEvent('claude:execution:complete', {
          execution_id: 'exec-9',
          exit_code: 0,
          success: true,
        });
      });

      expect(result.current.isRunning).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should set error on failed completion', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-10', status: 'running' });

      const { result } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('test');
      });

      act(() => {
        emitEvent('claude:execution:complete', {
          execution_id: 'exec-10',
          exit_code: 1,
          success: false,
        });
      });

      expect(result.current.isRunning).toBe(false);
      expect(result.current.error).toBe('Execution failed with exit code 1');
    });

    it('should clean up event listeners on completion', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-11', status: 'running' });

      const { result } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('test');
      });

      act(() => {
        emitEvent('claude:execution:complete', {
          execution_id: 'exec-11',
          exit_code: 0,
          success: true,
        });
      });

      expect(unlistenFns['claude:output:stdout']).toHaveBeenCalled();
      expect(unlistenFns['claude:output:stderr']).toHaveBeenCalled();
      expect(unlistenFns['claude:execution:complete']).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle executePlan rejection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Claude CLI not found'));

      const { result } = renderHook(() => useClaudeExecution());

      let returnedId = '';
      await act(async () => {
        returnedId = await result.current.execute('test');
      });

      expect(result.current.isRunning).toBe(false);
      expect(result.current.error).toBe('Claude CLI not found');
      expect(returnedId).toBe('');
    });

    it('should handle non-Error rejection', async () => {
      mockInvoke.mockRejectedValueOnce('string error');

      const { result } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('test');
      });

      expect(result.current.error).toBe('string error');
      expect(result.current.isRunning).toBe(false);
    });

    it('should clean up listeners on executePlan error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('timeout'));

      const { result } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('test');
      });

      expect(unlistenFns['claude:output:stdout']).toHaveBeenCalled();
      expect(unlistenFns['claude:output:stderr']).toHaveBeenCalled();
      expect(unlistenFns['claude:execution:complete']).toHaveBeenCalled();
    });
  });

  describe('callbacks', () => {
    it('should call onOutput for stdout events', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-cb1', status: 'running' });
      const onOutput = vi.fn();

      const { result } = renderHook(() => useClaudeExecution({ onOutput }));

      await act(async () => {
        await result.current.execute('test');
      });

      act(() => {
        emitEvent('claude:output:stdout', {
          execution_id: 'exec-cb1',
          content: 'hello',
          stream: 'stdout',
        });
      });

      expect(onOutput).toHaveBeenCalledWith({
        execution_id: 'exec-cb1',
        content: 'hello',
        stream: 'stdout',
      });
    });

    it('should call onOutput for stderr events', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-cb2', status: 'running' });
      const onOutput = vi.fn();

      const { result } = renderHook(() => useClaudeExecution({ onOutput }));

      await act(async () => {
        await result.current.execute('test');
      });

      act(() => {
        emitEvent('claude:output:stderr', {
          execution_id: 'exec-cb2',
          content: 'warning',
          stream: 'stderr',
        });
      });

      expect(onOutput).toHaveBeenCalledWith({
        execution_id: 'exec-cb2',
        content: 'warning',
        stream: 'stderr',
      });
    });

    it('should call onComplete on successful completion', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-cb3', status: 'running' });
      const onComplete = vi.fn();

      const { result } = renderHook(() => useClaudeExecution({ onComplete }));

      await act(async () => {
        await result.current.execute('test');
      });

      act(() => {
        emitEvent('claude:execution:complete', {
          execution_id: 'exec-cb3',
          exit_code: 0,
          success: true,
        });
      });

      expect(onComplete).toHaveBeenCalledWith({
        execution_id: 'exec-cb3',
        exit_code: 0,
        success: true,
      });
    });

    it('should call onError on failed completion', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-cb4', status: 'running' });
      const onError = vi.fn();

      const { result } = renderHook(() => useClaudeExecution({ onError }));

      await act(async () => {
        await result.current.execute('test');
      });

      act(() => {
        emitEvent('claude:execution:complete', {
          execution_id: 'exec-cb4',
          exit_code: 1,
          success: false,
        });
      });

      expect(onError).toHaveBeenCalledWith('Exit code: 1');
    });

    it('should call onError when executePlan rejects', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('network error'));
      const onError = vi.fn();

      const { result } = renderHook(() => useClaudeExecution({ onError }));

      await act(async () => {
        await result.current.execute('test');
      });

      expect(onError).toHaveBeenCalledWith('network error');
    });
  });

  describe('reset', () => {
    it('should reset all state', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-r1', status: 'running' });

      const { result } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('test');
      });

      // Accumulate some output
      act(() => {
        emitEvent('claude:output:stdout', {
          execution_id: 'exec-r1',
          content: 'some output',
          stream: 'stdout',
        });
      });

      expect(result.current.executionId).toBe('exec-r1');
      expect(result.current.output).toBe('some output\n');

      act(() => {
        result.current.reset();
      });

      expect(result.current.isRunning).toBe(false);
      expect(result.current.output).toBe('');
      expect(result.current.error).toBeNull();
      expect(result.current.executionId).toBeNull();
    });
  });

  describe('cleanup on unmount', () => {
    it('should clean up event listeners when the hook unmounts', async () => {
      mockInvoke.mockResolvedValueOnce({ id: 'exec-u1', status: 'running' });

      const { result, unmount } = renderHook(() => useClaudeExecution());

      await act(async () => {
        await result.current.execute('test');
      });

      unmount();

      expect(unlistenFns['claude:output:stdout']).toHaveBeenCalled();
      expect(unlistenFns['claude:output:stderr']).toHaveBeenCalled();
      expect(unlistenFns['claude:execution:complete']).toHaveBeenCalled();
    });
  });
});
