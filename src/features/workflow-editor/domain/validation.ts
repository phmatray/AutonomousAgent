import { NODE_SCHEMAS } from '@/features/workflow-editor/nodes/catalog';
import type {
  EditorNodeLike,
  FieldValidationError,
  NodeValidationResult,
} from '@/features/workflow-editor/domain/types';

export type { FieldValidationError, NodeValidationResult };

export function validateNodeConfigForNode(
  nodeId: string,
  nodes: EditorNodeLike[],
): NodeValidationResult {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return { valid: true, errors: [] };

  const schema = NODE_SCHEMAS[node.data.nodeType];
  if (!schema) return { valid: true, errors: [] };

  const config = (node.data.config ?? {}) as Record<string, unknown>;
  const errors: FieldValidationError[] = [];

  for (const field of schema.fields) {
    const value = config[field.key];

    if (field.required) {
      const stringValue = typeof value === 'string' ? value.trim() : String(value ?? '');
      if (!value || stringValue === '' || stringValue === 'undefined') {
        errors.push({ key: field.key, message: `${field.label} is required` });
      }
    }

    if (field.type === 'number' && value !== undefined && value !== '') {
      const numberValue = Number(value);
      if (isNaN(numberValue)) {
        errors.push({ key: field.key, message: `${field.label} must be a number` });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
