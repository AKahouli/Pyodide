import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { buildMcpExportManifest, buildStructuredExportBlocks } from './document-export';
import { exportPartsToMarkdown, projectOpenUiProgram } from '../components/openui/plain-text';
import { exportBlocksToHtml } from './html-export';
import { captureOpenUiChartPng } from './docx-capture';

vi.mock('./docx-capture', () => ({
  captureOpenUiSvgPng: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,c3Zn', width: 200, height: 100 })),
  captureOpenUiChartPng: vi.fn(async (): Promise<{ dataUrl: string; width: number; height: number } | null> => ({ dataUrl: 'data:image/png;base64,Y2hhcnQ=', width: 640, height: 320 })),
}));

const receipt = 'generated-image:123456789012345678901234';
const image = 'data:image/png;base64,aGVsbG8=';
const program = [
  'root = Card([h,sections,table,picture,chart])',
  'h = Header("Report", "Sources [1]")',
  'sections = SectionBlock([section])',
  'section = SectionBlockItem("hidden", "Details", [text])',
  'text = TextContent("Persisted detail [2]")',
  'table = Table([Col("City", "string"),Col("Count", "number")], [["Tokyo", 2]])',
  `picture = Image("Original chart [1]", "${receipt}")`,
  'chart = LineChart(["Jan", "Feb"], [{category: "Visits", values: [2, 5]}])',
].join('\n');
const messages = (content = program): Message[] => [{
  id: 'answer', conversationType: 'ai', createdAt: '2026-10-15T10:00:00Z',
  components: [{ id: 'part', type: 'text', data: { content } }],
} as unknown as Message];

describe('saved OpenUI export projection', () => {
  it('embeds validated static SVG captures without a remote asset resolver', async () => {
    const source = 'root = Card([drawing])\n drawing = Svg([Rect(0,0,20,10,"primary")], "0 0 20 10", null, null, "Saved SVG")';
    const resolver = vi.fn();
    const [block] = await buildStructuredExportBlocks(messages(source), { user: 'U', assistant: 'A' }, undefined, resolver);
    expect(block.parts).toEqual([{ kind: 'image', source: 'data:image/png;base64,c3Zn', caption: 'Saved SVG' }]);
    expect(resolver).not.toHaveBeenCalled();
    const blob = exportBlocksToHtml([block], 'SVG');
    const html = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(html).toContain('data:image/png;base64,c3Zn');
  });

  const chartProgram = 'root = Card([chart])\nchart = BarChart(["Jan","Feb","Mar"], [{category:"Visits",values:[2,5,0]},{category:"Sales",values:[4,6,8]}])';
  const chartState = { __ysExplore: { 'chart:chart': { componentType: 'ChartView', value: { seriesIndex: 0, labelIndex: 2 } } } };
  it.each(['BarChart', 'HorizontalBarChart', 'LineChart'])('projects %s series index zero and a selected category without losing numeric zero', async (chartType) => {
    const source = chartProgram.replace('BarChart(', `${chartType}(`);
    const markdown = exportPartsToMarkdown(await projectOpenUiProgram(source, chartState));
    expect(markdown).toContain('|  | Visits |\n| --- | --- |\n| Mar | 0 |');
    expect(markdown).not.toContain('Sales');
    expect(markdown).not.toContain('Jan');
    const all = exportPartsToMarkdown(await projectOpenUiProgram(source));
    expect(all).toContain('| Jan | 2 | 4 |');
    expect(all).toContain('| Mar | 0 | 8 |');
  });
  it('embeds rendered chart PNGs in HTML and PDF markdown without resolving them as conversation assets', async () => {
    const resolver = vi.fn();
    const [block] = await buildStructuredExportBlocks(messages(chartProgram), { user: 'U', assistant: 'A' }, undefined, resolver);
    expect(resolver).not.toHaveBeenCalled();
    expect(block.markdown).toContain('![](data:image/png;base64,Y2hhcnQ=)');
    const html = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(exportBlocksToHtml([block], 'Chart')); });
    expect(html).toContain('src="data:image/png;base64,Y2hhcnQ="');
  });
  it('fails explicitly when a chart cannot be rendered rather than silently omitting it', async () => {
    vi.mocked(captureOpenUiChartPng).mockResolvedValueOnce(null);
    await expect(buildStructuredExportBlocks(messages(chartProgram), { user: 'U', assistant: 'A' })).rejects.toThrow('chart capture failed');
  });
  it('uses saved chart selections after reload in both structured documents and MCP manifests', async () => {
    const answer = { ...messages(chartProgram)[0], conversationId: 'conversation' };
    const saved = JSON.parse(JSON.stringify([{ id: 'chart-saved', conversationId: 'conversation', conversationType: 'user', createdAt: '2026-10-16T13:00:00Z', interaction: {
      type: 'openui', schemaVersion: 1, sourceMessageId: answer.id, componentId: 'part', actionType: 'continue_conversation', formState: chartState,
    } }])) as Message[];
    const [block] = await buildStructuredExportBlocks([answer], { user: 'U', assistant: 'A' }, undefined, undefined, saved);
    expect(block.markdown).toContain('| Mar | 0 |');
    expect(captureOpenUiChartPng).toHaveBeenCalledWith('BarChart', expect.objectContaining({ labels: ['Mar'], series: [{ category: 'Visits', values: [0] }] }));
    expect(block.parts).toContainEqual({ kind: 'image', source: 'data:image/png;base64,Y2hhcnQ=', caption: '' });
    expect((await buildMcpExportManifest(answer, saved)).parts).toEqual(block.parts?.filter(part => part.kind !== 'image').map(part => ({ ...part, componentId: 'part' })));
    expect(exportBlocksToHtml([block], 'Selected chart')).toBeInstanceOf(Blob);
  });
  const tableProgram = 'root = Card([table])\ntable = Table([Col("City"),Col("Visits", "number")], [["Tokyo",2],["Paris",10],["Kyoto",0],["Osaka",5]])';
  const tableState = { __ysExplore: { 'table:table': { componentType: 'TableView', value: { query: 'o', sortColumn: 1, direction: 'desc', selectedRows: [0, 2] } } } };
  it('projects typed table filters, numeric sorting and original selected row indices', async () => {
    const markdown = exportPartsToMarkdown(await projectOpenUiProgram(tableProgram, tableState));
    expect(markdown).toContain('| Tokyo | 2 |\n| Kyoto | 0 |');
    expect(markdown).not.toContain('Paris');
    expect(markdown).not.toContain('Osaka');
    const unselected = { __ysExplore: { 'table:table': { componentType: 'TableView', value: { query: 'o', sortColumn: 1, direction: 'desc', selectedRows: [] } } } };
    expect(exportPartsToMarkdown(await projectOpenUiProgram(tableProgram, unselected))).toContain('| Osaka | 5 |\n| Tokyo | 2 |\n| Kyoto | 0 |');
  });
  it('rehydrates accepted scoped table values identically for answer exports and MCP', async () => {
    const answer = { ...messages(tableProgram)[0], conversationId: 'conversation' };
    const submission = { id: 'saved', conversationId: 'conversation', conversationType: 'user', createdAt: '2026-10-16T12:00:00Z', interaction: {
      type: 'openui', schemaVersion: 1, sourceMessageId: answer.id, componentId: 'part', actionType: 'continue_conversation', formState: tableState,
    } } as Message;
    const persisted = JSON.parse(JSON.stringify([submission])) as Message[];
    const [block] = await buildStructuredExportBlocks([answer], { user: 'U', assistant: 'A' }, undefined, undefined, persisted);
    expect(block.markdown).toContain('| Tokyo | 2 |\n| Kyoto | 0 |');
    expect((await buildMcpExportManifest(answer, persisted)).parts).toEqual(block.parts?.map((part) => ({ ...part, componentId: 'part' })));
    for (const foreign of [{ ...submission, conversationId: 'other' }, { ...submission, id: 'temp-pending' }, { ...submission, interaction: { ...submission.interaction, sourceMessageId: 'other' } } as Message]) {
      const [untouched] = await buildStructuredExportBlocks([answer], { user: 'U', assistant: 'A' }, undefined, undefined, [foreign]);
      expect(untouched.markdown).toContain('Paris');
    }
  });
  it('selects regenerated answers before resolving assets from obsolete branches', async () => {
    const oldAnswer = { ...messages('root = Card([i])\ni = Image("Deleted original", "generated-image:aaaaaaaaaaaaaaaaaaaaaaaa")')[0], id: 'old', questionMessageId: 'question' };
    const replacement = { ...messages()[0], id: 'replacement', questionMessageId: 'question', createdAt: '2026-10-15T10:01:00Z' };
    const question = { id: 'question', conversationType: 'user', content: 'Show the report', createdAt: '2026-10-15T09:59:00Z' } as unknown as Message;
    const resolver = vi.fn(async (source: string) => {
      if (source !== receipt) throw new Error('Obsolete image is missing');
      return image;
    });
    const blocks = await buildStructuredExportBlocks([oldAnswer, question, replacement], { user: 'U', assistant: 'A' }, undefined, resolver);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].markdown).toContain('Persisted detail');
    expect(blocks[1].markdown).not.toContain('Deleted original');
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith(receipt, expect.anything(), expect.objectContaining({ id: 'replacement' }));
  });
  it('provides the same structured content to MCP with exact persistent image selectors and caption order', async () => {
    const message = messages()[0];
    const manifest = await buildMcpExportManifest(message);
    expect(manifest.parts).toEqual((await projectOpenUiProgram(program)).map((part) => ({ ...part, componentId: 'part' })));
    expect(manifest.parts).toContainEqual({ kind: 'image', source: receipt, caption: 'Original chart [1]', componentId: 'part' });
    expect(JSON.stringify(manifest)).not.toContain('base64');
    expect(JSON.stringify(manifest)).not.toContain('root =');
    expect(manifest.parts.some((part) => part.kind === 'markdown' && part.markdown.includes('| Feb | 5 |'))).toBe(true);
    const gallery = messages('root = Card([g])\ng = ImageGallery(["Web", "PDF"], ["https://example.test/photo.png", "[1]"])')[0];
    expect((await buildMcpExportManifest(gallery)).parts).toEqual([
      { kind: 'image', source: 'https://example.test/photo.png', caption: 'Web', componentId: 'part' },
      { kind: 'image', source: '[1]', caption: 'PDF', componentId: 'part' },
    ]);
  });

  it('keeps non-OpenUI answer markdown in the MCP manifest', async () => {
    expect(await buildMcpExportManifest(messages('Plain **answer** [1]')[0])).toEqual({ parts: [{ kind: 'markdown', markdown: 'Plain **answer** [1]', componentId: 'part' }] });
  });
  it('exports stored text, editable tables, chart values and exact image captions without mounted DOM', async () => {
    const resolver = vi.fn(async () => image);
    const [block] = await buildStructuredExportBlocks(messages(), { user: 'User', assistant: 'Assistant' }, undefined, resolver);
    expect(block.markdown).toContain('## Report');
    expect(block.markdown).toContain('Persisted detail [2]');
    expect(block.markdown).toContain('| Tokyo | 2 |');
    expect(block.markdown).toContain('| Feb | 5 |');
    expect(block.parts).toContainEqual({ kind: 'image', source: image, caption: 'Original chart [1]' });
    expect(block.markdown).not.toContain('root =');
    expect(resolver).toHaveBeenCalledWith(receipt, expect.objectContaining({ id: 'part' }), expect.objectContaining({ id: 'answer' }));
  });

  it('has identical content with expanded, collapsed and absent rendered answers', async () => {
    const project = () => buildStructuredExportBlocks(messages(), { user: 'User', assistant: 'Assistant' }, undefined, async () => image);
    document.body.innerHTML = '<div id="message-answer"><div data-openui-scope data-openui-part="part">Visible answer</div></div>';
    const expanded = await project();
    document.body.innerHTML = '<div id="message-answer"><div data-openui-scope data-openui-part="part"><div class="openui-foldable-section-item" data-state="closed"></div></div></div>';
    expect(await project()).toEqual(expanded);
    document.body.innerHTML = '';
    expect(await project()).toEqual(expanded);
  });

  it('fails explicitly on missing or unresolved image assets', async () => {
    await expect(buildStructuredExportBlocks(messages(), { user: 'U', assistant: 'A' })).rejects.toThrow('resolver required');
    await expect(buildStructuredExportBlocks(messages(), { user: 'U', assistant: 'A' }, undefined, async () => receipt)).rejects.toThrow('Invalid resolved');
    await expect(buildStructuredExportBlocks(messages(), { user: 'U', assistant: 'A' }, undefined, async () => { throw new Error('Unauthorized'); })).rejects.toThrow('Unauthorized');
  });

  it('rejects incomplete and invalid programs instead of exporting code', async () => {
    await expect(projectOpenUiProgram('root = Card([missing])')).rejects.toThrow();
    await expect(projectOpenUiProgram('root = Card([TextContent("unfinished')).rejects.toThrow();
  });

  it('preserves report metadata and content parsed with the report signature', async () => {
    const parts = await projectOpenUiProgram('root = Report({title: "Quarterly report"}, [p])\np = Page("p1", content)\ncontent = ContentPage([h])\nh = InlineHeader("Highlights")');
    expect(parts).toContainEqual({ kind: 'markdown', markdown: '## Quarterly report' });
    expect(parts).toContainEqual({ kind: 'markdown', markdown: '## Highlights' });
  });

  it('uses the report Image source-first signature and report Column table schema', async () => {
    const parts = await projectOpenUiProgram(`root=Report({title:"Six Image Export Check"},[p])\np=Page("p",c)\nc=ContentPage([i,t])\ni=Image("${receipt}","Original")\nt=Table([Column("Source","text"),Column("Count","number")],[["Web",2]])`);
    expect(parts).toContainEqual({ kind: 'image', source: receipt, caption: 'Original' });
    expect(parts).toContainEqual({ kind: 'markdown', markdown: '| Source | Count |\n| --- | --- |\n| Web | 2 |' });
  });

  it('preserves chart kind, axes and units before its editable data table', async () => {
    const parts = await projectOpenUiProgram('root = Card([chart])\nchart = LineChart(["Jan"], [{category:"Visits",values:[2]}], null, "linear", "Monthly visits", "Source [1]", "Month", "Visitors", "k")');
    const metadata = parts.findIndex((part) => part.kind === 'markdown' && part.markdown.includes('"chart":"LineChart"'));
    expect(parts[metadata]).toEqual({ kind: 'markdown', markdown: '```json\n{"chart":"LineChart","xLabel":"Month","yLabel":"Visitors","unit":"k","variant":"linear"}\n```' });
    expect(parts[metadata + 1]).toEqual({ kind: 'markdown', markdown: '|  | Visits |\n| --- | --- |\n| Jan | 2 |' });
  });

  it('pairs gallery sources and captions in their saved order', async () => {
    const parts = await projectOpenUiProgram('root = Card([g])\ng = ImageGallery(["Original", "Edited"], ["https://example.test/original.png", "https://example.test/edited.png"])');
    expect(parts).toEqual([
      { kind: 'image', source: 'https://example.test/original.png', caption: 'Original' },
      { kind: 'image', source: 'https://example.test/edited.png', caption: 'Edited' },
    ]);
  });

  it('projects presentation text and chart data with the presentation library', async () => {
    const parts = await projectOpenUiProgram('root = Presentation({title: "Japan"}, [slide])\nslide = Slide("s1", content)\ncontent = ChartWithContext("Visits", chart, "Exact source [1]")\nchart = LineChartV2({data: {labels: ["Jan"], series: [{category: "Visits", values: [2]}]}})');
    expect(parts).toContainEqual({ kind: 'markdown', markdown: '## Visits' });
    expect(parts).toContainEqual({ kind: 'markdown', markdown: 'Exact source [1]' });
    expect(parts.some((part) => part.kind === 'markdown' && part.markdown.includes('| Jan | 2 |'))).toBe(true);
  });
  it('renders report charts with their original V2 component and props', async () => {
    const render = vi.fn(async () => image);
    const source = 'root = Presentation({title: "Japan"}, [slide])\nslide = Slide("s1", content)\ncontent = ChartWithContext("Visits", chart, "Source")\nchart = BarChartV2({data: {labels: ["Jan"], series: [{category: "Visits", values: [2]}]}})';
    const parts = await projectOpenUiProgram(source, undefined, render);
    expect(render).toHaveBeenCalledWith('BarChartV2', expect.objectContaining({ chartData: { data: { labels: ['Jan'], series: [{ category: 'Visits', values: [2] }] } } }));
    expect(parts.filter(part => part.kind === 'image')).toHaveLength(1);
  });

  it('keeps the resolved image in standalone HTML while rejecting active URL schemes', async () => {
    const blocks = await buildStructuredExportBlocks(messages(), { user: 'U', assistant: 'A' }, undefined, async () => image);
    blocks[0].markdown += '\n\n[Bad](javascript:alert%281%29)';
    const blob = exportBlocksToHtml(blocks, 'Report');
    const html = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(html).toContain(`src="${image}"`);
    expect(html).toContain('Original chart [1]');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('root =');
  });

  it('prints visible captions directly beneath their matching images in saved order', async () => {
    const captions = ['Original PDF chart [1]', 'Edited **style** [2](javascript:alert(1)) <script> &copy; back\\slash'];
    const sources = ['https://example.test/original(a).png', 'https://example.test/edited.png'];
    const markdown = exportPartsToMarkdown(captions.map((caption, index) => ({ kind: 'image', source: sources[index], caption })));
    expect(markdown).toContain('https://example.test/original%28a%29.png');
    const blob = exportBlocksToHtml([{ label: 'Assistant', markdown }], 'Images');
    const html = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const images = Array.from(doc.querySelectorAll('main section img'));
    expect(images).toHaveLength(2);
    images.forEach((element, index) => {
      expect(element.getAttribute('src')).toBe(sources[index].replaceAll('(', '%28').replaceAll(')', '%29'));
      expect(element.getAttribute('alt')).toBe(captions[index]);
      expect(element.parentElement?.nextElementSibling?.textContent).toBe(captions[index]);
    });
    expect(doc.querySelectorAll('main section a, main section script, main section strong')).toHaveLength(0);
  });
});
