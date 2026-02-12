/**
 * ProposalActionButtons Component Tests

 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../test-utils';
import { ProposalActionButtons } from '../../../client/src/components/ProposalActionButtons';

const defaultProps = {
  proposalId: 1,
  status: 'pending' as const,
  onEdit: vi.fn(),
  onApprove: vi.fn(),
  onIgnore: vi.fn(),
  onReset: vi.fn(),
};

describe('ProposalActionButtons', () => {
  describe('Pending status', () => {
    it('should render edit, approve, and ignore buttons for pending status', () => {
      render(<ProposalActionButtons {...defaultProps} status="pending" />);

      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Add to Changeset')).toBeInTheDocument();
      expect(screen.getByText('Discard')).toBeInTheDocument();
    });

    it('should call onEdit when edit button is clicked', () => {
      const onEdit = vi.fn();
      render(<ProposalActionButtons {...defaultProps} onEdit={onEdit} />);

      fireEvent.click(screen.getByText('Edit'));
      expect(onEdit).toHaveBeenCalled();
    });

    it('should call onApprove when approve button is clicked', () => {
      const onApprove = vi.fn();
      render(<ProposalActionButtons {...defaultProps} onApprove={onApprove} />);

      fireEvent.click(screen.getByText('Add to Changeset'));
      expect(onApprove).toHaveBeenCalled();
    });

    it('should call onIgnore when ignore button is clicked', () => {
      const onIgnore = vi.fn();
      render(<ProposalActionButtons {...defaultProps} onIgnore={onIgnore} />);

      fireEvent.click(screen.getByText('Discard'));
      expect(onIgnore).toHaveBeenCalled();
    });

    it('should disable all buttons when disabled is true', () => {
      render(<ProposalActionButtons {...defaultProps} disabled={true} />);

      const editButton = screen.getByText('Edit').closest('button');
      const approveButton = screen.getByText('Add to Changeset').closest('button');
      const ignoreButton = screen.getByText('Discard').closest('button');

      expect(editButton).toBeDisabled();
      expect(approveButton).toBeDisabled();
      expect(ignoreButton).toBeDisabled();
    });
  });

  describe('Approved status', () => {
    it('should render reset button for approved status', () => {
      render(<ProposalActionButtons {...defaultProps} status="approved" />);

      expect(screen.getByText('Remove from Changeset')).toBeInTheDocument();
    });

    it('should call onReset when reset button is clicked', () => {
      const onReset = vi.fn();
      render(<ProposalActionButtons {...defaultProps} status="approved" onReset={onReset} />);

      fireEvent.click(screen.getByText('Remove from Changeset'));
      expect(onReset).toHaveBeenCalled();
    });

    it('should not render edit, approve, ignore buttons for approved status', () => {
      render(<ProposalActionButtons {...defaultProps} status="approved" />);

      expect(screen.queryByText('Edit')).not.toBeInTheDocument();
      expect(screen.queryByText('Add to Changeset')).not.toBeInTheDocument();
      expect(screen.queryByText('Discard')).not.toBeInTheDocument();
    });
  });

  describe('Ignored status', () => {
    it('should render reset button for ignored status', () => {
      render(<ProposalActionButtons {...defaultProps} status="ignored" />);

      expect(screen.getByText('Remove from Discarded')).toBeInTheDocument();
    });

    it('should call onReset when reset button is clicked', () => {
      const onReset = vi.fn();
      render(<ProposalActionButtons {...defaultProps} status="ignored" onReset={onReset} />);

      fireEvent.click(screen.getByText('Remove from Discarded'));
      expect(onReset).toHaveBeenCalled();
    });

    it('should disable reset button when disabled is true', () => {
      render(<ProposalActionButtons {...defaultProps} status="ignored" disabled={true} />);

      const resetButton = screen.getByText('Remove from Discarded').closest('button');
      expect(resetButton).toBeDisabled();
    });
  });
});
