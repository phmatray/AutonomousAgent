import { useState, useCallback, useMemo, useEffect } from 'react';
import { useEditorStore } from '@/features/workflow-editor/stores/editor-store';
import { getNodeSchema, type FieldSchema } from '@/features/workflow-editor/config-schemas';
import { listGitHubCredentials } from '@/lib/api/github';
import {
  TextInput,
  NumberInput,
  SelectInput,
  TemplateTextarea,
  type TemplateVariable,
} from '@/components/ui/form';
import type { NodeType } from '@/types/workflow';

function NodeTypeIcon({ nodeType }: { nodeType: string }) {
  const category = nodeType.split('.')[0];
  const colorClass =
    category === 'github'
      ? 'text-github-accent'
      : category === 'git'
        ? 'text-git-accent'
        : category === 'claude'
          ? 'text-claude-accent'
          : 'text-control-text';
  return (
    <span className={`text-xs font-technical ${colorClass}`}>
      {nodeType}
    </span>
  );
}

function ValidationSummary({ nodeId }: { nodeId: string }) {
  const validateNodeConfig = useEditorStore((s) => s.validateNodeConfig);
  const result = validateNodeConfig(nodeId);

  if (result.valid) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-state-success px-2 py-1.5 rounded-md bg-state-success/10">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
        Configuration valid
      </div>
    );
  }

  return (
    <div className="text-xs text-state-error px-2 py-1.5 rounded-md bg-state-error/10">
      <div className="flex items-center gap-1.5 mb-1">
        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        {result.errors.length} field{result.errors.length !== 1 ? 's' : ''} need attention
      </div>
      <ul className="pl-5 space-y-0.5 list-disc">
        {result.errors.map((err) => (
          <li key={err.key}>{err.message}</li>
        ))}
      </ul>
    </div>
  );
}

interface DynamicFieldProps {
  field: FieldSchema;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  variables: TemplateVariable[];
  optionsOverride?: Array<{ label: string; value: string; disabled?: boolean }>;
  disabled?: boolean;
}

function DynamicField({
  field,
  value,
  onChange,
  variables,
  optionsOverride,
  disabled,
}: DynamicFieldProps) {
  const handleChange = useCallback(
    (v: unknown) => onChange(field.key, v),
    [field.key, onChange],
  );

  switch (field.type) {
    case 'text':
      return (
        <TextInput
          label={field.label}
          value={String(value ?? field.defaultValue ?? '')}
          onChange={handleChange as (v: string) => void}
          placeholder={field.placeholder}
          hint={field.description}
          required={field.required}
          mono
        />
      );

    case 'number':
      return (
        <NumberInput
          label={field.label}
          value={value !== undefined && value !== '' ? Number(value) : (field.defaultValue as number | undefined)}
          onChange={handleChange as (v: number | undefined) => void}
          placeholder={field.placeholder}
          hint={field.description}
          required={field.required}
          min={0}
        />
      );

    case 'select':
      return (
        <SelectInput
          label={field.label}
          value={String(value ?? field.defaultValue ?? '')}
          onChange={handleChange as (v: string) => void}
          options={(optionsOverride ?? field.options ?? []).map((o) => ({
            label: o.label,
            value: o.value,
            disabled: o.disabled,
          }))}
          placeholder={`Select ${field.label.toLowerCase()}...`}
          hint={field.description}
          required={field.required}
          disabled={disabled}
        />
      );

    case 'textarea':
      return (
        <TemplateTextarea
          label={field.label}
          value={String(value ?? field.defaultValue ?? '')}
          onChange={handleChange as (v: string) => void}
          placeholder={field.placeholder}
          hint={field.description}
          required={field.required}
          rows={4}
          variables={variables}
        />
      );

    case 'template':
      return (
        <TemplateTextarea
          label={field.label}
          value={String(value ?? field.defaultValue ?? '')}
          onChange={handleChange as (v: string) => void}
          placeholder={field.placeholder}
          hint={field.description}
          required={field.required}
          rows={1}
          variables={variables}
        />
      );

    default:
      return null;
  }
}

function RawJsonEditor({
  config,
  onUpdate,
}: {
  config: Record<string, unknown>;
  onUpdate: (config: Record<string, unknown>) => void;
}) {
  const [raw, setRaw] = useState(() => JSON.stringify(config, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      setRaw(text);
      try {
        const parsed = JSON.parse(text);
        setParseError(null);
        onUpdate(parsed);
      } catch (err) {
        setParseError((err as Error).message);
      }
    },
    [onUpdate],
  );

  return (
    <div className="space-y-1.5">
      <textarea
        value={raw}
        onChange={handleChange}
        className={`
          w-full rounded-md px-3 py-2 text-xs text-text-primary font-technical
          bg-bg-tertiary border transition-colors resize-y min-h-[100px] leading-relaxed
          focus:outline-none focus:ring-2 focus:ring-border-focus/50 focus:border-border-focus
          ${parseError ? 'border-state-error/70' : 'border-border-primary hover:border-border-hover'}
        `}
        aria-label="Raw JSON configuration"
        spellCheck={false}
      />
      {parseError && (
        <p className="text-xs text-state-error" role="alert">
          {parseError}
        </p>
      )}
    </div>
  );
}

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

  const isGithubNode = node?.data.nodeType.startsWith('github.') ?? false;
  const [credentialOptionsRaw, setCredentialOptionsRaw] = useState<
    Array<{ id: string; label: string; is_default: boolean }>
  >([]);
  const [credentialsLoading, setCredentialsLoading] = useState(false);

  useEffect(() => {
    if (!isGithubNode) {
      setCredentialOptionsRaw([]);
      setCredentialsLoading(false);
      return;
    }

    let cancelled = false;
    setCredentialsLoading(true);
    listGitHubCredentials()
      .then((credentials) => {
        if (cancelled) return;
        setCredentialOptionsRaw(
          credentials.map((credential) => ({
            id: credential.id,
            label: credential.label,
            is_default: credential.is_default,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setCredentialOptionsRaw([]);
      })
      .finally(() => {
        if (!cancelled) setCredentialsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isGithubNode]);

  const credentialOptions = useMemo(() => {
    if (credentialsLoading) {
      return [
        {
          label: 'Loading credentials...',
          value: '',
          disabled: true,
        },
      ];
    }

    if (credentialOptionsRaw.length === 0) {
      return [
        {
          label: 'No saved credentials in Settings',
          value: '',
          disabled: true,
        },
      ];
    }

    return credentialOptionsRaw.map((credential) => ({
      label: credential.is_default
        ? `${credential.label} (Default)`
        : credential.label,
      value: credential.id,
      disabled: false,
    }));
  }, [credentialOptionsRaw, credentialsLoading]);

  useEffect(() => {
    if (!node || !isGithubNode) return;
    if (!schema?.fields.some((field) => field.key === 'credential_id')) return;
    if (credentialsLoading) return;
    if (credentialOptionsRaw.length === 0) return;

    const currentConfig = (node.data.config ?? {}) as Record<string, unknown>;
    const currentValue = currentConfig.credential_id;
    if (typeof currentValue === 'string' && currentValue.trim() !== '') return;

    const defaultCredential =
      credentialOptionsRaw.find((credential) => credential.is_default) ??
      credentialOptionsRaw[0];
    updateNodeConfig(node.id, {
      ...currentConfig,
      credential_id: defaultCredential.id,
    });
  }, [credentialOptionsRaw, credentialsLoading, isGithubNode, node, schema, updateNodeConfig]);

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

  const config = (node.data.config ?? {}) as Record<string, unknown>;

  return (
    <aside
      className="w-80 h-full min-h-0 bg-bg-secondary border-l border-border-primary overflow-y-auto flex flex-col"
      aria-label="Node configuration"
    >
      {/* Header */}
      <div className="sticky top-0 bg-bg-secondary z-10 border-b border-border-secondary px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-text-primary truncate">
            {node.data.label}
          </h2>
          <button
            type="button"
            onClick={() => requestDeleteNode(node.id)}
            className="text-xs text-state-error/80 hover:text-state-error px-2 py-1 rounded-md hover:bg-state-error/10 transition-colors"
            aria-label={`Delete ${node.data.label} node`}
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

      {/* Condition Node Help */}
      {node.data.nodeType === 'condition' && (
        <div className="mx-4 mt-4 px-3 py-2 rounded-md bg-control-muted/30 border border-border-secondary text-xs text-text-secondary space-y-1">
          <p className="font-medium text-text-primary">Branch Outputs</p>
          <p>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-600 mr-1.5 align-middle" />
            <strong>Right (green)</strong> — true branch
          </p>
          <p>
            <span className="inline-block w-2 h-2 rounded-full bg-red-600 mr-1.5 align-middle" />
            <strong>Left (red)</strong> — false branch
          </p>
        </div>
      )}

      {/* Form Fields */}
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

      {/* Footer */}
      <div className="sticky bottom-0 bg-bg-secondary border-t border-border-secondary px-4 py-3 space-y-3">
        {/* Validation Summary */}
        <ValidationSummary nodeId={node.id} />

        {/* Raw JSON Toggle */}
        <button
          type="button"
          onClick={() => setShowRawJson((v) => !v)}
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
