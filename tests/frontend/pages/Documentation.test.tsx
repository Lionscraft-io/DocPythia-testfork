/**
 * Documentation Page Tests

 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '../test-utils';
import Documentation from '../../../client/src/pages/Documentation';

// Mock useConfig for Header
vi.mock('../../../client/src/hooks/useConfig', () => ({
  useConfig: vi.fn(() => ({
    data: {
      project: { name: 'Test Project', description: 'Test' },
      branding: { logo: '/logo.png' },
    },
    isLoading: false,
  })),
}));

// Mock react-query
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

import { useQuery } from '@tanstack/react-query';

describe('Documentation Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading state', () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: true,
    });

    render(<Documentation />);

    expect(screen.getByText('Loading documentation statistics...')).toBeInTheDocument();
  });

  it('should show no data message when gitStats is null', () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: false,
    });

    render(<Documentation />);

    expect(screen.getByText('No documentation data available')).toBeInTheDocument();
  });

  it('should render page title when data is loaded', () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        gitUrl: 'https://github.com/test/repo',
        branch: 'main',
        lastSyncAt: new Date().toISOString(),
        lastCommitHash: 'abc123def456',
        status: 'completed',
        totalDocuments: 100,
        documentsWithEmbeddings: 80,
      },
      isLoading: false,
    });

    render(<Documentation />);

    expect(screen.getByText('Documentation Sync Statistics')).toBeInTheDocument();
    expect(
      screen.getByText('Real-time statistics for Git-synced documentation repositories')
    ).toBeInTheDocument();
  });

  it('should extract and display repo name', () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        gitUrl: 'https://github.com/test/my-repo',
        branch: 'main',
        lastSyncAt: null,
        lastCommitHash: null,
        status: 'completed',
        totalDocuments: 50,
        documentsWithEmbeddings: 25,
      },
      isLoading: false,
    });

    render(<Documentation />);

    expect(screen.getByText('test/my-repo')).toBeInTheDocument();
  });

  it('should display branch name', () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        gitUrl: 'https://github.com/test/repo',
        branch: 'develop',
        lastSyncAt: null,
        lastCommitHash: null,
        status: 'completed',
        totalDocuments: 10,
        documentsWithEmbeddings: 5,
      },
      isLoading: false,
    });

    render(<Documentation />);

    expect(screen.getByText('develop')).toBeInTheDocument();
  });

  it('should display total documents count', () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        gitUrl: 'https://github.com/test/repo',
        branch: 'main',
        lastSyncAt: null,
        lastCommitHash: null,
        status: 'completed',
        totalDocuments: 1234,
        documentsWithEmbeddings: 1000,
      },
      isLoading: false,
    });

    render(<Documentation />);

    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('Total Documents')).toBeInTheDocument();
  });

  it('should display documents with embeddings count', () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        gitUrl: 'https://github.com/test/repo',
        branch: 'main',
        lastSyncAt: null,
        lastCommitHash: null,
        status: 'completed',
        totalDocuments: 100,
        documentsWithEmbeddings: 75,
      },
      isLoading: false,
    });

    render(<Documentation />);

    expect(screen.getByText('75')).toBeInTheDocument();
    expect(screen.getByText('Documents with Embeddings')).toBeInTheDocument();
    expect(screen.getByText('75% of total documents')).toBeInTheDocument();
  });

  it('should show synced badge for completed status', () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        gitUrl: 'https://github.com/test/repo',
        branch: 'main',
        lastSyncAt: null,
        lastCommitHash: null,
        status: 'completed',
        totalDocuments: 10,
        documentsWithEmbeddings: 5,
      },
      isLoading: false,
    });

    render(<Documentation />);

    expect(screen.getByText('Synced')).toBeInTheDocument();
  });

  it('should show syncing badge for in-progress status', () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        gitUrl: 'https://github.com/test/repo',
        branch: 'main',
        lastSyncAt: null,
        lastCommitHash: null,
        status: 'in-progress',
        totalDocuments: 10,
        documentsWithEmbeddings: 5,
      },
      isLoading: false,
    });

    render(<Documentation />);

    expect(screen.getByText('Syncing')).toBeInTheDocument();
  });

  it('should show failed badge for failed status', () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        gitUrl: 'https://github.com/test/repo',
        branch: 'main',
        lastSyncAt: null,
        lastCommitHash: null,
        status: 'failed',
        totalDocuments: 10,
        documentsWithEmbeddings: 5,
      },
      isLoading: false,
    });

    render(<Documentation />);

    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('should display commit hash when available', () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        gitUrl: 'https://github.com/test/repo',
        branch: 'main',
        lastSyncAt: null,
        lastCommitHash: 'abcdef123456789',
        status: 'completed',
        totalDocuments: 10,
        documentsWithEmbeddings: 5,
      },
      isLoading: false,
    });

    render(<Documentation />);

    expect(screen.getByText('abcdef12')).toBeInTheDocument();
  });

  it('should format time since last sync', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        gitUrl: 'https://github.com/test/repo',
        branch: 'main',
        lastSyncAt: fiveMinutesAgo,
        lastCommitHash: null,
        status: 'completed',
        totalDocuments: 10,
        documentsWithEmbeddings: 5,
      },
      isLoading: false,
    });

    render(<Documentation />);

    // Should appear multiple times (in "Last Synced" and "Sync Status" cards)
    const timeElements = screen.getAllByText('5 minutes ago');
    expect(timeElements.length).toBeGreaterThan(0);
  });
});
