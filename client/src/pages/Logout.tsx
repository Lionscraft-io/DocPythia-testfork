import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';

export default function Logout() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    const performLogout = async () => {
      try {
        // Call logout endpoint to clear server-side session cookies
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
        });
      } catch (error) {
        console.error('Logout error:', error);
      }

      // Clear all session storage (legacy cleanup)
      sessionStorage.removeItem('admin_password');
      sessionStorage.removeItem('admin_instance');
      sessionStorage.removeItem('admin_token');
      sessionStorage.clear();

      // Clear all cached queries
      queryClient.clear();

      // Redirect to login page
      setTimeout(() => {
        setLocation('/login');
      }, 100);
    };

    performLogout();
  }, [setLocation, queryClient]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Logging out...</h2>
        <p className="text-gray-600">Redirecting to login page...</p>
      </div>
    </div>
  );
}
