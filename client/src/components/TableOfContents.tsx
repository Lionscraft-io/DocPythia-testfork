import { cn } from '@/lib/utils';

interface TocItem {
  id: string;
  title: string;
  level: number;
}

interface TableOfContentsProps {
  items: TocItem[];
  activeId?: string;
}

export function TableOfContents({ items, activeId }: TableOfContentsProps) {
  return (
    <div className="space-y-2">
      <p className="font-semibold text-sm mb-3">On This Page</p>
      <nav className="space-y-1">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={cn(
              'block text-sm hover-elevate rounded-md px-2 py-1.5 transition-colors',
              item.level === 1 && 'font-bold',
              item.level === 2 && 'pl-4 font-medium',
              item.level === 3 && 'pl-8',
              activeId === item.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
            data-testid={`link-toc-${item.id}`}
          >
            {item.title}
          </a>
        ))}
      </nav>
    </div>
  );
}
