import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './code-block';
import { streamMetrics } from '@/modules/conversation/utils/stream-metrics';

const codeToHtmlMock = vi.hoisted(() => vi.fn(async (code: string) => `<pre class="shiki">${code}</pre>`));

vi.mock('shiki', () => ({
  codeToHtml: codeToHtmlMock,
}));

describe('CodeBlock streaming/highlight split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamMetrics.reset();
  });

  it('renders plain code while streaming and performs zero codeToHtml calls', () => {
    render(<CodeBlock code={'const a = 1;'} language='typescript' isStreaming />);
    expect(screen.getByText('const a = 1;')).toBeInTheDocument();
    expect(codeToHtmlMock).not.toHaveBeenCalled();
    expect(streamMetrics.snapshot()).toBeNull();
  });

  it('highlights once after finalization with a single dual-theme call and records metrics', async () => {
    const { rerender } = render(<CodeBlock code={'const a = 1;'} language='typescript' isStreaming />);
    rerender(<CodeBlock code={'const a = 1;'} language='typescript' />);

    await waitFor(() => expect(codeToHtmlMock).toHaveBeenCalledTimes(1));
    expect(codeToHtmlMock).toHaveBeenCalledWith('const a = 1;', expect.objectContaining({
      lang: 'typescript',
      themes: { light: 'one-light', dark: 'one-dark-pro' },
      defaultColor: 'light',
    }));
    await waitFor(() => expect(streamMetrics.snapshot()).toMatchObject({
      shikiHighlightCalls: 1,
      shikiHighlightMaxChars: 12,
    }));
  });

  it('serves repeated identical blocks from the bounded cache without new calls', async () => {
    const { rerender } = render(<CodeBlock code={'print(1)'} language='python' />);
    await waitFor(() => expect(codeToHtmlMock).toHaveBeenCalledTimes(1));
    rerender(<div />);
    render(<CodeBlock code={'print(1)'} language='python' />);
    // Give any (should-not-exist) second call a chance to surface.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(codeToHtmlMock).toHaveBeenCalledTimes(1);
  });

  it('discards stale highlight results when the code changes mid-flight', async () => {
    codeToHtmlMock.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve('<pre>slow-first</pre>'), 30)),
    );
    const { rerender } = render(<CodeBlock code={'first'} language='typescript' />);
    rerender(<CodeBlock code={'second'} language='typescript' />);
    await waitFor(() => expect(codeToHtmlMock).toHaveBeenCalledTimes(2));
    // The faster second result wins; the stale first result never renders.
    await waitFor(() => expect(screen.getByText('second')).toBeInTheDocument());
  });

  it('shows plain code until the highlight resolves instead of an empty block', async () => {
    let resolveHighlight!: (html: string) => void;
    codeToHtmlMock.mockImplementationOnce(() => new Promise((resolve) => { resolveHighlight = resolve; }));
    render(<CodeBlock code={'pending code'} language='typescript' />);

    // While the highlight is pending the plain code is already visible —
    // the block is never blank.
    expect(screen.getByText('pending code')).toBeInTheDocument();
    expect(document.querySelector('.shiki')).toBeNull();

    await waitFor(() => expect(codeToHtmlMock).toHaveBeenCalledTimes(1));
    resolveHighlight('<pre class="shiki">highlighted</pre>');
    await waitFor(() => expect(document.querySelector('.shiki')).toBeInTheDocument());
    expect(screen.queryByText('pending code')).not.toBeInTheDocument();
  });

  it('keeps the plain code readable when highlighting fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    codeToHtmlMock.mockRejectedValueOnce(new Error('shiki unavailable'));
    render(<CodeBlock code={'const broken = 1;'} language='typescript' />);

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    // After the failure the code is still readable — never blanked.
    expect(screen.getByText('const broken = 1;')).toBeInTheDocument();
    expect(document.querySelector('.shiki')).toBeNull();
    consoleError.mockRestore();
  });
});
