/**
 * AdminAdvanced Page Tests

 * Date: 2025-12-29
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test-utils';
import AdminAdvanced from '../../../client/src/pages/AdminAdvanced';

// Hoist mock functions
const mockSetLocation = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockInvalidateQueries = vi.hoisted(() => vi.fn());
const mockMutate = vi.hoisted(() => vi.fn());

// Mock data holder - needs to be hoisted for use in mocks
const mockQueryDataHolder = vi.hoisted(() => ({ current: {} as Record<string, any> }));

// Mock wouter
vi.mock('wouter', () => ({
  useLocation: () => ['/admin/advanced', mockSetLocation],
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
  adminApiRequest: vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ success: true }),
  }),
  getQueryFn: vi.fn(() => async () => ({ data: [] })),
}));

// Mock react-query hooks
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: vi.fn().mockImplementation(({ queryKey }) => {
      const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
      const data = mockQueryDataHolder.current;

      if (key.includes('/api/updates')) {
        return {
          data: data.updates || [],
          isLoading: data.isLoading || false,
          error: data.error || null,
        };
      }
      if (key.includes('/api/docs')) {
        return { data: data.sections || [], isLoading: false };
      }
      if (key.includes('/history')) {
        return { data: data.history || [], isLoading: false };
      }
      if (key.includes('status=pending')) {
        return {
          data: data.suggestedChanges || {
            data: [],
            pagination: { total: 0 },
            totals: { total_messages_in_conversations: 0 },
          },
          isLoading: false,
        };
      }
      if (key.includes('status=changeset')) {
        return {
          data: data.changeset || {
            data: [],
            pagination: { total: 0 },
            totals: { total_messages_in_conversations: 0 },
          },
          isLoading: false,
        };
      }
      if (key.includes('status=discarded')) {
        return {
          data: data.discarded || {
            data: [],
            pagination: { total: 0 },
            totals: { total_messages_in_conversations: 0 },
          },
          isLoading: false,
        };
      }
      if (key.includes('processingStatus=PENDING')) {
        return {
          data: data.unprocessedMessages || { data: [], pagination: { total: 0 } },
          isLoading: false,
        };
      }
      if (key.includes('/api/admin/stream/stats')) {
        return {
          data: data.streamStats || {
            processed: 0,
            total_messages: 0,
            queued: 0,
            proposals: { total: 0 },
          },
          isLoading: false,
        };
      }
      if (key.includes('/api/admin/llm-cache/stats')) {
        return { data: data.llmCacheStats || { total: 0, byPurpose: {} }, isLoading: false };
      }
      if (key.includes('/api/admin/llm-cache') && !key.includes('stats')) {
        return { data: data.llmCache || [], isLoading: false };
      }
      if (key.includes('/api/admin/stream/batches')) {
        return { data: data.batchHistory || { batches: [] }, isLoading: false };
      }
      return { data: null, isLoading: false };
    }),
    useMutation: vi.fn().mockImplementation(() => ({
      mutate: mockMutate,
      isPending: false,
    })),
  };
});

describe('AdminAdvanced Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryDataHolder.current = {};
    // Set up authenticated session
    sessionStorage.setItem('admin_token', 'test-token');
    // Suppress console.log
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Mock fetch for auth check
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe('Basic Rendering', () => {
    it('should render admin dashboard heading', () => {
      render(<AdminAdvanced />);
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    it('should render search input', () => {
      render(<AdminAdvanced />);
      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    });

    it('should render stats cards', () => {
      render(<AdminAdvanced />);
      expect(screen.getByText('Processed')).toBeInTheDocument();
      expect(screen.getByText('Unprocessed')).toBeInTheDocument();
      expect(screen.getByText('Proposals')).toBeInTheDocument();
    });

    it('should render action buttons', () => {
      render(<AdminAdvanced />);
      expect(screen.getByText('Process Messages')).toBeInTheDocument();
      expect(screen.getByText('Sync Docs')).toBeInTheDocument();
      expect(screen.getByText('Clear Processed')).toBeInTheDocument();
    });

    it('should render tabs', () => {
      render(<AdminAdvanced />);
      expect(screen.getByTestId('tab-suggested-changes')).toBeInTheDocument();
      expect(screen.getByTestId('tab-discarded')).toBeInTheDocument();
    });
  });

  describe('Loading State', () => {
    it('should show loading state when data is loading', () => {
      mockQueryDataHolder.current.isLoading = true;
      render(<AdminAdvanced />);
      expect(screen.getByText('Loading updates...')).toBeInTheDocument();
    });
  });

  describe('Stats Display', () => {
    it('should display processed messages count', () => {
      mockQueryDataHolder.current.streamStats = {
        processed: 50,
        total_messages: 100,
        queued: 25,
        proposals: { total: 15 },
      };
      render(<AdminAdvanced />);
      expect(screen.getByText('50 / 100')).toBeInTheDocument();
    });

    it('should display unprocessed messages count', () => {
      mockQueryDataHolder.current.streamStats = {
        processed: 50,
        total_messages: 100,
        queued: 25,
        proposals: { total: 15 },
      };
      render(<AdminAdvanced />);
      expect(screen.getByText('25')).toBeInTheDocument();
    });

    it('should display proposals count', () => {
      mockQueryDataHolder.current.streamStats = {
        processed: 50,
        total_messages: 100,
        queued: 25,
        proposals: { total: 15 },
      };
      render(<AdminAdvanced />);
      expect(screen.getByText('15')).toBeInTheDocument();
    });

    it('should display stats descriptions', () => {
      render(<AdminAdvanced />);
      expect(screen.getByText('Messages Processed')).toBeInTheDocument();
      expect(screen.getByText('Awaiting Review')).toBeInTheDocument();
      expect(screen.getByText('Documentation Updates')).toBeInTheDocument();
    });
  });

  describe('Tab Switching', () => {
    it('should allow clicking suggested changes tab', () => {
      render(<AdminAdvanced />);
      const tab = screen.getByTestId('tab-suggested-changes');
      fireEvent.click(tab);
      expect(tab).toBeInTheDocument();
    });

    it('should allow clicking discarded tab', () => {
      render(<AdminAdvanced />);
      const tab = screen.getByTestId('tab-discarded');
      fireEvent.click(tab);
      expect(tab).toBeInTheDocument();
    });
  });

  describe('Tab Counts', () => {
    it('should display suggested changes count', () => {
      mockQueryDataHolder.current.suggestedChanges = {
        data: [],
        pagination: { total: 5 },
        totals: { total_messages_in_conversations: 20 },
      };
      render(<AdminAdvanced />);
      expect(screen.getByText('5 conversations • 20 messages')).toBeInTheDocument();
    });

    it('should display discarded count', () => {
      mockQueryDataHolder.current.discarded = {
        data: [],
        pagination: { total: 3 },
        totals: { total_messages_in_conversations: 10 },
      };
      render(<AdminAdvanced />);
      expect(screen.getByText('3 conversations • 10 messages')).toBeInTheDocument();
    });
  });

  describe('Action Button Clicks', () => {
    it('should handle process messages click', () => {
      render(<AdminAdvanced />);
      const button = screen.getByText('Process Messages');
      fireEvent.click(button);
      expect(mockMutate).toHaveBeenCalled();
    });

    it('should handle sync docs click', () => {
      render(<AdminAdvanced />);
      const button = screen.getByText('Sync Docs');
      fireEvent.click(button);
      expect(mockMutate).toHaveBeenCalled();
    });

    it('should handle clear processed click', () => {
      render(<AdminAdvanced />);
      const button = screen.getByText('Clear Processed');
      fireEvent.click(button);
      expect(mockMutate).toHaveBeenCalled();
    });
  });

  describe('Authentication', () => {
    it('should redirect to login on auth error', async () => {
      mockQueryDataHolder.current.error = { message: '401 Unauthorized' };
      render(<AdminAdvanced />);

      await waitFor(() => {
        expect(mockSetLocation).toHaveBeenCalledWith('/admin/login');
      });
    });

    it('should redirect to login on 403 error', async () => {
      mockQueryDataHolder.current.error = { message: '403 Forbidden' };
      render(<AdminAdvanced />);

      await waitFor(() => {
        expect(mockSetLocation).toHaveBeenCalledWith('/admin/login');
      });
    });
  });

  describe('Search Input', () => {
    it('should allow typing in search input', () => {
      render(<AdminAdvanced />);
      const searchInput = screen.getByPlaceholderText('Search...');
      fireEvent.change(searchInput, { target: { value: 'test search' } });
      expect(searchInput).toHaveValue('test search');
    });
  });

  describe('Default Values', () => {
    it('should show zero counts when no data', () => {
      render(<AdminAdvanced />);
      // Default 0 / 0 for processed
      expect(screen.getByText('0 / 0')).toBeInTheDocument();
    });

    it('should show zero unprocessed when no data', () => {
      render(<AdminAdvanced />);
      // Multiple elements with 0
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBeGreaterThan(0);
    });
  });
});
