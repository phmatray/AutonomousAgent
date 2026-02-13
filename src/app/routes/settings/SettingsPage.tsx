import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthStatus, authenticateGitHub } from '@/lib/api/github';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  const { data: authStatus, isLoading: isCheckingAuth } = useQuery({
    queryKey: ['github-auth'],
    queryFn: getAuthStatus,
    retry: false,
  });

  const saveTokenMutation = useMutation({
    mutationFn: (newToken: string) => authenticateGitHub(newToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-auth'] });
      setToken('');
      setShowToken(false);
    },
  });

  useEffect(() => {
    if (saveTokenMutation.isSuccess) {
      const timer = setTimeout(() => saveTokenMutation.reset(), 3000);
      return () => clearTimeout(timer);
    }
  }, [saveTokenMutation.isSuccess, saveTokenMutation]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
        <p className="text-sm text-gray-400 mb-8">
          Configure authentication and preferences
        </p>

        <section className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-6" aria-labelledby="gh-auth-heading">
          <h2 id="gh-auth-heading" className="text-lg font-semibold text-white mb-4">
            GitHub Authentication
          </h2>

          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm text-gray-400">Status:</span>
              {isCheckingAuth ? (
                <span className="text-sm text-gray-500">Checking...</span>
              ) : authStatus?.authenticated ? (
                <span className="text-sm text-green-400">
                  Connected as {authStatus.username}
                </span>
              ) : (
                <span className="text-sm text-yellow-400">
                  Not authenticated
                </span>
              )}
            </div>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (token.trim()) {
                saveTokenMutation.mutate(token.trim());
              }
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
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-white font-mono pr-16 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-describedby="token-help"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-300 px-2 py-1"
                  aria-label={showToken ? 'Hide token' : 'Show token'}
                >
                  {showToken ? 'Hide' : 'Show'}
                </button>
              </div>
              <p id="token-help" className="text-xs text-gray-500 mt-1">
                Create a token at GitHub &gt; Settings &gt; Developer settings &gt; Personal access tokens.
                Required scopes: repo, workflow.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!token.trim() || saveTokenMutation.isPending}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {saveTokenMutation.isPending ? 'Saving...' : 'Save Token'}
              </button>
              {saveTokenMutation.isSuccess && (
                <span className="text-sm text-green-400" role="status" aria-live="polite">
                  Token saved successfully
                </span>
              )}
              {saveTokenMutation.isError && (
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
              <dt className="text-gray-400 w-24">Version</dt>
              <dd className="text-gray-300">0.1.0</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-400 w-24">Engine</dt>
              <dd className="text-gray-300">Tauri 2.x + React 19</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
