import { Switch, Route, Redirect } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import Admin from '@/pages/Admin';
import AdminAdvanced from '@/pages/AdminAdvanced';
import AdminLogin from '@/pages/AdminLogin';
import AdminLegacy from '@/pages/AdminLegacy';
import PromptsOverview from '@/pages/PromptsOverview';
import RulesetEditor from '@/pages/RulesetEditor';
import PipelineDebugger from '@/pages/PipelineDebugger';
import Logout from '@/pages/Logout';
import NotFound from '@/pages/not-found';
import { useConfig } from '@/hooks/useConfig';
import { useEffect } from 'react';

function Router() {
  return (
    <Switch>
      <Route path="/">
        <Redirect to="/login" />
      </Route>
      <Route path="/login" component={AdminLogin} />
      <Route path="/logout" component={Logout} />
      <Route path="/:instance/admin/login" component={AdminLogin} />
      <Route path="/:instance/admin/advanced" component={AdminAdvanced} />
      <Route path="/:instance/admin/legacy" component={AdminLegacy} />
      <Route path="/:instance/admin/prompts" component={PromptsOverview} />
      <Route path="/:instance/admin/ruleset" component={RulesetEditor} />
      <Route path="/:instance/admin/pipeline" component={PipelineDebugger} />
      <Route path="/:instance/admin" component={Admin} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const { data: config } = useConfig();

  // Update document title and meta tags when config loads
  useEffect(() => {
    // Only update if we're not on the login page (let AdminLogin handle it)
    const isLoginPage =
      window.location.pathname === '/login' || window.location.pathname.endsWith('/admin/login');

    if (config && !isLoginPage) {
      // Update document title
      document.title = config.project.name;

      // Update meta description
      const metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription) {
        metaDescription.setAttribute('content', config.project.description);
      }

      // Update favicon — use config value or fall back to default
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
  }, [config]);

  return (
    <>
      <Toaster />
      <Router />
      {/* AI Conversation Widget - Temporarily disabled */}
      {/* {config?.widget.enabled && (
        <DropdownWidget
          title={config.widget.title}
          expertId="5"
          domain={import.meta.env.VITE_WIDGET_DOMAIN || "http://localhost:5173"}
          theme={config.widget.theme}
          position={config.widget.position}
        />
      )} */}
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
