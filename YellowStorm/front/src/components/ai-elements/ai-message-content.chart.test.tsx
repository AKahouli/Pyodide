import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AIMessageContent, type MessageContentPart } from './ai-message-content';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

describe('AIMessageContent charts', () => {
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
});
