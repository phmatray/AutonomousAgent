import { useQuery } from '@tanstack/react-query';
import { isInitialized, type InitializationState } from '@/lib/api/system';

/**
 * Polls the backend for initialization status until all subsystems are ready.
 * Once fully initialized, polling stops automatically.
 */
export function useInitializationStatus() {
  const query = useQuery<InitializationState>({
    queryKey: ['initialization-status'],
    queryFn: isInitialized,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.database && data?.github_auth_attempted) {
        return false; // Stop polling once fully initialized
      }
      return 500; // Poll every 500ms while initializing
    },
    retry: 3,
  });

  const isFullyInitialized =
    query.data?.database === true &&
    query.data?.github_auth_attempted === true;

  return {
    ...query,
    isFullyInitialized,
  };
}
