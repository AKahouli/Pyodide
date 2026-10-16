import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CitationData } from '@/components/ai-elements/ai-message-content';
import { useFileViewerStore } from '@/modules/file-viewer/store';
import OpenUiRenderer from './OpenUiRenderer';
import { ReportPanelSidebar } from './ReportPanelSidebar';
import { initialState, reportPanelStore } from './report-panel-store';

vi.mock('@/modules/file-viewer', () => ({
  openFileViewerFromUrl: vi.fn(),
  openFileViewerFromUrlLoader: vi.fn().mockResolvedValue(undefined),
  getMimeTypeFromFilename: () => undefined,
  useFileViewerDisplayMode: () => 'sidebar',
}));
vi.mock('@/modules/conversation/api', () => ({ fetchRootEvidence: vi.fn(), getCitationViewUrl: vi.fn() }));

const CHAT = 'root = Card([t])\nt = TextContent("Short answer.")';
const reportProgram = (title: string, cell = 'EMEA') => [
  `root = Report({title: "${title}", subtitle: "Spike"}, [p1])`,
  'p1 = Page("p1", cp)',
  'cp = ContentPage([ih, km, tbl])',
  'ih = InlineHeader("Highlights", "Quarter to date")',
  'km = KeyMetrics("row", [{title: "Messages", text: "48,210"}, {title: "Threads", text: "9,031"}])',
  `tbl = Table([Column("Region", "text"), Column("Messages", "number")], [["${cell}", 120], ["US", 340]])`,
].join('\n');
const answer = (title: string, cell?: string) => `${CHAT}\n\n${reportProgram(title, cell)}`;

const citation = (reference: string): CitationData => ({
  parentId: '', sourceType: 'text', source: `workspace/doc${reference}.pdf`, fileName: `doc${reference}.pdf`, externalId: '', page: '1', pageContent: 'x', workspaceId: 'w', reference,
});
const scope = { conversationId: 'c', messageId: 'm' };

const mount = (content: string, extra: Partial<Parameters<typeof OpenUiRenderer>[0]> = {}) => render(
  <>
    <OpenUiRenderer content={content} isStreaming={false} onAction={vi.fn()} {...extra} />
    <ReportPanelSidebar />
  </>,
);
const viewButton = () => screen.getByRole('button', { name: /view/i });

beforeEach(() => reportPanelStore.setState({ ...initialState }));
afterEach(() => {
  act(() => useFileViewerStore.getState().closeViewer());
  vi.clearAllMocks();
});

describe('report in an OpenUI answer', () => {
  it('renders the chat answer and the report chip inline, with the panel closed', async () => {
    mount(answer('Q3 mail report'));
    expect(await screen.findByText('Short answer.')).toBeInTheDocument();
    const chip = document.querySelector('[data-openui-report] .c1-report-chat-preview');
    expect(chip).not.toBeNull();
    expect(within(chip as HTMLElement).getByText('Q3 mail report')).toBeInTheDocument();
    expect(screen.queryByTestId('report-panel')).not.toBeInTheDocument();
  });

  it('renders a report-only answer', async () => {
    mount(reportProgram('Only a report'));
    expect(await screen.findByText('Only a report')).toBeInTheDocument();
    expect(screen.queryByText('Short answer.')).not.toBeInTheDocument();
  });

  it('opens the full report in the side panel from the chip and closes it with the button, then Escape', async () => {
    mount(answer('Q3 mail report'));
    await screen.findByText('Short answer.');
    fireEvent.click(viewButton());
    const panel = await screen.findByTestId('report-panel');
    await waitFor(() => expect(within(panel).getByText('Highlights')).toBeInTheDocument());
    expect(within(panel).getByText('EMEA')).toBeInTheDocument();
    expect(within(panel).getByText('48,210')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'openui.report.close' }));
    await waitFor(() => expect(screen.queryByTestId('report-panel')).not.toBeInTheDocument());
    expect(screen.queryByText('Highlights')).not.toBeInTheDocument();

    fireEvent.click(viewButton());
    await screen.findByTestId('report-panel');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('report-panel')).not.toBeInTheDocument());
  });

  it('shows the report of the clicked answer only when two answers carry one', async () => {
    const view = render(
      <>
        <OpenUiRenderer content={answer('First report', 'AAA')} isStreaming={false} onAction={vi.fn()} partId='p1' citationScope={{ conversationId: 'c', messageId: 'm1' }} />
        <OpenUiRenderer content={answer('Second report', 'BBB')} isStreaming={false} onAction={vi.fn()} partId='p1' citationScope={{ conversationId: 'c', messageId: 'm2' }} />
        <ReportPanelSidebar />
      </>,
    );
    await waitFor(() => expect(view.getAllByRole('button', { name: /view/i })).toHaveLength(2));
    fireEvent.click(view.getAllByRole('button', { name: /view/i })[1]);
    const panel = await screen.findByTestId('report-panel');
    await waitFor(() => expect(within(panel).getByText('BBB')).toBeInTheDocument());
    expect(within(panel).queryByText('AAA')).not.toBeInTheDocument();
  });

  it('keeps the report chip when the chat program cannot be parsed, and falls back for the chat text only', async () => {
    const fallback = vi.fn((text: string) => <div data-testid='fallback'>{text}</div>);
    mount(`Not a program at all.

${reportProgram('Q3 mail report')}`, { fallback });
    expect(await screen.findByTestId('fallback')).toHaveTextContent('Not a program at all.');
    expect(fallback).not.toHaveBeenCalledWith(expect.stringContaining('root = Report'));
    expect(within(screen.getByTestId('openui-report')).getByText('Q3 mail report')).toBeInTheDocument();
  });

  it('does not let a partial report root line leak into the streaming chat card', async () => {
    const view = render(<OpenUiRenderer content={`${CHAT}

root = Rep`} isStreaming onAction={vi.fn()} />);
    expect(await screen.findByText('Short answer.')).toBeInTheDocument();
    expect(view.queryByTestId('openui-report')).not.toBeInTheDocument();
    view.rerender(<OpenUiRenderer content={answer('Q3 mail report')} isStreaming onAction={vi.fn()} />);
    expect(await screen.findByText('Q3 mail report')).toBeInTheDocument();
    expect(screen.getByText('Short answer.')).toBeInTheDocument();
  });

  it('closes the panel when the answer holding the open report unmounts', async () => {
    const view = render(<><OpenUiRenderer content={answer('Q3 mail report')} isStreaming={false} onAction={vi.fn()} /><ReportPanelSidebar /></>);
    await screen.findByText('Short answer.');
    fireEvent.click(viewButton());
    await screen.findByTestId('report-panel');
    view.rerender(<ReportPanelSidebar />);
    await waitFor(() => expect(screen.queryByTestId('report-panel')).not.toBeInTheDocument());
    expect(reportPanelStore.getState().activeDetailedViewId).toBeNull();
  });

  it('keeps the panel open when another answer unmounts', async () => {
    const view = render(
      <>
        <OpenUiRenderer key='first' content={answer('First report', 'AAA')} isStreaming={false} onAction={vi.fn()} partId='p1' citationScope={{ conversationId: 'c', messageId: 'm1' }} />
        <OpenUiRenderer key='second' content={answer('Second report', 'BBB')} isStreaming={false} onAction={vi.fn()} partId='p1' citationScope={{ conversationId: 'c', messageId: 'm2' }} />
        <ReportPanelSidebar key='panel' />
      </>,
    );
    await waitFor(() => expect(view.getAllByRole('button', { name: /view/i })).toHaveLength(2));
    fireEvent.click(view.getAllByRole('button', { name: /view/i })[0]);
    await screen.findByTestId('report-panel');
    view.rerender(
      <>
        <OpenUiRenderer key='first' content={answer('First report', 'AAA')} isStreaming={false} onAction={vi.fn()} partId='p1' citationScope={{ conversationId: 'c', messageId: 'm1' }} />
        <ReportPanelSidebar key='panel' />
      </>,
    );
    expect(screen.getByTestId('report-panel')).toBeInTheDocument();
  });

  it('lists the sources a report marks under its chip, since the report text cannot carry chips', async () => {
    const withMarkers = answer('Q3 mail report').replace('Highlights', 'Highlights [2]').replace('Short answer.', 'Short answer [1].');
    mount(withMarkers, { citations: [citation('1'), citation('2')], citationScope: scope });
    await screen.findByRole('button', { name: '1' });
    const sources = screen.getByTestId('openui-report').querySelectorAll('button');
    expect(Array.from(sources).map((button) => button.textContent)).toContain('2');
    expect(within(screen.getByTestId('openui-report')).queryByRole('button', { name: '1' })).toBeNull();
  });
});

describe('report panel next to the file viewer', () => {
  const openViewerInSidebar = () => act(() => useFileViewerStore.setState({ mode: 'open', displayMode: 'sidebar' }));

  it('closes the file viewer sidebar when a report opens', async () => {
    openViewerInSidebar();
    mount(answer('Q3 mail report'));
    await screen.findByText('Short answer.');
    fireEvent.click(viewButton());
    await screen.findByTestId('report-panel');
    expect(useFileViewerStore.getState().mode).toBe('closed');
  });

  it('closes the report when the file viewer takes the sidebar', async () => {
    mount(answer('Q3 mail report'));
    await screen.findByText('Short answer.');
    fireEvent.click(viewButton());
    await screen.findByTestId('report-panel');
    openViewerInSidebar();
    await waitFor(() => expect(screen.queryByTestId('report-panel')).not.toBeInTheDocument());
  });

  it('leaves a floating file viewer alone', async () => {
    act(() => useFileViewerStore.setState({ mode: 'open', displayMode: 'floating' }));
    mount(answer('Q3 mail report'));
    await screen.findByText('Short answer.');
    fireEvent.click(viewButton());
    await screen.findByTestId('report-panel');
    expect(useFileViewerStore.getState().mode).toBe('open');
  });

  it('reopens the report after the file viewer took the sidebar, closing the viewer again', async () => {
    mount(answer('Q3 mail report'));
    await screen.findByText('Short answer.');
    fireEvent.click(viewButton());
    await screen.findByTestId('report-panel');
    openViewerInSidebar();
    await waitFor(() => expect(screen.queryByTestId('report-panel')).not.toBeInTheDocument());
    expect(useFileViewerStore.getState().mode).toBe('open');
    fireEvent.click(viewButton());
    await screen.findByTestId('report-panel');
    expect(useFileViewerStore.getState().mode).toBe('closed');
  });

  it('closes when the conversation changes', async () => {
    const view = render(<><OpenUiRenderer content={answer('Q3 mail report')} isStreaming={false} onAction={vi.fn()} /><ReportPanelSidebar resetKey='a' /></>);
    await screen.findByText('Short answer.');
    fireEvent.click(viewButton());
    await screen.findByTestId('report-panel');
    view.rerender(<><OpenUiRenderer content={answer('Q3 mail report')} isStreaming={false} onAction={vi.fn()} /><ReportPanelSidebar resetKey='b' /></>);
    await waitFor(() => expect(screen.queryByTestId('report-panel')).not.toBeInTheDocument());
  });
});
