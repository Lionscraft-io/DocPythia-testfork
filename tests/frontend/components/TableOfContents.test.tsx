/**
 * TableOfContents Component Tests

 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '../test-utils';
import { TableOfContents } from '../../../client/src/components/TableOfContents';

describe('TableOfContents', () => {
  const mockItems = [
    { id: 'intro', title: 'Introduction', level: 1 },
    { id: 'setup', title: 'Setup', level: 2 },
    { id: 'config', title: 'Configuration', level: 3 },
    { id: 'usage', title: 'Usage', level: 2 },
  ];

  it('should render title', () => {
    render(<TableOfContents items={mockItems} />);

    expect(screen.getByText('On This Page')).toBeInTheDocument();
  });

  it('should render all toc items', () => {
    render(<TableOfContents items={mockItems} />);

    expect(screen.getByTestId('link-toc-intro')).toHaveTextContent('Introduction');
    expect(screen.getByTestId('link-toc-setup')).toHaveTextContent('Setup');
    expect(screen.getByTestId('link-toc-config')).toHaveTextContent('Configuration');
    expect(screen.getByTestId('link-toc-usage')).toHaveTextContent('Usage');
  });

  it('should have correct href for each item', () => {
    render(<TableOfContents items={mockItems} />);

    expect(screen.getByTestId('link-toc-intro')).toHaveAttribute('href', '#intro');
    expect(screen.getByTestId('link-toc-setup')).toHaveAttribute('href', '#setup');
  });

  it('should highlight active item', () => {
    render(<TableOfContents items={mockItems} activeId="setup" />);

    const activeItem = screen.getByTestId('link-toc-setup');
    expect(activeItem).toHaveClass('text-primary');
  });

  it('should apply correct styling for level 1 items', () => {
    render(<TableOfContents items={mockItems} />);

    const level1Item = screen.getByTestId('link-toc-intro');
    expect(level1Item).toHaveClass('font-bold');
  });

  it('should apply correct styling for level 2 items', () => {
    render(<TableOfContents items={mockItems} />);

    const level2Item = screen.getByTestId('link-toc-setup');
    expect(level2Item).toHaveClass('pl-4');
    expect(level2Item).toHaveClass('font-medium');
  });

  it('should apply correct styling for level 3 items', () => {
    render(<TableOfContents items={mockItems} />);

    const level3Item = screen.getByTestId('link-toc-config');
    expect(level3Item).toHaveClass('pl-8');
  });

  it('should render empty list when no items', () => {
    render(<TableOfContents items={[]} />);

    expect(screen.getByText('On This Page')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
