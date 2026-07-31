import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoadingIndicator, StreamingCursor } from './LoadingIndicator';

describe('LoadingIndicator', () => {
  it('renders loader container', () => {
    const { container } = render(<LoadingIndicator activity='usingTools' />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveAttribute('aria-atomic', 'true');
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveClass('motion-reduce:animate-none');
    expect(container.firstChild).toHaveClass('mx-2', 'md:mx-4', 'w-auto', 'rounded-xl', 'p-2');
  });

  it('uses a static completion icon after streaming ends', () => {
    const { container } = render(<LoadingIndicator isComplete components={[{ id: 'thoughts', type: 'chainOfThought', data: { steps: ['Reviewed the request'] } }] as never} />);
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
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
    expect(screen.getByText('1. Activate Skill')).toBeInTheDocument();
    expect(screen.queryByText('workspace-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('1. Activate Skill'));
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
    expect(screen.getByText('1. Search Documents')).toBeInTheDocument();
    fireEvent.click(screen.getByText('1. Search Documents'));
    expect(screen.getByText(/contract/)).toBeInTheDocument();
  });

  it('keeps completed activity available without an active live status', () => {
    render(<LoadingIndicator isComplete components={[{ id: 'thoughts', type: 'chainOfThought', data: { steps: ['Reviewed the request'] } }] as never} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Reviewed the request')).toBeInTheDocument();
  });

  it('shows the tool datetime without exposing a raw tool response', () => {
    const startedAt = '2026-07-21T10:13:42Z';
    const expectedDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(startedAt));
    render(<LoadingIndicator isComplete components={[{
      id: 'tool',
      type: 'toolInfo',
      data: {
        title: 'search_documents',
        status: 'completed',
        params: '{"query":"contract"}',
        startedAt,
        resultJson: '{"matches":[{"id":"doc-1"}]}',
      },
    }] as never} />);

    fireEvent.click(screen.getByRole('button', { name: 'stream.activity.detailsAria' }));
    fireEvent.click(screen.getByText('1. Search Documents'));

    expect(screen.getByText((content) => content.includes(expectedDate))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'stream.activity.viewResponse' })).not.toBeInTheDocument();
    expect(screen.queryByText(/doc-1/)).not.toBeInTheDocument();
  });

  it('omits response controls for legacy tool activity', () => {
    render(<LoadingIndicator isComplete components={[{
      id: 'tool',
      type: 'toolInfo',
      data: { title: 'search_documents', status: 'completed', params: '{"query":"contract"}' },
    }] as never} />);

    fireEvent.click(screen.getByRole('button', { name: 'stream.activity.detailsAria' }));
    fireEvent.click(screen.getByText('1. Search Documents'));
    expect(screen.queryByRole('button', { name: 'stream.activity.viewResponse' })).not.toBeInTheDocument();
  });

  it('numbers tool executions and calculates duration from the next tool start', () => {
    const { container } = render(<LoadingIndicator isComplete components={[
      { id: 'tool-1', type: 'toolInfo', data: { title: 'search_documents', status: 'completed', startedAt: '2026-07-21T10:13:42.000Z' } },
      { id: 'tool-2', type: 'toolInfo', data: { title: 'create_report', status: 'running', startedAt: '2026-07-21T10:14:00.400Z' } },
    ] as never} />);

    fireEvent.click(screen.getByRole('button', { name: 'stream.activity.detailsAria' }));

    expect(screen.getByText('1. Search Documents')).toBeInTheDocument();
    expect(screen.getByText('2. Create Report')).toBeInTheDocument();
    const durations = container.querySelectorAll('[data-duration-seconds]');
    expect(durations).toHaveLength(1);
    expect(durations[0]).toHaveAttribute('data-duration-seconds', '18');
    expect(durations[0].closest('summary')).toHaveTextContent('1. Search Documents');
    expect(screen.getByText('2. Create Report').closest('summary')).not.toContainElement(durations[0] as HTMLElement);
  });

  it('renders every occurrence when the same tool is called repeatedly', () => {
    render(<LoadingIndicator isComplete components={[
      { id: 'tool-agent-a-call-1', type: 'toolInfo', data: { title: 'perform_document_search', status: 'completed' } },
      { id: 'tool-agent-a-call-2', type: 'toolInfo', data: { title: 'perform_document_search', status: 'completed' } },
      { id: 'tool-manager-call-1', type: 'toolInfo', data: { title: 'delegate_to_researcher', status: 'completed' } },
    ] as never} />);

    fireEvent.click(screen.getByRole('button', { name: 'stream.activity.detailsAria' }));
    expect(screen.getByText('1. Perform Document Search')).toBeInTheDocument();
    expect(screen.getByText('2. Perform Document Search')).toBeInTheDocument();
    expect(screen.getByText('3. Delegate To Researcher')).toBeInTheDocument();
  });
});
