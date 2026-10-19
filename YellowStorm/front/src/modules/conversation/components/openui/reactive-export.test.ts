import { describe, expect, it, vi } from 'vitest';
import { projectOpenUiProgram } from './plain-text';
import { dashboardExamples } from './dashboard-examples';

describe('acknowledged reactive dashboard export', () => {
  it('exports saved sales filters, zero and false with the evaluated SVG', async () => {
    const capture = vi.fn(async () => 'data:image/png;base64,test');
    const parts = await projectOpenUiProgram(dashboardExamples.sales, undefined, capture, { reactiveState: { $minimum: 100, $includeReturns: false } });
    const text = parts.filter(part => part.kind === 'markdown').map(part => part.markdown).join('\n');
    expect(text).toContain('Minimum revenue: 100');
    expect(text).toContain('Include returns: false');
    expect(text).toContain('North: 120');
    expect(capture).toHaveBeenCalledWith('Svg', expect.objectContaining({ children: expect.arrayContaining([expect.objectContaining({ props: expect.objectContaining({ text: '120.00' }) })]) }));
    const zero = await projectOpenUiProgram(dashboardExamples.sales, undefined, capture, { reactiveState: { $minimum: 0, $includeReturns: false } });
    expect(JSON.stringify(zero)).toContain('Minimum revenue: 0');
  });

  it('exports the saved operations window and hidden-flow geometry after JSON reload', async () => {
    const capture = vi.fn(async () => 'data:image/png;base64,test');
    const reactiveState = JSON.parse(JSON.stringify({ $window: 3, $showFlow: false }));
    const parts = await projectOpenUiProgram(dashboardExamples.operations, undefined, capture, { reactiveState });
    expect(JSON.stringify(parts)).toContain('2026-10-03: 6.0');
    expect(JSON.stringify(parts)).toContain('Show flow: false');
    expect(capture).toHaveBeenCalledWith('Svg', expect.objectContaining({ children: expect.arrayContaining([expect.objectContaining({ typeName: 'G', props: expect.objectContaining({ transform: 'translate(-130 0)' }) })]) }));
  });

  it('rejects missing snapshots, executable queries, invalid state and missing capture', async () => {
    await expect(projectOpenUiProgram(dashboardExamples.sales)).rejects.toThrow();
    await expect(projectOpenUiProgram(dashboardExamples.sales, undefined, undefined, { reactiveState: {} })).rejects.toThrow('SVG export requires visual capture');
    await expect(projectOpenUiProgram(dashboardExamples.sales, undefined, vi.fn(), { reactiveState: { $minimum: Infinity } })).rejects.toThrow();
    await expect(projectOpenUiProgram('root = Card([TextContent("Result")])\nfetch = Query("remote", {})', undefined, vi.fn(), { reactiveState: {} })).rejects.toThrow();
  });

  it('includes only authorized document labels and a result matching the saved typed inputs', async () => {
    const source = `root = Card([app])
$document = ""
$count = 0
app = MiniApp("summary", "Summarizer", "", [document, result])
document = MiniDocument("document", "Source", $document)
result = MiniTaskResult("Saved summary", {documentId: $document, count: $count})`;
    const id = 'a'.repeat(24);
    const snapshot = { reactiveState: { $document: id, $count: 0 }, documents: { [id]: 'Quarterly report.pdf' }, taskResults: {
      summary: { inputs: { count: 0, documentId: id }, parts: [{ kind: 'markdown' as const, markdown: 'The saved summary.' }] },
    } };
    expect(await projectOpenUiProgram(source, undefined, undefined, snapshot)).toEqual([
      { kind: 'markdown', markdown: '## Summarizer' }, { kind: 'markdown', markdown: 'Source: Quarterly report.pdf' },
      { kind: 'markdown', markdown: 'Saved summary' }, { kind: 'markdown', markdown: 'The saved summary.' },
    ]);
    await expect(projectOpenUiProgram(source, undefined, undefined, { ...snapshot, documents: {} })).rejects.toThrow('authorized document');
    await expect(projectOpenUiProgram(source, undefined, undefined, { ...snapshot, taskResults: {} })).rejects.toThrow('result is missing');
    await expect(projectOpenUiProgram(source, undefined, undefined, { ...snapshot, reactiveState: { $document: id, $count: 1 } })).rejects.toThrow('saved inputs');
  });

  it('uses the private saved table and chart view ahead of accepted selections', async () => {
    const source = `root = Card([app])
$minimum = 0
app = MiniApp("dashboard", "Dashboard", "", [table, chart])
table = Table([Col("City"), Col("Count", "number")], [["Tokyo",2],["Paris",10],["Kyoto",0],["Osaka",5]])
chart = BarChart(["Jan","Feb","Mar"], [{category:"Visits",values:[2,5,0]},{category:"Sales",values:[4,6,8]}])`;
    const accepted = { __ysExplore: {
      'table:table': { componentType: 'TableView', value: { selectedRows: [1] } },
      'chart:chart': { componentType: 'ChartView', value: { seriesIndex: 1, labelIndex: 1 } },
    } };
    const privateView = { __ysExplore: {
      'table:table': { componentType: 'TableView', value: { query: 'o', sortColumn: 1, direction: 'desc', selectedRows: [0, 2] } },
      'chart:chart': { componentType: 'ChartView', value: { seriesIndex: 0, labelIndex: 2 } },
    } };
    const capture = vi.fn(async () => 'data:image/png;base64,test');
    const parts = await projectOpenUiProgram(source, accepted, capture, { reactiveState: JSON.parse(JSON.stringify(privateView)) });
    const text = JSON.stringify(parts);
    expect(text).toContain('| Tokyo | 2 |\\n| Kyoto | 0 |');
    expect(text).not.toContain('| Paris |');
    expect(text).toContain('| Mar | 0 |');
    expect(capture).toHaveBeenCalledWith('BarChart', expect.objectContaining({ labels: ['Mar'], series: [{ category: 'Visits', values: [0] }] }));
  });
});
