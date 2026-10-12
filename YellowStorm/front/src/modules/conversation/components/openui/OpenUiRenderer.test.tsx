import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ThemeProviderContext, type ThemeProviderState } from '@/contexts/ThemeContext';
import { openFileViewerFromUrlLoader } from '@/modules/file-viewer';
import type { CitationData } from '@/components/ai-elements/ai-message-content';
import { toFollowUpMessage } from './actions';
import OpenUiRenderer, { resolveOpenUiMode } from './OpenUiRenderer';

vi.mock('@/modules/file-viewer', () => ({
  openFileViewerFromUrl: vi.fn(),
  openFileViewerFromUrlLoader: vi.fn().mockResolvedValue(undefined),
  getMimeTypeFromFilename: () => undefined,
  useFileViewerDisplayMode: () => 'sidebar',
}));
vi.mock('@/modules/conversation/api', () => ({ fetchRootEvidence: vi.fn(), getCitationViewUrl: vi.fn() }));

const program = (text: string) => `root = Card([body])\nbody = TextContent(${JSON.stringify(text)})`;
const citation = (overrides: Partial<CitationData>): CitationData => ({
  parentId: '', sourceType: 'text', source: 'workspace/contract.pdf', fileName: 'contract.pdf', externalId: '', page: '3', pageContent: 'Ends 31/12/2025', workspaceId: 'w', reference: '1', ...overrides,
});
const scope = { conversationId: 'c', messageId: 'm' };
const withTheme = (theme: string, children: ReactNode) => (
  <ThemeProviderContext.Provider value={{ theme } as ThemeProviderState}>{children}</ThemeProviderContext.Provider>
);
const themeStyles = () => Array.from(document.head.querySelectorAll('style[data-openui-theme]')).map((style) => style.textContent ?? '').join('\n');

afterEach(() => vi.clearAllMocks());

// Unmocked: proves the stock library mounts under React 18 + jsdom.
describe('OpenUiRenderer', () => {
  it('renders an OpenUI Lang program with the stock component library', async () => {
    render(<OpenUiRenderer content={program('Quarterly summary')} isStreaming={false} onAction={vi.fn()} />);
    expect(await screen.findByText('Quarterly summary')).toBeInTheDocument();
    expect(screen.getByTestId('openui-answer')).toHaveAttribute('data-openui-scope');
  });

  it('tags the scope with the stored component it renders', async () => {
    render(<OpenUiRenderer content={program('Tagged')} isStreaming={false} onAction={vi.fn()} partId='component-7' />);
    await screen.findByText('Tagged');
    expect(screen.getByTestId('openui-answer')).toHaveAttribute('data-openui-part', 'component-7');
  });

  describe('theme and typography', () => {
    it('scopes the compact typography tokens to the OpenUI wrapper only', async () => {
      render(<OpenUiRenderer content={program('Sized')} isStreaming={false} onAction={vi.fn()} />);
      await screen.findByText('Sized');
      const styles = themeStyles();
      expect(styles).toContain('[data-openui-scope]');
      expect(styles).toMatch(/--openui-text-body-default:\s*400 14px\//);
      expect(document.body.getAttribute('style') ?? '').not.toContain('--openui');
    });

    it('follows the app theme: dark and light get different palettes, system resolves through the media query', async () => {
      const { rerender } = render(withTheme('dark', <OpenUiRenderer content={program('Themed')} isStreaming={false} onAction={vi.fn()} />));
      await screen.findByText('Themed');
      const dark = themeStyles();
      rerender(withTheme('light', <OpenUiRenderer content={program('Themed')} isStreaming={false} onAction={vi.fn()} />));
      await waitFor(() => expect(themeStyles()).not.toBe(dark));
      expect(resolveOpenUiMode('light')).toBe('light');
      expect(resolveOpenUiMode('dark')).toBe('dark');
      vi.spyOn(globalThis, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
      expect(resolveOpenUiMode('system')).toBe('light');
    });
  });

  describe('streaming', () => {
    it('renders progressively and never swaps to the fallback on partial or invalid intermediate text', async () => {
      const fallback = <div data-testid='fallback' />;
      const full = 'root = Card([a, b])\na = TextContent("First block")\nb = TextContent("Second block")';
      const { rerender } = render(<OpenUiRenderer content='ro' isStreaming onAction={vi.fn()} fallback={fallback} />);
      expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
      rerender(<OpenUiRenderer content={'root = Card([a, b])\na = TextContent("First blo'} isStreaming onAction={vi.fn()} fallback={fallback} />);
      expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
      rerender(<OpenUiRenderer content={full.slice(0, full.indexOf('b = '))} isStreaming onAction={vi.fn()} fallback={fallback} />);
      expect(await screen.findByText('First block')).toBeInTheDocument();
      expect(screen.queryByText('Second block')).not.toBeInTheDocument();
      rerender(<OpenUiRenderer content={full} isStreaming={false} onAction={vi.fn()} fallback={fallback} />);
      expect(await screen.findByText('Second block')).toBeInTheDocument();
      expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
    });

    it('falls back to the markdown view only once the answer is complete and has no renderable root', async () => {
      const fallback = <div data-testid='fallback'>plain markdown answer</div>;
      const { rerender } = render(<OpenUiRenderer content='Just a plain sentence.' isStreaming onAction={vi.fn()} fallback={fallback} />);
      expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
      rerender(<OpenUiRenderer content='Just a plain sentence.' isStreaming={false} onAction={vi.fn()} fallback={fallback} />);
      expect(await screen.findByTestId('fallback')).toBeInTheDocument();
    });
  });

  describe('citations', () => {
    it('renders [n] markers in text as our citation chips and opens the document viewer on click', async () => {
      render(<OpenUiRenderer content={program('The contract ends on 31/12/2025 [1].')} isStreaming={false} onAction={vi.fn()} citations={[citation({})]} citationScope={scope} />);
      const chip = await screen.findByRole('button', { name: '1' });
      expect(chip.closest('[data-citation-ref="1"]')).not.toBeNull();
      expect(screen.getByTestId('openui-answer').textContent).not.toContain('[1]');
      fireEvent.click(chip);
      await waitFor(() => expect(openFileViewerFromUrlLoader).toHaveBeenCalledTimes(1));
      expect(vi.mocked(openFileViewerFromUrlLoader).mock.calls[0][0]).toBe(JSON.stringify(['c', 'm', 'workspace/contract.pdf']));
      expect(vi.mocked(openFileViewerFromUrlLoader).mock.calls[0][1]).toBe('contract.pdf');
    });

    it('keeps a marker without a known citation as literal text and shows unmarked citations after the answer', async () => {
      render(<OpenUiRenderer content={program('Known [1] and unknown [7].')} isStreaming={false} onAction={vi.fn()}
        citations={[citation({}), citation({ reference: '2', source: 'workspace/other.pdf', fileName: 'other.pdf' })]} citationScope={scope} />);
      await screen.findByRole('button', { name: '1' });
      expect(screen.getByTestId('openui-answer')).toHaveTextContent('unknown [7]');
      expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
    });

    const two = [citation({}), citation({ reference: '2', source: 'workspace/other.pdf', fileName: 'other.pdf' })];
    const renderProgram = (source: string) => render(<OpenUiRenderer content={source} isStreaming={false} onAction={vi.fn()} citations={two} citationScope={scope} />);

    it('renders chips in Steps (title and details) and opens the viewer from them', async () => {
      renderProgram('root = Card([s])\ns = Steps([a, b])\na = StepsItem("Open the module [2]", "Fill the mask [1] and save.")\nb = StepsItem("Validate", "Check it [1][2].")');
      await screen.findAllByRole('button', { name: '1' });
      const details = document.querySelectorAll('.openui-step-details [data-citation-ref]');
      expect(Array.from(details).map((chip) => chip.getAttribute('data-citation-ref'))).toEqual(['1', '1', '2']);
      expect(document.querySelector('.openui-step-title [data-citation-ref="2"]')).not.toBeNull();
      expect(screen.getByTestId('openui-answer').textContent).not.toMatch(/\[\d\]/);
      fireEvent.click(document.querySelector('.openui-step-details [data-citation-ref="1"] button')!);
      await waitFor(() => expect(openFileViewerFromUrlLoader).toHaveBeenCalledTimes(1));
    });

    it('renders chips in CalloutV2 title and description', async () => {
      renderProgram('root = Card([c])\nc = CalloutV2("info", "Heads up [2]", "The contract says so [1].")');
      await waitFor(() => expect(document.querySelectorAll('.openui-callout [data-citation-ref]')).toHaveLength(2));
      expect(document.querySelector('.openui-callout-title [data-citation-ref="2"]')).not.toBeNull();
      expect(document.querySelector('.openui-callout-description [data-citation-ref="1"]')).not.toBeNull();
    });

    it('renders chips in table cells, headers and TextContent markdown', async () => {
      renderProgram('root = Card([h, t, m])\nh = Header("Summary [1]", "Sources [2]")\nt = Table([Col("Doc"), Col("Pages", "number")], [["Contract [1]", 3], ["Plain", 4]])\nm = TextContent("**Bold** claim [2].")');
      await waitFor(() => expect(document.querySelectorAll('[data-citation-ref]')).toHaveLength(4));
      expect(document.querySelector('td [data-citation-ref="1"]')).not.toBeNull();
      expect(document.querySelector('.openui-header [data-citation-ref="2"]')).not.toBeNull();
      expect(screen.getByText('Plain')).toBeInTheDocument();
      expect(document.querySelector('.c1-text-content strong')?.textContent).toBe('Bold');
    });

    it('renders chips in List items and headings, EntityList rows and the Text of a list', async () => {
      renderProgram('root = Card([l, e])\nl = List([i1, i2], "number", "Findings [1]")\ni1 = ListItem("Term ends 2025 [1]", "Per the contract [2]")\ni2 = ListItem("Plain item")\ne = EntityList([{left: "Revenue [2]", right: "12 [1]"}])');
      await waitFor(() => expect(document.querySelectorAll('[data-citation-ref]')).toHaveLength(5));
      expect(document.querySelector('.c1-list .c1-inline-header-heading [data-citation-ref="1"]')).not.toBeNull();
      expect(document.querySelector('.c1-entity-list__cell-left [data-citation-ref="2"]')).not.toBeNull();
      expect(document.querySelector('.c1-entity-list__cell-right [data-citation-ref="1"]')).not.toBeNull();
      expect(screen.getByText('Plain item')).toBeInTheDocument();
    });

    it('leaves unknown markers literal in Steps and CalloutV2 too', async () => {
      renderProgram('root = Card([s, c])\ns = Steps([a])\na = StepsItem("Step [9]", "Detail [9] and [1].")\nc = CalloutV2("info", "T", "Callout [8].")');
      await screen.findByRole('button', { name: '1' });
      const text = screen.getByTestId('openui-answer').textContent ?? '';
      expect(text).toContain('Step [9]');
      expect(text).toContain('Detail [9]');
      expect(text).toContain('Callout [8]');
    });

    it('does not turn markers into chips when the answer has no citations', async () => {
      render(<OpenUiRenderer content={program('Plain [1] text')} isStreaming={false} onAction={vi.fn()} />);
      expect(await screen.findByText(/Plain \[1\] text/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument();
    });
  });

  describe('chat library blocks', () => {
    const two = [citation({}), citation({ reference: '2', source: 'workspace/other.pdf', fileName: 'other.pdf' })];
    const renderProgram = (source: string) => render(
      <OpenUiRenderer content={source} isStreaming={false} onAction={vi.fn()} citations={two} citationScope={scope} />,
    );

    it('sends a clicked follow-up to the conversation as a user message', async () => {
      const onAction = vi.fn();
      render(<OpenUiRenderer content={'root = Card([t, f])\nt = TextContent("Done")\nf = FollowUpBlock(["Compare with MSFT", "Show the 5-year trend"])'} isStreaming={false} onAction={onAction} />);
      fireEvent.click(await screen.findByText('Show the 5-year trend'));
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(toFollowUpMessage(onAction.mock.calls[0][0])).toEqual({ kind: 'message', content: 'Show the 5-year trend' });
    });

    it('renders chips in SectionBlock content and shows no Sources strip', async () => {
      renderProgram('root = Card([sec])\nsec = SectionBlock([s1])\ns1 = SectionBlockItem("a", "Overview", [t])\nt = TextContent("Revenue grew [1].")');
      await screen.findByRole('button', { name: '1' });
      expect(document.querySelector('.openui-foldable-section-item [data-citation-ref="1"]')).not.toBeNull();
      expect(document.querySelector('.openui-sources')).toBeNull();
    });

    it('ignores the sources argument of Card: citations come from the tools, not from the model', async () => {
      renderProgram('root = Card([t], [s])\nt = TextContent("Revenue grew [1].")\ns = { title: "Invented", sourceName: "Nowhere", url: "https://example.com" }');
      await screen.findByRole('button', { name: '1' });
      expect(screen.getByTestId('openui-answer')).not.toHaveTextContent('Invented');
    });

    it('renders chips in card block text, inline headers and the glyph stays the stock one', async () => {
      renderProgram(
        'root = Card([h, cb])\nh = InlineHeader("Revenue [1]", "Per the filing [2]")\n'
        + 'cb = CompositeCardBlock([c1, c2])\n'
        + 'c1 = CompositeCardItem("x", head1, [body1, bold1])\nc2 = CompositeCardItem("y", head2, [body2])\n'
        + 'head1 = IconText(ic, "neutral", "m", "ACME [1]", "Up [2]")\nhead2 = IconText(ic, "neutral", "m", "Globex", "Flat")\nic = Icon("building", "business")\n'
        + 'body1 = Text("text", "Margin 12% [2]", "+3 pts [1]", "metric")\nbold1 = BoldText("text", "Strong [1]")\nbody2 = Text("text", "Margin 8%")',
      );
      await waitFor(() => expect(document.querySelectorAll('[data-citation-ref]')).toHaveLength(7));
      expect(document.querySelector('.c1-inline-header-heading [data-citation-ref="1"]')).not.toBeNull();
      expect(document.querySelector('.c1-icon-text__content [data-citation-ref="2"]')).not.toBeNull();
      expect(document.querySelector('.c1-text-block__secondary--positive [data-citation-ref="1"]')).not.toBeNull();
      expect(document.querySelectorAll('.c1-icon-text .c1-icon-tag')).toHaveLength(2);
      expect(screen.getByText('Globex')).toBeInTheDocument();
      expect(screen.getByTestId('openui-answer').textContent).not.toMatch(/\[\d\]/);
    });
  });
});
