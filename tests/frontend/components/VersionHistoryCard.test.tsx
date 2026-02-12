/**
 * VersionHistoryCard Component Tests

 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../test-utils';
import { VersionHistoryCard } from '../../../client/src/components/VersionHistoryCard';
import type { SectionVersion } from '../../../shared/schema';

const createVersion = (overrides: Partial<SectionVersion> = {}): SectionVersion => ({
  id: 'version-1',
  sectionId: 'section-1',
  op: 'edit',
  title: 'Test Section',
  content: 'Current content of the section',
  createdAt: new Date(),
  createdBy: 'TestUser',
  ...overrides,
});

describe('VersionHistoryCard', () => {
  it('should render version title and operation badge', () => {
    const version = createVersion({ op: 'edit' });
    render(<VersionHistoryCard version={version} />);

    expect(screen.getByTestId('text-title')).toHaveTextContent('Test Section');
    expect(screen.getByTestId('badge-op-edit')).toHaveTextContent('Edited');
  });

  it('should render "Added" badge for add operation', () => {
    const version = createVersion({ op: 'add' });
    render(<VersionHistoryCard version={version} />);

    expect(screen.getByTestId('badge-op-add')).toHaveTextContent('Added');
  });

  it('should render "Deleted" badge for delete operation', () => {
    const version = createVersion({ op: 'delete' });
    render(<VersionHistoryCard version={version} />);

    expect(screen.getByTestId('badge-op-delete')).toHaveTextContent('Deleted');
  });

  it('should render "Rolled Back" badge for rollback operation', () => {
    const version = createVersion({ op: 'rollback' });
    render(<VersionHistoryCard version={version} />);

    expect(screen.getByTestId('badge-op-rollback')).toHaveTextContent('Rolled Back');
  });

  it('should render createdBy when provided', () => {
    const version = createVersion({ createdBy: 'TestUser' });
    render(<VersionHistoryCard version={version} />);

    expect(screen.getByTestId('text-created-by')).toHaveTextContent('by TestUser');
  });

  it('should not render createdBy when not provided', () => {
    const version = createVersion({ createdBy: undefined });
    render(<VersionHistoryCard version={version} />);

    expect(screen.queryByTestId('text-created-by')).not.toBeInTheDocument();
  });

  it('should render revert button for non-delete operations', () => {
    const onRevert = vi.fn();
    const version = createVersion({ op: 'edit' });
    render(<VersionHistoryCard version={version} onRevert={onRevert} />);

    expect(screen.getByTestId('button-revert-version-1')).toBeInTheDocument();
  });

  it('should not render revert button for delete operations', () => {
    const onRevert = vi.fn();
    const version = createVersion({ op: 'delete' });
    render(<VersionHistoryCard version={version} onRevert={onRevert} />);

    expect(screen.queryByTestId('button-revert-version-1')).not.toBeInTheDocument();
  });

  it('should call onRevert with version id when revert button is clicked', () => {
    const onRevert = vi.fn();
    const version = createVersion({ op: 'edit' });
    render(<VersionHistoryCard version={version} onRevert={onRevert} />);

    fireEvent.click(screen.getByTestId('button-revert-version-1'));
    expect(onRevert).toHaveBeenCalledWith('version-1');
  });

  it('should show diff toggle button when previousVersion is provided', () => {
    const version = createVersion();
    const previousVersion = createVersion({ id: 'version-0', content: 'Previous content' });
    render(<VersionHistoryCard version={version} previousVersion={previousVersion} />);

    expect(screen.getByTestId('button-toggle-diff-version-1')).toHaveTextContent('Show Changes');
  });

  it('should toggle diff visibility when button is clicked', () => {
    const version = createVersion();
    const previousVersion = createVersion({ id: 'version-0', content: 'Previous content' });
    render(<VersionHistoryCard version={version} previousVersion={previousVersion} />);

    // Initially hidden
    expect(screen.queryByTestId('text-diff-before')).not.toBeInTheDocument();

    // Click to show
    fireEvent.click(screen.getByTestId('button-toggle-diff-version-1'));
    expect(screen.getByTestId('text-diff-before')).toHaveTextContent('Previous content');
    expect(screen.getByTestId('text-diff-after')).toHaveTextContent(
      'Current content of the section'
    );

    // Click to hide
    fireEvent.click(screen.getByTestId('button-toggle-diff-version-1'));
    expect(screen.queryByTestId('text-diff-before')).not.toBeInTheDocument();
  });

  it('should show initial version message for add operation without previous version', () => {
    const version = createVersion({ op: 'add' });
    render(<VersionHistoryCard version={version} />);

    expect(screen.getByText('Initial version - no previous content')).toBeInTheDocument();
  });

  it('should format timestamp correctly', () => {
    // Set a recent time (5 minutes ago)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const version = createVersion({ createdAt: fiveMinutesAgo });
    render(<VersionHistoryCard version={version} />);

    expect(screen.getByTestId('text-timestamp')).toHaveTextContent('5 minutes ago');
  });
});
