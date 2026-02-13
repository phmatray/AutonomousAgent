import { useCallback, useState } from 'react';
import { createWorkflow, executeWorkflow, preflightWorkflow } from '@/lib/api/workflow';
import { getAuthStatus } from '@/lib/api/github';
import { buildWorkflowPayload } from '@/app/routes/editor/hooks/use-editor-workflow/buildWorkflowPayload';
import type {
  NavigateFn,
  WorkflowDomainControls,
  WorkflowExecutionState,
  WorkflowFlowControls,
  WorkflowGraphSnapshot,
} from '@/app/routes/editor/hooks/use-editor-workflow/types';

interface UseWorkflowExecutionParams {
  graph: WorkflowGraphSnapshot;
  controls: WorkflowDomainControls;
  flow: WorkflowFlowControls;
  isWorkflowNameValid: boolean;
  navigate: NavigateFn;
}

export function useWorkflowExecution({
  graph,
  controls,
  flow,
  isWorkflowNameValid,
  navigate,
}: UseWorkflowExecutionParams): WorkflowExecutionState & { handleExecute: () => Promise<void> } {
  const [preflightIssues, setPreflightIssues] = useState<WorkflowExecutionState['preflightIssues']>([]);

  const handleExecute = useCallback(async () => {
    if (!isWorkflowNameValid || flow.isBusy) return;

    const requiresGitHubAuth = graph.nodes.some((node) => {
      const type = node.data.nodeType;
      return type.startsWith('github.') || type === 'backlog.syncIssues';
    });
    if (requiresGitHubAuth) {
      try {
        const authStatus = await getAuthStatus();
        if (!authStatus.authenticated) {
          flow.sendFlowEvent({
            type: 'EXECUTE_FAILURE',
            message: 'GitHub is not authenticated. Open Credentials and save a GitHub token first.',
          });
          return;
        }
      } catch {
        flow.sendFlowEvent({
          type: 'EXECUTE_FAILURE',
          message: 'Could not verify GitHub authentication. Open Credentials and retry.',
        });
        return;
      }
    }

    flow.sendFlowEvent({ type: 'EXECUTE_REQUEST' });
    try {
      const payload = buildWorkflowPayload({
        workflowId: graph.workflowId,
        workflowName: graph.workflowName,
        workflowStatus: graph.workflowStatus,
        nodes: graph.nodes,
        edges: graph.edges,
      });

      const preflight = await preflightWorkflow(payload);
      setPreflightIssues(preflight.issues);

      const preflightErrors = preflight.issues.filter((issue) => issue.level === 'ERROR');
      if (preflightErrors.length > 0) {
        flow.sendFlowEvent({
          type: 'EXECUTE_FAILURE',
          message: `Preflight failed with ${preflightErrors.length} error${preflightErrors.length === 1 ? '' : 's'}.`,
        });
        return;
      }

      let targetWorkflowId = graph.workflowId;
      if (!targetWorkflowId) {
        const createdWorkflow = await createWorkflow(payload);
        targetWorkflowId = createdWorkflow.id;
        controls.sendDomainEvent({
          type: 'WORKFLOW_CREATED',
          id: createdWorkflow.id,
          name: createdWorkflow.name,
          status: createdWorkflow.status ?? 'draft',
        });
        navigate('editor', { id: createdWorkflow.id });
      }

      const execution = await executeWorkflow(targetWorkflowId, 'manual');
      flow.sendFlowEvent({ type: 'EXECUTE_SUCCESS' });

      if (execution?.id) {
        navigate('monitoring', { id: execution.id });
      } else {
        navigate('monitoring');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to execute workflow';
      flow.sendFlowEvent({ type: 'EXECUTE_FAILURE', message });
    }
  }, [controls, flow, graph, isWorkflowNameValid, navigate]);

  return {
    preflightIssues,
    dismissPreflightIssues: () => setPreflightIssues([]),
    handleExecute,
  };
}
