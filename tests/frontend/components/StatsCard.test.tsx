/**
 * StatsCard Component Tests

 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '../test-utils';
import { StatsCard } from '../../../client/src/components/StatsCard';
import { Activity } from 'lucide-react';

describe('StatsCard', () => {
  it('should render title and value', () => {
    render(<StatsCard title="Total Messages" value={1234} icon={Activity} />);

    expect(screen.getByText('Total Messages')).toBeInTheDocument();
    expect(screen.getByTestId('stat-value-total-messages')).toHaveTextContent('1234');
  });

  it('should render string value correctly', () => {
    render(<StatsCard title="Status" value="Active" icon={Activity} />);

    expect(screen.getByTestId('stat-value-status')).toHaveTextContent('Active');
  });

  it('should render description when provided', () => {
    render(<StatsCard title="Messages" value={100} icon={Activity} description="Last 24 hours" />);

    expect(screen.getByTestId('stat-description')).toHaveTextContent('Last 24 hours');
  });

  it('should not render description when not provided', () => {
    render(<StatsCard title="Messages" value={100} icon={Activity} />);

    expect(screen.queryByTestId('stat-description')).not.toBeInTheDocument();
  });

  it('should render positive trend correctly', () => {
    render(
      <StatsCard
        title="Growth"
        value="15%"
        icon={Activity}
        trend={{ value: '+5%', positive: true }}
      />
    );

    const trend = screen.getByTestId('stat-trend');
    expect(trend).toHaveTextContent('+5%');
    expect(trend.textContent).toContain('↑');
  });

  it('should render negative trend correctly', () => {
    render(
      <StatsCard
        title="Errors"
        value={23}
        icon={Activity}
        trend={{ value: '-10%', positive: false }}
      />
    );

    const trend = screen.getByTestId('stat-trend');
    expect(trend).toHaveTextContent('-10%');
    expect(trend.textContent).toContain('↓');
  });

  it('should not render trend when not provided', () => {
    render(<StatsCard title="Count" value={50} icon={Activity} />);

    expect(screen.queryByTestId('stat-trend')).not.toBeInTheDocument();
  });
});
