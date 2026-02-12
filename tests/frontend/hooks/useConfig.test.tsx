/**
 * useConfig Hook Tests

 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { useConfig } from '../../../client/src/hooks/useConfig';

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
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useConfig Hook', () => {
  const mockConfig = {
    project: {
      name: 'Test Project',
      shortName: 'TP',
      description: 'Test Description',
    },
    branding: {
      logo: '/logo.png',
      primaryColor: '#000000',
      projectUrl: 'https://test.com',
    },
    widget: {
      enabled: true,
      title: 'Test Widget',
      welcomeMessage: 'Welcome',
      suggestedQuestions: [],
      position: 'bottom-right' as const,
      theme: 'light' as const,
    },
    features: {
      chatEnabled: true,
      versionHistoryEnabled: true,
    },
    repository: {
      targetRepo: 'test/repo',
      sourceRepo: 'test/source',
      baseBranch: 'main',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch config successfully', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });

    const { result } = renderHook(() => useConfig(), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockConfig);
  });

  it('should call fetch with correct URL', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });

    renderHook(() => useConfig(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/config');
    });
  });
});
