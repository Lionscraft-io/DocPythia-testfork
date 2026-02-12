import { Link } from 'wouter';
import { ThemeToggle } from './ThemeToggle';
import { Search, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfig } from '@/hooks/useConfig';

interface HeaderProps {
  onMenuClick?: () => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

export function Header({ onMenuClick, searchValue = '', onSearchChange }: HeaderProps) {
  const { data: config, isLoading } = useConfig();

  // Use default values while loading
  const projectName = config?.project.name || 'Loading...';
  const projectDescription = config?.project.description || '';
  const logoUrl = config?.branding.logo || '';

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center gap-4 px-6 md:px-8">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onMenuClick}
          data-testid="button-menu-toggle"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <Link href="/" className="flex items-center gap-3" data-testid="link-home">
          {logoUrl && !isLoading && (
            <img src={logoUrl} alt={`${projectName} Logo`} className="h-8 w-auto" />
          )}
          <div className="hidden sm:block">
            <div className="font-bold text-xl">{projectName}</div>
            <div className="text-xs text-muted-foreground -mt-1">{projectDescription}</div>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-6 flex-1">
          <Link
            href="/admin"
            className="text-sm font-medium text-muted-foreground hover-elevate px-3 py-2 rounded-md"
            data-testid="link-admin"
          >
            Admin
          </Link>
        </nav>

        <div className="flex flex-1 items-center justify-end gap-2">
          <div className="relative hidden sm:block max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search documentation..."
              className="pl-9"
              data-testid="input-search"
              value={searchValue}
              onChange={(e) => onSearchChange?.(e.target.value)}
            />
          </div>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
