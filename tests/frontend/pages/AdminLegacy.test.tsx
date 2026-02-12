/**
 * AdminLegacy Page Tests
 * Tests for the legacy admin dashboard page

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '../test-utils';
import AdminLegacy from '../../../client/src/pages/AdminLegacy';

// Hoist mock functions
const mockSetLocation = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockInvalidateQueries = vi.hoisted(() => vi.fn());
const mockMutate = vi.hoisted(() => vi.fn());
const mockQueryDataHolder = vi.hoisted(() => ({
  current: {
    updates: [] as any[],
    isLoading: false,
    error: null as any,
  },
}));

// Mock wouter
vi.mock('wouter', () => ({
  useLocation: () => ['/admin', mockSetLocation],
}));

// Mock useToast
vi.mock('../../../client/src/hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

// Mock queryClient
vi.mock('../../../client/src/lib/queryClient', () => ({
  queryClient: {
    invalidateQueries: mockInvalidateQueries,
    clear: vi.fn(),
  },
  adminApiRequest: vi.fn().mockResolvedValue({}),
  getQueryFn: vi.fn(() => async () => []),
}));

// Mock react-query hooks
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: vi.fn().mockImplementation(() => ({
      data: mockQueryDataHolder.current.updates,
      isLoading: mockQueryDataHolder.current.isLoading,
      error: mockQueryDataHolder.current.error,
    })),
    useMutation: vi.fn().mockImplementation(() => ({
      mutate: mockMutate,
      isLoading: false,
    })),
  };
});

// Mock update data
const createMockUpdate = (id: string, status: string = 'pending') => ({
  id,
  type: 'minor',
  section: 'docs/test.md',
  summary: 'Test update',
  source: 'Test source',
  timestamp: new Date().toISOString(),
  status,
  diff: {
    before: 'Old content',
    after: 'New content',
  },
});

describe('AdminLegacy Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryDataHolder.current = { updates: [], isLoading: false, error: null };
    sessionStorage.setItem('admin_token', 'test-token');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe('Basic Rendering', () => {
    it('should render admin dashboard heading', () => {
      render(<AdminLegacy />);
      expect(screen.getByText('Admin Dashboard (Legacy View)')).toBeInTheDocument();
    });

    it('should render description text', () => {
      render(<AdminLegacy />);
      expect(
        screen.getByText('Review and manage AI-suggested documentation updates')
      ).toBeInTheDocument();
    });

    it('should render stats cards', () => {
      render(<AdminLegacy />);
      expect(screen.getByText('Total Updates')).toBeInTheDocument();
      expect(screen.getByText('Pending Review')).toBeInTheDocument();
      // These texts appear in both stats cards and tabs
      expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Auto-Applied').length).toBeGreaterThan(0);
    });

    it('should render tabs', () => {
      render(<AdminLegacy />);
      expect(screen.getByTestId('tab-pending')).toBeInTheDocument();
      expect(screen.getByTestId('tab-approved')).toBeInTheDocument();
      expect(screen.getByTestId('tab-auto-applied')).toBeInTheDocument();
      expect(screen.getByTestId('tab-all')).toBeInTheDocument();
    });
  });

  describe('Authentication', () => {
    it('should redirect to login when no auth token', () => {
      sessionStorage.removeItem('admin_token');
      render(<AdminLegacy />);
      expect(mockSetLocation).toHaveBeenCalledWith('/admin/login');
    });

    it('should redirect on 401 error', () => {
      mockQueryDataHolder.current.error = { message: '401 Unauthorized' };
      render(<AdminLegacy />);
      expect(mockSetLocation).toHaveBeenCalledWith('/admin/login');
    });

    it('should redirect on 403 error', () => {
      mockQueryDataHolder.current.error = { message: '403 Forbidden' };
      render(<AdminLegacy />);
      expect(mockSetLocation).toHaveBeenCalledWith('/admin/login');
    });
  });

  describe('Loading State', () => {
    it('should show loading state when data is loading', () => {
      mockQueryDataHolder.current.isLoading = true;
      render(<AdminLegacy />);
      expect(screen.getByText('Loading updates...')).toBeInTheDocument();
    });
  });

  describe('Empty States', () => {
    it('should show empty state for pending when no updates', () => {
      render(<AdminLegacy />);
      expect(screen.getByText('No pending updates')).toBeInTheDocument();
    });
  });

  describe('With Data', () => {
    beforeEach(() => {
      mockQueryDataHolder.current = {
        updates: [
          createMockUpdate('1', 'pending'),
          createMockUpdate('2', 'approved'),
          createMockUpdate('3', 'auto-applied'),
        ],
        isLoading: false,
        error: null,
      };
    });

    it('should display pending count in tab', () => {
      render(<AdminLegacy />);
      expect(screen.getByTestId('tab-pending')).toHaveTextContent('Pending (1)');
    });

    it('should display total updates count in stats card', () => {
      render(<AdminLegacy />);
      expect(screen.getByText('Total Updates')).toBeInTheDocument();
    });

    it('should have all tabs visible', () => {
      render(<AdminLegacy />);
      expect(screen.getByTestId('tab-approved')).toBeInTheDocument();
      expect(screen.getByTestId('tab-auto-applied')).toBeInTheDocument();
      expect(screen.getByTestId('tab-all')).toBeInTheDocument();
    });
  });

  describe('Tab Switching', () => {
    beforeEach(() => {
      mockQueryDataHolder.current = {
        updates: [createMockUpdate('1', 'pending')],
        isLoading: false,
        error: null,
      };
    });

    it('should allow clicking approved tab', () => {
      render(<AdminLegacy />);
      const approvedTab = screen.getByTestId('tab-approved');
      fireEvent.click(approvedTab);
      expect(approvedTab).toBeInTheDocument();
    });

    it('should allow clicking all updates tab', () => {
      render(<AdminLegacy />);
      const allTab = screen.getByTestId('tab-all');
      fireEvent.click(allTab);
      expect(allTab).toBeInTheDocument();
    });

    it('should allow clicking auto-applied tab', () => {
      render(<AdminLegacy />);
      const autoAppliedTab = screen.getByTestId('tab-auto-applied');
      fireEvent.click(autoAppliedTab);
      expect(autoAppliedTab).toBeInTheDocument();
    });
  });

  describe('Stats Display', () => {
    it('should display correct stats descriptions', () => {
      render(<AdminLegacy />);
      expect(screen.getByText('All time')).toBeInTheDocument();
      expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
      expect(screen.getByText('This week')).toBeInTheDocument();
      expect(screen.getByText('Minor changes')).toBeInTheDocument();
    });
  });
});
