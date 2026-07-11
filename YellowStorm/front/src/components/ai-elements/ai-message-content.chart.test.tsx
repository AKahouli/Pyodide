import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AIMessageContent, type MessageContentPart } from './ai-message-content';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';

const openFileViewerFromUrlMock = vi.hoisted(() => vi.fn());
const getArtifactDownloadUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

vi.mock('@/modules/file-viewer', () => ({
  openFileViewerFromUrl: openFileViewerFromUrlMock,
  getMimeTypeFromFilename: () => 'application/pdf',
  useFileViewerDisplayMode: () => 'sidebar',
}));

vi.mock('@/modules/conversation/api', () => ({
  getArtifactDownloadUrl: getArtifactDownloadUrlMock,
}));

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', class {
    observe = vi.fn();
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

  it('opens citations with exact located highlight text', async () => {
    getArtifactDownloadUrlMock.mockResolvedValueOnce({ downloadUrl: 'https://example.test/contract.pdf' });
    const parts: MessageContentPart[] = [
      {
        type: 'text',
        content: 'Priorite haute [2].',
        citations: [{
          parentId: '',
          sourceType: 'text',
          source: 'user-1/codeinterpreter/contract.pdf',
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

    render(<AIMessageContent parts={parts} />);
    await userEvent.click(screen.getByText('2'));

    expect(openFileViewerFromUrlMock).toHaveBeenCalledWith(
      'https://example.test/contract.pdf',
      'contract.pdf',
      'application/pdf',
      {
        displayMode: 'sidebar',
        page: 2,
        highlightText: 'Exact located quote',
        highlightBBox: [10, 20, 30, 40],
      },
    );
  });

  it('renders a line chart between text parts', () => {
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
    expect(screen.getByRole('figure', { name: 'Revenue trend' })).toBeInTheDocument();
    expect(screen.getByText('After chart')).toBeInTheDocument();
  });

  it('renders a no-data state for empty chart payloads', () => {
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

    expect(screen.getByText('ai.chart.noData')).toBeInTheDocument();
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
