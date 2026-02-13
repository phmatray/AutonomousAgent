# Workflow Editor Nodes

This folder owns the editor-side node feature.

## Scope

- Node catalog and config schemas
- Palette and node-rendering UI
- Node configuration panel
- Node-specific UI tests
- Feature grouping metadata (`control`, `github`, `git`, `claude`)

## Main Files

- `src/features/workflow-editor/nodes/catalog.ts`
- `src/features/workflow-editor/nodes/icons.ts`
- `src/features/workflow-editor/nodes/features/index.ts`
- `src/features/workflow-editor/nodes/components/NodePalette.tsx`
- `src/features/workflow-editor/nodes/components/WorkflowNodeComponent.tsx`
- `src/features/workflow-editor/nodes/components/NodeConfigPanel.tsx`
- `src/features/workflow-editor/nodes/components/__tests__/NodePalette.test.tsx`
- `src/features/workflow-editor/nodes/components/__tests__/NodeConfigPanel.test.tsx`

## Feature Folders

- `src/features/workflow-editor/nodes/features/control/README.md`
- `src/features/workflow-editor/nodes/features/github/README.md`
- `src/features/workflow-editor/nodes/features/git/README.md`
- `src/features/workflow-editor/nodes/features/claude/README.md`

## Runtime Node Docs

Backend execution docs remain in `docs/nodes/README.md`.
