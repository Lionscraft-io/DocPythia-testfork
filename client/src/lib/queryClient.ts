import { QueryClient, QueryFunction } from '@tanstack/react-query';
import { getCsrfHeaders, requiresCsrf } from '@/hooks/useCsrf';

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

/**
 * Make an API request with proper credentials and CSRF protection
 */
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(data ? { 'Content-Type': 'application/json' } : {}),
    ...(requiresCsrf(method) ? getCsrfHeaders() : {}),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: 'include', // Send cookies with request
  });

  await throwIfResNotOk(res);
  return res;
}

/**
 * Make an admin API request with session-based auth
 * Now uses httpOnly cookies for authentication (no more Bearer tokens)
 */
export async function adminApiRequest(
  method: string,
  url: string,
  data?: unknown | undefined
): Promise<Response> {
  // Legacy: check for Bearer token fallback (for API-to-API calls)
  const adminToken = sessionStorage.getItem('admin_token');

  const headers: Record<string, string> = {
    ...(data ? { 'Content-Type': 'application/json' } : {}),
    ...(requiresCsrf(method) ? getCsrfHeaders() : {}),
    // Include Bearer token if present (legacy/API fallback)
    ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: 'include', // Send cookies with request
  });

  // If we get 401/403, auth is required
  if (res.status === 401 || res.status === 403) {
    // Check if we have session - if not, redirect to login
    const sessionCheck = await fetch('/api/auth/session', { credentials: 'include' });
    const session = await sessionCheck.json();
    if (!session.authenticated) {
      throw new Error('Session expired. Please login again.');
    }
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = 'returnNull' | 'throw';
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
  requiresAuth?: boolean;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior, requiresAuth = false }) =>
  async ({ queryKey }) => {
    const url = queryKey.join('/') as string;

    // Legacy: check for Bearer token fallback
    const adminToken = sessionStorage.getItem('admin_token');
    const headers: Record<string, string> = {};

    if (requiresAuth && adminToken) {
      headers['Authorization'] = `Bearer ${adminToken}`;
    }

    const res = await fetch(url, {
      credentials: 'include', // Send cookies with request
      headers,
    });

    if (unauthorizedBehavior === 'returnNull' && res.status === 401) {
      return null;
    }

    // If we get 401/403 and requiresAuth, check session
    if ((res.status === 401 || res.status === 403) && requiresAuth) {
      throw new Error('Session expired. Please login again.');
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: 'throw' }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
