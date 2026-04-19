import { extractComponentData } from './component-mapper';

describe('component-mapper chart extraction', () => {
  it('maps extended chart fields from grpc chart components', () => {
    const result = extractComponentData({
      chart: {
        title: 'Revenue trend',
        data: '[{"month":"Jan","revenue":42}]',
        config: '{"revenue":{"label":"Revenue","color":"#123456"}}',
        xAxisKey: 'month',
        yAxisKey: 'revenue',
        series: '[{"dataKey":"revenue","label":"Revenue","color":"#123456"}]',
        kind: 'CHART_KIND_LINE',
        stacked: false,
        layout: 'CHART_LAYOUT_HORIZONTAL',
        inner_radius: 24,
        show_legend: true,
        show_grid: false,
      },
    });

    expect(result).toEqual({
      type: 'chart',
      data: {
        title: 'Revenue trend',
        chartData: '[{"month":"Jan","revenue":42}]',
        config: '{"revenue":{"label":"Revenue","color":"#123456"}}',
        xAxisKey: 'month',
        series: '[{"dataKey":"revenue","label":"Revenue","color":"#123456"}]',
        kind: 'CHART_KIND_LINE',
        yAxisKey: 'revenue',
        nameKey: '',
        zAxisKey: '',
        stacked: false,
        layout: 'CHART_LAYOUT_HORIZONTAL',
        innerRadius: 24,
        showLegend: true,
        showGrid: false,
      },
    });
  });

  it('defaults chart fields for older producers', () => {
    const result = extractComponentData({
      chart: {
        title: 'Legacy',
        data: '[]',
        config: '{}',
        xAxisKey: 'name',
        series: '[]',
      },
    });

    expect(result.data).toMatchObject({
      kind: 'CHART_KIND_UNSPECIFIED',
      yAxisKey: '',
      stacked: false,
      layout: 'CHART_LAYOUT_UNSPECIFIED',
      innerRadius: 0,
      showLegend: true,
      showGrid: true,
    });
  });

  it('preserves empty chart payloads so the frontend can show a fallback state', () => {
    const result = extractComponentData({
      chart: {
        title: 'Empty payload',
        data: '[]',
        config: '{}',
        xAxisKey: 'category',
        yAxisKey: 'value',
        series: '[]',
        kind: 'CHART_KIND_BAR',
      },
    });

    expect(result).toEqual({
      type: 'chart',
      data: {
        title: 'Empty payload',
        chartData: '[]',
        config: '{}',
        xAxisKey: 'category',
        series: '[]',
        kind: 'CHART_KIND_BAR',
        yAxisKey: 'value',
        nameKey: '',
        zAxisKey: '',
        stacked: false,
        layout: 'CHART_LAYOUT_UNSPECIFIED',
        innerRadius: 0,
        showLegend: true,
        showGrid: true,
      },
    });
  });
});
