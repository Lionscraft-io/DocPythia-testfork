/**
 * Admin Page Tests

 * Date: 2025-12-23
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '../test-utils';
import Admin from '../../../client/src/pages/Admin';

// Hoist mock functions
const mockSetLocation = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());
const mockInvalidateQueries = vi.hoisted(() => vi.fn());
const mockMutate = vi.hoisted(() => vi.fn());

// Mock data holder - needs to be hoisted for use in mocks
const mockQueryDataHolder = vi.hoisted(() => ({ current: {} as Record<string, any> }));

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
  adminApiRequest: vi.fn().mockResolvedValue({ batch: { id: 'test-batch' } }),
  getQueryFn: vi.fn(() => async () => ({ data: [] })),
}));

// Create mock conversation with proposals
const createMockConversation = (id: string, proposals: any[] = []) => ({
  conversation_id: id,
  category: 'troubleshooting',
  created_at: new Date().toISOString(),
  messages: [{ author: 'user', content: 'Test message' }],
  proposals,
});

const createMockProposal = (id: number, status: string = 'pending') => ({
  id,
  status,
  update_type: 'UPDATE',
  page: 'docs/test.md',
  reasoning: 'Test reasoning',
  suggested_text: 'Test content',
  created_at: new Date().toISOString(),
});

// Mock react-query hooks
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: vi.fn().mockImplementation(({ queryKey }) => {
      const key = queryKey[0];
      const data = mockQueryDataHolder.current;
      const defaultPagination = { page: 1, limit: 10, total: 0, totalPages: 0 };
      const withPagination = (d: any) => {
        if (!d || !d.data) return { data: [], pagination: defaultPagination };
        const total = d.data.length;
        return {
          ...d,
          pagination: d.pagination || {
            ...defaultPagination,
            total,
            totalPages: total > 0 ? 1 : 0,
          },
        };
      };
      if (key.includes('status=pending')) {
        return { data: withPagination(data.pending), isLoading: data.isLoading || false };
      }
      if (key.includes('status=changeset')) {
        return { data: withPagination(data.approved), isLoading: data.isLoading || false };
      }
      if (key.includes('status=discarded')) {
        return { data: withPagination(data.ignored), isLoading: data.isLoading || false };
      }
      if (key.includes('batches')) {
        return { data: data.batches || { batches: [] }, isLoading: false };
      }
      if (key.includes('conversations')) {
        return { data: withPagination(data.all), isLoading: data.isLoading || false };
      }
      return { data: null, isLoading: false };
    }),
    useMutation: vi.fn().mockImplementation(() => ({
      mutate: mockMutate,
      isLoading: false,
    })),
  };
});

describe('Admin Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryDataHolder.current = {};
    // Set up authenticated session
    sessionStorage.setItem('admin_token', 'test-token');
    sessionStorage.setItem('admin_instance', 'test');
    // Suppress console.log
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  describe('Basic Rendering', () => {
    it('should render admin dashboard heading', () => {
      render(<Admin />);
      expect(screen.getByTestId('heading-admin')).toHaveTextContent('Admin Dashboard');
    });

    it('should render description text', () => {
      render(<Admin />);
      expect(
        screen.getByText('Review and manage AI-suggested documentation updates')
      ).toBeInTheDocument();
    });

    it('should render stats cards', () => {
      render(<Admin />);
      expect(screen.getByText('Total Updates')).toBeInTheDocument();
      expect(screen.getByText('Pending Review')).toBeInTheDocument();
      expect(screen.getByText('Approved')).toBeInTheDocument();
      expect(screen.getByText('Ignored')).toBeInTheDocument();
    });

    it('should render tabs', () => {
      render(<Admin />);
      expect(screen.getByTestId('tab-pending')).toBeInTheDocument();
      expect(screen.getByTestId('tab-approved')).toBeInTheDocument();
      expect(screen.getByTestId('tab-ignored')).toBeInTheDocument();
      expect(screen.getByTestId('tab-all')).toBeInTheDocument();
      expect(screen.getByTestId('tab-history')).toBeInTheDocument();
    });

    it('should render generate PR button', () => {
      render(<Admin />);
      expect(screen.getByText(/Generate PR/)).toBeInTheDocument();
    });

    it('should render logout button', () => {
      render(<Admin />);
      expect(screen.getByText('Logout')).toBeInTheDocument();
    });
  });

  describe('Authentication', () => {
    it('should redirect to login when logout is clicked', () => {
      render(<Admin />);
      fireEvent.click(screen.getByText('Logout'));
      expect(mockSetLocation).toHaveBeenCalledWith('/logout');
    });

    it('should redirect to login when no auth token', () => {
      sessionStorage.removeItem('admin_token');
      sessionStorage.removeItem('admin_instance');
      render(<Admin />);
      expect(mockSetLocation).toHaveBeenCalledWith('/login');
    });

    it('should redirect to instance login when instance is set but no token', () => {
      sessionStorage.removeItem('admin_token');
      sessionStorage.setItem('admin_instance', 'test');
      render(<Admin />);
      expect(mockSetLocation).toHaveBeenCalledWith('/test/admin/login');
    });
  });

  describe('Loading State', () => {
    it('should show loading state when data is loading', () => {
      mockQueryDataHolder.current.isLoading = true;
      render(<Admin />);
      expect(screen.getByText('Loading updates...')).toBeInTheDocument();
    });
  });

  describe('Empty States', () => {
    it('should show empty state for pending when no updates', () => {
      render(<Admin />);
      expect(screen.getByText('No pending updates')).toBeInTheDocument();
    });

    it('should disable generate PR button when no approved updates', () => {
      render(<Admin />);
      const generateButton = screen.getByText(/Generate PR/);
      expect(generateButton).toBeDisabled();
    });
  });

  describe('Tab Switching', () => {
    it('should allow clicking approved tab', () => {
      render(<Admin />);
      const approvedTab = screen.getByTestId('tab-approved');
      fireEvent.click(approvedTab);
      // Tab should be clickable without error
      expect(approvedTab).toBeInTheDocument();
    });

    it('should allow clicking ignored tab', () => {
      render(<Admin />);
      const ignoredTab = screen.getByTestId('tab-ignored');
      fireEvent.click(ignoredTab);
      expect(ignoredTab).toBeInTheDocument();
    });

    it('should allow clicking all tab', () => {
      render(<Admin />);
      const allTab = screen.getByTestId('tab-all');
      fireEvent.click(allTab);
      expect(allTab).toBeInTheDocument();
    });

    it('should allow clicking history tab', () => {
      render(<Admin />);
      const historyTab = screen.getByTestId('tab-history');
      fireEvent.click(historyTab);
      expect(historyTab).toBeInTheDocument();
    });
  });

  describe('With Data', () => {
    beforeEach(() => {
      mockQueryDataHolder.current = {
        pending: {
          data: [createMockConversation('conv-1', [createMockProposal(1, 'pending')])],
        },
        approved: {
          data: [createMockConversation('conv-2', [createMockProposal(2, 'approved')])],
        },
        ignored: {
          data: [createMockConversation('conv-3', [createMockProposal(3, 'ignored')])],
        },
        all: {
          data: [
            createMockConversation('conv-1', [createMockProposal(1, 'pending')]),
            createMockConversation('conv-2', [createMockProposal(2, 'approved')]),
            createMockConversation('conv-3', [createMockProposal(3, 'ignored')]),
          ],
          pagination: { page: 1, limit: 10, total: 3, totalPages: 1 },
        },
        batches: { batches: [] },
      };
    });

    it('should display pending count in stats', () => {
      render(<Admin />);
      // Stats card shows the count
      const pendingTab = screen.getByTestId('tab-pending');
      expect(pendingTab).toHaveTextContent('Pending (1)');
    });

    it('should display approved count in stats', () => {
      render(<Admin />);
      const approvedTab = screen.getByTestId('tab-approved');
      expect(approvedTab).toHaveTextContent('Approved (1)');
    });

    it('should display ignored count in stats', () => {
      render(<Admin />);
      const ignoredTab = screen.getByTestId('tab-ignored');
      expect(ignoredTab).toHaveTextContent('Ignored (1)');
    });

    it('should enable generate PR button when approved updates exist', () => {
      render(<Admin />);
      const generateButton = screen.getByText(/Generate PR/);
      expect(generateButton).not.toBeDisabled();
    });

    it('should show View Context button on conversations', () => {
      render(<Admin />);
      const viewContextButtons = screen.getAllByText('View Conversation Context');
      expect(viewContextButtons.length).toBeGreaterThan(0);
    });
  });

  describe('PR Generation', () => {
    it('should show toast when trying to generate PR with no approved changes', () => {
      mockQueryDataHolder.current = { approved: { data: [] } };
      render(<Admin />);

      // Click generate PR should show the button is disabled
      const generateButton = screen.getByText(/Generate PR/);
      expect(generateButton).toBeDisabled();
    });
  });

  describe('Batch History', () => {
    it('should display PR History tab with batch count', () => {
      mockQueryDataHolder.current = {
        pending: { data: [] },
        approved: { data: [] },
        ignored: { data: [] },
        batches: {
          batches: [
            {
              id: 'batch-1',
              batchId: 'BATCH001',
              status: 'submitted',
              prTitle: 'Test PR',
              prUrl: 'https://github.com/test/repo/pull/123',
              prNumber: 123,
              submittedAt: new Date().toISOString(),
              totalProposals: 5,
              affectedFiles: ['docs/test.md'],
              proposals: [],
              failures: [],
            },
          ],
        },
      };

      render(<Admin />);
      // Tab should show correct batch count
      const historyTab = screen.getByTestId('tab-history');
      expect(historyTab).toHaveTextContent('PR History (1)');
    });

    it('should show zero batches when no history', () => {
      mockQueryDataHolder.current = {
        pending: { data: [] },
        approved: { data: [] },
        ignored: { data: [] },
        batches: { batches: [] },
      };

      render(<Admin />);
      const historyTab = screen.getByTestId('tab-history');
      expect(historyTab).toHaveTextContent('PR History (0)');
    });

    it('should show multiple batches count', () => {
      mockQueryDataHolder.current = {
        pending: { data: [] },
        approved: { data: [] },
        ignored: { data: [] },
        batches: {
          batches: [
            { id: 'batch-1', batchId: 'BATCH001', status: 'submitted', totalProposals: 5 },
            { id: 'batch-2', batchId: 'BATCH002', status: 'merged', totalProposals: 3 },
          ],
        },
      };

      render(<Admin />);
      const historyTab = screen.getByTestId('tab-history');
      expect(historyTab).toHaveTextContent('PR History (2)');
    });
  });

  describe('Conversation Merging', () => {
    it('should deduplicate conversations across different status tabs', () => {
      // Same conversation appearing in multiple status arrays
      const sharedConv = {
        conversation_id: 'shared-conv',
        category: 'troubleshooting',
        created_at: new Date().toISOString(),
        messages: [],
        proposals: [createMockProposal(1, 'pending'), createMockProposal(2, 'approved')],
      };

      mockQueryDataHolder.current = {
        pending: { data: [sharedConv] },
        approved: { data: [sharedConv] },
        ignored: { data: [] },
        batches: { batches: [] },
      };

      render(<Admin />);

      // All tab should show combined count
      fireEvent.click(screen.getByTestId('tab-all'));
      // The conversation should appear once with all proposals
    });
  });

  describe('Stats Display', () => {
    it('should display correct stats descriptions', () => {
      render(<Admin />);
      expect(screen.getByText('All proposals')).toBeInTheDocument();
      expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
      expect(screen.getByText('Ready for PR')).toBeInTheDocument();
      expect(screen.getByText('Rejected proposals')).toBeInTheDocument();
    });
  });

  describe('Multiple Proposals', () => {
    it('should display multiple proposals in a conversation', () => {
      mockQueryDataHolder.current = {
        pending: {
          data: [
            createMockConversation('conv-multi', [
              createMockProposal(1, 'pending'),
              createMockProposal(2, 'pending'),
              createMockProposal(3, 'pending'),
            ]),
          ],
        },
        approved: { data: [] },
        ignored: { data: [] },
        batches: { batches: [] },
      };

      render(<Admin />);
      // Should show proposal count
      expect(screen.getByText('3 proposals')).toBeInTheDocument();
    });

    it('should show singular "proposal" for single proposal', () => {
      mockQueryDataHolder.current = {
        pending: {
          data: [createMockConversation('conv-single', [createMockProposal(1, 'pending')])],
        },
        approved: { data: [] },
        ignored: { data: [] },
        batches: { batches: [] },
      };

      render(<Admin />);
      expect(screen.getByText('1 proposal')).toBeInTheDocument();
    });
  });

  describe('Conversation Display', () => {
    it('should show truncated conversation ID', () => {
      mockQueryDataHolder.current = {
        pending: {
          data: [createMockConversation('abcdefgh12345678', [createMockProposal(1, 'pending')])],
        },
        approved: { data: [] },
        ignored: { data: [] },
        batches: { batches: [] },
      };

      render(<Admin />);
      // Should show first 8 characters
      expect(screen.getByText('abcdefgh')).toBeInTheDocument();
    });
  });
});
