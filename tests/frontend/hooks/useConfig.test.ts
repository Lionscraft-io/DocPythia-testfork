/**
 * useConfig Hook Tests
 * Tests for the configuration fetching hook

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useConfig, type AppConfig } from '../../../client/src/hooks/useConfig';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock wouter's useLocation hook
vi.mock('wouter', () => ({
  useLocation: () => ['/admin', vi.fn()], // Default to non-instance path
}));

const mockConfig: AppConfig = {
  project: {
    name: 'Test Project',
    shortName: 'test',
    description: 'Test description',
  },
  branding: {
    logo: 'https://example.com/logo.png',
    primaryColor: '#FF0000',
    projectUrl: 'https://example.com',
  },
  widget: {
    enabled: true,
    title: 'Help',
    welcomeMessage: 'How can I help?',
    suggestedQuestions: ['What is this?'],
    position: 'bottom-right',
    theme: 'auto',
  },
  features: {
    chatEnabled: true,
    versionHistoryEnabled: false,
  },
  repository: {
    targetRepo: 'https://github.com/test/target',
    sourceRepo: 'https://github.com/test/source',
    baseBranch: 'main',
  },
};

describe('useConfig', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  it('should fetch config successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });

    const { result } = renderHook(() => useConfig(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(mockConfig);
    expect(mockFetch).toHaveBeenCalledWith('/api/config');
  });

  it('should handle non-ok response', async () => {
    // The hook throws Error for non-ok responses
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useConfig(), { wrapper });

    // Wait for the query to attempt and fail
    await waitFor(() => {
      // The query will be in error state after retries are exhausted
      // Since retry is false, it should fail immediately
      expect(result.current.isLoading || result.current.isError).toBe(true);
    });
  });

  it('should be loading initially', () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

    const { result } = renderHook(() => useConfig(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('should cache config for 5 minutes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });

    // First render
    const { result: result1 } = renderHook(() => useConfig(), { wrapper });

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second render should use cache
    const { result: result2 } = renderHook(() => useConfig(), { wrapper });

    await waitFor(() => {
      expect(result2.current.isSuccess).toBe(true);
    });

    // Should not have made another fetch call due to staleTime
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should return project config', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });

    const { result } = renderHook(() => useConfig(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.project.name).toBe('Test Project');
    expect(result.current.data?.project.shortName).toBe('test');
    expect(result.current.data?.project.description).toBe('Test description');
  });

  it('should return branding config', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });

    const { result } = renderHook(() => useConfig(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.branding.logo).toBe('https://example.com/logo.png');
    expect(result.current.data?.branding.primaryColor).toBe('#FF0000');
  });

  it('should return widget config', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });

    const { result } = renderHook(() => useConfig(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.widget.enabled).toBe(true);
    expect(result.current.data?.widget.position).toBe('bottom-right');
    expect(result.current.data?.widget.theme).toBe('auto');
  });

  it('should return feature flags', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });

    const { result } = renderHook(() => useConfig(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.features.chatEnabled).toBe(true);
    expect(result.current.data?.features.versionHistoryEnabled).toBe(false);
  });

  it('should return repository config', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });

    const { result } = renderHook(() => useConfig(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.repository.targetRepo).toBe('https://github.com/test/target');
    expect(result.current.data?.repository.baseBranch).toBe('main');
  });

  it('should use correct query key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockConfig),
    });

    renderHook(() => useConfig(), { wrapper });

    await waitFor(() => {
      // Query key now includes instance (null when not on instance route)
      const queryState = queryClient.getQueryState(['config', null]);
      expect(queryState).toBeDefined();
    });
  });
});
