# Workflow Editor Domain

Pure workflow-editor domain logic that is independent from UI rendering.

## Modules

- `connection.ts`: connection validity and edge style decisions
- `variables.ts`: upstream template variable derivation
- `validation.ts`: node configuration validation rules
- `types.ts`: shared domain-level types

These modules are consumed by the editor store and can be tested independently.
