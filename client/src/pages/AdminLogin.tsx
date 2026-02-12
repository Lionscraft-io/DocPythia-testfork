import { useState, useEffect } from 'react';
import { useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Shield, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useConfig } from '@/hooks/useConfig';
import { setCsrfTokenCache } from '@/hooks/useCsrf';

export default function AdminLogin() {
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const params = useParams();
  const { data: config } = useConfig();

  // Determine if this is generic login or instance-specific
  const isGenericLogin = !params.instance;
  const instanceName = params.instance
    ? config?.project.name || params.instance.toUpperCase()
    : 'Lionscraft AI Docs';

  // Update document title and favicon based on route
  useEffect(() => {
    if (isGenericLogin) {
      document.title = 'Login - Lionscraft AI Docs';

      // Update favicon to ico.png
      const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
      if (favicon) {
        favicon.href = '/ico.png';
      } else {
        const newFavicon = document.createElement('link');
        newFavicon.rel = 'icon';
        newFavicon.href = '/ico.png';
        document.head.appendChild(newFavicon);
      }
    } else if (config) {
      document.title = `Login - ${config.project.name}`;

      // Update favicon to instance-specific, fall back to default
      const faviconHref = config.branding.favicon || '/ico.png';
      const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
      if (favicon) {
        favicon.href = faviconHref;
      } else {
        const newFavicon = document.createElement('link');
        newFavicon.rel = 'icon';
        newFavicon.href = faviconHref;
        document.head.appendChild(newFavicon);
      }
    }
  }, [isGenericLogin, config]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a password',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      // If we're on an instance-specific login page, include the instance
      const loginPayload: { password: string; instanceId?: string } = {
        password: password.trim(),
      };
      if (params.instance) {
        loginPayload.instanceId = params.instance;
      }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(loginPayload),
        credentials: 'include', // Important: receive and store cookies
      });

      const data = await response.json();

      if (data.success && data.instanceId) {
        // Store CSRF token in cache for immediate use
        if (data.csrfToken) {
          setCsrfTokenCache(data.csrfToken);
        }

        // Store instance for legacy compatibility (some components still read this)
        sessionStorage.setItem('admin_instance', data.instanceId);
        // Keep password for Bearer token fallback (hybrid auth support)
        sessionStorage.setItem('admin_token', password.trim());

        // Clear all cached queries to prevent showing stale data from previous user
        queryClient.clear();

        toast({
          title: 'Login successful',
          description: `Redirecting to ${data.instanceId.toUpperCase()} admin panel...`,
        });

        // Redirect to instance-specific admin
        setTimeout(() => {
          setLocation(data.redirectUrl || `/${data.instanceId}/admin`);
        }, 500);
      } else {
        toast({
          title: 'Login failed',
          description: data.error || 'Invalid password',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Login error:', error);
      toast({
        title: 'Error',
        description: 'Failed to connect to server',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            {isGenericLogin ? (
              <img
                src="/Black.png"
                alt="Lionscraft AI Docs"
                className="h-16 w-auto object-contain"
              />
            ) : config?.branding.logo ? (
              <img
                src={config.branding.logo}
                alt={config.project.name}
                className="h-16 w-auto object-contain"
              />
            ) : (
              <Shield className="h-12 w-12 text-primary" />
            )}
          </div>
          <CardTitle>{instanceName}</CardTitle>
          <CardDescription>Enter your password to access the admin dashboard</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Admin Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your admin password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="input-admin-password"
                disabled={isLoading}
                required
                autoFocus
              />
            </div>
            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="button-login"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Authenticating...
                </>
              ) : (
                'Access Dashboard'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
