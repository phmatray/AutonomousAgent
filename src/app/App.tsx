import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from '@/lib/router';
import { Navigation } from '@/app/components/Navigation';
import { DashboardPage } from '@/app/routes/dashboard/DashboardPage';
// import { BacklogPage } from '@/app/routes/backlog/BacklogPage'; // TODO: Implement backlog feature
import { EditorPage } from '@/app/routes/editor/EditorPage';
import { MonitoringPage } from '@/app/routes/monitoring/MonitoringPage';
import { SettingsPage } from '@/app/routes/settings/SettingsPage';

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

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      <Navigation currentRoute={route} onNavigate={navigate} />
      <main className="flex-1 overflow-hidden" role="main">
        {route === 'dashboard' && <DashboardPage />}
        {/* {route === 'backlog' && <BacklogPage />} */}
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
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
