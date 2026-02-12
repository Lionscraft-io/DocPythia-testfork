import { Link } from 'wouter';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

interface NodeTypeCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  iconColor?: string;
}

export function NodeTypeCard({
  title,
  description,
  icon: Icon,
  href,
  iconColor = 'text-primary',
}: NodeTypeCardProps) {
  return (
    <Card className="hover-elevate transition-all">
      <CardHeader>
        <div
          className={`mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 ${iconColor}`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="min-h-[3rem]">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link href={href}>
          <Button
            variant="ghost"
            className="group"
            data-testid={`button-view-${title.toLowerCase()}`}
          >
            View Documentation
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
