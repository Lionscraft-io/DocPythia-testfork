/**
 * AdminLogin Page Tests

 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test-utils';
import AdminLogin from '../../../client/src/pages/AdminLogin';

// Mock wouter
const mockSetLocation = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/login', mockSetLocation],
  useParams: () => ({}),
}));

// Mock useConfig
vi.mock('../../../client/src/hooks/useConfig', () => ({
  useConfig: vi.fn(() => ({
    data: {
      project: {
        name: 'Test Project',
      },
      branding: {
        logo: '/logo.png',
        favicon: '/favicon.ico',
      },
    },
    isLoading: false,
  })),
}));

// Mock useToast
const mockToast = vi.fn();
vi.mock('../../../client/src/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

describe('AdminLogin Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    global.fetch = vi.fn();
  });

  it('should render login form', () => {
    render(<AdminLogin />);

    expect(screen.getByText('Lionscraft AI Docs')).toBeInTheDocument();
    expect(
      screen.getByText('Enter your password to access the admin dashboard')
    ).toBeInTheDocument();
  });

  it('should render password input', () => {
    render(<AdminLogin />);

    const passwordInput = screen.getByTestId('input-admin-password');
    expect(passwordInput).toBeInTheDocument();
    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(passwordInput).toHaveAttribute('placeholder', 'Enter your admin password');
  });

  it('should render login button', () => {
    render(<AdminLogin />);

    const loginButton = screen.getByTestId('button-login');
    expect(loginButton).toBeInTheDocument();
    expect(loginButton).toHaveTextContent('Access Dashboard');
  });

  it('should update password input value', () => {
    render(<AdminLogin />);

    const passwordInput = screen.getByTestId('input-admin-password');
    fireEvent.change(passwordInput, { target: { value: 'testpassword' } });
    expect(passwordInput).toHaveValue('testpassword');
  });

  it('should show error toast for empty password', async () => {
    render(<AdminLogin />);

    const form = screen.getByTestId('button-login').closest('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Please enter a password',
        variant: 'destructive',
      });
    });
  });

  it('should call fetch on form submit', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ success: false, error: 'Invalid password' }),
    });

    render(<AdminLogin />);

    const passwordInput = screen.getByTestId('input-admin-password');
    fireEvent.change(passwordInput, { target: { value: 'testpassword' } });

    const form = screen.getByTestId('button-login').closest('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'testpassword' }),
        })
      );
    });
  });

  it('should show loading state during authentication', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                json: () => Promise.resolve({ success: false }),
              }),
            100
          )
        )
    );

    render(<AdminLogin />);

    const passwordInput = screen.getByTestId('input-admin-password');
    fireEvent.change(passwordInput, { target: { value: 'testpassword' } });

    const loginButton = screen.getByTestId('button-login');
    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(screen.getByText('Authenticating...')).toBeInTheDocument();
    });
  });

  it('should handle successful login', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          success: true,
          instanceId: 'projecta',
          redirectUrl: '/projecta/admin',
        }),
    });

    render(<AdminLogin />);

    const passwordInput = screen.getByTestId('input-admin-password');
    fireEvent.change(passwordInput, { target: { value: 'correctpassword' } });

    const form = screen.getByTestId('button-login').closest('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Login successful',
        })
      );
    });

    // Session-based auth stores admin_token for hybrid auth support
    expect(sessionStorage.getItem('admin_token')).toBe('correctpassword');
    expect(sessionStorage.getItem('admin_instance')).toBe('projecta');
  });

  it('should show error toast on login failure', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      json: () => Promise.resolve({ success: false, error: 'Wrong password' }),
    });

    render(<AdminLogin />);

    const passwordInput = screen.getByTestId('input-admin-password');
    fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });

    const form = screen.getByTestId('button-login').closest('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Login failed',
        description: 'Wrong password',
        variant: 'destructive',
      });
    });
  });
});
