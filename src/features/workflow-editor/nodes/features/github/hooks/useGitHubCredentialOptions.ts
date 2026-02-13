import { useEffect, useMemo, useState } from 'react';
import { listGitHubCredentials } from '@/lib/api/github';
import type { NodeConfigSchema } from '@/features/workflow-editor/nodes/catalog';
import type { WorkflowNode } from '@/features/workflow-editor/stores/editor-store';
import type { ConfigFieldOption } from '@/features/workflow-editor/nodes/components/node-config/DynamicField';

interface CredentialRecord {
  id: string;
  label: string;
  is_default: boolean;
}

interface UseGitHubCredentialOptionsParams {
  node: WorkflowNode | undefined;
  schema: NodeConfigSchema | null;
  updateNodeConfig: (id: string, config: Record<string, unknown>) => void;
}

interface UseGitHubCredentialOptionsResult {
  credentialsLoading: boolean;
  credentialOptions: ConfigFieldOption[];
}

export function useGitHubCredentialOptions({
  node,
  schema,
  updateNodeConfig,
}: UseGitHubCredentialOptionsParams): UseGitHubCredentialOptionsResult {
  const [credentialRecords, setCredentialRecords] = useState<CredentialRecord[]>([]);
  const [credentialsLoading, setCredentialsLoading] = useState(false);

  const usesGithubCredentials = node
    ? (node.data.nodeType.startsWith('github.') || node.data.nodeType === 'backlog.syncIssues')
    : false;

  useEffect(() => {
    if (!usesGithubCredentials) {
      setCredentialRecords([]);
      setCredentialsLoading(false);
      return;
    }

    let cancelled = false;
    setCredentialsLoading(true);

    listGitHubCredentials()
      .then((credentials) => {
        if (cancelled) return;
        setCredentialRecords(
          credentials.map((credential) => ({
            id: credential.id,
            label: credential.label,
            is_default: credential.is_default,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setCredentialRecords([]);
      })
      .finally(() => {
        if (!cancelled) setCredentialsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [usesGithubCredentials]);

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

    if (credentialRecords.length === 0) {
      return [
        {
          label: 'No saved credentials in Settings',
          value: '',
          disabled: true,
        },
      ];
    }

    return credentialRecords.map((credential) => ({
      label: credential.is_default
        ? `${credential.label} (Default)`
        : credential.label,
      value: credential.id,
      disabled: false,
    }));
  }, [credentialRecords, credentialsLoading]);

  useEffect(() => {
    if (!node || !usesGithubCredentials) return;
    if (!schema?.fields.some((field) => field.key === 'credential_id')) return;
    if (credentialsLoading) return;
    if (credentialRecords.length === 0) return;

    const currentConfig = (node.data.config ?? {}) as Record<string, unknown>;
    const currentValue = currentConfig.credential_id;
    if (typeof currentValue === 'string' && currentValue.trim() !== '') return;

    const defaultCredential =
      credentialRecords.find((credential) => credential.is_default) ??
      credentialRecords[0];

    updateNodeConfig(node.id, {
      ...currentConfig,
      credential_id: defaultCredential.id,
    });
  }, [credentialRecords, credentialsLoading, usesGithubCredentials, node, schema, updateNodeConfig]);

  return {
    credentialsLoading,
    credentialOptions,
  };
}
