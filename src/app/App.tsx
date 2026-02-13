import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen w-full items-center justify-center bg-gray-900">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-4">
            Autonomous Agent
          </h1>
          <p className="text-gray-400">
            AI-powered autonomous developer system
          </p>
        </div>
      </div>
    </QueryClientProvider>
  );
}

export default App;
