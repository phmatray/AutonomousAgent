import type { NodeType } from '@/types/workflow';

export interface EditorNodeDataLike {
  nodeType: NodeType;
  config?: Record<string, unknown>;
}

export interface EditorNodeLike {
  id: string;
  data: EditorNodeDataLike;
}

export interface EditorEdgeLike {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface FieldValidationError {
  key: string;
  message: string;
}

export interface NodeValidationResult {
  valid: boolean;
  errors: FieldValidationError[];
}
