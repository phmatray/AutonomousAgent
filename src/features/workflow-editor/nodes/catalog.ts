import nodeSpecsCatalog from '@/shared/node-specs.json';
import type { NodeType } from '@/types/workflow';

export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'template';

export interface FieldOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  description?: string;
  options?: FieldOption[];
  defaultValue?: string | number;
}

export interface OutputVariable {
  name: string;
  description: string;
}

export interface NodeConfigSchema {
  fields: FieldSchema[];
  outputs: OutputVariable[];
}

interface NodeCatalogEntry {
  type: NodeType;
  label: string;
  category: 'control' | 'github' | 'git' | 'claude';
  fields: FieldSchema[];
  outputs: OutputVariable[];
}

interface NodeCatalog {
  nodes: NodeCatalogEntry[];
}

const catalog = nodeSpecsCatalog as NodeCatalog;

const EXECUTION_POLICY_FIELDS: FieldSchema[] = [
  {
    key: 'join_policy',
    label: 'Join Policy',
    type: 'select',
    required: false,
    description: 'How multiple inbound branches are combined for this node',
    defaultValue: 'all',
    options: [
      { label: 'All Inputs', value: 'all' },
      { label: 'Any Input', value: 'any' },
    ],
  },
  {
    key: '_max_retries',
    label: 'Retries Override',
    type: 'number',
    required: false,
    placeholder: '2',
    description: 'Optional per-node override for max retries',
  },
  {
    key: '_retry_delay_ms',
    label: 'Retry Delay (ms)',
    type: 'number',
    required: false,
    placeholder: '1000',
    description: 'Optional per-node override for retry delay in milliseconds',
  },
  {
    key: '_backoff',
    label: 'Retry Backoff',
    type: 'select',
    required: false,
    description: 'Retry delay strategy when retries are enabled',
    defaultValue: 'linear',
    options: [
      { label: 'Linear', value: 'linear' },
      { label: 'Exponential', value: 'exponential' },
    ],
  },
  {
    key: '_timeout_secs',
    label: 'Node Timeout (s)',
    type: 'number',
    required: false,
    placeholder: '600',
    description: 'Optional per-node timeout override in seconds',
  },
  {
    key: '_continue_on_error',
    label: 'Continue On Error',
    type: 'select',
    required: false,
    description: 'When true, workflow continues even if this node fails',
    defaultValue: 'false',
    options: [
      { label: 'False', value: 'false' },
      { label: 'True', value: 'true' },
    ],
  },
];

function buildNodeSchema(entry: NodeCatalogEntry): NodeConfigSchema {
  return {
    fields: [...entry.fields, ...EXECUTION_POLICY_FIELDS],
    outputs: entry.outputs,
  };
}

export const NODE_SCHEMAS: Record<NodeType, NodeConfigSchema> = catalog.nodes.reduce(
  (acc, entry) => {
    acc[entry.type] = buildNodeSchema(entry);
    return acc;
  },
  {} as Record<NodeType, NodeConfigSchema>,
);

export const NODE_METADATA: Record<NodeType, { label: string; category: NodeCatalogEntry['category'] }> =
  catalog.nodes.reduce(
    (acc, entry) => {
      acc[entry.type] = {
        label: entry.label,
        category: entry.category,
      };
      return acc;
    },
    {} as Record<NodeType, { label: string; category: NodeCatalogEntry['category'] }>,
  );

export function getNodeSchema(nodeType: NodeType): NodeConfigSchema {
  return NODE_SCHEMAS[nodeType];
}

export function getRequiredFields(nodeType: NodeType): FieldSchema[] {
  return NODE_SCHEMAS[nodeType].fields.filter((f) => f.required);
}

export function getNodeOutputs(nodeType: NodeType): OutputVariable[] {
  return NODE_SCHEMAS[nodeType].outputs;
}

export function getNodeLabel(nodeType: NodeType): string {
  return NODE_METADATA[nodeType]?.label ?? nodeType;
}
