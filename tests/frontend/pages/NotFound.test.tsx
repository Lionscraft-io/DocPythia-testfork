/**
 * NotFound Page Tests

 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '../test-utils';
import NotFound from '../../../client/src/pages/not-found';

describe('NotFound Page', () => {
  it('should render 404 heading', () => {
    render(<NotFound />);

    expect(screen.getByText('404 Page Not Found')).toBeInTheDocument();
  });

  it('should render helpful message', () => {
    render(<NotFound />);

    expect(screen.getByText('Did you forget to add the page to the router?')).toBeInTheDocument();
  });
});
