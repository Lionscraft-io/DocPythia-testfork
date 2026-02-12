/**
 * Header Component Tests

 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../test-utils';
import { Header } from '../../../client/src/components/Header';

// Mock the useConfig hook
vi.mock('../../../client/src/hooks/useConfig', () => ({
  useConfig: vi.fn(() => ({
    data: {
      project: {
        name: 'Test Project',
        description: 'Test Description',
      },
      branding: {
        logo: '/logo.png',
      },
    },
    isLoading: false,
  })),
}));

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render project name and description', () => {
    render(<Header />);

    expect(screen.getByText('Test Project')).toBeInTheDocument();
    expect(screen.getByText('Test Description')).toBeInTheDocument();
  });

  it('should render menu toggle button', () => {
    render(<Header />);

    const menuButton = screen.getByTestId('button-menu-toggle');
    expect(menuButton).toBeInTheDocument();
  });

  it('should call onMenuClick when menu button is clicked', () => {
    const onMenuClick = vi.fn();
    render(<Header onMenuClick={onMenuClick} />);

    fireEvent.click(screen.getByTestId('button-menu-toggle'));
    expect(onMenuClick).toHaveBeenCalled();
  });

  it('should render home link', () => {
    render(<Header />);

    const homeLink = screen.getByTestId('link-home');
    expect(homeLink).toHaveAttribute('href', '/');
  });

  it('should render admin link', () => {
    render(<Header />);

    const adminLink = screen.getByTestId('link-admin');
    expect(adminLink).toHaveAttribute('href', '/admin');
    expect(adminLink).toHaveTextContent('Admin');
  });

  it('should render search input', () => {
    render(<Header />);

    const searchInput = screen.getByTestId('input-search');
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute('placeholder', 'Search documentation...');
  });

  it('should show search value when provided', () => {
    render(<Header searchValue="test query" />);

    const searchInput = screen.getByTestId('input-search');
    expect(searchInput).toHaveValue('test query');
  });

  it('should call onSearchChange when search input changes', () => {
    const onSearchChange = vi.fn();
    render(<Header onSearchChange={onSearchChange} />);

    const searchInput = screen.getByTestId('input-search');
    fireEvent.change(searchInput, { target: { value: 'new search' } });
    expect(onSearchChange).toHaveBeenCalledWith('new search');
  });

  it('should render theme toggle', () => {
    render(<Header />);

    const themeToggle = screen.getByTestId('button-theme-toggle');
    expect(themeToggle).toBeInTheDocument();
  });

  it('should render logo when available and not loading', () => {
    render(<Header />);

    const logo = screen.getByAltText('Test Project Logo');
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute('src', '/logo.png');
  });
});
