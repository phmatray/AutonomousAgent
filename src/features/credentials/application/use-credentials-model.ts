import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  type CredentialAuditEvent,
  type GitHubCredential,
} from '@/lib/api/github';
import {
  type ClaudeCredentialStatus,
} from '@/lib/api/claude';
import {
  fetchClaudeStatus,
  fetchCredentialAuditEvents,
  fetchGitHubAuthStatus,
  fetchGitHubCredentials,
  removeGitHubCredential,
  removeGitHubToken,
  restoreSavedGitHubToken,
  saveClaudeApiCredential,
  saveGitHubToken,
  type GitHubAuthStatus,
  verifyGitHubTokenForReveal,
} from '@/features/credentials/application/credentials-use-cases';
import { triggerCredentialAuditDownload } from '@/features/credentials/application/export-audit';
import {
  AUDIT_PAGE_SIZE_OPTIONS,
  filterCredentialAuditEvents,
  filterGitHubCredentialsByQuery,
  hasInvalidAuditDateRange as isAuditDateRangeInvalid,
  type AuditResultFilter,
} from '@/features/credentials/domain/audit';
import {
  getInitialGitHubTokenAutofill,
  persistGitHubTokenAutofill,
} from '@/features/credentials/domain/token-autofill';

export type SaveState = 'idle' | 'success' | 'error';
export type CredentialsTab = 'github' | 'activity' | 'claude';

type AuditPageSize = (typeof AUDIT_PAGE_SIZE_OPTIONS)[number];

export function useCredentialsModel() {
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
  const [auditPageSize, setAuditPageSize] = useState<AuditPageSize>(10);
  const [auditPage, setAuditPage] = useState(1);

  const refreshGitHubStatus = useCallback(async () => {
    setIsRefreshingGithub(true);
    try {
      const status = await fetchGitHubAuthStatus();
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
      const events = await fetchCredentialAuditEvents();
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
      const credentials = await fetchGitHubCredentials();
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
      const status = await fetchClaudeStatus();
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
      const token = await restoreSavedGitHubToken();
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

  const handleGitHubSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const token = githubToken.trim();
    if (!token) return;

    setIsSavingGithub(true);
    setGithubSaveState('idle');

    try {
      await saveGitHubToken(token);
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
      await verifyGitHubTokenForReveal(token);
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
    persistGitHubTokenAutofill(enabled);
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
      await removeGitHubToken();
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
      await removeGitHubCredential(selectedCredentialForDelete.id);
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

  const handleClaudeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const apiKey = claudeApiKey.trim();
    if (!apiKey) return;

    setIsSavingClaude(true);
    setClaudeSaveState('idle');

    try {
      const status = await saveClaudeApiCredential({
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
    return filterCredentialAuditEvents(credentialAuditEvents, {
      provider: auditProviderFilter,
      action: auditActionFilter,
      result: auditResultFilter,
      fromDate: auditFromDate,
      toDate: auditToDate,
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
    return isAuditDateRangeInvalid(auditFromDate, auditToDate);
  }, [auditFromDate, auditToDate]);

  const totalAuditPages = Math.max(1, Math.ceil(filteredCredentialAuditEvents.length / auditPageSize));

  const filteredGitHubCredentials = useMemo(() => {
    return filterGitHubCredentialsByQuery(githubCredentials, credentialSearchQuery);
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

  const resetAuditFilters = () => {
    setAuditProviderFilter('all');
    setAuditActionFilter('all');
    setAuditResultFilter('all');
    setAuditFromDate('');
    setAuditToDate('');
  };

  const handleAuditPageSizeChange = (value: number) => {
    if (AUDIT_PAGE_SIZE_OPTIONS.includes(value as AuditPageSize)) {
      setAuditPageSize(value as AuditPageSize);
    }
  };

  const exportFilteredCredentialAudit = () => {
    triggerCredentialAuditDownload(filteredCredentialAuditEvents, {
      provider: auditProviderFilter,
      action: auditActionFilter,
      result: auditResultFilter,
      from_date: auditFromDate || 'all',
      to_date: auditToDate || 'all',
    });
  };

  return {
    activeTab,
    githubStatus,
    githubStatusError,
    isRefreshingGithub,
    githubToken,
    showGithubToken,
    isGithubTokenAutofillEnabled,
    isSavingGithub,
    githubSaveState,
    isDeletingGithub,
    githubDeleteState,
    showDeleteGitHubDialog,
    showDeleteCredentialDialog,
    selectedCredentialForDelete,
    requiresGithubRevealVerification,
    isVerifyingGithubReveal,
    githubRevealState,
    githubCredentials,
    githubCredentialsError,
    isRefreshingGitHubCredentials,
    credentialSearchQuery,
    claudeStatus,
    claudeStatusError,
    isRefreshingClaude,
    claudeAccountLabel,
    claudeApiKey,
    showClaudeApiKey,
    isSavingClaude,
    claudeSaveState,
    credentialAuditEvents,
    credentialAuditError,
    isRefreshingCredentialAudit,
    auditProviderFilter,
    auditActionFilter,
    auditResultFilter,
    auditFromDate,
    auditToDate,
    auditPageSize,
    auditPage,
    auditProviderOptions,
    auditActionOptions,
    filteredCredentialAuditEvents,
    hasInvalidAuditDateRange,
    totalAuditPages,
    filteredGitHubCredentials,
    hasAuditFilters,
    paginatedCredentialAuditEvents,
    setActiveTab,
    setShowDeleteGitHubDialog,
    setShowDeleteCredentialDialog,
    setSelectedCredentialForDelete,
    setCredentialSearchQuery,
    setClaudeAccountLabel,
    setClaudeApiKey,
    setShowClaudeApiKey,
    setAuditProviderFilter,
    setAuditActionFilter,
    setAuditResultFilter,
    setAuditFromDate,
    setAuditToDate,
    setAuditPage,
    refreshGitHubStatus,
    refreshCredentialAudit,
    refreshGitHubCredentials,
    refreshClaudeStatus,
    handleGitHubSubmit,
    handleGitHubTokenChange,
    handleGitHubTokenVisibilityToggle,
    handleGitHubTokenAutofillToggle,
    confirmDeleteGitHubToken,
    requestDeleteGitHubCredential,
    confirmDeleteGitHubCredential,
    handleClaudeSubmit,
    resetAuditFilters,
    handleAuditPageSizeChange,
    exportFilteredCredentialAudit,
  };
}
