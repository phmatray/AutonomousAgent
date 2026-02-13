import { useCallback, useEffect, useState } from 'react';
import { authenticateGitHub, getAuthStatus } from '@/lib/api/github';
import {
  getClaudeCredentialStatus,
  saveClaudeCredential,
  type ClaudeCredentialStatus,
} from '@/lib/api/claude';
import { CenteredPage, PageHeader } from '@/app/components/PageLayout';

interface GitHubAuthStatus {
  authenticated: boolean;
  username?: string;
}

type SaveState = 'idle' | 'success' | 'error';

export function CredentialsPage() {
  const [githubStatus, setGithubStatus] = useState<GitHubAuthStatus | null>(null);
  const [githubStatusError, setGithubStatusError] = useState(false);
  const [isRefreshingGithub, setIsRefreshingGithub] = useState(false);

  const [githubToken, setGithubToken] = useState('');
  const [showGithubToken, setShowGithubToken] = useState(false);
  const [isSavingGithub, setIsSavingGithub] = useState(false);
  const [githubSaveState, setGithubSaveState] = useState<SaveState>('idle');

  const [claudeStatus, setClaudeStatus] = useState<ClaudeCredentialStatus | null>(null);
  const [claudeStatusError, setClaudeStatusError] = useState(false);
  const [isRefreshingClaude, setIsRefreshingClaude] = useState(false);

  const [claudeAccountLabel, setClaudeAccountLabel] = useState('');
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [showClaudeApiKey, setShowClaudeApiKey] = useState(false);
  const [isSavingClaude, setIsSavingClaude] = useState(false);
  const [claudeSaveState, setClaudeSaveState] = useState<SaveState>('idle');

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

  useEffect(() => {
    void Promise.all([refreshGitHubStatus(), refreshClaudeStatus()]);
  }, [refreshGitHubStatus, refreshClaudeStatus]);

  useEffect(() => {
    if (githubSaveState === 'idle') return;
    const timer = setTimeout(() => setGithubSaveState('idle'), 3000);
    return () => clearTimeout(timer);
  }, [githubSaveState]);

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
      setGithubToken('');
      setShowGithubToken(false);
      setGithubSaveState('success');
      await refreshGitHubStatus();
    } catch {
      setGithubSaveState('error');
    } finally {
      setIsSavingGithub(false);
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
    } catch {
      setClaudeSaveState('error');
    } finally {
      setIsSavingClaude(false);
    }
  };

  return (
    <CenteredPage width="md">
      <PageHeader
        title="Credentials"
        description="Manage encrypted credentials stored in your local database"
      />

      <section className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6" aria-labelledby="github-credentials-heading">
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
            <button
              type="button"
              onClick={() => void refreshGitHubStatus()}
              disabled={isRefreshingGithub}
              className="px-3 py-1.5 text-xs bg-red-800/70 text-red-100 rounded hover:bg-red-700/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRefreshingGithub ? 'Retrying...' : 'Retry status check'}
            </button>
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
                onChange={(event) => setGithubToken(event.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white font-mono pr-16 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-describedby="github-token-help"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowGithubToken((current) => !current)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-200 px-2 py-1"
                aria-label={showGithubToken ? 'Hide token' : 'Show token'}
                aria-pressed={showGithubToken}
              >
                {showGithubToken ? 'Hide' : 'Show'}
              </button>
            </div>
            <p id="github-token-help" className="text-xs text-gray-400 mt-1">
              Required scopes: repo, workflow.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!githubToken.trim() || isSavingGithub}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {isSavingGithub ? 'Saving...' : 'Save GitHub Token'}
            </button>

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
          </div>
        </form>
      </section>

      <section className="bg-gray-800 border border-gray-700 rounded-lg p-6" aria-labelledby="claude-credentials-heading">
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
            <button
              type="button"
              onClick={() => void refreshClaudeStatus()}
              disabled={isRefreshingClaude}
              className="mt-2 px-3 py-1.5 text-xs bg-red-800/70 text-red-100 rounded hover:bg-red-700/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRefreshingClaude ? 'Retrying...' : 'Retry status check'}
            </button>
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
            <button
              type="submit"
              disabled={!claudeApiKey.trim() || isSavingClaude}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {isSavingClaude ? 'Saving...' : 'Save Claude Credentials'}
            </button>

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
      </section>
    </CenteredPage>
  );
}
