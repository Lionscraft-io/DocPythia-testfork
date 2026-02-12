/**
 * DocContent Component Tests

 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '../test-utils';
import { DocContent } from '../../../client/src/components/DocContent';

describe('DocContent', () => {
  it('should render level 1 heading', () => {
    const sections = [{ id: 'intro', title: 'Introduction', content: '', level: 1 }];
    render(<DocContent sections={sections} />);

    expect(screen.getByTestId('heading-intro')).toHaveTextContent('Introduction');
    expect(screen.getByTestId('heading-intro').tagName).toBe('H1');
  });

  it('should render level 2 heading', () => {
    const sections = [{ id: 'setup', title: 'Setup Guide', content: '', level: 2 }];
    render(<DocContent sections={sections} />);

    expect(screen.getByTestId('heading-setup')).toHaveTextContent('Setup Guide');
    expect(screen.getByTestId('heading-setup').tagName).toBe('H2');
  });

  it('should render level 3 heading', () => {
    const sections = [{ id: 'config', title: 'Configuration', content: '', level: 3 }];
    render(<DocContent sections={sections} />);

    expect(screen.getByTestId('heading-config')).toHaveTextContent('Configuration');
    expect(screen.getByTestId('heading-config').tagName).toBe('H3');
  });

  it('should render content with markdown', () => {
    const sections = [
      {
        id: 'test',
        title: 'Test',
        content: 'This is **bold** text',
        level: 2,
      },
    ];
    render(<DocContent sections={sections} />);

    const content = screen.getByTestId('content-test');
    expect(content).toBeInTheDocument();
    // Check bold text is rendered
    expect(content.querySelector('strong')).toHaveTextContent('bold');
  });

  it('should render info alert for info type', () => {
    const sections = [
      {
        id: 'info',
        title: 'Information',
        content: 'Some info here',
        type: 'info' as const,
      },
    ];
    render(<DocContent sections={sections} />);

    expect(screen.getByText('Information')).toBeInTheDocument();
    expect(screen.getByText('Some info here')).toBeInTheDocument();
  });

  it('should render warning alert for warning type', () => {
    const sections = [
      {
        id: 'warning',
        title: 'Warning',
        content: 'Be careful!',
        type: 'warning' as const,
      },
    ];
    render(<DocContent sections={sections} />);

    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Be careful!')).toBeInTheDocument();
  });

  it('should render success alert for success type', () => {
    const sections = [
      {
        id: 'success',
        title: 'Success',
        content: 'Operation completed',
        type: 'success' as const,
      },
    ];
    render(<DocContent sections={sections} />);

    expect(screen.getByText('Success')).toBeInTheDocument();
    expect(screen.getByText('Operation completed')).toBeInTheDocument();
  });

  it('should render multiple sections', () => {
    const sections = [
      { id: 'intro', title: 'Introduction', content: 'Intro text', level: 1 },
      { id: 'setup', title: 'Setup', content: 'Setup text', level: 2 },
    ];
    render(<DocContent sections={sections} />);

    expect(screen.getByTestId('heading-intro')).toBeInTheDocument();
    expect(screen.getByTestId('heading-setup')).toBeInTheDocument();
    expect(screen.getByTestId('content-intro')).toHaveTextContent('Intro text');
    expect(screen.getByTestId('content-setup')).toHaveTextContent('Setup text');
  });

  it('should not render content when empty', () => {
    const sections = [{ id: 'empty', title: 'Empty', content: '', level: 2 }];
    render(<DocContent sections={sections} />);

    expect(screen.queryByTestId('content-empty')).not.toBeInTheDocument();
  });
});
