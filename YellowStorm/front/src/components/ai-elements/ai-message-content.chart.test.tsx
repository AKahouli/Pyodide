import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AIMessageContent, type MessageContentPart } from './ai-message-content';
import { MessageProvider } from './message-context';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';

const openFileViewerFromUrlMock = vi.hoisted(() => vi.fn());
const openFileViewerFromUrlLoaderMock = vi.hoisted(() => vi.fn());
const getFileSignedUrlMock = vi.hoisted(() => vi.fn());
const getCitationViewUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, options?: { page?: string }) => key === 'ai.citations.page' ? `Page ${options?.page}` : key,
    language: 'en',
  }),
}));

vi.mock('@/modules/file-viewer', () => ({
  openFileViewerFromUrl: openFileViewerFromUrlMock,
  openFileViewerFromUrlLoader: openFileViewerFromUrlLoaderMock,
  getMimeTypeFromFilename: (fileName: string) => fileName.endsWith('.png') ? 'image/png' : 'application/pdf',
  useFileViewerDisplayMode: () => 'sidebar',
}));

vi.mock('@/modules/conversation-v2/api', () => ({
  conversationV2Api: { getFileSignedUrl: getFileSignedUrlMock },
}));

vi.mock('@/modules/conversation/api', () => ({ getCitationViewUrl: getCitationViewUrlMock }));

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe = (target: Element) => this.callback([{
      target,
      contentRect: { width: 800, height: 250 },
    } as ResizeObserverEntry], this as unknown as ResizeObserver);
    unobserve = vi.fn();
    disconnect = vi.fn();
  });
});

describe('AIMessageContent charts', () => {
  it('renders an exact choice prompt only once', () => {
    const prompt = 'Pour vous orienter, de quel type de dossier s’agit-il ?';
    const parts: MessageContentPart[] = [
      { type: 'text', content: ` ${prompt} ` },
      {
        type: 'choice', componentId: 'choice-1', schemaVersion: 1, questionId: 'dossier-type', prompt,
        presentation: 'quick_replies', selectionMode: 'single', submitBehavior: 'immediate', status: 'ready',
        options: [{ id: 'create', label: 'Créer une activité', submitText: 'Créer une activité' }, { id: 'funding', label: 'Demander une aide', submitText: 'Demander une aide' }],
      },
    ];

    render(<AIMessageContent parts={parts} />);

    expect(screen.getAllByText(prompt)).toHaveLength(1);
  });

  it('keeps non-identical text alongside a choice prompt', () => {
    const prompt = 'Choisissez une option';
    const parts: MessageContentPart[] = [
      { type: 'text', content: `${prompt} pour continuer.` },
      {
        type: 'choice', componentId: 'choice-1', schemaVersion: 1, questionId: 'next-step', prompt,
        presentation: 'quick_replies', selectionMode: 'single', submitBehavior: 'immediate', status: 'ready',
        options: [{ id: 'one', label: 'Un', submitText: 'Un' }, { id: 'two', label: 'Deux', submitText: 'Deux' }],
      },
    ];

    render(<AIMessageContent parts={parts} />);

    expect(screen.getByText(`${prompt} pour continuer.`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: prompt })).toBeInTheDocument();
  });

  it('keeps an exact text prompt for submitted choices', () => {
    const prompt = 'Choisissez une option';
    const parts: MessageContentPart[] = [
      { type: 'text', content: prompt },
      {
        type: 'choice', componentId: 'choice-1', schemaVersion: 1, questionId: 'next-step', prompt,
        presentation: 'quick_replies', selectionMode: 'single', submitBehavior: 'immediate', status: 'submitted',
        options: [{ id: 'one', label: 'Un', submitText: 'Un' }, { id: 'two', label: 'Deux', submitText: 'Deux' }],
      },
    ];

    render(<AIMessageContent parts={parts} />);

    expect(screen.getByText(prompt)).toBeInTheDocument();
    expect(screen.getByText('choice.submitted')).toBeInTheDocument();
  });

  it('renders markdown lists with compact shared spacing', () => {
    const parts: MessageContentPart[] = [
      {
        type: 'text',
        content: '- **Best approach:** use a newsletter funnel\n- **Core strategy:** publish useful insights\n  - AI adoption\n  - data strategy',
      },
    ];

    const { container } = render(<AIMessageContent parts={parts} />);
    const list = container.querySelector('ul');
    const listItem = container.querySelector('li');

    expect(list).toHaveClass('my-2');
    expect(listItem).toHaveClass('my-0', 'leading-relaxed');
  });

  it('does not parse currency values as inline math', () => {
    const { container } = render(<AIMessageContent parts={[{
      type: 'text',
      content: 'Bitcoin moved from **$77,934.11** to approximately **$77,964.80**.',
    }]} />);

    expect([...container.querySelectorAll('strong')].map((node) => node.textContent)).toEqual([
      '$77,934.11',
      '$77,964.80',
    ]);
    expect(container.querySelector('.katex')).not.toBeInTheDocument();
  });

  it('renders parenthesized LaTeX as inline math', () => {
    const { container } = render(<AIMessageContent parts={[{ type: 'text', content: 'Value: \\(x^2\\).' }]} />);

    expect(container.querySelector('.katex')).toBeInTheDocument();
  });

  it('renders titled assistant citations as safe title-only links', () => {
    const { container } = render(<AIMessageContent parts={[{ type: 'text', content: 'Voir [Aide de la Ville, https://example.com/aide].' }]} />);

    const link = screen.getByRole('link', { name: 'Aide de la Ville' });
    expect(link).toHaveAttribute('href', 'https://example.com/aide');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByText('https://example.com/aide')).not.toBeInTheDocument();
    expect(container.textContent).toBe('Voir Aide de la Ville.');
  });

  it('renders every titled assistant citation in one paragraph', () => {
    const { container } = render(<AIMessageContent parts={[{ type: 'text', content: '[First source, https://example.com/one] and [Second source, https://example.com/two]' }]} />);

    expect(screen.getByRole('link', { name: 'First source' })).toHaveAttribute('href', 'https://example.com/one');
    expect(screen.getByRole('link', { name: 'Second source' })).toHaveAttribute('href', 'https://example.com/two');
    expect(container.textContent).toBe('First source and Second source');
  });

  it('preserves assistant citation syntax in code and rejects non-HTTP(S) targets', () => {
    render(<AIMessageContent parts={[{ type: 'text', content: '`[Code, https://example.com]`\n\n```\n[Block, https://example.com]\n```\n\n[Unsafe, javascript:alert(1)]' }]} />);

    expect(screen.getByText('[Code, https://example.com]')).toBeInTheDocument();
    expect(screen.getByText('[Block, https://example.com]')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Unsafe' })).not.toBeInTheDocument();
  });

  it('does not transform citation-shaped text inside standard Markdown links', () => {
    render(<AIMessageContent parts={[{ type: 'text', content: '[Read [Example, https://example.com]](https://destination.test)' }]} />);

    const link = screen.getByRole('link', { name: 'Read [Example, https://example.com]' });
    expect(link).toHaveAttribute('href', 'https://destination.test');
  });

  it('renders assistant-provided HTML anchors as safe links', () => {
    render(<AIMessageContent parts={[{
      type: 'text',
      content: '<a href="https://example.com/forecast" target="_blank" rel="noopener">Detailed forecast</a> [1]',
    }]} />);

    const link = screen.getByRole('link', { name: 'Detailed forecast' });
    expect(link).toHaveAttribute('href', 'https://example.com/forecast');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('leaves unsafe HTML anchors escaped', () => {
    render(<AIMessageContent parts={[{ type: 'text', content: '<a href="javascript:alert(1)">Unsafe</a>' }]} />);

    expect(screen.queryByRole('link', { name: 'Unsafe' })).not.toBeInTheDocument();
    expect(screen.getByText(/<a href="javascript:alert\(1\)">Unsafe<\/a>/)).toBeInTheDocument();
  });

  it('renders inline citation markers without bracket text', () => {
    const parts: MessageContentPart[] = [
      {
        type: 'text',
        content: 'Priorite haute [2].',
        citations: [{
          parentId: '',
          sourceType: 'text',
          source: 'user-1/codeinterpreter/contract.docx',
          externalId: '',
          page: '2',
          pageContent: 'Clause',
          workspaceId: 'codeinterpreter',
          reference: '[2]',
        }],
      },
    ];

    render(<AIMessageContent parts={parts} />);

    expect(screen.queryByText('[2]')).not.toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows only the file name, page, and source context in citation previews', async () => {
    const storageKey = '6984baadd6b2ec4585e8c707/bpce/reports/quarterly-results.pdf';
    const parts: MessageContentPart[] = [{
      type: 'text',
      content: 'Novobanco contribution [21].',
      citations: [{
        parentId: '',
        sourceType: 'text',
        source: storageKey,
        externalId: '',
        page: '8',
        pageContent: 'Novobanco: 246 M€ de PNB pour 2 mois de contribution au S1-26',
        workspaceId: 'bpce',
        reference: '[21]',
      }],
    }];

    render(<AIMessageContent parts={parts} />);
    await userEvent.hover(screen.getByRole('button', { name: '21' }));

    expect(await screen.findByText('quarterly-results.pdf')).toBeInTheDocument();
    expect(screen.getByText('Page 8')).toBeInTheDocument();
    expect(screen.getByText('Novobanco: 246 M€ de PNB pour 2 mois de contribution au S1-26')).toBeInTheDocument();
    expect(screen.queryByText(storageKey)).not.toBeInTheDocument();
  });

  it('does not expose storage keys in citation triggers without references', () => {
    const storageKey = '6984baadd6b2ec4585e8c707/bpce/reports/quarterly-results.pdf';
    render(<AIMessageContent parts={[{
      type: 'text',
      content: 'Trailing source.',
      citations: [{
        parentId: '', sourceType: 'text', source: storageKey, externalId: '', page: '8',
        pageContent: 'Source context', workspaceId: 'bpce',
      }],
    }]} />);

    const trigger = screen.getByRole('button', { name: 'quarterly-results.pdf' });
    expect(trigger).toHaveAttribute('title', 'quarterly-results.pdf');
    expect(screen.queryByRole('button', { name: storageKey })).not.toBeInTheDocument();
    expect(screen.queryByText(storageKey)).not.toBeInTheDocument();
  });

  it('opens citations with exact located highlight text', async () => {
    openFileViewerFromUrlLoaderMock.mockImplementationOnce(async (_key, _fileName, _mimeType, load) => load());
    getCitationViewUrlMock.mockResolvedValueOnce({ url: 'https://example.test/contract.pdf', fileName: 'contract.pdf', mimeType: 'application/pdf' });
    const parts: MessageContentPart[] = [
      {
        type: 'text',
        content: 'Priorite haute [2].',
        citations: [{
          parentId: '',
          sourceType: 'text',
          source: 'user-1/codeinterpreter/contract.pdf',
          fileName: 'contract.pdf',
          externalId: '',
          page: '2',
          pageContent: 'Retrieved chunk',
          workspaceId: 'codeinterpreter',
          reference: '[2]',
          highlightText: 'Exact located quote',
          highlightBBox: [10, 20, 30, 40],
        }],
      },
    ];

    render(<AIMessageContent parts={parts} citationScope={{ conversationId: 'conversation-1', messageId: 'message-1' }} />);
    await userEvent.click(screen.getByText('2'));

    await waitFor(() => {
      expect(getCitationViewUrlMock).toHaveBeenCalledWith('conversation-1', 'message-1', {
        source: 'user-1/codeinterpreter/contract.pdf', fileName: 'contract.pdf', reference: '2',
      });
      expect(openFileViewerFromUrlLoaderMock).toHaveBeenCalledWith(
        '["conversation-1","message-1","user-1/codeinterpreter/contract.pdf"]',
        'contract.pdf',
        'application/pdf',
        expect.any(Function),
        {
          displayMode: 'sidebar',
          closeOnOutsideClick: false,
          page: 2,
          highlightText: 'Exact located quote',
          highlightBBox: [10, 20, 30, 40],
        },
      );
    });
  });

  it('resolves a filename-less image citation by its path', async () => {
    openFileViewerFromUrlLoaderMock.mockImplementationOnce(async (_key, _fileName, _mimeType, load) => load());
    getCitationViewUrlMock.mockResolvedValueOnce({
      url: 'https://example.test/chart.png', fileName: 'chart.png', mimeType: 'image/png',
    });
    const parts: MessageContentPart[] = [{
      type: 'citation',
      parentId: '',
      sourceType: 'image',
      source: '',
      externalId: '',
      page: '3',
      pageContent: '',
      workspaceId: 'workspace-1',
      reference: '[4]',
      path: 'owner/workspace/chart.png',
    }];

    render(<AIMessageContent parts={parts} citationScope={{ conversationId: 'conversation-1', messageId: 'message-1' }} />);
    await userEvent.click(screen.getByText('4'));

    await waitFor(() => {
      expect(getCitationViewUrlMock).toHaveBeenCalledWith('conversation-1', 'message-1', {
        source: 'owner/workspace/chart.png', fileName: undefined, reference: '4',
      });
      expect(openFileViewerFromUrlLoaderMock).toHaveBeenCalledWith(
        '["conversation-1","message-1","owner/workspace/chart.png"]',
        'chart.png',
        'image/png',
        expect.any(Function),
        expect.objectContaining({ page: 3 }),
      );
    });
  });

  it('uses scoped object keys to distinguish citations with the same filename', async () => {
    const parts: MessageContentPart[] = [{
      type: 'text',
      content: 'First [1], second [2].',
      citations: [
        {
          parentId: '', sourceType: 'text', source: 'owner/first/shared.pdf', fileName: 'shared.pdf',
          externalId: '', page: '1', pageContent: '', workspaceId: 'workspace-1', reference: '[1]',
        },
        {
          parentId: '', sourceType: 'text', source: 'owner/second/shared.pdf', fileName: 'shared.pdf',
          externalId: '', page: '2', pageContent: '', workspaceId: 'workspace-1', reference: '[2]',
        },
      ],
    }];

    render(<AIMessageContent parts={parts} citationScope={{ conversationId: 'conversation-1', messageId: 'message-1' }} />);
    await userEvent.click(screen.getByText('1'));
    await userEvent.click(screen.getByText('2'));

    expect(openFileViewerFromUrlLoaderMock).toHaveBeenCalledWith(
      '["conversation-1","message-1","owner/first/shared.pdf"]',
      'shared.pdf',
      'application/pdf',
      expect.any(Function),
      expect.objectContaining({ page: 1 }),
    );
    expect(openFileViewerFromUrlLoaderMock).toHaveBeenCalledWith(
      '["conversation-1","message-1","owner/second/shared.pdf"]',
      'shared.pdf',
      'application/pdf',
      expect.any(Function),
      expect.objectContaining({ page: 2 }),
    );
  });

  it('enables outside-click dismissal for playbook citations', async () => {
    openFileViewerFromUrlLoaderMock.mockImplementationOnce(async (_key, _fileName, _mimeType, load) => load());
    getFileSignedUrlMock.mockResolvedValueOnce({ url: 'https://example.test/playbook.pdf' });
    const parts: MessageContentPart[] = [{
      type: 'text',
      content: 'Playbook source [2].',
      citations: [{
        parentId: '',
        sourceType: 'text',
        source: 'playbook.pdf',
        externalId: '',
        page: '2',
        pageContent: 'Source',
        workspaceId: 'playbook',
        reference: '[2]',
      }],
    }];

    render(
      <MessageProvider fileViewerDisplayMode='floating'>
        <AIMessageContent parts={parts} />
      </MessageProvider>,
    );
    await userEvent.click(screen.getByText('2'));

    await waitFor(() => {
      expect(openFileViewerFromUrlLoaderMock).toHaveBeenLastCalledWith(
        'playbook.pdf',
        'playbook.pdf',
        'application/pdf',
        expect.any(Function),
        expect.objectContaining({ displayMode: 'floating', closeOnOutsideClick: true }),
      );
    });
  });

  it('renders a line chart between text parts', async () => {
    const parts: MessageContentPart[] = [
      { type: 'text', content: 'Before chart' },
      {
        type: 'chart',
        title: 'Revenue trend',
        kind: 'line',
        data: [{ month: 'Jan', revenue: 42 }],
        config: { revenue: { label: 'Revenue', color: '#123456' } },
        xAxisKey: 'month',
        yAxisKey: 'revenue',
        series: [{ dataKey: 'revenue', label: 'Revenue', color: '#123456' }],
      },
      { type: 'text', content: 'After chart' },
    ];

    render(<AIMessageContent parts={parts} />);

    expect(screen.getByText('Before chart')).toBeInTheDocument();
    // The chart renderer is a lazy boundary; wait for the chunk + render.
    // The first lazy import in a worker pays the cold transform cost.
    expect(await screen.findByRole('figure', { name: 'Revenue trend' }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByText('After chart')).toBeInTheDocument();
  });

  it('renders fallback-colored bars when yAxisKey is not a data field', async () => {
    const parts: MessageContentPart[] = [{
      type: 'chart',
      title: 'Revenue by period',
      kind: 'bar',
      data: [{ period: 'T1', 'net revenue': 42 }],
      config: {},
      xAxisKey: 'period',
      yAxisKey: 'amount_M€',
      series: [{ dataKey: 'net revenue', label: 'Net revenue' }],
    }];

    const { container } = render(<AIMessageContent parts={parts} />);

    await screen.findByRole('figure', { name: 'Revenue by period' });
    expect(container.querySelectorAll('.recharts-responsive-container')).toHaveLength(1);
    await waitFor(() => {
      expect(container.querySelector('.recharts-bar-rectangle path')).toHaveAttribute('fill', 'var(--chart-1)');
    }, { timeout: 3000 });
  });

  it('renders a no-data state for empty chart payloads', async () => {
    const parts: MessageContentPart[] = [
      {
        type: 'chart',
        title: 'Empty chart',
        kind: 'pie',
        data: [],
        config: {},
        xAxisKey: 'label',
        series: [{ dataKey: 'value' }],
      },
    ];

    render(<AIMessageContent parts={parts} />);

    expect(await screen.findByText('ai.chart.noData')).toBeInTheDocument();
  });

  it('renders a localized error block when chart payload is invalid', () => {
    const parts: MessageContentPart[] = [
      {
        type: 'error',
        title: '',
        content: 'ai.chart.errorContent',
      },
    ];

    render(<AIMessageContent parts={parts} />);

    expect(screen.getByText('ai.chart.errorContent')).toBeInTheDocument();
  });

  it('maps numeric enum-style chart kinds and layouts from streamed components', () => {
    const parts = mapComponentsToContentParts([
      {
        id: 'chart-1',
        type: 'chart',
        data: {
          title: 'Prix des produits',
          chartData: JSON.stringify([{ produit: 'Stylo', prix: 1.2 }]),
          config: JSON.stringify({ prix: { label: 'Prix', color: '#123456' } }),
          xAxisKey: 'produit',
          yAxisKey: 'prix',
          series: JSON.stringify([{ dataKey: 'prix', label: 'Prix' }]),
          kind: 1,
          layout: 1,
        },
      },
    ] as any);

    expect(parts[0]).toMatchObject({
      type: 'chart',
      kind: 'bar',
      layout: 'horizontal',
    });
  });

  it('drops non-array chart series payloads instead of crashing the renderer', () => {
    const parts = mapComponentsToContentParts([
      {
        id: 'chart-2',
        type: 'chart',
        data: {
          title: 'Invalid series payload',
          chartData: [{ month: 'Jan', revenue: 42 }],
          config: {},
          xAxisKey: 'month',
          yAxisKey: 'revenue',
          series: { dataKey: 'revenue' },
          kind: 'line',
        },
      },
    ] as any);

    expect(parts[0]).toMatchObject({
      type: 'chart',
      series: [],
    });
  });

  it('keeps backend-normalized chart data available after streaming merge', () => {
    const parts = mapComponentsToContentParts([
      {
        id: 'chart-normalized',
        type: 'chart',
        data: {
          title: 'Normalized chart',
          data: [{ month: 'Jan', revenue: 42 }],
          chartData: [{ month: 'Jan', revenue: 42 }],
          config: { revenue: { label: 'Revenue', color: '#123456' } },
          xAxisKey: 'month',
          yAxisKey: 'revenue',
          series: [{ dataKey: 'revenue', label: 'Revenue' }],
          kind: 'line',
          showLegend: true,
          showGrid: true,
        },
      },
    ] as any);

    expect(parts[0]).toMatchObject({
      type: 'chart',
      title: 'Normalized chart',
      data: [{ month: 'Jan', revenue: 42 }],
      kind: 'line',
    });
  });

  it('defaults unspecified proto chart kinds to a renderable chart kind', () => {
    const parts = mapComponentsToContentParts([
      {
        id: 'chart-unspecified',
        type: 'chart',
        data: {
          title: 'Revenue trend',
          data: [{ month: 'Jan', revenue: 32 }],
          chartData: [{ month: 'Jan', revenue: 32 }],
          config: { revenue: { label: 'Revenue', color: '#2563eb' } },
          xAxisKey: 'month',
          yAxisKey: 'revenue',
          series: [{ dataKey: 'revenue', label: 'Revenue' }],
          kind: 'CHART_KIND_UNSPECIFIED',
          layout: 'CHART_LAYOUT_UNSPECIFIED',
        },
      },
    ] as any);

    expect(parts[0]).toMatchObject({
      type: 'chart',
      kind: 'bar',
      layout: 'horizontal',
    });
  });

  it('drops chart payload strings produced by object concatenation', () => {
    const parts = mapComponentsToContentParts([
      {
        id: 'chart-bad',
        type: 'chart',
        data: {
          title: 'Broken chart',
          chartData: '[object Object],[object Object],[object Object]',
          config: {},
          xAxisKey: 'month',
          yAxisKey: 'revenue',
          series: [],
          kind: 'line',
        },
      },
    ] as any);

    expect(parts[0]).toMatchObject({
      type: 'chart',
      data: [],
    });
  });
});
