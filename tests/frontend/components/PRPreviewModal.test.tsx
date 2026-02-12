/**
 * PRPreviewModal Component Tests

 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test-utils';
import { PRPreviewModal } from '../../../client/src/components/PRPreviewModal';

// Mock useConfig
vi.mock('../../../client/src/hooks/useConfig', () => ({
  useConfig: vi.fn(() => ({
    data: {
      repository: {
        targetRepo: 'test/repo',
        sourceRepo: 'test/repo',
        baseBranch: 'main',
      },
    },
    isLoading: false,
  })),
}));

describe('PRPreviewModal', () => {
  const mockProposals = [
    { id: 1, page: '/docs/intro.md', section: 'Overview', suggested_text: 'Text 1' },
    { id: 2, page: '/docs/intro.md', section: 'Setup', suggested_text: 'Text 2' },
    { id: 3, page: '/docs/api.md', section: 'Endpoints', suggested_text: 'Text 3' },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    approvedProposals: mockProposals,
    onSubmit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.log
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should render modal with title', () => {
    render(<PRPreviewModal {...defaultProps} />);

    expect(screen.getByText('Generate Pull Request')).toBeInTheDocument();
  });

  it('should show proposal and file counts', () => {
    render(<PRPreviewModal {...defaultProps} />);

    expect(screen.getByText('3')).toBeInTheDocument(); // Total proposals
    expect(screen.getByText('2')).toBeInTheDocument(); // Affected files (2 unique)
  });

  it('should render changeset summary', () => {
    render(<PRPreviewModal {...defaultProps} />);

    expect(screen.getByText('Changeset Summary')).toBeInTheDocument();
    expect(screen.getByText('Total Proposals:')).toBeInTheDocument();
    expect(screen.getByText('Affected Files:')).toBeInTheDocument();
  });

  it('should show repository configuration', () => {
    render(<PRPreviewModal {...defaultProps} />);

    expect(screen.getByText('Repository Configuration')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test/repo')).toBeInTheDocument();
    expect(screen.getByDisplayValue('main')).toBeInTheDocument();
  });

  it('should expand file list when clicked', () => {
    render(<PRPreviewModal {...defaultProps} />);

    const expandButton = screen.getByText('Affected Files').closest('button');
    fireEvent.click(expandButton!);

    expect(screen.getByText('/docs/intro.md')).toBeInTheDocument();
    expect(screen.getByText('/docs/api.md')).toBeInTheDocument();
  });

  it('should update PR title when typing', () => {
    render(<PRPreviewModal {...defaultProps} />);

    const titleInput = screen.getByPlaceholderText(/Update documentation/);
    fireEvent.change(titleInput, { target: { value: 'New PR Title' } });

    expect(titleInput).toHaveValue('New PR Title');
  });

  it('should update PR description when typing', () => {
    render(<PRPreviewModal {...defaultProps} />);

    const bodyInput = screen.getByPlaceholderText(/Describe the changes/);
    fireEvent.change(bodyInput, { target: { value: 'PR Description' } });

    expect(bodyInput).toHaveValue('PR Description');
  });

  it('should disable submit button when title is empty', () => {
    render(<PRPreviewModal {...defaultProps} />);

    const submitButton = screen.getByText('Create Draft PR');
    expect(submitButton).toBeDisabled();
  });

  it('should enable submit button when title is filled', () => {
    render(<PRPreviewModal {...defaultProps} />);

    const titleInput = screen.getByPlaceholderText(/Update documentation/);
    fireEvent.change(titleInput, { target: { value: 'Valid Title' } });

    const submitButton = screen.getByText('Create Draft PR');
    expect(submitButton).not.toBeDisabled();
  });

  it('should call onSubmit with correct data', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PRPreviewModal {...defaultProps} onSubmit={onSubmit} />);

    const titleInput = screen.getByPlaceholderText(/Update documentation/);
    fireEvent.change(titleInput, { target: { value: 'Test Title' } });

    const bodyInput = screen.getByPlaceholderText(/Describe the changes/);
    fireEvent.change(bodyInput, { target: { value: 'Test body' } });

    fireEvent.click(screen.getByText('Create Draft PR'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        targetRepo: 'test/repo',
        sourceRepo: 'test/repo',
        baseBranch: 'main',
        prTitle: 'Test Title',
        prBody: 'Test body',
        submittedBy: 'system',
      });
    });
  });

  it('should call onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    render(<PRPreviewModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('should show success message after successful submission', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PRPreviewModal {...defaultProps} onSubmit={onSubmit} />);

    const titleInput = screen.getByPlaceholderText(/Update documentation/);
    fireEvent.change(titleInput, { target: { value: 'Test' } });

    fireEvent.click(screen.getByText('Create Draft PR'));

    await waitFor(() => {
      expect(screen.getByText('Pull request created successfully!')).toBeInTheDocument();
    });
  });

  it('should show error message after failed submission', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('API Error'));
    render(<PRPreviewModal {...defaultProps} onSubmit={onSubmit} />);

    const titleInput = screen.getByPlaceholderText(/Update documentation/);
    fireEvent.change(titleInput, { target: { value: 'Test' } });

    fireEvent.click(screen.getByText('Create Draft PR'));

    await waitFor(() => {
      expect(screen.getByText('Failed to generate pull request')).toBeInTheDocument();
      expect(screen.getByText('API Error')).toBeInTheDocument();
    });
  });
});
