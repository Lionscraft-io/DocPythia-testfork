/**
 * NodeTypeCard Component Tests

 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '../test-utils';
import { NodeTypeCard } from '../../../client/src/components/NodeTypeCard';
import { FileText } from 'lucide-react';

describe('NodeTypeCard', () => {
  const defaultProps = {
    title: 'Documentation',
    description: 'Browse and manage documentation sections',
    icon: FileText,
    href: '/docs',
  };

  it('should render title and description', () => {
    render(<NodeTypeCard {...defaultProps} />);

    expect(screen.getByText('Documentation')).toBeInTheDocument();
    expect(screen.getByText('Browse and manage documentation sections')).toBeInTheDocument();
  });

  it('should render view documentation button', () => {
    render(<NodeTypeCard {...defaultProps} />);

    const button = screen.getByTestId('button-view-documentation');
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('View Documentation');
  });

  it('should have correct link href', () => {
    render(<NodeTypeCard {...defaultProps} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/docs');
  });

  it('should generate testid from lowercase title', () => {
    render(<NodeTypeCard {...defaultProps} title="API Reference" />);

    expect(screen.getByTestId('button-view-api reference')).toBeInTheDocument();
  });

  it('should apply custom icon color when provided', () => {
    const { container } = render(<NodeTypeCard {...defaultProps} iconColor="text-chart-1" />);

    const iconContainer = container.querySelector('.text-chart-1');
    expect(iconContainer).toBeInTheDocument();
  });

  it('should use default icon color when not provided', () => {
    const { container } = render(<NodeTypeCard {...defaultProps} />);

    const iconContainer = container.querySelector('.text-primary');
    expect(iconContainer).toBeInTheDocument();
  });
});
