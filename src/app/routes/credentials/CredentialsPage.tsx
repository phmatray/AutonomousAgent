import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  authenticateGitHub,
  deleteGitHubCredential,
  deleteGitHubToken,
  getAuthStatus,
  getSavedGitHubToken,
  listGitHubCredentials,
  listCredentialAuditEvents,
  type CredentialAuditEvent,
  type GitHubCredential,
  verifyGitHubToken,
} from '@/lib/api/github';
import {
  getClaudeCredentialStatus,
  saveClaudeCredential,
  type ClaudeCredentialStatus,
} from '@/lib/api/claude';
import { CenteredPage, PageHeader } from '@/app/components/PageLayout';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Badge, Button, Input, SectionCard } from '@/components/ui/primitives';

interface GitHubAuthStatus {
  authenticated: boolean;
  username?: string;
}

type SaveState = 'idle' | 'success' | 'error';
type AuditResultFilter = 'all' | 'success' | 'failure';
type CredentialsTab = 'github' | 'activity' | 'claude';
const GITHUB_TOKEN_AUTOFILL_STORAGE_KEY = 'credentials.github.token_autofill';
const CREDENTIAL_AUDIT_FETCH_LIMIT = 200;
const AUDIT_PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;

function getBrowserStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  const storage = window.localStorage as Partial<Storage> | undefined;
  if (!storage) return null;
  if (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return null;
  }
  return storage as Pick<Storage, 'getItem' | 'setItem'>;
}

function getInitialGitHubTokenAutofill(): boolean {
  const raw = getBrowserStorage()?.getItem(GITHUB_TOKEN_AUTOFILL_STORAGE_KEY);
  return raw !== 'false';
}

function formatAuditTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function toAuditActionLabel(event: CredentialAuditEvent): string {
  const actionMap: Record<string, string> = {
    save_token: 'Saved token',
    delete_token: 'Removed token',
    delete_credential: 'Removed credential',
    verify_reveal: 'Verified reveal',
    save_credential: 'Saved credential',
  };

  return actionMap[event.action] ?? event.action;
}

function toAuditDateBoundary(dateValue: string, endOfDay: boolean): Date | null {
  const trimmed = dateValue.trim();
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function triggerCredentialAuditDownload(events: CredentialAuditEvent[], filters: Record<string, string>) {
  if (typeof document === 'undefined') return;

  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const fileName = `credential-audit-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;

  const payload = JSON.stringify(
    {
      exported_at: now.toISOString(),
      filters,
      events,
    },
    null,
    2,
  );

  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function CredentialsPage() {
  const [activeTab, setActiveTab] = useState<CredentialsTab>('github');
  const [githubStatus, setGithubStatus] = useState<GitHubAuthStatus | null>(null);
  const [githubStatusError, setGithubStatusError] = useState(false);
  const [isRefreshingGithub, setIsRefreshingGithub] = useState(false);

  const [githubToken, setGithubToken] = useState('');
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [isGithubTokenAutofillEnabled, setIsGithubTokenAutofillEnabled] = useState(
    getInitialGitHubTokenAutofill,
  );
  const [isSavingGithub, setIsSavingGithub] = useState(false);
  const [githubSaveState, setGithubSaveState] = useState<SaveState>('idle');
  const [isDeletingGithub, setIsDeletingGithub] = useState(false);
  const [githubDeleteState, setGithubDeleteState] = useState<SaveState>('idle');
  const [showDeleteGitHubDialog, setShowDeleteGitHubDialog] = useState(false);
  const [showDeleteCredentialDialog, setShowDeleteCredentialDialog] = useState(false);
  const [selectedCredentialForDelete, setSelectedCredentialForDelete] = useState<GitHubCredential | null>(null);
  const [requiresGithubRevealVerification, setRequiresGithubRevealVerification] = useState(false);
  const [isVerifyingGithubReveal, setIsVerifyingGithubReveal] = useState(false);
  const [githubRevealState, setGithubRevealState] = useState<SaveState>('idle');
  const [githubCredentials, setGithubCredentials] = useState<GitHubCredential[]>([]);
  const [githubCredentialsError, setGithubCredentialsError] = useState(false);
  const [isRefreshingGitHubCredentials, setIsRefreshingGitHubCredentials] = useState(false);
  const [credentialSearchQuery, setCredentialSearchQuery] = useState('');

  const [claudeStatus, setClaudeStatus] = useState<ClaudeCredentialStatus | null>(null);
  const [claudeStatusError, setClaudeStatusError] = useState(false);
  const [isRefreshingClaude, setIsRefreshingClaude] = useState(false);

  const [claudeAccountLabel, setClaudeAccountLabel] = useState('');
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [showClaudeApiKey, setShowClaudeApiKey] = useState(false);
  const [isSavingClaude, setIsSavingClaude] = useState(false);
  const [claudeSaveState, setClaudeSaveState] = useState<SaveState>('idle');

  const [credentialAuditEvents, setCredentialAuditEvents] = useState<CredentialAuditEvent[]>([]);
  const [credentialAuditError, setCredentialAuditError] = useState(false);
  const [isRefreshingCredentialAudit, setIsRefreshingCredentialAudit] = useState(false);
  const [auditProviderFilter, setAuditProviderFilter] = useState('all');
  const [auditActionFilter, setAuditActionFilter] = useState('all');
  const [auditResultFilter, setAuditResultFilter] = useState<AuditResultFilter>('all');
  const [auditFromDate, setAuditFromDate] = useState('');
  const [auditToDate, setAuditToDate] = useState('');
  const [auditPageSize, setAuditPageSize] =
    useState<(typeof AUDIT_PAGE_SIZE_OPTIONS)[number]>(10);
  const [auditPage, setAuditPage] = useState(1);

  const refreshGitHubStatus = useCallback(async () => {
    setIsRefreshingGithub(true);
    try {
      const status = await getAuthStatus();
      setGithubStatus(status);
      setGithubStatusError(false);
    } catch {
      setGithubStatusError(true);
    } finally {
      setIsRefreshingGithub(false);
    }
  }, []);

  const refreshCredentialAudit = useCallback(async () => {
    setIsRefreshingCredentialAudit(true);
    try {
      const events = await listCredentialAuditEvents(CREDENTIAL_AUDIT_FETCH_LIMIT);
      setCredentialAuditEvents(events);
      setCredentialAuditError(false);
    } catch {
      setCredentialAuditError(true);
    } finally {
      setIsRefreshingCredentialAudit(false);
    }
  }, []);

  const refreshGitHubCredentials = useCallback(async () => {
    setIsRefreshingGitHubCredentials(true);
    try {
      const credentials = await listGitHubCredentials();
      setGithubCredentials(credentials);
      setGithubCredentialsError(false);
    } catch {
      setGithubCredentialsError(true);
    } finally {
      setIsRefreshingGitHubCredentials(false);
    }
  }, []);

  const refreshClaudeStatus = useCallback(async () => {
    setIsRefreshingClaude(true);
    try {
      const status = await getClaudeCredentialStatus();
      setClaudeStatus(status);
      setClaudeStatusError(false);
      if (status.account_label) {
        setClaudeAccountLabel(status.account_label);
      }
    } catch {
      setClaudeStatusError(true);
    } finally {
      setIsRefreshingClaude(false);
    }
  }, []);

  const restoreGitHubToken = useCallback(async () => {
    if (!isGithubTokenAutofillEnabled) {
      setGithubToken('');
      return;
    }

    try {
      const token = await getSavedGitHubToken();
      setGithubToken(token);
      setRequiresGithubRevealVerification(token.trim().length > 0);
      setShowGithubToken(false);
      setGithubRevealState('idle');
    } catch {
      // Keep token field empty if secure storage cannot be read.
    }
  }, [isGithubTokenAutofillEnabled]);

  useEffect(() => {
    void Promise.all([
      refreshGitHubStatus(),
      refreshClaudeStatus(),
      refreshCredentialAudit(),
      refreshGitHubCredentials(),
    ]);
  }, [refreshGitHubStatus, refreshClaudeStatus, refreshCredentialAudit, refreshGitHubCredentials]);

  useEffect(() => {
    void restoreGitHubToken();
  }, [restoreGitHubToken]);

  useEffect(() => {
    if (githubSaveState === 'idle') return;
    const timer = setTimeout(() => setGithubSaveState('idle'), 3000);
    return () => clearTimeout(timer);
  }, [githubSaveState]);

  useEffect(() => {
    if (githubDeleteState === 'idle') return;
    const timer = setTimeout(() => setGithubDeleteState('idle'), 3000);
    return () => clearTimeout(timer);
  }, [githubDeleteState]);

  useEffect(() => {
    if (githubRevealState === 'idle') return;
    const timer = setTimeout(() => setGithubRevealState('idle'), 3000);
    return () => clearTimeout(timer);
  }, [githubRevealState]);

  useEffect(() => {
    if (claudeSaveState === 'idle') return;
    const timer = setTimeout(() => setClaudeSaveState('idle'), 3000);
    return () => clearTimeout(timer);
  }, [claudeSaveState]);

  const handleGitHubSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const token = githubToken.trim();
    if (!token) return;

    setIsSavingGithub(true);
    setGithubSaveState('idle');

    try {
      await authenticateGitHub(token);
      setGithubToken(token);
      setRequiresGithubRevealVerification(false);
      setShowGithubToken(false);
      setGithubSaveState('success');
      await Promise.all([
        refreshGitHubStatus(),
        refreshCredentialAudit(),
        refreshGitHubCredentials(),
      ]);
    } catch {
      setGithubSaveState('error');
    } finally {
      setIsSavingGithub(false);
    }
  };

  const handleGitHubTokenChange = (value: string) => {
    setGithubToken(value);
    setRequiresGithubRevealVerification(false);
    setGithubRevealState('idle');
  };

  const handleGitHubTokenVisibilityToggle = async () => {
    if (showGithubToken) {
      setShowGithubToken(false);
      return;
    }

    const token = githubToken.trim();
    if (!token) return;

    if (!requiresGithubRevealVerification) {
      setShowGithubToken(true);
      return;
    }

    setIsVerifyingGithubReveal(true);
    setGithubRevealState('idle');

    try {
      await verifyGitHubToken(token);
      setRequiresGithubRevealVerification(false);
      setShowGithubToken(true);
      setGithubRevealState('success');
      await Promise.all([
        refreshGitHubStatus(),
        refreshCredentialAudit(),
        refreshGitHubCredentials(),
      ]);
    } catch {
      setShowGithubToken(false);
      setGithubRevealState('error');
    } finally {
      setIsVerifyingGithubReveal(false);
    }
  };

  const handleGitHubTokenAutofillToggle = (enabled: boolean) => {
    setIsGithubTokenAutofillEnabled(enabled);
    getBrowserStorage()?.setItem(GITHUB_TOKEN_AUTOFILL_STORAGE_KEY, String(enabled));
    if (!enabled) {
      setGithubToken('');
      setRequiresGithubRevealVerification(false);
      setShowGithubToken(false);
      setGithubRevealState('idle');
    }
  };

  const confirmDeleteGitHubToken = async () => {
    setIsDeletingGithub(true);
    setGithubDeleteState('idle');

    try {
      await deleteGitHubToken();
      setGithubToken('');
      setRequiresGithubRevealVerification(false);
      setShowGithubToken(false);
      setGithubRevealState('idle');
      setGithubSaveState('idle');
      setGithubDeleteState('success');
      await Promise.all([
        refreshGitHubStatus(),
        refreshCredentialAudit(),
        refreshGitHubCredentials(),
      ]);
    } catch {
      setGithubDeleteState('error');
    } finally {
      setIsDeletingGithub(false);
      setShowDeleteGitHubDialog(false);
    }
  };

  const requestDeleteGitHubCredential = (credential: GitHubCredential) => {
    setSelectedCredentialForDelete(credential);
    setShowDeleteCredentialDialog(true);
  };

  const confirmDeleteGitHubCredential = async () => {
    if (!selectedCredentialForDelete) return;

    setIsDeletingGithub(true);
    setGithubDeleteState('idle');

    try {
      await deleteGitHubCredential(selectedCredentialForDelete.id);
      setGithubToken('');
      setShowGithubToken(false);
      setRequiresGithubRevealVerification(false);
      setGithubRevealState('idle');
      setGithubDeleteState('success');
      await Promise.all([
        refreshGitHubStatus(),
        refreshCredentialAudit(),
        refreshGitHubCredentials(),
        restoreGitHubToken(),
      ]);
    } catch {
      setGithubDeleteState('error');
    } finally {
      setIsDeletingGithub(false);
      setShowDeleteCredentialDialog(false);
      setSelectedCredentialForDelete(null);
    }
  };

  const handleClaudeSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const apiKey = claudeApiKey.trim();
    if (!apiKey) return;

    setIsSavingClaude(true);
    setClaudeSaveState('idle');

    try {
      const status = await saveClaudeCredential({
        apiKey,
        accountLabel: claudeAccountLabel,
      });
      setClaudeStatus(status);
      setClaudeApiKey('');
      setShowClaudeApiKey(false);
      setClaudeSaveState('success');
      await refreshCredentialAudit();
    } catch {
      setClaudeSaveState('error');
    } finally {
      setIsSavingClaude(false);
    }
  };

  const auditProviderOptions = useMemo(() => {
    return Array.from(
      new Set(credentialAuditEvents.map((event) => event.provider)),
    ).sort((a, b) => a.localeCompare(b));
  }, [credentialAuditEvents]);

  const auditActionOptions = useMemo(() => {
    return Array.from(
      new Set(credentialAuditEvents.map((event) => event.action)),
    ).sort((a, b) => a.localeCompare(b));
  }, [credentialAuditEvents]);

  const filteredCredentialAuditEvents = useMemo(() => {
    const fromBoundary = toAuditDateBoundary(auditFromDate, false);
    const toBoundary = toAuditDateBoundary(auditToDate, true);

    return credentialAuditEvents.filter((event) => {
      if (auditProviderFilter !== 'all' && event.provider !== auditProviderFilter) {
        return false;
      }
      if (auditActionFilter !== 'all' && event.action !== auditActionFilter) {
        return false;
      }
      if (auditResultFilter === 'success' && !event.success) {
        return false;
      }
      if (auditResultFilter === 'failure' && event.success) {
        return false;
      }
      const eventTimestamp = new Date(event.timestamp);
      if (!Number.isNaN(eventTimestamp.getTime())) {
        if (fromBoundary && eventTimestamp < fromBoundary) {
          return false;
        }
        if (toBoundary && eventTimestamp > toBoundary) {
          return false;
        }
      }
      return true;
    });
  }, [
    credentialAuditEvents,
    auditProviderFilter,
    auditActionFilter,
    auditResultFilter,
    auditFromDate,
    auditToDate,
  ]);

  const hasInvalidAuditDateRange = useMemo(() => {
    const fromBoundary = toAuditDateBoundary(auditFromDate, false);
    const toBoundary = toAuditDateBoundary(auditToDate, true);
    return Boolean(
      fromBoundary && toBoundary && fromBoundary.getTime() > toBoundary.getTime(),
    );
  }, [auditFromDate, auditToDate]);

  const totalAuditPages = Math.max(1, Math.ceil(filteredCredentialAuditEvents.length / auditPageSize));
  const filteredGitHubCredentials = useMemo(() => {
    const normalizedSearch = credentialSearchQuery.trim().toLowerCase();
    if (!normalizedSearch) return githubCredentials;
    return githubCredentials.filter((credential) =>
      credential.label.toLowerCase().includes(normalizedSearch)
      || credential.id.toLowerCase().includes(normalizedSearch)
      || credential.username.toLowerCase().includes(normalizedSearch),
    );
  }, [credentialSearchQuery, githubCredentials]);
  const hasAuditFilters = Boolean(
    auditProviderFilter !== 'all'
    || auditActionFilter !== 'all'
    || auditResultFilter !== 'all'
    || auditFromDate
    || auditToDate,
  );
  const paginatedCredentialAuditEvents = useMemo(() => {
    const startIndex = (auditPage - 1) * auditPageSize;
    return filteredCredentialAuditEvents.slice(startIndex, startIndex + auditPageSize);
  }, [filteredCredentialAuditEvents, auditPage, auditPageSize]);

  useEffect(() => {
    setAuditPage(1);
  }, [
    auditProviderFilter,
    auditActionFilter,
    auditResultFilter,
    auditFromDate,
    auditToDate,
    auditPageSize,
  ]);

  useEffect(() => {
    setAuditPage((currentPage) => Math.min(currentPage, totalAuditPages));
  }, [totalAuditPages]);

  const exportFilteredCredentialAudit = () => {
    triggerCredentialAuditDownload(filteredCredentialAuditEvents, {
      provider: auditProviderFilter,
      action: auditActionFilter,
      result: auditResultFilter,
      from_date: auditFromDate || 'all',
      to_date: auditToDate || 'all',
    });
  };

  return (
    <CenteredPage width="md">
      <PageHeader
        title="Credentials"
        description="Manage encrypted credentials stored in your local database"
        metadata={(
          <div className="flex flex-wrap gap-2">
            <Badge tone={githubStatus?.authenticated ? 'success' : 'warning'}>
              GitHub {githubStatus?.authenticated ? 'Connected' : 'Not connected'}
            </Badge>
            <Badge tone={claudeStatus?.configured ? 'success' : 'warning'}>
              Claude {claudeStatus?.configured ? 'Configured' : 'Not configured'}
            </Badge>
            <Badge tone="info">
              Activity events {credentialAuditEvents.length}
            </Badge>
          </div>
        )}
      />

      <div className="mb-6">
        <div
          className="inline-flex rounded-lg border border-gray-700 bg-gray-900/70 p-1"
          role="tablist"
          aria-label="Credentials sections"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'github'}
            onClick={() => setActiveTab('github')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === 'github'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            GitHub
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'activity'}
            onClick={() => setActiveTab('activity')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === 'activity'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            Activity
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'claude'}
            onClick={() => setActiveTab('claude')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === 'claude'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:text-white hover:bg-gray-800'
            }`}
          >
            Claude
          </button>
        </div>
      </div>

      {activeTab === 'github' && (
      <SectionCard className="mb-6" aria-labelledby="github-credentials-heading">
        <h2 id="github-credentials-heading" className="text-lg font-semibold text-white mb-4">
          GitHub Account
        </h2>

        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm text-gray-300">Status:</span>
            {isRefreshingGithub ? (
              <span className="text-sm text-gray-400">Checking...</span>
            ) : githubStatus?.authenticated ? (
              <span className="text-sm text-green-400">Connected as {githubStatus.username}</span>
            ) : githubStatusError ? (
              <span className="text-sm text-red-400">Could not verify authentication status</span>
            ) : (
              <span className="text-sm text-yellow-300">Not authenticated</span>
            )}
          </div>

          {githubStatusError ? (
            <Button
              onClick={() => void refreshGitHubStatus()}
              disabled={isRefreshingGithub}
              variant="danger"
              size="sm"
              className="bg-red-800/70 hover:bg-red-700/80"
            >
              {isRefreshingGithub ? 'Retrying...' : 'Retry status check'}
            </Button>
          ) : null}
        </div>

        <form onSubmit={(event) => void handleGitHubSubmit(event)} className="space-y-4">
          <div>
            <label
              htmlFor="github-token"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Personal Access Token
            </label>
            <div className="relative">
              <input
                id="github-token"
                type={showGithubToken ? 'text' : 'password'}
                value={githubToken}
                onChange={(event) => handleGitHubTokenChange(event.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white font-mono pr-16 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-describedby="github-token-help"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => void handleGitHubTokenVisibilityToggle()}
                disabled={!githubToken.trim() || isVerifyingGithubReveal}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-200 px-2 py-1"
                aria-label={
                  showGithubToken
                    ? 'Hide token'
                    : requiresGithubRevealVerification
                      ? 'Verify and show token'
                      : 'Show token'
                }
                aria-pressed={showGithubToken}
              >
                {showGithubToken
                  ? 'Hide'
                  : isVerifyingGithubReveal
                    ? 'Verifying...'
                    : requiresGithubRevealVerification
                      ? 'Verify & Show'
                      : 'Show'}
              </button>
            </div>
            <p id="github-token-help" className="text-xs text-gray-400 mt-1">
              Required scopes: repo, workflow.
            </p>
            {githubRevealState === 'success' ? (
              <p className="text-xs text-green-400 mt-1" role="status" aria-live="polite">
                Token verification succeeded.
              </p>
            ) : null}
            {githubRevealState === 'error' ? (
              <p className="text-xs text-red-400 mt-1" role="alert">
                Token verification failed. Save a valid token and retry.
              </p>
            ) : null}
            <label className="inline-flex items-center gap-2 text-xs text-gray-300 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isGithubTokenAutofillEnabled}
                onChange={(event) => handleGitHubTokenAutofillToggle(event.target.checked)}
                className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-indigo-600 focus:ring-indigo-500"
              />
              Auto-fill saved token on page open
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={!githubToken.trim() || isSavingGithub}
            >
              {isSavingGithub ? 'Saving...' : 'Save GitHub Token'}
            </Button>
            <Button
              onClick={() => setShowDeleteGitHubDialog(true)}
              disabled={isDeletingGithub}
              variant="secondary"
            >
              {isDeletingGithub ? 'Removing...' : 'Remove Saved Token'}
            </Button>

            {githubSaveState === 'success' ? (
              <span className="text-sm text-green-400" role="status" aria-live="polite">
                GitHub token saved
              </span>
            ) : null}
            {githubSaveState === 'error' ? (
              <span className="text-sm text-red-400" role="alert">
                Failed to save GitHub token
              </span>
            ) : null}
            {githubDeleteState === 'success' ? (
              <span className="text-sm text-green-400" role="status" aria-live="polite">
                GitHub credential removed
              </span>
            ) : null}
            {githubDeleteState === 'error' ? (
              <span className="text-sm text-red-400" role="alert">
                Failed to remove GitHub credential
              </span>
            ) : null}
          </div>
        </form>

        <div className="mt-6 border-t border-gray-700 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-200">Saved Credential Profiles</h3>
            <Button
              onClick={() => void refreshGitHubCredentials()}
              disabled={isRefreshingGitHubCredentials}
              variant="secondary"
              size="sm"
            >
              {isRefreshingGitHubCredentials ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
          <Input
            type="search"
            value={credentialSearchQuery}
            onChange={(event) => setCredentialSearchQuery(event.target.value)}
            placeholder="Search credentials by label, username, or ID"
            className="mb-3 h-9 text-sm bg-gray-900 border-gray-700"
            aria-label="Search saved GitHub credentials"
          />

          {githubCredentialsError ? (
            <p className="text-sm text-red-400">Could not load saved GitHub credentials.</p>
          ) : githubCredentials.length === 0 ? (
            <p className="text-sm text-gray-400">No saved GitHub credentials.</p>
          ) : filteredGitHubCredentials.length === 0 ? (
            <p className="text-sm text-gray-400">No credential profiles match your search.</p>
          ) : (
            <ul className="space-y-2" aria-label="Saved GitHub credentials">
              {filteredGitHubCredentials.map((credential) => (
                <li key={credential.id} className="flex items-center justify-between gap-3 rounded border border-gray-700 bg-gray-900/40 px-3 py-2">
                  <div>
                    <p className="text-sm text-gray-100">
                      {credential.label}
                      {credential.is_default ? ' (Default)' : ''}
                    </p>
                    <p className="text-xs text-gray-500 font-mono">{credential.id}</p>
                  </div>
                  <Button
                    onClick={() => requestDeleteGitHubCredential(credential)}
                    disabled={isDeletingGithub || credential.id === '__active_session__'}
                    variant="secondary"
                    size="sm"
                  >
                    Remove Profile
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>
      )}

      {activeTab === 'activity' && (
      <SectionCard className="mb-6" aria-labelledby="credential-audit-heading">
        <div className="sticky top-0 z-20 -mx-6 mb-4 border-b border-gray-700 bg-gray-800/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center justify-between">
            <h2 id="credential-audit-heading" className="text-lg font-semibold text-white">
              Credential Activity
            </h2>
            <div className="flex items-center gap-2">
              {hasAuditFilters ? (
                <Button
                  onClick={() => {
                    setAuditProviderFilter('all');
                    setAuditActionFilter('all');
                    setAuditResultFilter('all');
                    setAuditFromDate('');
                    setAuditToDate('');
                  }}
                  variant="ghost"
                  size="sm"
                >
                  Reset filters
                </Button>
              ) : null}
              <Button
                onClick={exportFilteredCredentialAudit}
                disabled={filteredCredentialAuditEvents.length === 0 || hasInvalidAuditDateRange}
                variant="secondary"
                size="sm"
              >
                Export JSON
              </Button>
              <Button
                onClick={() => void refreshCredentialAudit()}
                disabled={isRefreshingCredentialAudit}
                variant="secondary"
                size="sm"
              >
                {isRefreshingCredentialAudit ? 'Refreshing...' : 'Refresh'}
              </Button>
            </div>
          </div>
          {!credentialAuditError && credentialAuditEvents.length > 0 && (
            <p className="mt-2 text-xs text-gray-400">Filters stay pinned while you scroll activity events.</p>
          )}
        </div>

        {credentialAuditError ? (
          <p className="text-sm text-red-400">Could not load credential activity.</p>
        ) : credentialAuditEvents.length === 0 ? (
          <p className="text-sm text-gray-400">No credential activity yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
              <label className="text-xs text-gray-300">
                Provider
                <select
                  value={auditProviderFilter}
                  onChange={(event) => setAuditProviderFilter(event.target.value)}
                  className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                >
                  <option value="all">All providers</option>
                  {auditProviderOptions.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-gray-300">
                Action
                <select
                  value={auditActionFilter}
                  onChange={(event) => setAuditActionFilter(event.target.value)}
                  className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                >
                  <option value="all">All actions</option>
                  {auditActionOptions.map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-gray-300">
                Result
                <select
                  value={auditResultFilter}
                  onChange={(event) => setAuditResultFilter(event.target.value as AuditResultFilter)}
                  className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                >
                  <option value="all">All results</option>
                  <option value="success">Success</option>
                  <option value="failure">Failure</option>
                </select>
              </label>

              <label className="text-xs text-gray-300">
                From date
                <input
                  type="date"
                  value={auditFromDate}
                  onChange={(event) => setAuditFromDate(event.target.value)}
                  className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                />
              </label>

              <label className="text-xs text-gray-300">
                To date
                <input
                  type="date"
                  value={auditToDate}
                  onChange={(event) => setAuditToDate(event.target.value)}
                  className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                />
              </label>

              <label className="text-xs text-gray-300">
                Page size
                <select
                  value={String(auditPageSize)}
                  onChange={(event) => {
                    const nextSize = Number(event.target.value);
                    if (AUDIT_PAGE_SIZE_OPTIONS.includes(nextSize as (typeof AUDIT_PAGE_SIZE_OPTIONS)[number])) {
                      setAuditPageSize(nextSize as (typeof AUDIT_PAGE_SIZE_OPTIONS)[number]);
                    }
                  }}
                  className="mt-1 w-full rounded border border-gray-600 bg-gray-900 text-gray-100 px-2 py-1 text-xs"
                >
                  {AUDIT_PAGE_SIZE_OPTIONS.map((pageSize) => (
                    <option key={pageSize} value={pageSize}>
                      {pageSize} events
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {hasInvalidAuditDateRange ? (
              <p className="text-sm text-red-400 mb-3">
                Date range is invalid. Choose a start date before the end date.
              </p>
            ) : null}

            {filteredCredentialAuditEvents.length === 0 ? (
              <p className="text-sm text-gray-400">No activity matches the current filters.</p>
            ) : (
              <>
                <p className="text-xs text-gray-400 mb-2">
                  Showing {(auditPage - 1) * auditPageSize + 1}-
                  {Math.min(auditPage * auditPageSize, filteredCredentialAuditEvents.length)} of{' '}
                  {filteredCredentialAuditEvents.length} matching events.
                </p>
                <ul className="space-y-2" aria-label="Credential activity log">
                  {paginatedCredentialAuditEvents.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-3 text-sm border-b border-gray-700/70 pb-2">
                    <div>
                      <p className={event.success ? 'text-green-300' : 'text-red-300'}>
                        {event.provider.toUpperCase()}: {toAuditActionLabel(event)}
                      </p>
                      {event.detail ? <p className="text-xs text-gray-400">{event.detail}</p> : null}
                    </div>
                    <time className="text-xs text-gray-500">{formatAuditTimestamp(event.timestamp)}</time>
                  </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-center justify-between">
                  <Button
                    onClick={() => setAuditPage((currentPage) => Math.max(1, currentPage - 1))}
                    disabled={auditPage <= 1}
                    variant="secondary"
                    size="sm"
                  >
                    Previous
                  </Button>
                  <p className="text-xs text-gray-400">
                    Page {auditPage} of {totalAuditPages}
                  </p>
                  <Button
                    onClick={() => setAuditPage((currentPage) => Math.min(totalAuditPages, currentPage + 1))}
                    disabled={auditPage >= totalAuditPages}
                    variant="secondary"
                    size="sm"
                  >
                    Next
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </SectionCard>
      )}

      {activeTab === 'claude' && (
      <SectionCard aria-labelledby="claude-credentials-heading">
        <h2 id="claude-credentials-heading" className="text-lg font-semibold text-white mb-4">
          Claude Account
        </h2>

        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm text-gray-300">Status:</span>
            {isRefreshingClaude ? (
              <span className="text-sm text-gray-400">Checking...</span>
            ) : claudeStatus?.configured ? (
              <span className="text-sm text-green-400">Configured</span>
            ) : claudeStatusError ? (
              <span className="text-sm text-red-400">Could not verify credential status</span>
            ) : (
              <span className="text-sm text-yellow-300">Not configured</span>
            )}
          </div>
          {claudeStatus?.account_label ? (
            <p className="text-xs text-gray-400">Account: {claudeStatus.account_label}</p>
          ) : null}
          {claudeStatusError ? (
            <Button
              onClick={() => void refreshClaudeStatus()}
              disabled={isRefreshingClaude}
              variant="danger"
              size="sm"
              className="mt-2 bg-red-800/70 hover:bg-red-700/80"
            >
              {isRefreshingClaude ? 'Retrying...' : 'Retry status check'}
            </Button>
          ) : null}
        </div>

        <form onSubmit={(event) => void handleClaudeSubmit(event)} className="space-y-4">
          <div>
            <label
              htmlFor="claude-account-label"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Account Label (optional)
            </label>
            <input
              id="claude-account-label"
              type="text"
              value={claudeAccountLabel}
              onChange={(event) => setClaudeAccountLabel(event.target.value)}
              placeholder="work-account"
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoComplete="off"
            />
          </div>

          <div>
            <label
              htmlFor="claude-api-key"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              API Key
            </label>
            <div className="relative">
              <input
                id="claude-api-key"
                type={showClaudeApiKey ? 'text' : 'password'}
                value={claudeApiKey}
                onChange={(event) => setClaudeApiKey(event.target.value)}
                placeholder="sk-ant-..."
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white font-mono pr-16 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowClaudeApiKey((current) => !current)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-200 px-2 py-1"
                aria-label={showClaudeApiKey ? 'Hide API key' : 'Show API key'}
                aria-pressed={showClaudeApiKey}
              >
                {showClaudeApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={!claudeApiKey.trim() || isSavingClaude}
            >
              {isSavingClaude ? 'Saving...' : 'Save Claude Credentials'}
            </Button>

            {claudeSaveState === 'success' ? (
              <span className="text-sm text-green-400" role="status" aria-live="polite">
                Claude credentials saved
              </span>
            ) : null}
            {claudeSaveState === 'error' ? (
              <span className="text-sm text-red-400" role="alert">
                Failed to save Claude credentials
              </span>
            ) : null}
          </div>
        </form>
      </SectionCard>
      )}

      <ConfirmDialog
        open={showDeleteGitHubDialog}
        title="Remove Saved GitHub Token"
        message="This removes all saved GitHub credential entries from local storage. Continue?"
        confirmLabel={isDeletingGithub ? 'Removing...' : 'Remove Token'}
        cancelLabel="Cancel"
        confirmDisabled={isDeletingGithub}
        onConfirm={() => void confirmDeleteGitHubToken()}
        onCancel={() => {
          if (!isDeletingGithub) setShowDeleteGitHubDialog(false);
        }}
      />
      <ConfirmDialog
        open={showDeleteCredentialDialog}
        title="Remove GitHub Credential Profile"
        message={`Remove credential profile "${selectedCredentialForDelete?.label ?? ''}" from local storage?`}
        confirmLabel={isDeletingGithub ? 'Removing...' : 'Remove Profile'}
        cancelLabel="Cancel"
        confirmDisabled={isDeletingGithub}
        onConfirm={() => void confirmDeleteGitHubCredential()}
        onCancel={() => {
          if (!isDeletingGithub) {
            setShowDeleteCredentialDialog(false);
            setSelectedCredentialForDelete(null);
          }
        }}
      />
    </CenteredPage>
  );
}
