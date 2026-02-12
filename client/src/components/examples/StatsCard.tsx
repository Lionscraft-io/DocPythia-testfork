import { StatsCard } from '../StatsCard';
import { FileText } from 'lucide-react';

export default function StatsCardExample() {
  return (
    <div className="max-w-xs">
      <StatsCard
        title="Total Updates"
        value={142}
        icon={FileText}
        description="This month"
        trend={{ value: '12%', positive: true }}
      />
    </div>
  );
}
