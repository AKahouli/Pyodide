import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { buildMcpExportManifest, buildStructuredExportBlocks } from './document-export';
import { exportPartsToMarkdown, projectOpenUiProgram } from '../components/openui/plain-text';
import { exportBlocksToHtml } from './html-export';

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
