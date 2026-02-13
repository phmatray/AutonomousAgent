# Workflow Editor Feature

This feature is organized by concern:

- `components/`: canvas and edge rendering
- `nodes/`: node catalog, node UI, and node-specific feature modules
- `stores/`: Zustand state container and state transitions
- `domain/`: pure graph and validation logic shared by the store

Start with:

- `src/features/workflow-editor/stores/editor-store.ts`
- `src/features/workflow-editor/nodes/README.md`
- `src/features/workflow-editor/domain/README.md`
