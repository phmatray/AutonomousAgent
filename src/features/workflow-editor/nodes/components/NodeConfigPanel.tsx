import { useState, useCallback, useMemo } from 'react';
import { useEditorStore } from '@/features/workflow-editor/stores/editor-store';
import { getNodeLabel, getNodeSchema } from '@/features/workflow-editor/nodes/catalog';
import { DynamicField } from '@/features/workflow-editor/nodes/components/node-config/DynamicField';
import { RawJsonEditor } from '@/features/workflow-editor/nodes/components/node-config/RawJsonEditor';
import { NodeTypeIcon } from '@/features/workflow-editor/nodes/components/node-config/NodeTypeIcon';
import { ValidationSummary } from '@/features/workflow-editor/nodes/components/node-config/ValidationSummary';
import { ConditionBranchHelp } from '@/features/workflow-editor/nodes/features/control/components/ConditionBranchHelp';
import { useGitHubCredentialOptions } from '@/features/workflow-editor/nodes/features/github/hooks/useGitHubCredentialOptions';
import type { NodeType } from '@/types/workflow';

export function NodeConfigPanel() {
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const nodes = useEditorStore((s) => s.nodes);
  const updateNodeConfig = useEditorStore((s) => s.updateNodeConfig);
  const requestDeleteNode = useEditorStore((s) => s.requestDeleteNode);
  const getAvailableVariables = useEditorStore((s) => s.getAvailableVariables);

  const [showRawJson, setShowRawJson] = useState(false);

  const node = nodes.find((n) => n.id === selectedNodeId);

  const variables = useMemo(() => {
    if (!node) return [];
    return getAvailableVariables(node.id);
  }, [node, getAvailableVariables]);

  const schema = useMemo(() => {
    if (!node) return null;
    return getNodeSchema(node.data.nodeType as NodeType);
  }, [node]);

  const { credentialOptions, credentialsLoading } = useGitHubCredentialOptions({
    node,
    schema,
    updateNodeConfig,
  });

  const handleFieldChange = useCallback(
    (key: string, value: unknown) => {
      if (!node) return;
      const currentConfig = (node.data.config ?? {}) as Record<string, unknown>;
      updateNodeConfig(node.id, { ...currentConfig, [key]: value });
    },
    [node, updateNodeConfig],
  );

  const handleRawJsonUpdate = useCallback(
    (config: Record<string, unknown>) => {
      if (!node) return;
      updateNodeConfig(node.id, config);
    },
    [node, updateNodeConfig],
  );

  if (!node) return null;

  const nodeLabel = getNodeLabel(node.data.nodeType);
  const config = (node.data.config ?? {}) as Record<string, unknown>;

  return (
    <aside
      className="w-80 h-full min-h-0 bg-bg-secondary border-l border-border-primary overflow-y-auto flex flex-col"
      aria-label="Node configuration"
    >
      <div className="sticky top-0 bg-bg-secondary z-10 border-b border-border-secondary px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-text-primary truncate">
            {nodeLabel}
          </h2>
          <button
            type="button"
            onClick={() => requestDeleteNode(node.id)}
            className="text-xs text-state-error/80 hover:text-state-error px-2 py-1 rounded-md hover:bg-state-error/10 transition-colors"
            aria-label={`Delete ${nodeLabel} node`}
          >
            Delete
          </button>
        </div>
        <div className="flex items-center gap-3">
          <NodeTypeIcon nodeType={node.data.nodeType} />
          <span className="text-xs text-text-tertiary font-technical truncate">
            {node.id}
          </span>
        </div>
      </div>

      {node.data.nodeType === 'condition' && <ConditionBranchHelp />}

      <div className="flex-1 px-4 py-4 space-y-4">
        {schema && !showRawJson && (
          <>
            {schema.fields.map((field) => (
              <DynamicField
                key={field.key}
                field={field}
                value={config[field.key]}
                onChange={handleFieldChange}
                variables={variables}
                optionsOverride={field.key === 'credential_id' ? credentialOptions : undefined}
                disabled={field.key === 'credential_id' && credentialsLoading}
              />
            ))}
          </>
        )}

        {showRawJson && (
          <RawJsonEditor config={config} onUpdate={handleRawJsonUpdate} />
        )}

        {!schema && !showRawJson && (
          <p className="text-xs text-text-tertiary italic">
            No configuration schema for this node type.
          </p>
        )}
      </div>

      <div className="sticky bottom-0 bg-bg-secondary border-t border-border-secondary px-4 py-3 space-y-3">
        <ValidationSummary nodeId={node.id} />

        <button
          type="button"
          onClick={() => setShowRawJson((value) => !value)}
          className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors w-full"
          aria-expanded={showRawJson}
        >
          <svg
            className={`w-3 h-3 transition-transform ${showRawJson ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          {showRawJson ? 'Show Form' : 'Show Raw JSON'}
        </button>
      </div>
    </aside>
  );
}
