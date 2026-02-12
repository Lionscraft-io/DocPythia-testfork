/**
 * UpdateCard Component Tests

 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../test-utils';
import { UpdateCard } from '../../../client/src/components/UpdateCard';

const defaultProps = {
  id: 'update-1',
  type: 'minor' as const,
  section: 'docs/getting-started.md',
  summary: 'Added missing configuration step',
  source: 'Community Chat',
  timestamp: '2 hours ago',
  status: 'pending' as const,
};

describe('UpdateCard', () => {
  it('should render section and summary', () => {
    render(<UpdateCard {...defaultProps} />);

    expect(screen.getByTestId('text-section')).toHaveTextContent('docs/getting-started.md');
    expect(screen.getByTestId('text-summary')).toHaveTextContent(
      'Added missing configuration step'
    );
  });

  it('should render source and timestamp', () => {
    render(<UpdateCard {...defaultProps} />);

    expect(screen.getByTestId('text-source')).toHaveTextContent('Source: Community Chat');
    expect(screen.getByTestId('text-timestamp')).toHaveTextContent('2 hours ago');
  });

  it('should render approve button when onApprove is provided', () => {
    const onApprove = vi.fn();
    render(<UpdateCard {...defaultProps} onApprove={onApprove} />);

    const approveBtn = screen.getByTestId('button-approve-update-1');
    expect(approveBtn).toBeInTheDocument();
    expect(approveBtn).toHaveTextContent('Approve');
  });

  it('should call onApprove when approve button is clicked', () => {
    const onApprove = vi.fn();
    render(<UpdateCard {...defaultProps} onApprove={onApprove} />);

    fireEvent.click(screen.getByTestId('button-approve-update-1'));
    expect(onApprove).toHaveBeenCalledWith('update-1');
  });

  it('should render reject button when onReject is provided', () => {
    const onReject = vi.fn();
    render(<UpdateCard {...defaultProps} onReject={onReject} />);

    const rejectBtn = screen.getByTestId('button-reject-update-1');
    expect(rejectBtn).toBeInTheDocument();
  });

  it('should call onReject when reject button is clicked', () => {
    const onReject = vi.fn();
    render(<UpdateCard {...defaultProps} onReject={onReject} />);

    fireEvent.click(screen.getByTestId('button-reject-update-1'));
    expect(onReject).toHaveBeenCalledWith('update-1');
  });

  it('should render edit button when onEdit is provided', () => {
    const onEdit = vi.fn();
    render(<UpdateCard {...defaultProps} onEdit={onEdit} />);

    const editBtn = screen.getByTestId('button-edit-update-1');
    expect(editBtn).toBeInTheDocument();
    expect(editBtn).toHaveTextContent('Edit');
  });

  it('should render view context button when onViewContext is provided', () => {
    const onViewContext = vi.fn();
    render(<UpdateCard {...defaultProps} onViewContext={onViewContext} />);

    const contextBtn = screen.getByTestId('button-view-context-update-1');
    expect(contextBtn).toBeInTheDocument();
    expect(contextBtn).toHaveTextContent('View Conversation Context');
  });

  it('should call onViewContext when view context button is clicked', () => {
    const onViewContext = vi.fn();
    render(<UpdateCard {...defaultProps} onViewContext={onViewContext} />);

    fireEvent.click(screen.getByTestId('button-view-context-update-1'));
    expect(onViewContext).toHaveBeenCalled();
  });

  it('should not render action buttons when no callbacks provided', () => {
    render(<UpdateCard {...defaultProps} />);

    expect(screen.queryByTestId('button-approve-update-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-reject-update-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-edit-update-1')).not.toBeInTheDocument();
  });

  it('should render proposed change when diff is provided', () => {
    render(
      <UpdateCard
        {...defaultProps}
        diff={{
          before: 'Old content',
          after: 'New content with changes',
        }}
      />
    );

    expect(screen.getByText('Proposed Change:')).toBeInTheDocument();
    expect(screen.getByText('New content with changes')).toBeInTheDocument();
  });

  it('should show correct button text based on status', () => {
    const onReject = vi.fn();

    // Pending status
    const { rerender } = render(
      <UpdateCard {...defaultProps} status="pending" onReject={onReject} />
    );
    expect(screen.getByTestId('button-reject-update-1')).toHaveTextContent('Ignore');

    // Approved status
    rerender(<UpdateCard {...defaultProps} status="approved" onReject={onReject} />);
    expect(screen.getByTestId('button-reject-update-1')).toHaveTextContent('Reset to Pending');

    // Rejected status
    rerender(<UpdateCard {...defaultProps} status="rejected" onReject={onReject} />);
    expect(screen.getByTestId('button-reject-update-1')).toHaveTextContent('Reset to Pending');
  });

  describe('Edit Dialog', () => {
    const propsWithDiff = {
      ...defaultProps,
      diff: {
        before: 'Old content',
        after: 'New content with changes',
      },
    };

    it('should open edit dialog when edit button is clicked', () => {
      const onEdit = vi.fn();
      render(<UpdateCard {...propsWithDiff} onEdit={onEdit} />);

      // Dialog should not be visible initially
      expect(screen.queryByText('Edit Change Proposal')).not.toBeInTheDocument();

      // Click edit button
      fireEvent.click(screen.getByTestId('button-edit-update-1'));

      // Dialog should now be visible
      expect(screen.getByText('Edit Change Proposal')).toBeInTheDocument();
      expect(
        screen.getByText('Modify the AI-generated content before approving.')
      ).toBeInTheDocument();
    });

    it('should pre-fill textarea with diff.after content', () => {
      const onEdit = vi.fn();
      render(<UpdateCard {...propsWithDiff} onEdit={onEdit} />);

      fireEvent.click(screen.getByTestId('button-edit-update-1'));

      const textarea = screen.getByTestId('textarea-edit-content');
      expect(textarea).toHaveValue('New content with changes');
    });

    it('should allow editing content in textarea', () => {
      const onEdit = vi.fn();
      render(<UpdateCard {...propsWithDiff} onEdit={onEdit} />);

      fireEvent.click(screen.getByTestId('button-edit-update-1'));

      const textarea = screen.getByTestId('textarea-edit-content');
      fireEvent.change(textarea, { target: { value: 'Updated content' } });
      expect(textarea).toHaveValue('Updated content');
    });

    it('should call onEdit with updated content when save is clicked', () => {
      const onEdit = vi.fn();
      render(<UpdateCard {...propsWithDiff} onEdit={onEdit} />);

      fireEvent.click(screen.getByTestId('button-edit-update-1'));

      const textarea = screen.getByTestId('textarea-edit-content');
      fireEvent.change(textarea, { target: { value: 'Updated content' } });

      fireEvent.click(screen.getByTestId('button-save-edit'));

      expect(onEdit).toHaveBeenCalledWith('update-1', {
        diffAfter: 'Updated content',
      });
    });

    it('should close dialog and reset content when cancel is clicked', () => {
      const onEdit = vi.fn();
      render(<UpdateCard {...propsWithDiff} onEdit={onEdit} />);

      fireEvent.click(screen.getByTestId('button-edit-update-1'));

      // Modify content
      const textarea = screen.getByTestId('textarea-edit-content');
      fireEvent.change(textarea, { target: { value: 'Modified content' } });

      // Click cancel
      fireEvent.click(screen.getByTestId('button-cancel-edit'));

      // Dialog should be closed
      expect(screen.queryByText('Edit Change Proposal')).not.toBeInTheDocument();

      // onEdit should not have been called
      expect(onEdit).not.toHaveBeenCalled();
    });

    it('should close dialog after saving', () => {
      const onEdit = vi.fn();
      render(<UpdateCard {...propsWithDiff} onEdit={onEdit} />);

      fireEvent.click(screen.getByTestId('button-edit-update-1'));
      fireEvent.click(screen.getByTestId('button-save-edit'));

      // Dialog should be closed
      expect(screen.queryByText('Edit Change Proposal')).not.toBeInTheDocument();
    });

    it('should show preview tab in dialog', () => {
      const onEdit = vi.fn();
      render(<UpdateCard {...propsWithDiff} onEdit={onEdit} />);

      fireEvent.click(screen.getByTestId('button-edit-update-1'));

      // Should show Edit and Preview tabs
      expect(screen.getByRole('tab', { name: /edit/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /preview/i })).toBeInTheDocument();
    });

    it('should disable textarea for delete type', () => {
      const onEdit = vi.fn();
      render(<UpdateCard {...propsWithDiff} type="delete" onEdit={onEdit} />);

      fireEvent.click(screen.getByTestId('button-edit-update-1'));

      const textarea = screen.getByTestId('textarea-edit-content');
      expect(textarea).toBeDisabled();
    });

    it('should show delete-specific label for delete type', () => {
      const onEdit = vi.fn();
      render(<UpdateCard {...propsWithDiff} type="delete" onEdit={onEdit} />);

      fireEvent.click(screen.getByTestId('button-edit-update-1'));

      expect(screen.getByText('Content to be deleted')).toBeInTheDocument();
    });

    it('should show "(No content)" when diff.after is empty', () => {
      const onEdit = vi.fn();
      render(<UpdateCard {...defaultProps} diff={{ before: 'Old', after: '' }} onEdit={onEdit} />);

      // The card itself should show "(No content)" for the proposed change
      expect(screen.getByText('(No content)')).toBeInTheDocument();
    });
  });

  describe('Type variations', () => {
    it('should render correctly for major type', () => {
      render(<UpdateCard {...defaultProps} type="major" />);
      expect(screen.getByTestId('text-section')).toBeInTheDocument();
    });

    it('should render correctly for add type', () => {
      render(<UpdateCard {...defaultProps} type="add" />);
      expect(screen.getByTestId('text-section')).toBeInTheDocument();
    });

    it('should render correctly for delete type', () => {
      render(<UpdateCard {...defaultProps} type="delete" />);
      expect(screen.getByTestId('text-section')).toBeInTheDocument();
    });
  });

  describe('Status display', () => {
    it('should render auto-applied status', () => {
      render(<UpdateCard {...defaultProps} status="auto-applied" />);
      expect(screen.getByTestId('text-section')).toBeInTheDocument();
    });
  });
});
