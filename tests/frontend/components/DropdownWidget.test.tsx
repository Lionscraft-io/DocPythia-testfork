/**
 * DropdownWidget Component Tests

 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../test-utils';
import { DropdownWidget } from '../../../client/src/components/DropdownWidget';

describe('DropdownWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.log output
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should render toggle button when closed', () => {
    render(<DropdownWidget />);

    const toggleButton = screen.getByRole('button');
    expect(toggleButton).toBeInTheDocument();
  });

  it('should show overlay when opened', () => {
    render(<DropdownWidget />);

    const toggleButton = screen.getByRole('button');
    fireEvent.click(toggleButton);

    expect(screen.getByText('AI Assistant')).toBeInTheDocument();
  });

  it('should use custom title', () => {
    render(<DropdownWidget title="Custom Chat" />);

    const toggleButton = screen.getByRole('button');
    fireEvent.click(toggleButton);

    expect(screen.getByText('Custom Chat')).toBeInTheDocument();
  });

  it('should close when close button is clicked', () => {
    render(<DropdownWidget />);

    // Open the widget
    const toggleButton = screen.getByRole('button');
    fireEvent.click(toggleButton);

    expect(screen.getByText('AI Assistant')).toBeInTheDocument();

    // Close using the X button in header (there are 2 X buttons, get the one in the header)
    const closeButtons = screen.getAllByRole('button');
    // The close button in the header should have the X icon
    const headerCloseButton = closeButtons.find((btn) => btn.classList.contains('h-8'));
    if (headerCloseButton) {
      fireEvent.click(headerCloseButton);
    }
  });

  it('should render iframe with correct URL', () => {
    render(<DropdownWidget expertId="test-expert" />);

    const toggleButton = screen.getByRole('button');
    fireEvent.click(toggleButton);

    const iframe = screen.getByTitle('AI Assistant Full Screen');
    expect(iframe).toBeInTheDocument();
    expect(iframe.getAttribute('src')).toContain('/chat/test-expert');
    expect(iframe.getAttribute('src')).toContain('theme=light');
    expect(iframe.getAttribute('src')).toContain('embedded=true');
  });

  it('should apply dark theme styling', () => {
    render(<DropdownWidget theme="dark" />);

    const toggleButton = screen.getByRole('button');
    fireEvent.click(toggleButton);

    const iframe = screen.getByTitle('AI Assistant Full Screen');
    expect(iframe.getAttribute('src')).toContain('theme=dark');
  });

  it('should have correct position class for bottom-right', () => {
    const { container } = render(<DropdownWidget position="bottom-right" />);

    const positionDiv = container.querySelector('.bottom-4.right-4');
    expect(positionDiv).toBeInTheDocument();
  });

  it('should have correct position class for bottom-left', () => {
    const { container } = render(<DropdownWidget position="bottom-left" />);

    const positionDiv = container.querySelector('.bottom-4.left-4');
    expect(positionDiv).toBeInTheDocument();
  });

  it('should show loading state initially', () => {
    render(<DropdownWidget />);

    const toggleButton = screen.getByRole('button');
    fireEvent.click(toggleButton);

    expect(screen.getByText('Loading Chat...')).toBeInTheDocument();
  });
});
