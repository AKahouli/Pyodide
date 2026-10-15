import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CitationData } from '@/components/ai-elements/ai-message-content';
import { useFileViewerStore } from '@/modules/file-viewer/store';
import OpenUiRenderer from './OpenUiRenderer';
import { ReportPanelSidebar } from './ReportPanelSidebar';
import { initialState, reportPanelStore } from './report-panel-store';
import { getGeneratedImageUrl } from '../../api';
vi.mock('./ConversationImageActions', () => ({ ConversationImageActions: ({ source }: { source: string }) => <span data-testid='image-actions' data-source={source} /> }));

vi.mock('@/modules/file-viewer', () => ({
  openFileViewerFromUrl: vi.fn(),
  openFileViewerFromUrlLoader: vi.fn().mockResolvedValue(undefined),
  getMimeTypeFromFilename: () => undefined,
  useFileViewerDisplayMode: () => 'sidebar',
}));
vi.mock('@/modules/conversation/api', () => ({ fetchRootEvidence: vi.fn(), getCitationViewUrl: vi.fn(), getGeneratedImageUrl: vi.fn(), fetchSlideExportImage: vi.fn() }));

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
  it('resolves a generated slide background before showing its preview and releases it on unmount', async () => {
    vi.mocked(getGeneratedImageUrl).mockResolvedValue({ url: 'https://storage.example/image.png', mimeType: 'image/png', fileName: 'image.png' });
    const fetchImage = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }));
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:generated-slide');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const view = mount('root = Presentation({title: "Generated deck"}, [s1])\ns1 = Slide("s1", MinimalTitle("Generated cover", "", "", {imageUrl: "", name: "", role: ""}, "title-top", "generated-image:0123456789abcdef01234567"))', { citationScope: scope });
    await screen.findByRole('button', { name: /view/i });
    fireEvent.click(viewButton());
    await screen.findByTestId('report-panel');
    await waitFor(() => expect(document.querySelector('[style*="blob:generated-slide"]')).not.toBeNull());
    expect(getGeneratedImageUrl).toHaveBeenCalledWith('c', 'm', '0123456789abcdef01234567', expect.any(AbortSignal));
    expect(screen.getAllByTestId('image-actions').some((element) => element.dataset.source === 'generated-image:0123456789abcdef01234567')).toBe(true);
    expect(screen.getAllByTestId('image-actions').every((element) => element.closest('button') === null)).toBe(true);
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:generated-slide');
    create.mockRestore(); revoke.mockRestore(); fetchImage.mockRestore();
  });
  it('preserves generated image selectors for report image actions in the preview', async () => {
    vi.mocked(getGeneratedImageUrl).mockResolvedValue({ url: 'https://storage.example/image.png', mimeType: 'image/png', fileName: 'image.png' });
    const fetchImage = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }));
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report-image');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const view = mount('root = Report({title: "Image report"}, [p])\np = Page("page", ContentPage([Image("generated-image:0123456789abcdef01234567", "Saved chart")]))', { citationScope: scope });
    fireEvent.click(await screen.findByRole('button', { name: /view/i }));
    await screen.findByRole('img', { name: 'Saved chart' });
    expect(screen.getAllByTestId('image-actions').some((element) => element.dataset.source === 'generated-image:0123456789abcdef01234567')).toBe(true);
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:report-image');
    create.mockRestore(); revoke.mockRestore(); fetchImage.mockRestore();
  });
  it('clears the artifact owner when an open presentation unmounts', async () => {
    const view = mount('root = Presentation({title: "Japan"}, [s1])\ns1 = Slide("s1", MinimalTitle("Japan"))');
    await screen.findByRole('button', { name: /view/i });
    fireEvent.click(viewButton());
    await screen.findByTestId('report-panel');
    view.rerender(<ReportPanelSidebar />);
    await waitFor(() => expect(reportPanelStore.getState().activeDetailedViewId).toBeNull());
  });
  it('opens a stock slide deck, navigates thumbnails, and closes the shared preview', async () => {
    const slides = 'root = Presentation({title: "Japan slides"}, [s1, s2])\ns1 = Slide("s1", MinimalTitle("Visit Japan"))\ns2 = Slide("s2", ContentClassic("Places to explore", ["Tokyo", "Kyoto"]))';
    mount(`${CHAT}\n\n${slides}`);
    await screen.findByText('Short answer.');
    fireEvent.click(viewButton());
    const panel = await screen.findByTestId('report-panel');
    expect(within(panel).getByRole('button', { name: 'openui.slides.export.label' })).toBeInTheDocument();
    const second = await within(panel).findByRole('button', { name: 'Go to slide 2' });
    fireEvent.click(second);
    expect(within(panel).getByLabelText('Slide 2 of 2')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'openui.report.close' }));
    await waitFor(() => expect(screen.queryByTestId('report-panel')).not.toBeInTheDocument());
  });

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
    expect(within(panel).queryByRole('button', { name: 'openui.slides.export.label' })).not.toBeInTheDocument();
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
