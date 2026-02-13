import { useEffect } from 'react';
import { useMachine } from '@xstate/react';
import { settingsMachine } from './settings-machine';
import { CenteredPage, PageHeader } from '@/app/components/PageLayout';

export function SettingsPage() {
  const [state, send] = useMachine(settingsMachine);
  const authStatus = state.context.authStatus;
  const token = state.context.token;
  const showToken = state.context.showToken;
  const saveFeedback = state.context.saveFeedback;
  const isCheckingAuth = state.matches('checkingStatus');
  const isAuthStatusError = state.context.statusError;
  const isFetchingAuthStatus = isCheckingAuth;
  const isSaving = state.matches('savingToken');

  useEffect(() => {
    if (saveFeedback !== 'idle') {
      const timer = setTimeout(() => send({ type: 'CLEAR_SAVE_FEEDBACK' }), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveFeedback, send]);

  return (
    <CenteredPage width="md">
      <PageHeader
        title="Settings"
        description="Configure authentication and preferences"
      />

      <section className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6" aria-labelledby="gh-auth-heading">
        <h2 id="gh-auth-heading" className="text-lg font-semibold text-white mb-4">
          GitHub Authentication
        </h2>

        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm text-gray-300">Status:</span>
            {isCheckingAuth ? (
              <span className="text-sm text-gray-400">Checking...</span>
            ) : authStatus?.authenticated ? (
              <span className="text-sm text-green-400">
                Connected as {authStatus.username}
              </span>
            ) : isAuthStatusError ? (
              <span className="text-sm text-red-400">
                Could not verify authentication status
              </span>
            ) : (
              <span className="text-sm text-yellow-300">
                Not authenticated
              </span>
            )}
          </div>
          {isAuthStatusError && (
            <div className="mt-3 p-3 bg-red-900/30 border border-red-800 rounded-lg" role="alert">
              <p className="text-xs text-red-300 mb-2">
                Unable to contact backend while checking GitHub authentication.
              </p>
              <button
                type="button"
                onClick={() => send({ type: 'RETRY_STATUS' })}
                disabled={isFetchingAuthStatus}
                className="px-3 py-1.5 text-xs bg-red-800/70 text-red-100 rounded hover:bg-red-700/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isFetchingAuthStatus ? 'Retrying...' : 'Retry status check'}
              </button>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send({ type: 'SUBMIT_TOKEN' });
          }}
          className="space-y-4"
        >
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
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => send({ type: 'TOKEN_CHANGED', value: e.target.value })}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white font-mono pr-16 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-describedby="token-help"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => send({ type: 'TOGGLE_SHOW_TOKEN' })}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-200 px-2 py-1"
                aria-label={showToken ? 'Hide token' : 'Show token'}
                aria-pressed={showToken}
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
            <p id="token-help" className="text-xs text-gray-400 mt-1">
              Create a token at GitHub &gt; Settings &gt; Developer settings &gt; Personal access tokens.
              Required scopes: repo, workflow.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!token.trim() || isSaving}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {isSaving ? 'Saving...' : 'Save Token'}
            </button>
            {saveFeedback === 'success' && (
              <span className="text-sm text-green-400" role="status" aria-live="polite">
                Token saved successfully
              </span>
            )}
            {saveFeedback === 'error' && (
              <span className="text-sm text-red-400" role="alert">
                Failed to save token
              </span>
            )}
          </div>
        </form>
      </section>

      <section className="bg-gray-800 border border-gray-700 rounded-lg p-6" aria-labelledby="about-heading">
        <h2 id="about-heading" className="text-lg font-semibold text-white mb-4">
          About
        </h2>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="text-gray-300 w-24">Version</dt>
            <dd className="text-gray-200">0.1.0</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-gray-300 w-24">Engine</dt>
            <dd className="text-gray-200">Tauri 2.x + React 19</dd>
          </div>
        </dl>
      </section>
    </CenteredPage>
  );
}
