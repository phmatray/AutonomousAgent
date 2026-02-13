import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emit } from '@tauri-apps/api/event';
import { mockInvoke } from '@/test/mocks/tauri';
import {
  executePlan,
  cancelExecution,
  listRunningExecutions,
  onClaudeStdout,
  onClaudeStderr,
  onClaudeComplete,
} from '@/lib/api/claude';
import type { ExecutionResult, ClaudeOutput, ClaudeExecutionComplete } from '@/lib/api/claude';

const mockExecResult: ExecutionResult = {
  id: 'claude-exec-1',
  status: 'RUNNING',
  started_at: '2026-01-01T00:00:00Z',
};

describe('execution API (claude)', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe('executePlan', () => {
    it('calls invoke with prompt only', async () => {
      mockInvoke.mockResolvedValueOnce(mockExecResult);

      const result = await executePlan({ prompt: 'Fix the bug in auth module' });

      expect(mockInvoke).toHaveBeenCalledWith('execute_plan', {
        prompt: 'Fix the bug in auth module',
      });
      expect(result).toEqual(mockExecResult);
    });

    it('calls invoke with all parameters', async () => {
      mockInvoke.mockResolvedValueOnce(mockExecResult);

      const params = {
        prompt: 'Fix the bug',
        workingDir: '/tmp/repo',
        timeoutSecs: 120,
      };

      const result = await executePlan(params);

      expect(mockInvoke).toHaveBeenCalledWith('execute_plan', params);
      expect(result).toEqual(mockExecResult);
    });

    it('propagates errors when Claude CLI is not available', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Claude CLI not found on PATH'));

      await expect(executePlan({ prompt: 'test' })).rejects.toThrow(
        'Claude CLI not found on PATH',
      );
    });
  });

  describe('cancelExecution', () => {
    it('calls invoke with correct executionId', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      await cancelExecution('claude-exec-1');

      expect(mockInvoke).toHaveBeenCalledWith('cancel_execution', {
        executionId: 'claude-exec-1',
      });
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Execution not found'));

      await expect(cancelExecution('nonexistent')).rejects.toThrow('Execution not found');
    });
  });

  describe('listRunningExecutions', () => {
    it('calls invoke and returns execution ids', async () => {
      mockInvoke.mockResolvedValueOnce(['exec-1', 'exec-2']);

      const result = await listRunningExecutions();

      expect(mockInvoke).toHaveBeenCalledWith('list_running_executions');
      expect(result).toEqual(['exec-1', 'exec-2']);
    });

    it('returns empty array when no executions running', async () => {
      mockInvoke.mockResolvedValueOnce([]);

      const result = await listRunningExecutions();

      expect(result).toEqual([]);
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Service unavailable'));

      await expect(listRunningExecutions()).rejects.toThrow('Service unavailable');
    });
  });

  describe('onClaudeStdout', () => {
    it('receives emitted stdout events', async () => {
      const callback = vi.fn();

      await onClaudeStdout(callback);
      await emit('claude:output:stdout', {
        execution_id: 'exec-1',
        content: 'Processing...',
        stream: 'stdout',
      } satisfies ClaudeOutput);

      expect(callback).toHaveBeenCalledWith({
        execution_id: 'exec-1',
        content: 'Processing...',
        stream: 'stdout',
      });
    });

    it('stops receiving events after unlisten', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const callback = vi.fn();
      const unlisten = await onClaudeStdout(callback);

      await emit('claude:output:stdout', {
        execution_id: 'exec-1',
        content: 'line 1',
        stream: 'stdout',
      } satisfies ClaudeOutput);
      expect(callback).toHaveBeenCalledTimes(1);

      unlisten();
      await emit('claude:output:stdout', {
        execution_id: 'exec-1',
        content: 'line 2',
        stream: 'stdout',
      } satisfies ClaudeOutput);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('onClaudeStderr', () => {
    it('receives emitted stderr events', async () => {
      const callback = vi.fn();

      await onClaudeStderr(callback);
      await emit('claude:output:stderr', {
        execution_id: 'exec-1',
        content: 'Warning: deprecated API',
        stream: 'stderr',
      } satisfies ClaudeOutput);

      expect(callback).toHaveBeenCalledWith({
        execution_id: 'exec-1',
        content: 'Warning: deprecated API',
        stream: 'stderr',
      });
    });
  });

  describe('onClaudeComplete', () => {
    it('receives completion payload', async () => {
      const callback = vi.fn();

      await onClaudeComplete(callback);
      await emit('claude:execution:complete', {
        execution_id: 'exec-1',
        exit_code: 0,
        success: true,
      } satisfies ClaudeExecutionComplete);

      expect(callback).toHaveBeenCalledWith({
        execution_id: 'exec-1',
        exit_code: 0,
        success: true,
      });
    });

    it('handles failed execution complete event', async () => {
      const callback = vi.fn();

      await onClaudeComplete(callback);
      await emit('claude:execution:complete', {
        execution_id: 'exec-1',
        exit_code: 1,
        success: false,
      } satisfies ClaudeExecutionComplete);

      expect(callback).toHaveBeenCalledWith({
        execution_id: 'exec-1',
        exit_code: 1,
        success: false,
      });
    });
  });
});
