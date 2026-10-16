import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CitationData } from '@/components/ai-elements/ai-message-content';
import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import { fetchRootEvidence, fetchSlideExportImage, getCitationViewUrl, getGeneratedImageUrl } from '../../api';
import { renderPdfImage } from './pdf-image';
import OpenUiRenderer from './OpenUiRenderer';
import { mapImageSources } from './document-images';

vi.mock('../../api', () => ({ fetchRootEvidence: vi.fn(), fetchSlideExportImage: vi.fn(), getCitationViewUrl: vi.fn(), getGeneratedImageUrl: vi.fn() }));
vi.mock('./ConversationImageActions', () => ({ ConversationImageActions: ({ source }: { source: string }) => <span data-testid='image-actions' data-source={source} /> }));
vi.mock('./pdf-image', () => ({ renderPdfImage: vi.fn() }));
vi.mock('@/modules/file-viewer', () => ({
  openFileViewerFromUrlLoader: vi.fn(), getMimeTypeFromFilename: () => 'application/pdf', useFileViewerDisplayMode: () => 'sidebar',
}));

const scope = { conversationId: 'conversation', messageId: 'answer' };
const citation: CitationData = {
  parentId: '', sourceType: 'text', source: 'owner/workspace/test_image.pdf', fileName: 'test_image.pdf',
  externalId: '', page: '1', pageContent: 'Bar chart', workspaceId: 'workspace', reference: '1',
  blockBBox: [100, 200, 400, 150],
};
const figure = 'root = Card([figure])\nfigure = Image("Original bar chart", "[1]")';
const imageBlob = new Blob(['image'], { type: 'image/png' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(new Uint8Array(4), { headers: { 'content-type': 'image/png' } })));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:document-image');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.mocked(getCitationViewUrl).mockResolvedValue({ url: 'https://storage.example/authorized.pdf', fileName: 'test_image.pdf', mimeType: 'application/pdf' });
  vi.mocked(renderPdfImage).mockResolvedValue(imageBlob);
  vi.mocked(fetchSlideExportImage).mockResolvedValue('data:image/png;base64,aW1hZ2U=');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('OpenUI document images', () => {
  it('renders image actions for authorized web images and preserves their exact source', async () => {
    vi.mocked(fetchSlideExportImage).mockResolvedValue('data:image/png;base64,aW1hZ2U=');
    render(<OpenUiRenderer content={'root = Image("Web photo", "https://images.example/photo.png")'} isStreaming={false} onAction={vi.fn()} citationScope={scope} />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Web photo' })).toHaveAttribute('src', 'blob:document-image'));
    expect(screen.getByTestId('image-actions')).toHaveAttribute('data-source', 'https://images.example/photo.png');
    expect(fetchSlideExportImage).toHaveBeenCalledWith('conversation', 'answer', 'https://images.example/photo.png', expect.any(AbortSignal));
  });
  it.each([
    { mode: 'openui', generated: false }, { mode: 'markdown', generated: false },
    { mode: 'openui', generated: true }, { mode: 'markdown', generated: true },
  ])('labels $mode images according to resolver provenance: generated=$generated', async ({ mode, generated }) => {
    const source = 'generated-image:0123456789abcdef01234567';
    vi.mocked(getGeneratedImageUrl).mockResolvedValue({ url: 'https://storage.example/image.png', fileName: generated ? 'edited.png' : 'generated-import-original.png', mimeType: 'image/png', generated });
    vi.mocked(fetch).mockImplementation(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }));
    const props = { citationScope: scope, isStreaming: false };
    const image = mode === 'openui'
      ? <OpenUiRenderer {...props} content={`root = Image("Source image", "${source}")`} onAction={vi.fn()} />
      : <AIMessageContent {...props} parts={[{ type: 'text', content: `![Source image](${source})` }]} />;
    const view = render(image);
    expect(screen.queryByText('openui.image.generated')).not.toBeInTheDocument();
    await screen.findByRole('img', { name: 'Source image' });
    expect(Boolean(screen.queryByText('openui.image.generated'))).toBe(generated);
    expect(screen.getByRole('link', { name: 'openui.image.preview' })).toHaveAttribute('href', 'blob:document-image');
    if (mode === 'markdown') expect(screen.getByRole('link', { name: 'openui.image.download' })).toHaveAttribute('download');
    else expect(screen.getByTestId('image-actions')).toHaveAttribute('data-source', source);
    view.unmount();
    render(image);
    await screen.findByRole('img', { name: 'Source image' });
    expect(Boolean(screen.queryByText('openui.image.generated'))).toBe(generated);
    expect(getGeneratedImageUrl).toHaveBeenCalledTimes(2);
  });

  it('renders stable generated images in ordinary Markdown with preview and download links', async () => {
    const source = 'generated-image:0123456789abcdef01234567';
    vi.mocked(getGeneratedImageUrl).mockResolvedValue({ url: 'https://storage.example/generated.png', fileName: 'generated.png', mimeType: 'image/png' });
    vi.mocked(fetch).mockImplementation(async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }));
    const parts = [{ type: 'text' as const, content: `![Generated landscape](${source})` }];
    const view = render(<AIMessageContent parts={parts} isStreaming citationScope={scope} />);
    expect(getGeneratedImageUrl).not.toHaveBeenCalled();
    view.rerender(<AIMessageContent parts={parts} isStreaming={false} citationScope={scope} />);
    expect(await screen.findByRole('img', { name: 'Generated landscape' })).toHaveAttribute('src', 'blob:document-image');
    expect(screen.getByRole('link', { name: 'openui.image.preview' })).toHaveAttribute('href', 'blob:document-image');
    expect(screen.getByRole('link', { name: 'openui.image.download' })).toHaveAttribute('download');
  });
  it('resolves generated images only after completion and resolves again after reload', async () => {
    const id = '0123456789abcdef01234567';
    const props = { content: `root = Image("Generated landscape", "generated-image:${id}")`, onAction: vi.fn(), citationScope: scope };
    vi.mocked(getGeneratedImageUrl).mockResolvedValue({ url: 'https://storage.example/generated.png', fileName: 'generated.png', mimeType: 'image/png' });
    vi.mocked(fetch).mockImplementation(async () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png' } }));
    const view = render(<OpenUiRenderer {...props} isStreaming />);
    expect(getGeneratedImageUrl).not.toHaveBeenCalled();
    view.rerender(<OpenUiRenderer {...props} isStreaming={false} />);
    expect(await screen.findByRole('img', { name: 'Generated landscape' })).toHaveClass('object-contain', 'h-auto');
    expect(getGeneratedImageUrl).toHaveBeenCalledWith('conversation', 'answer', id, expect.any(AbortSignal));
    expect(screen.getByText('openui.image.generated')).toBeInTheDocument();
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:document-image');
    render(<OpenUiRenderer {...props} isStreaming={false} />);
    await screen.findByRole('img', { name: 'Generated landscape' });
    expect(getGeneratedImageUrl).toHaveBeenCalledTimes(2);
    expect(getCitationViewUrl).not.toHaveBeenCalled();
  });

  it('fails closed when a generated image is denied', async () => {
    vi.mocked(getGeneratedImageUrl).mockRejectedValue(new Error('Denied'));
    render(<OpenUiRenderer content={'root = Image("Generated", "generated-image:0123456789abcdef01234567")'} isStreaming={false} onAction={vi.fn()} citationScope={scope} />);
    await screen.findByRole('alert');
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('renders the cited PDF region without cropping and signs it again when the answer remounts', async () => {
    const figureCitation = { ...citation, highlightBBox: [120, 210, 350, 120] as [number, number, number, number] };
    const props = { content: figure, isStreaming: false, onAction: vi.fn(), citations: [figureCitation], citationScope: scope };
    const view = render(<OpenUiRenderer {...props} />);
    const image = await screen.findByRole('img', { name: 'Original bar chart' });
    expect(image).toHaveAttribute('src', 'blob:document-image');
    expect(image).toHaveClass('object-contain');
    expect(image).toHaveClass('w-auto', 'max-w-full', 'h-auto', 'max-h-96');
    expect(image).not.toHaveClass('w-full');
    expect(getCitationViewUrl).toHaveBeenCalledWith('conversation', 'answer', { source: citation.source, fileName: 'test_image.pdf', reference: '1' }, expect.any(AbortSignal));
    expect(renderPdfImage).toHaveBeenCalledWith('https://storage.example/authorized.pdf', 1, figureCitation.highlightBBox, expect.any(AbortSignal));
    expect(screen.getByText(/test_image.pdf/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:document-image');
    render(<OpenUiRenderer {...props} />);
    await screen.findByRole('img', { name: 'Original bar chart' });
    expect(getCitationViewUrl).toHaveBeenCalledTimes(2);
  });

  it('waits for stream completion and uses owned evidence without falling back to the legacy signer', async () => {
    const owned = { ...citation, evidenceId: 'evidence', executionId: 'execution' };
    vi.mocked(fetchRootEvidence).mockResolvedValue({ kind: 'citation', url: 'https://storage.example/figure.png', fileName: 'figure.png', mimeType: 'image/png' } as Awaited<ReturnType<typeof fetchRootEvidence>>);
    const props = { content: figure, onAction: vi.fn(), citations: [owned], citationScope: scope };
    const { rerender } = render(<OpenUiRenderer {...props} isStreaming />);
    expect(getCitationViewUrl).not.toHaveBeenCalled();
    expect(fetchRootEvidence).not.toHaveBeenCalled();
    expect(screen.queryByRole('img', { name: 'Original bar chart' })).not.toBeInTheDocument();
    rerender(<OpenUiRenderer {...props} isStreaming={false} />);
    await screen.findByRole('img', { name: 'Original bar chart' });
    expect(fetchRootEvidence).toHaveBeenCalledWith('conversation', 'execution', 'evidence', expect.any(AbortSignal));
    expect(getCitationViewUrl).not.toHaveBeenCalled();
    expect(renderPdfImage).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('https://storage.example/figure.png', { signal: expect.any(AbortSignal), credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('shows a retryable error after denied access and never exposes a storage path as an image URL', async () => {
    vi.mocked(getCitationViewUrl).mockRejectedValueOnce(new Error('Access revoked'));
    render(<OpenUiRenderer content={figure} isStreaming={false} onAction={vi.fn()} citations={[citation]} citationScope={scope} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Original bar chart' })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'home.retry' }));
    await screen.findByRole('img', { name: 'Original bar chart' });
    expect(getCitationViewUrl).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown references and web-page citations before requesting image bytes', async () => {
    const props = { content: figure, isStreaming: false, onAction: vi.fn(), citationScope: scope };
    const { rerender } = render(<OpenUiRenderer {...props} citations={[]} />);
    await screen.findByRole('alert');
    rerender(<OpenUiRenderer {...props} citations={[{ ...citation, sourceType: 'web', source: 'https://example.test/page' }]} />);
    await screen.findByRole('alert');
    expect(getCitationViewUrl).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ evidenceId: 'evidence' }, { evidenceId: '', executionId: '' }, { evidenceId: ' ', executionId: 'execution' }])('fails closed for an incomplete owned evidence identity %j without legacy signing', async (identity) => {
    render(<OpenUiRenderer content={figure} isStreaming={false} onAction={vi.fn()} citations={[{ ...citation, ...identity }]} citationScope={scope} />);
    await screen.findByRole('alert');
    expect(fetchRootEvidence).not.toHaveBeenCalled();
    expect(getCitationViewUrl).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves gallery and nested image cards using the same citation reference', async () => {
    vi.mocked(URL.createObjectURL).mockImplementation((blob) => blob === imageBlob ? 'blob:document-image' : 'blob:web-image');
    const gallery = 'root = Card([gallery])\ngallery = ImageGallery(["Original chart", "Web photo"], ["[1]", "https://example.test/photo.png"])';
    const { rerender } = render(<OpenUiRenderer content={gallery} isStreaming={false} onAction={vi.fn()} citations={[citation]} citationScope={scope} />);
    expect(await screen.findByRole('img', { name: 'Original chart' })).toHaveAttribute('src', 'blob:document-image');
    expect(screen.getByRole('img', { name: 'Web photo' })).toHaveAttribute('src', 'blob:web-image');
    fireEvent.error(screen.getByRole('img', { name: 'Web photo' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Original chart' })).toHaveAttribute('src', 'blob:document-image');
    const cards = 'root = Card([cards])\ncards = VisualCardBlock([a, b], "grid")\na = VisualCardItem(BoldText("text", "Original chart", "Source figure"), "a", "[1]")\nb = VisualCardItem(BoldText("text", "Other view", "Same figure"), "b", "[1]")';
    rerender(<OpenUiRenderer content={cards} isStreaming={false} onAction={vi.fn()} citations={[citation]} citationScope={scope} />);
    await waitFor(() => expect(document.querySelector('[style*="blob:document-image"]')).not.toBeNull());
    expect(getCitationViewUrl).toHaveBeenCalledTimes(1);
  });

  it('keeps successful gallery images visible and retries only the failed image', async () => {
    vi.mocked(URL.createObjectURL).mockImplementation((blob) => blob === imageBlob ? 'blob:document-image' : 'blob:retried-web-image');
    vi.mocked(fetchSlideExportImage).mockRejectedValueOnce(new Error('Temporary failure')).mockResolvedValue('data:image/png;base64,aW1hZ2U=');
    const gallery = 'root = ImageGallery(["Original chart", "Web photo"], ["[1]", "https://example.test/photo.png"])';
    render(<OpenUiRenderer content={gallery} isStreaming={false} onAction={vi.fn()} citations={[citation]} citationScope={scope} />);
    const good = await screen.findByRole('img', { name: 'Original chart' });
    await screen.findByRole('alert');
    expect(good).toHaveAttribute('src', 'blob:document-image');
    expect(screen.queryByRole('img', { name: 'Web photo' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'home.retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('img', { name: 'Web photo' })).toHaveAttribute('src', 'blob:retried-web-image'));
    expect(screen.getByRole('img', { name: 'Original chart' })).toHaveAttribute('src', 'blob:document-image');
    expect(getCitationViewUrl).toHaveBeenCalledTimes(1);
    expect(renderPdfImage).toHaveBeenCalledTimes(1);
    expect(fetchSlideExportImage).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('deduplicates identical image references across separate components of one answer', async () => {
    const program = 'root = Card([a, b])\na = Image("First view", "[1]")\nb = Image("Second view", "[1]")';
    const view = render(<OpenUiRenderer content={program} isStreaming={false} onAction={vi.fn()} citations={[citation]} citationScope={scope} />);
    await screen.findByRole('img', { name: 'First view' });
    await screen.findByRole('img', { name: 'Second view' });
    expect(getCitationViewUrl).toHaveBeenCalledTimes(1);
    view.rerender(<OpenUiRenderer content={program} isStreaming={false} onAction={vi.fn()} citations={[citation]} citationScope={{ conversationId: 'other-user-conversation', messageId: 'other-answer' }} />);
    await waitFor(() => expect(getCitationViewUrl).toHaveBeenCalledTimes(2));
    expect(getCitationViewUrl).toHaveBeenLastCalledWith('other-user-conversation', 'other-answer', expect.any(Object), expect.any(AbortSignal));
  });

  it('retries one labeled failed image without retrying another failed source', async () => {
    vi.mocked(fetchSlideExportImage).mockImplementation(async (_conversation, _message, source) => {
      if (source.endsWith('/first.png') && vi.mocked(fetchSlideExportImage).mock.calls.filter((call) => call[2] === source).length > 1) return 'data:image/png;base64,aW1hZ2U=';
      throw new Error('Unavailable');
    });
    const gallery = 'root = ImageGallery(["First landscape", "Second portrait"], ["https://example.test/first.png", "https://example.test/second.png"])';
    render(<OpenUiRenderer content={gallery} isStreaming={false} onAction={vi.fn()} citationScope={scope} />);
    const first = await screen.findByRole('alert', { name: 'First landscape' });
    await screen.findByRole('alert', { name: 'Second portrait' });
    await waitFor(() => expect(within(first).getByRole('button', { name: 'home.retry' })).toBeEnabled());
    fireEvent.click(within(first).getByRole('button', { name: 'home.retry' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'First landscape' })).toHaveAttribute('src', 'blob:document-image'));
    expect(screen.queryByRole('alert', { name: 'First landscape' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert', { name: 'Second portrait' })).toBeInTheDocument();
    expect(vi.mocked(fetchSlideExportImage).mock.calls.filter((call) => call[2].endsWith('/first.png'))).toHaveLength(2);
    expect(vi.mocked(fetchSlideExportImage).mock.calls.filter((call) => call[2].endsWith('/second.png'))).toHaveLength(1);
  });

  it('does not publish a removed gallery source after an array changes during loading', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof getCitationViewUrl>>) => void;
    vi.mocked(getCitationViewUrl).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const gallery = 'root = ImageGallery(["Removed chart", "Earlier web"], ["[1]", "https://example.test/earlier.png"])';
    const view = render(<OpenUiRenderer content={gallery} isStreaming={false} onAction={vi.fn()} citations={[citation]} citationScope={scope} />);
    await waitFor(() => expect(resolveOld).toBeDefined());
    view.rerender(<OpenUiRenderer content={'root = ImageGallery(["Current web"], ["https://example.test/current.png"])'} isStreaming={false} onAction={vi.fn()} citations={[citation]} citationScope={scope} />);
    await screen.findByRole('img', { name: 'Current web' });
    resolveOld({ url: 'https://storage.example/old.pdf', fileName: 'old.pdf', mimeType: 'application/pdf' });
    await waitFor(() => expect(renderPdfImage).toHaveBeenCalled());
    expect(screen.queryByRole('img', { name: 'Removed chart' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Earlier web' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByTestId('image-actions')).toHaveAttribute('data-source', 'https://example.test/current.png');
  });

  it('only transforms image fields, preserving captions, source markers and card identifiers', () => {
    expect(mapImageSources({ title: '[1]', id: '[1]', image: { props: { src: '[1]', alt: '[1]' } }, imagesSrc: ['[1]'] }, () => 'blob:image'))
      .toEqual({ title: '[1]', id: '[1]', image: { props: { src: 'blob:image', alt: '[1]' } }, imagesSrc: ['blob:image'] });
  });
});
