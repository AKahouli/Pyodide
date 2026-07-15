import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingIndicator, StreamingCursor } from './LoadingIndicator';

describe('LoadingIndicator', () => {
  it('renders loader container', () => {
    render(<LoadingIndicator activity='usingTools' />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
  });

  it('renders streaming cursor', () => {
    const { container } = render(<StreamingCursor />);
    expect(container.querySelector('span')).toBeTruthy();
  });

  it('keeps tool parameters and thought steps compact until explicitly expanded', () => {
    render(
      <LoadingIndicator
        activity='usingTools'
        components={[
          { id: 'reasoning', type: 'reasoning', data: { content: 'Never show this raw prompt' } },
          { id: 'thoughts', type: 'chainOfThought', data: { steps: ['Reviewing the document'] } },
          { id: 'tool', type: 'toolInfo', data: { title: 'activate_skill', status: 'running', args: { workspaceId: 'workspace-1' }, params: '{"secret":"value"}' } },
        ] as never}
      />,
    );

    expect(screen.queryByText('Reviewing the document')).not.toBeInTheDocument();
    expect(screen.queryByText('Never show this raw prompt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Reviewing the document')).toBeInTheDocument();
    expect(screen.getByText('Activate Skill')).toBeInTheDocument();
    expect(screen.queryByText('workspace-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Activate Skill'));
    expect(screen.getByText(/workspace-1/)).toBeInTheDocument();
    expect(screen.getByText(/secret/)).toBeInTheDocument();
    expect(screen.queryByText('Never show this raw prompt')).not.toBeInTheDocument();
  });

  it('replaces chain tool names with their dedicated debug panes', () => {
    render(<LoadingIndicator isComplete components={[
      { id: 'thoughts', type: 'chainOfThought', data: { steps: ['search_documents'] } },
      { id: 'tool', type: 'toolInfo', data: { title: 'search_documents', status: 'completed', params: '{"query":"contract"}' } },
    ] as never} />);

    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('search_documents')).not.toBeInTheDocument();
    expect(screen.getByText('Search Documents')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Search Documents'));
    expect(screen.getByText(/contract/)).toBeInTheDocument();
  });

  it('keeps completed activity available without an active live status', () => {
    render(<LoadingIndicator isComplete components={[{ id: 'thoughts', type: 'chainOfThought', data: { steps: ['Reviewed the request'] } }] as never} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Reviewed the request')).toBeInTheDocument();
  });
});
