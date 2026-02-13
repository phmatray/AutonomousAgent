import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, useRouter } from '@/lib/router';
import { Navigation } from '@/app/components/Navigation';
import { DashboardPage } from '@/app/routes/dashboard/DashboardPage';
import { BacklogPage } from '@/app/routes/backlog/BacklogPage';
import { EditorPage } from '@/app/routes/editor/EditorPage';
import { MonitoringPage } from '@/app/routes/monitoring/MonitoringPage';
import { SettingsPage } from '@/app/routes/settings/SettingsPage';
import { WorkflowCatalogProvider } from '@/app/state/workflow-catalog-machine';
import { useInitializationStatus } from '@/lib/hooks/useInitializationStatus';

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
  const { data, isError, isLoading, isFullyInitialized } = useInitializationStatus();
  const showInitializationGate = isLoading || (!isError && !isFullyInitialized);

  if (showInitializationGate) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-white p-6">
        <section className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900/80 p-6">
          <h1 className="text-lg font-semibold text-white">Starting Autonomous Agent</h1>
          <p className="mt-2 text-sm text-gray-400">
            Waiting for backend services to become available.
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
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      <Navigation currentRoute={route} onNavigate={navigate} />
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
