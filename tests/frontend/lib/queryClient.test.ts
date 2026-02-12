/**
 * Query Client Tests
 * Tests for API request utilities and query client configuration

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  apiRequest,
  adminApiRequest,
  getQueryFn,
  queryClient,
} from '../../../client/src/lib/queryClient';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock sessionStorage
const mockSessionStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};
Object.defineProperty(global, 'sessionStorage', { value: mockSessionStorage });

// Mock document.cookie for CSRF token
Object.defineProperty(document, 'cookie', {
  writable: true,
  value: '',
});

describe('apiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = '';
  });

  it('should make a GET request without body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
    });

    const result = await apiRequest('GET', '/api/test');

    expect(mockFetch).toHaveBeenCalledWith('/api/test', {
      method: 'GET',
      headers: {},
      body: undefined,
      credentials: 'include',
    });
    expect(result.status).toBe(200);
  });

  it('should make a POST request with JSON body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
    });

    const data = { name: 'Test' };
    const result = await apiRequest('POST', '/api/test', data);

    expect(mockFetch).toHaveBeenCalledWith('/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'include',
    });
    expect(result.status).toBe(201);
  });

  it('should include CSRF token for POST requests when cookie exists', async () => {
    document.cookie = 'docpythia_csrf_token=test-csrf-token';
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
    });

    const data = { name: 'Test' };
    await apiRequest('POST', '/api/test', data);

    expect(mockFetch).toHaveBeenCalledWith('/api/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'test-csrf-token',
      },
      body: JSON.stringify(data),
      credentials: 'include',
    });
  });

  it('should throw error on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: () => Promise.resolve('Invalid input'),
    });

    await expect(apiRequest('POST', '/api/test', {})).rejects.toThrow('400: Invalid input');
  });

  it('should use statusText when response body is empty', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve(''),
    });

    await expect(apiRequest('GET', '/api/test')).rejects.toThrow('500: Internal Server Error');
  });
});

describe('adminApiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = '';
  });

  it('should include Authorization header when token exists', async () => {
    mockSessionStorage.getItem.mockReturnValue('test-token');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
    });

    await adminApiRequest('GET', '/api/admin/test');

    expect(mockFetch).toHaveBeenCalledWith('/api/admin/test', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-token' },
      body: undefined,
      credentials: 'include',
    });
  });

  it('should make request without Authorization header when no token', async () => {
    mockSessionStorage.getItem.mockReturnValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
    });

    await adminApiRequest('GET', '/api/admin/test');

    expect(mockFetch).toHaveBeenCalledWith('/api/admin/test', {
      method: 'GET',
      headers: {},
      body: undefined,
      credentials: 'include',
    });
  });

  it('should include Content-Type and Authorization for POST with data', async () => {
    mockSessionStorage.getItem.mockReturnValue('admin-token');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
    });

    const data = { key: 'value' };
    await adminApiRequest('POST', '/api/admin/test', data);

    expect(mockFetch).toHaveBeenCalledWith('/api/admin/test', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      credentials: 'include',
    });
  });

  it('should throw session expired error on 401 when session check fails', async () => {
    mockSessionStorage.getItem.mockReturnValue(null);
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authenticated: false }),
      });

    await expect(adminApiRequest('GET', '/api/admin/test')).rejects.toThrow(
      'Session expired. Please login again.'
    );
  });

  it('should throw session expired error on 403 when session check fails', async () => {
    mockSessionStorage.getItem.mockReturnValue(null);
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authenticated: false }),
      });

    await expect(adminApiRequest('GET', '/api/admin/test')).rejects.toThrow(
      'Session expired. Please login again.'
    );
  });

  it('should throw regular error on 401 when session is still valid', async () => {
    mockSessionStorage.getItem.mockReturnValue('expired-token');
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Token expired'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ authenticated: true }),
      });

    await expect(adminApiRequest('GET', '/api/admin/test')).rejects.toThrow('401: Token expired');
  });
});

describe('getQueryFn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('with on401: returnNull', () => {
    it('should return null on 401 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
      });

      const queryFn = getQueryFn({ on401: 'returnNull' });
      const result = await queryFn({
        queryKey: ['/api/user'],
        signal: new AbortController().signal,
        meta: undefined,
      });

      expect(result).toBeNull();
    });

    it('should return parsed JSON on success', async () => {
      const mockData = { id: 1, name: 'Test' };
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockData),
      });

      const queryFn = getQueryFn({ on401: 'returnNull' });
      const result = await queryFn({
        queryKey: ['/api/user'],
        signal: new AbortController().signal,
        meta: undefined,
      });

      expect(result).toEqual(mockData);
    });
  });

  describe('with on401: throw', () => {
    it('should throw on 401 response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Not authenticated'),
      });

      const queryFn = getQueryFn({ on401: 'throw' });

      await expect(
        queryFn({
          queryKey: ['/api/user'],
          signal: new AbortController().signal,
          meta: undefined,
        })
      ).rejects.toThrow('401: Not authenticated');
    });
  });

  describe('with requiresAuth: true', () => {
    it('should include Authorization header when token exists', async () => {
      mockSessionStorage.getItem.mockReturnValue('auth-token');
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      const queryFn = getQueryFn({ on401: 'throw', requiresAuth: true });
      await queryFn({
        queryKey: ['/api/admin/data'],
        signal: new AbortController().signal,
        meta: undefined,
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/admin/data', {
        credentials: 'include',
        headers: { Authorization: 'Bearer auth-token' },
      });
    });

    it('should work without token when auth is disabled', async () => {
      mockSessionStorage.getItem.mockReturnValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'test' }),
      });

      const queryFn = getQueryFn({ on401: 'throw', requiresAuth: true });
      const result = await queryFn({
        queryKey: ['/api/admin/data'],
        signal: new AbortController().signal,
        meta: undefined,
      });

      expect(result).toEqual({ data: 'test' });
    });

    it('should throw session expired on 401 when requiresAuth and no token', async () => {
      mockSessionStorage.getItem.mockReturnValue(null);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve(''),
      });

      const queryFn = getQueryFn({ on401: 'throw', requiresAuth: true });

      await expect(
        queryFn({
          queryKey: ['/api/admin/data'],
          signal: new AbortController().signal,
          meta: undefined,
        })
      ).rejects.toThrow('Session expired. Please login again.');
    });

    it('should throw session expired on 403 when requiresAuth and no token', async () => {
      mockSessionStorage.getItem.mockReturnValue(null);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: () => Promise.resolve(''),
      });

      const queryFn = getQueryFn({ on401: 'throw', requiresAuth: true });

      await expect(
        queryFn({
          queryKey: ['/api/admin/data'],
          signal: new AbortController().signal,
          meta: undefined,
        })
      ).rejects.toThrow('Session expired. Please login again.');
    });
  });

  it('should join queryKey parts to form URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    const queryFn = getQueryFn({ on401: 'throw' });
    await queryFn({
      queryKey: ['/api', 'users', '123'],
      signal: new AbortController().signal,
      meta: undefined,
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/users/123', expect.any(Object));
  });
});

describe('queryClient', () => {
  it('should be configured correctly', () => {
    const defaultOptions = queryClient.getDefaultOptions();

    expect(defaultOptions.queries?.refetchInterval).toBe(false);
    expect(defaultOptions.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaultOptions.queries?.staleTime).toBe(Infinity);
    expect(defaultOptions.queries?.retry).toBe(false);
    expect(defaultOptions.mutations?.retry).toBe(false);
  });
});
