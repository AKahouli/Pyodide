/// <reference types="jest" />

import { aggregateTextFromComponents, extractComponentData, getComponentType } from './component-mapper';

describe('component-mapper text extraction', () => {
  it('extracts text content from proto oneof text field', () => {
    const result = extractComponentData({
      id: 'comp-1',
      text: { content: 'Hello from agent' },
    });

    expect(result).toEqual({
      type: 'text',
      data: { content: 'Hello from agent', outputPortId: '', output_port_id: '' },
    });
  });

  it('prefers agent activity over empty default text oneof (proto-loader defaults)', () => {
    const comp = {
      id: 'comp-2',
      text: { content: '' },
      agent_activity: { summary: 'Preparing sources', status: 'running' },
    };

    expect(getComponentType(comp)).toBe('agentActivity');
    expect(extractComponentData(comp).data.summary).toBe('Preparing sources');
  });

  it('uses the oneof discriminator for display-safe agent activity with an empty summary', () => {
    const comp = {
      id: 'comp-2-empty',
      data: 'agent_activity',
      text: { content: '' },
      agent_activity: { summary: '', status: 'completed' },
      tool_activity: { tool_name: '', status: '' },
    };

    expect(getComponentType(comp)).toBe('agentActivity');
    expect(extractComponentData(comp)).toEqual({
      type: 'agentActivity',
      data: { summary: '', status: 'completed' },
    });
  });

  it('supports legacy component.type + component.data shape from ADK formatter', () => {
    const result = extractComponentData({
      id: 'comp-3',
      type: 'text',
      data: { content: 'Legacy stream chunk' },
    });

    expect(result).toEqual({
      type: 'text',
      data: { content: 'Legacy stream chunk' },
    });
  });

  it('excludes agent activity from plain-text replies', () => {
    const reply = aggregateTextFromComponents([
      { type: 'agentActivity', data: { summary: 'Preparing answer', status: 'completed' } },
      { type: 'text', data: { content: 'Answer.' } },
    ]);

    expect(reply).toBe('Answer.');
  });
});

describe('component-mapper chart extraction', () => {
  it('maps extended chart fields from grpc chart components', () => {
    const result = extractComponentData({
      chart: {
        title: 'Revenue trend',
        data: '[{"month":"Jan","revenue":42}]',
        chartData: [{ month: 'Jan', revenue: 42 }],
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
          data: '[{"month":"Jan","revenue":42}]',
          chartData: '[{"month":"Jan","revenue":42}]',
        config: '{"revenue":{"label":"Revenue","color":"#123456"}}',
        xAxisKey: 'month',
        series: [{ dataKey: 'revenue', label: 'Revenue', color: '#123456' }],
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

  it('maps snake_case chart fields from grpc/proto-loader output', () => {
    const result = extractComponentData({
      chart: {
        title: 'Prices',
        data: '[{"produit":"Stylo","prix":1.2}]',
        chartData: [{ produit: 'Stylo', prix: 1.2 }],
        config: '{"prix":{"label":"Prix (€)","color":"#123456"}}',
        x_axis_key: 'produit',
        y_axis_key: 'prix',
        name_key: '',
        z_axis_key: '',
        series: '[{"dataKey":"prix","label":"Prix (€)"}]',
        kind: 'CHART_KIND_BAR',
        stacked: false,
        layout: 'CHART_LAYOUT_HORIZONTAL',
        inner_radius: 0,
        show_legend: true,
        show_grid: true,
      },
    });

    expect(result).toEqual({
      type: 'chart',
        data: {
          title: 'Prices',
          data: '[{"produit":"Stylo","prix":1.2}]',
          chartData: '[{"produit":"Stylo","prix":1.2}]',
        config: '{"prix":{"label":"Prix (€)","color":"#123456"}}',
        xAxisKey: 'produit',
        series: [{ dataKey: 'prix', label: 'Prix (€)' }],
        kind: 'CHART_KIND_BAR',
        yAxisKey: 'prix',
        nameKey: '',
        zAxisKey: '',
        stacked: false,
        layout: 'CHART_LAYOUT_HORIZONTAL',
        innerRadius: 0,
        showLegend: true,
        showGrid: true,
      },
    });
  });

  it('defaults chart fields for older producers', () => {
    const result = extractComponentData({
      chart: {
        title: 'Legacy',
        data: '[]',
        chartData: [],
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
        chartData: [],
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
          data: '[]',
          chartData: '[]',
        config: '{}',
        xAxisKey: 'category',
        series: [],
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

  it('maps backend-normalized chart arrays into the chart payload', () => {
    const result = extractComponentData({
      chart: {
        title: 'Normalized',
        data: [{ month: 'Jan', revenue: 42 }],
        config: {},
        xAxisKey: 'month',
        yAxisKey: 'revenue',
        series: [{ dataKey: 'revenue' }],
        kind: 'CHART_KIND_LINE',
      },
    });

    expect(result).toEqual({
      type: 'chart',
      data: {
        title: 'Normalized',
        data: [{ month: 'Jan', revenue: 42 }],
        chartData: [{ month: 'Jan', revenue: 42 }],
        config: {},
        xAxisKey: 'month',
        series: [{ dataKey: 'revenue' }],
        kind: 'CHART_KIND_LINE',
        yAxisKey: 'revenue',
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

  it('preserves citation highlight metadata from grpc components', () => {
    const result = extractComponentData({
      citation: {
        parent_id: 'text-1',
        text_source: {
          source: 'user-1/workspace/Sodexo-DEU-2024-FR.pdf',
          file_name: 'Sodexo-DEU-2024-FR.pdf',
          page: '286',
          page_content: 'dividende en croissance reguliere',
          workspace_id: 'workspace',
          reference: '[1]',
          highlight_text: 'dividende en croissance reguliere',
          highlight_bbox: [42.52, 123.16, 246.73, 52.5],
          block_bbox: [42.52, 123.16, 246.73, 52.5],
        },
      },
    });

    expect(result).toEqual({
      type: 'citation',
      data: {
        parentId: 'text-1',
        sourceType: 'text',
        source: 'user-1/workspace/Sodexo-DEU-2024-FR.pdf',
        fileName: 'Sodexo-DEU-2024-FR.pdf',
        page: '286',
        pageContent: 'dividende en croissance reguliere',
        workspaceId: 'workspace',
        reference: '[1]',
        highlightText: 'dividende en croissance reguliere',
        highlightBBox: [42.52, 123.16, 246.73, 52.5],
        blockBBox: [42.52, 123.16, 246.73, 52.5],
      },
    });
  });
});

describe('component-mapper choice extraction', () => {
  it('normalizes snake_case protobuf choice data', () => {
    const result = extractComponentData({ choice: {
      schema_version: 1, question_id: 'q1', prompt: 'Pick one', presentation: 'list', selection_mode: 'multiple', submit_behavior: 'immediate', status: 'ready',
      labels: { submit: 'Continue' }, progress: { current: 1, total: 2, label: 'Step 1' },
      options: [{ id: 'first', label: 'First', submit_text: 'I choose first' }, { id: 'second', label: 'Second', submit_text: 'I choose second' }],
    } });
    expect(result.type).toBe('choice');
    expect(result.data).toMatchObject({ questionId: 'q1', selectionMode: 'multiple', submitBehavior: 'explicit', labels: { submit: 'Continue' }, progress: { current: 1, total: 2 } });
  });

  it('maps full tool activity metadata from the proto component', () => {
    expect(extractComponentData({
      id: 'tool-1',
      tool_activity: {
        tool_name: 'search_documents',
        status: 'completed',
        params_json: '{"query":"contract"}',
        result_json: '{"matches":2}',
        started_at: '2026-07-21T10:13:42Z',
        primary_input: 'return normalize(input);',
        primary_input_language: 'typescript',
      },
    })).toEqual({
      type: 'toolActivity',
      data: {
        toolName: 'search_documents',
        status: 'completed',
        paramsJson: '{"query":"contract"}',
        resultJson: '{"matches":2}',
        startedAt: '2026-07-21T10:13:42Z',
        summary: '',
        renderKind: 'generic',
        primaryInput: 'return normalize(input);',
        primaryInputLanguage: 'typescript',
      },
    });
  });
});
