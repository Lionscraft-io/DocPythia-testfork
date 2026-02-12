/**
 * EditProposalModal Component Tests

 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '../test-utils';
import { EditProposalModal } from '../../../client/src/components/EditProposalModal';

describe('EditProposalModal', () => {
  const mockProposal = {
    id: 1,
    suggested_text: 'Original suggested text',
    page: '/docs/getting-started.md',
    section: 'Installation',
  };

  const defaultProps = {
    proposal: mockProposal,
    isOpen: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render modal when open', () => {
    render(<EditProposalModal {...defaultProps} />);

    expect(screen.getByText('Edit Proposal Text')).toBeInTheDocument();
  });

  it('should display page and section in description', () => {
    render(<EditProposalModal {...defaultProps} />);

    expect(screen.getByText('/docs/getting-started.md')).toBeInTheDocument();
    expect(screen.getByText('Installation')).toBeInTheDocument();
  });

  it('should show suggested_text in textarea', () => {
    render(<EditProposalModal {...defaultProps} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('Original suggested text');
  });

  it('should show edited_text if available', () => {
    const proposalWithEdit = {
      ...mockProposal,
      edited_text: 'Previously edited text',
    };
    render(<EditProposalModal {...defaultProps} proposal={proposalWithEdit} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('Previously edited text');
  });

  it('should update text when typing', () => {
    render(<EditProposalModal {...defaultProps} />);

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'New edited text' } });

    expect(textarea).toHaveValue('New edited text');
  });

  it('should show character count', () => {
    render(<EditProposalModal {...defaultProps} />);

    expect(screen.getByText('23 characters')).toBeInTheDocument();
  });

  it('should show warning when exceeding character limit', () => {
    render(<EditProposalModal {...defaultProps} />);

    const textarea = screen.getByRole('textbox');
    const longText = 'a'.repeat(10001);
    fireEvent.change(textarea, { target: { value: longText } });

    expect(screen.getByText('Maximum 10,000 characters')).toBeInTheDocument();
  });

  it('should call onSave with proposal id and text', () => {
    const onSave = vi.fn();
    render(<EditProposalModal {...defaultProps} onSave={onSave} />);

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Updated text' } });

    fireEvent.click(screen.getByText('Save Changes'));
    expect(onSave).toHaveBeenCalledWith(1, 'Updated text');
  });

  it('should call onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    render(<EditProposalModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('should disable save button when text is empty', () => {
    render(<EditProposalModal {...defaultProps} />);

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '' } });

    expect(screen.getByText('Save Changes')).toBeDisabled();
  });

  it('should disable buttons when saving', () => {
    render(<EditProposalModal {...defaultProps} isSaving={true} />);

    expect(screen.getByText('Saving...')).toBeDisabled();
    expect(screen.getByText('Cancel')).toBeDisabled();
  });

  it('should return null when proposal is null', () => {
    const { container } = render(<EditProposalModal {...defaultProps} proposal={null} />);

    expect(container.firstChild).toBeNull();
  });
});
