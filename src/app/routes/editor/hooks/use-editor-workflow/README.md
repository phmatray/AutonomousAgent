# Editor Workflow Hook Modules

This folder contains the composable pieces behind `useEditorWorkflow`.

- `useWorkflowDomainState.ts`: editor graph + domain machine wiring
- `useWorkflowFlowState.ts`: flow machine wiring (save/execute UI state)
- `useWorkflowLoading.ts`: load workflow from route and hydrate editor graph
- `useWorkflowPersistence.ts`: save workflow
- `useWorkflowExecution.ts`: preflight + execute workflow
- `useWorkflowImportExport.ts`: import/export JSON workflow files
- `buildWorkflowPayload.ts`: workflow payload mapper
- `types.ts`: shared hook types
