/**
 * Logout Page Tests

 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '../test-utils';
import Logout from '../../../client/src/pages/Logout';

// Mock wouter
const mockSetLocation = vi.fn();
vi.mock('wouter', () => ({
  useLocation: () => ['/logout', mockSetLocation],
}));

describe('Logout Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up session storage items to be cleared
    sessionStorage.setItem('admin_password', 'testpassword');
    sessionStorage.setItem('admin_instance', 'test');
    sessionStorage.setItem('admin_token', 'testtoken');
  });

  it('should render logout message', () => {
    render(<Logout />);

    expect(screen.getByText('Logging out...')).toBeInTheDocument();
    expect(screen.getByText('Redirecting to login page...')).toBeInTheDocument();
  });

  it('should clear session storage on mount', async () => {
    render(<Logout />);

    await waitFor(() => {
      expect(sessionStorage.getItem('admin_password')).toBeNull();
      expect(sessionStorage.getItem('admin_instance')).toBeNull();
      expect(sessionStorage.getItem('admin_token')).toBeNull();
    });
  });

  it('should redirect to login page', async () => {
    render(<Logout />);

    // The redirect happens after 100ms timeout
    await waitFor(
      () => {
        expect(mockSetLocation).toHaveBeenCalledWith('/login');
      },
      { timeout: 500 }
    );
  });
});
