import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, useRouter } from '@/lib/router';
import { Navigation } from '@/app/components/Navigation';
import { DashboardPage } from '@/app/routes/dashboard/DashboardPage';
import { BacklogPage } from '@/app/routes/backlog/BacklogPage';
import { EditorPage } from '@/app/routes/editor/EditorPage';
import { MonitoringPage } from '@/app/routes/monitoring/MonitoringPage';
import { CredentialsPage } from '@/app/routes/credentials/CredentialsPage';
import { SettingsPage } from '@/app/routes/settings/SettingsPage';
import { WorkflowCatalogProvider } from '@/app/state/workflow-catalog-machine';
import { useInitializationStatus } from '@/lib/hooks/useInitializationStatus';
import { useMemo, useState } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function AppContent() {
  const { route, navigate } = useRouter();
  const {
    data,
    errorMessage,
    isError,
    isFetching,
    isLoading,
    isFullyInitialized,
    lastCheckedAt,
    refetch,
  } = useInitializationStatus();
  const [allowLimitedMode, setAllowLimitedMode] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const showInitializationGate = isLoading || (!isError && !isFullyInitialized);
  const showGate = showInitializationGate && !allowLimitedMode;
  const diagnostics = useMemo(() => {
    return {
      databaseReady: data?.database === true,
      githubAuthChecked: data?.github_auth_attempted === true,
      queryStatus: isLoading ? 'loading' : isError ? 'error' : 'ready',
      isFetching,
      lastCheckedAt,
      error: errorMessage,
    };
  }, [data, errorMessage, isError, isFetching, isLoading, lastCheckedAt]);

  if (showGate) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-white p-6">
        <section className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900/80 p-6">
          <h1 className="text-lg font-semibold text-white">Starting Autonomous Agent</h1>
          <p className="mt-2 text-sm text-gray-400">
            Waiting for backend services to become available. You can continue in limited mode if checks are taking too long.
          </p>
          <div className="mt-4 space-y-2 text-sm" aria-live="polite">
            <div className="flex items-center justify-between">
              <span className="text-gray-300">Database ready</span>
              <span className={data?.database ? 'text-green-400' : 'text-gray-500'}>
                {data?.database ? 'Ready' : 'Pending'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-300">GitHub auth check</span>
              <span className={data?.github_auth_attempted ? 'text-green-400' : 'text-gray-500'}>
                {data?.github_auth_attempted ? 'Ready' : 'Pending'}
              </span>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refetch()}
              className="px-3 py-1.5 rounded-md border border-indigo-600 text-indigo-200 hover:bg-indigo-900/25 transition-colors"
              disabled={isFetching}
            >
              {isFetching ? 'Checking...' : 'Retry now'}
            </button>
            <button
              type="button"
              onClick={() => setShowDiagnostics((value) => !value)}
              className="px-3 py-1.5 rounded-md border border-gray-700 text-gray-200 hover:bg-gray-800 transition-colors"
              aria-expanded={showDiagnostics}
              aria-controls="init-diagnostics"
            >
              {showDiagnostics ? 'Hide diagnostics' : 'View diagnostics'}
            </button>
            <button
              type="button"
              onClick={() => setAllowLimitedMode(true)}
              className="px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
            >
              Continue in limited mode
            </button>
          </div>
          {showDiagnostics && (
            <dl
              id="init-diagnostics"
              className="mt-4 rounded-lg border border-gray-800 bg-gray-950/60 p-3 text-xs space-y-2"
            >
              <div className="flex justify-between gap-4">
                <dt className="text-gray-400">Status</dt>
                <dd className="text-gray-200">{diagnostics.queryStatus}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-400">Database ready</dt>
                <dd className="text-gray-200">{diagnostics.databaseReady ? 'true' : 'false'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-400">GitHub auth check</dt>
                <dd className="text-gray-200">{diagnostics.githubAuthChecked ? 'true' : 'false'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-400">Last successful check</dt>
                <dd className="text-gray-200 font-mono">
                  {diagnostics.lastCheckedAt ?? 'n/a'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-400">Error</dt>
                <dd className="text-red-300 break-all text-right">{diagnostics.error ?? 'none'}</dd>
              </div>
            </dl>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      <Navigation currentRoute={route} onNavigate={navigate} />
      {!isFullyInitialized && allowLimitedMode && (
        <div className="px-3 py-2 text-xs text-indigo-100 bg-indigo-900/30 border-b border-indigo-700/40 flex items-center justify-between gap-2">
          <span>Limited mode: backend initialization is still pending.</span>
          <button
            type="button"
            onClick={() => {
              setAllowLimitedMode(false);
              void refetch();
            }}
            className="px-2 py-1 rounded border border-indigo-400/60 hover:bg-indigo-800/40 transition-colors"
          >
            Recheck
          </button>
        </div>
      )}
      {isError && (
        <div className="px-3 py-2 text-xs text-amber-300 bg-amber-900/25 border-b border-amber-700/60" role="status">
          Could not verify backend initialization state. Continuing anyway.
        </div>
      )}
      <main className="flex-1 overflow-hidden" role="main">
        {route === 'dashboard' && <DashboardPage />}
        {route === 'backlog' && <BacklogPage />}
        {route === 'editor' && <EditorPage />}
        {route === 'monitoring' && <MonitoringPage />}
        {route === 'credentials' && <CredentialsPage />}
        {route === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider>
        <WorkflowCatalogProvider>
          <AppContent />
        </WorkflowCatalogProvider>
      </RouterProvider>
    </QueryClientProvider>
  );
}

export default App;
