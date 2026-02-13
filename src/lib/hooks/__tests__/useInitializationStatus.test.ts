import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { useInitializationStatus } from '../useInitializationStatus';
import { mockInvoke } from '@/test/mocks/tauri';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
  vi.useRealTimers();
});

describe('useInitializationStatus', () => {
  it('should return loading state initially', () => {
    mockInvoke.mockResolvedValue({ database: false, github_auth_attempted: false });

    const { result } = renderHook(() => useInitializationStatus(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isFullyInitialized).toBe(false);
  });

  it('should return not fully initialized when database is false', async () => {
    mockInvoke.mockResolvedValue({ database: false, github_auth_attempted: true });

    const { result } = renderHook(() => useInitializationStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isFullyInitialized).toBe(false);
    expect(result.current.data).toEqual({ database: false, github_auth_attempted: true });
  });

  it('should return not fully initialized when github_auth_attempted is false', async () => {
    mockInvoke.mockResolvedValue({ database: true, github_auth_attempted: false });

    const { result } = renderHook(() => useInitializationStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isFullyInitialized).toBe(false);
  });

  it('should return fully initialized when both fields are true', async () => {
    mockInvoke.mockResolvedValue({ database: true, github_auth_attempted: true });

    const { result } = renderHook(() => useInitializationStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isFullyInitialized).toBe(true);
    });

    expect(result.current.data).toEqual({ database: true, github_auth_attempted: true });
  });

  it('should call is_initialized via invoke', async () => {
    mockInvoke.mockResolvedValue({ database: true, github_auth_attempted: true });

    renderHook(() => useInitializationStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('is_initialized');
    });
  });

  it('should not report fully initialized when query fails', async () => {
    // Even if the query fails, isFullyInitialized should remain false.
    // The hook's retry: 3 and refetchInterval: 500 make it hard to reach
    // a terminal error state, but isFullyInitialized should always be false
    // when there's no successful data.
    mockInvoke.mockRejectedValue(new Error('backend not ready'));

    const { result } = renderHook(() => useInitializationStatus(), {
      wrapper: createWrapper(),
    });

    // Wait for at least one query attempt
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalled();
    });

    // Even after failed queries, isFullyInitialized must be false
    expect(result.current.isFullyInitialized).toBe(false);
    expect(result.current.data).toBeUndefined();
  });
});
