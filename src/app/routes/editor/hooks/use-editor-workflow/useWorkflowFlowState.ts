import { useEffect, useRef } from 'react';
import { useMachine } from '@xstate/react';
import { editorFlowMachine, type EditorFlowEvent } from '@/app/routes/editor/editor-flow-machine';
import type { WorkflowFlowControls } from '@/app/routes/editor/hooks/use-editor-workflow/types';

export function useWorkflowFlowState(): WorkflowFlowControls {
  const [flowState, sendFlowEvent] = useMachine(editorFlowMachine);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  return {
    isSaving: flowState.matches('saving'),
    isExecuting: flowState.matches('executing'),
    isBusy: flowState.matches('saving') || flowState.matches('executing'),
    saveGlow: flowState.context.saveGlow,
    flowError: flowState.context.error,
    sendFlowEvent: (event) => {
      sendFlowEvent(event as EditorFlowEvent);
      if (event.type === 'SAVE_SUCCESS') {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(
          () => sendFlowEvent({ type: 'SAVE_GLOW_TIMEOUT' }),
          1200,
        );
      }
    },
  };
}
