// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildExportView } from './build-view';
import { defaultExportMode, isModeAllowed } from './mode';
import { buildStandaloneGraphHtml } from './standalone-html';
import { SVG_NODE_LIMIT, type ExportNode, type StandaloneGraphInput } from './types';
import { colorOf, dataOf, everyone, format, HOSTILE, index, labels, positions, strings, values } from './test-utils';

const meta = { title: `Mails <b>"${HOSTILE}"`, subtitle: 'Exported on 11 Oct 2026 · 4 records', language: 'en', strings };
const input = (mode: StandaloneGraphInput['mode'], withValues = false): StandaloneGraphInput =>
  ({ mode, meta, ...buildExportView({ index, ids: everyone, labels, colorOf, positions, values: withValues ? values : undefined, format }) });
const scripts = (html: string) => html.match(/<script/g)?.length ?? 0;

describe('buildStandaloneGraphHtml', () => {
  it.each(['svg', 'sigma'] as const)('builds one self-contained file in %s mode', (mode) => {
    const html = buildStandaloneGraphHtml(input(mode));
    // Nothing is fetched from elsewhere, and no script closes early or opens a comment.
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|<img|@import|url\(http/);
    expect(scripts(html)).toBe(html.match(/<\/script>/g)!.length);
    expect(html).not.toContain('<!--');
    expect(html).toContain('<title>Mails &#60;b&#62;&#34;Hello &#60;/script&#62;');
    expect(html).toContain('Exported on 11 Oct 2026 · 4 records');
    expect(dataOf(html).mode).toBe(mode);
  });

  it('embeds the records, links, concepts, colours and strings, whatever characters they hold', () => {
    const html = buildStandaloneGraphHtml(input('svg', true));
    const data = dataOf(html);
    expect(data.concepts).toEqual([
      { label: 'Message', color: '#059669', fields: ['Subject', 'Body'] },
      { label: 'Correspondent', color: '#4f46e5', fields: ['Name'] },
    ]);
    expect(data.relations).toEqual(['sent by']);
    expect(data.nodes[0].slice(0, 2)).toEqual([HOSTILE, 0]);
    expect(data.nodes[0][6]).toEqual(['Greetings', null].map((value) => (value === null ? null : `<${value}>`)));
    expect(data.edges).toEqual([[0, 2, 0], [1, 2, 0], [1, 3, 0]]);
    expect(data.t.search).toBe('search');
    // The hostile name is only ever inside the JSON, with its `<` escaped.
    expect(html).not.toContain('</script><img');
    expect(html).toContain('Hello \\u003c/script>\\u003cimg');
  });

  it('holds the runtime of the mode asked for, and the WebGL libraries only for WebGL', () => {
    const svg = buildStandaloneGraphHtml(input('svg'));
    const sigma = buildStandaloneGraphHtml(input('sigma'));
    expect(svg).toContain('createElementNS');
    expect(svg).not.toContain('Sigma.Sigma');
    expect(sigma).toContain('new Sigma.Sigma');
    expect(sigma).toContain('MultiDirectedGraph');
    expect(sigma).not.toContain('createElementNS(NS');
    expect(sigma.length).toBeGreaterThan(svg.length + 100_000);
    expect(scripts(sigma)).toBe(scripts(svg) + 2);
  });

  it('drops links whose records are not in the file', () => {
    const data = dataOf(buildStandaloneGraphHtml({ ...input('svg'), edges: [{ source: 'm1', target: 'gone', label: 'sent by' }, { source: 'm1', target: 'p1', label: 'sent by' }] }));
    expect(data.edges).toEqual([[0, 2, 0]]);
  });

  it('keeps the vector drawing for graphs that move smoothly, and refuses it beyond', () => {
    expect(defaultExportMode(SVG_NODE_LIMIT)).toBe('svg');
    expect(defaultExportMode(SVG_NODE_LIMIT + 1)).toBe('sigma');
    expect(isModeAllowed('svg', SVG_NODE_LIMIT)).toBe(true);
    expect(isModeAllowed('svg', SVG_NODE_LIMIT + 1)).toBe(false);
    expect(isModeAllowed('sigma', 1_000_000)).toBe(true);

    const base = input('svg').nodes[0];
    const many: ExportNode[] = Array.from({ length: SVG_NODE_LIMIT + 1 }, (_, position) => ({ ...base, id: `r${position}` }));
    expect(() => buildStandaloneGraphHtml({ ...input('svg'), nodes: many, edges: [] })).toThrow(/at most 2000/);
    expect(dataOf(buildStandaloneGraphHtml({ ...input('sigma'), nodes: many, edges: [] })).nodes).toHaveLength(SVG_NODE_LIMIT + 1);
  });
});
