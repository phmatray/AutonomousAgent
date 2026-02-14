import type { Workflow } from '@/types/workflow';
import { executeWorkflow, updateWorkflow } from '@/lib/api/workflow';
import { getWorkflowStatus, type WorkflowStatus } from '@/features/dashboard/domain/workflows';

export async function toggleWorkflowPublishStatus(workflow: Workflow): Promise<WorkflowStatus> {
  const current = getWorkflowStatus(workflow);
  const nextStatus: WorkflowStatus = current === 'published' ? 'draft' : 'published';
  await updateWorkflow(workflow.id, { ...workflow, status: nextStatus });
  return nextStatus;
}

export async function runPublishedWorkflow(workflow: Workflow) {
  if (getWorkflowStatus(workflow) !== 'published') {
    throw new Error('Only published workflows can run from this page.');
  }
  return executeWorkflow(workflow.id, 'manual');
}
