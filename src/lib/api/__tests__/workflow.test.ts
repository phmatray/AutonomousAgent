import { describe, it, expect, beforeEach } from 'vitest';
import { mockInvoke } from '@/test/mocks/tauri';
import {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  executeWorkflow,
  listExecutions,
  getExecutionLogs,
  cancelExecution,
} from '@/lib/api/workflow';
import type { Workflow, WorkflowExecution, ExecutionLog } from '@/types/workflow';

const mockWorkflow: Workflow = {
  id: 'wf-1',
  name: 'Test Workflow',
  description: 'A test workflow',
  nodes: [{ id: 'n1', type: 'trigger' }],
  edges: [],
  config: {},
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockExecution: WorkflowExecution = {
  id: 'exec-1',
  workflowId: 'wf-1',
  status: 'COMPLETED',
  triggerType: 'manual',
  startedAt: '2026-01-01T00:00:00Z',
  completedAt: '2026-01-01T00:01:00Z',
};

const mockLog: ExecutionLog = {
  id: 1,
  executionId: 'exec-1',
  nodeId: 'n1',
  level: 'INFO',
  message: 'Node executed successfully',
  timestamp: '2026-01-01T00:00:30Z',
};

describe('workflow API', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe('listWorkflows', () => {
    it('calls invoke with correct command', async () => {
      mockInvoke.mockResolvedValueOnce([mockWorkflow]);

      const result = await listWorkflows();

      expect(mockInvoke).toHaveBeenCalledWith('list_workflows');
      expect(result).toEqual([mockWorkflow]);
    });

    it('returns empty array when no workflows exist', async () => {
      mockInvoke.mockResolvedValueOnce([]);

      const result = await listWorkflows();

      expect(result).toEqual([]);
    });

    it('propagates errors from invoke', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Database not initialized'));

      await expect(listWorkflows()).rejects.toThrow('Database not initialized');
    });
  });

  describe('getWorkflow', () => {
    it('calls invoke with correct command and id', async () => {
      mockInvoke.mockResolvedValueOnce(mockWorkflow);

      const result = await getWorkflow('wf-1');

      expect(mockInvoke).toHaveBeenCalledWith('get_workflow', { id: 'wf-1' });
      expect(result).toEqual(mockWorkflow);
    });

    it('propagates errors for non-existent workflow', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Workflow not found'));

      await expect(getWorkflow('wf-nonexistent')).rejects.toThrow('Workflow not found');
    });
  });

  describe('createWorkflow', () => {
    it('calls invoke with correct command and workflow data', async () => {
      mockInvoke.mockResolvedValueOnce(mockWorkflow);

      const result = await createWorkflow(mockWorkflow);

      expect(mockInvoke).toHaveBeenCalledWith('create_workflow', { workflow: mockWorkflow });
      expect(result).toEqual(mockWorkflow);
    });

    it('propagates validation errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Invalid workflow'));

      await expect(createWorkflow(mockWorkflow)).rejects.toThrow('Invalid workflow');
    });
  });

  describe('updateWorkflow', () => {
    it('calls invoke with correct command, id, and partial workflow', async () => {
      const update = { name: 'Updated Name' };
      const updated = { ...mockWorkflow, name: 'Updated Name' };
      mockInvoke.mockResolvedValueOnce(updated);

      const result = await updateWorkflow('wf-1', update);

      expect(mockInvoke).toHaveBeenCalledWith('update_workflow', {
        id: 'wf-1',
        workflow: update,
      });
      expect(result.name).toBe('Updated Name');
    });

    it('propagates errors for non-existent workflow', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Workflow not found'));

      await expect(updateWorkflow('wf-nonexistent', { name: 'X' })).rejects.toThrow(
        'Workflow not found',
      );
    });
  });

  describe('deleteWorkflow', () => {
    it('calls invoke with correct command and id', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      await deleteWorkflow('wf-1');

      expect(mockInvoke).toHaveBeenCalledWith('delete_workflow', { id: 'wf-1' });
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Cannot delete active workflow'));

      await expect(deleteWorkflow('wf-1')).rejects.toThrow('Cannot delete active workflow');
    });
  });

  describe('executeWorkflow', () => {
    it('calls invoke with workflowId and triggerType', async () => {
      mockInvoke.mockResolvedValueOnce(mockExecution);

      const result = await executeWorkflow('wf-1', 'manual');

      expect(mockInvoke).toHaveBeenCalledWith('execute_workflow', {
        workflowId: 'wf-1',
        triggerType: 'manual',
      });
      expect(result).toEqual(mockExecution);
    });

    it('calls invoke with undefined triggerType when not provided', async () => {
      mockInvoke.mockResolvedValueOnce(mockExecution);

      await executeWorkflow('wf-1');

      expect(mockInvoke).toHaveBeenCalledWith('execute_workflow', {
        workflowId: 'wf-1',
        triggerType: undefined,
      });
    });

    it('propagates execution errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Workflow already running'));

      await expect(executeWorkflow('wf-1')).rejects.toThrow('Workflow already running');
    });
  });

  describe('listExecutions', () => {
    it('calls invoke with workflowId filter', async () => {
      mockInvoke.mockResolvedValueOnce([mockExecution]);

      const result = await listExecutions('wf-1');

      expect(mockInvoke).toHaveBeenCalledWith('list_executions', { workflowId: 'wf-1' });
      expect(result).toEqual([mockExecution]);
    });

    it('calls invoke with undefined workflowId when not provided', async () => {
      mockInvoke.mockResolvedValueOnce([mockExecution]);

      await listExecutions();

      expect(mockInvoke).toHaveBeenCalledWith('list_executions', { workflowId: undefined });
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Database error'));

      await expect(listExecutions()).rejects.toThrow('Database error');
    });
  });

  describe('getExecutionLogs', () => {
    it('calls invoke with correct executionId', async () => {
      mockInvoke.mockResolvedValueOnce([mockLog]);

      const result = await getExecutionLogs('exec-1');

      expect(mockInvoke).toHaveBeenCalledWith('get_execution_logs', { executionId: 'exec-1' });
      expect(result).toEqual([mockLog]);
    });

    it('returns empty array for execution with no logs', async () => {
      mockInvoke.mockResolvedValueOnce([]);

      const result = await getExecutionLogs('exec-1');

      expect(result).toEqual([]);
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Execution not found'));

      await expect(getExecutionLogs('exec-nonexistent')).rejects.toThrow('Execution not found');
    });
  });

  describe('cancelExecution', () => {
    it('calls invoke with correct executionId', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      await cancelExecution('exec-1');

      expect(mockInvoke).toHaveBeenCalledWith('cancel_execution', { executionId: 'exec-1' });
    });

    it('propagates errors', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Execution already completed'));

      await expect(cancelExecution('exec-1')).rejects.toThrow('Execution already completed');
    });
  });
});
