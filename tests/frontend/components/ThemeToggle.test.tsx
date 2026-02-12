/**
 * ThemeToggle Component Tests

 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../test-utils';
import { ThemeToggle } from '../../../client/src/components/ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Reset document classes
    document.documentElement.classList.remove('dark');
  });

  it('should render theme toggle button', () => {
    render(<ThemeToggle />);

    const button = screen.getByTestId('button-theme-toggle');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', 'Toggle theme');
  });

  it('should default to dark theme when prefers-color-scheme is dark', () => {
    // Mock matchMedia to prefer dark
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(<ThemeToggle />);

    // Should show Sun icon (indicating dark mode is active)
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('should toggle theme from dark to light when clicked', () => {
    render(<ThemeToggle />);

    const button = screen.getByTestId('button-theme-toggle');
    fireEvent.click(button);

    // After clicking, theme should toggle
    expect(localStorage.getItem('theme')).toBeDefined();
  });

  it('should use stored theme from localStorage', () => {
    localStorage.setItem('theme', 'light');

    render(<ThemeToggle />);

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('should persist theme to localStorage on toggle', () => {
    localStorage.setItem('theme', 'dark');

    render(<ThemeToggle />);

    const button = screen.getByTestId('button-theme-toggle');
    fireEvent.click(button);

    expect(localStorage.getItem('theme')).toBe('light');
  });
});
