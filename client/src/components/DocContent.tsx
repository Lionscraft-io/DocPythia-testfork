import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info, AlertTriangle, CheckCircle2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface DocSection {
  id: string;
  title: string;
  content: string;
  level?: number;
  type?: 'text' | 'info' | 'warning' | 'success';
}

interface DocContentProps {
  sections: DocSection[];
}

export function DocContent({ sections }: DocContentProps) {
  const getAlertIcon = (type?: string) => {
    switch (type) {
      case 'warning':
        return <AlertTriangle className="h-4 w-4" />;
      case 'success':
        return <CheckCircle2 className="h-4 w-4" />;
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  const getAlertVariant = (type?: string): 'default' | 'destructive' => {
    return type === 'warning' ? 'destructive' : 'default';
  };

  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none space-y-6">
      {sections.map((section) => (
        <div key={section.id} id={section.id}>
          {section.type && section.type !== 'text' ? (
            <Alert variant={getAlertVariant(section.type)} className="my-4">
              {getAlertIcon(section.type)}
              <AlertTitle>{section.title}</AlertTitle>
              <AlertDescription className="whitespace-pre-line leading-relaxed">
                {section.content}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {section.level === 1 && (
                <h1
                  className="text-3xl font-bold tracking-tight"
                  data-testid={`heading-${section.id}`}
                >
                  {section.title}
                </h1>
              )}
              {section.level === 2 && (
                <h2
                  className="text-2xl font-semibold tracking-tight"
                  data-testid={`heading-${section.id}`}
                >
                  {section.title}
                </h2>
              )}
              {section.level === 3 && (
                <h3 className="text-xl font-semibold" data-testid={`heading-${section.id}`}>
                  {section.title}
                </h3>
              )}
              {section.content && (
                <div
                  className="leading-relaxed text-foreground"
                  data-testid={`content-${section.id}`}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.content}</ReactMarkdown>
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
