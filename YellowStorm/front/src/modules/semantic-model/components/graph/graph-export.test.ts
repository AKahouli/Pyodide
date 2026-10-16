// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { GraphExportContent, SemanticGraph } from '../../types';
import { buildGraphIndex } from './graph-analytics';
import { buildExportHtml, type ExportStrings } from './graph-export';

const model = {
  nodes: [
    { id: 'c-mail', key: 'mail', label: 'Message', attributes: [{ key: 'sujet', label: 'Subject', type: 'text' }, { key: 'corps', label: 'Body', type: 'text' }] },
    { id: 'c-person', key: 'person', label: 'Correspondent', attributes: [{ key: 'nom', label: 'Name', type: 'text' }] },
  ],
  relations: [{ id: 'r-sent', key: 'sent', label: 'sent by' }],
} as unknown as SemanticGraph;
const index = buildGraphIndex({
  concepts: [{ id: 'c-mail', fields: ['sujet', 'corps'] }, { id: 'c-person', fields: ['nom'] }],
  records: [{ id: 'm1', c: 'c-mail', l: 'Hello </script><b>' }, { id: 'p1', c: 'c-person', l: 'Ana', m: ['nom'] }],
  links: [{ id: 'e1', r: 'r-sent', s: 'm1', t: 'p1' }],
}, model);
const content: GraphExportContent = {
  modelName: 'Mails', exportedBy: 'Ana', exportedAt: '2026-10-06T10:00:00Z', shortenTo: 200,
  records: [{ id: 'm1', c: 'c-mail', l: 'Hello </script><b>', v: { corps: 'Bonjour' } }, { id: 'p1', c: 'c-person', l: 'Ana', v: { nom: null } }],
  links: [{ id: 'e1', r: 'r-sent', s: 'm1', t: 'p1' }],
};
const strings = new Proxy({}, { get: (_target, key) => String(key) }) as ExportStrings;

async function unpack(html: string) {
  const packed = /<script type="application\/octet-stream" id="graph-data">([^<]+)<\/script>/.exec(html)![1];
  const bytes = Uint8Array.from(atob(packed), (char) => char.charCodeAt(0));
  return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}

describe('graph export', () => {
  it('builds one file with the viewer, the libraries and the data, laid out and without the fields left out', async () => {
    const blob = await buildExportHtml(content, index, {
      title: 'Mails <graph>', subtitle: 'Exported by Ana', language: 'en', strings, colorOf: () => '#059669', drawLimit: 1500, maxDraw: 5000,
      choices: { mail: { sujet: 'exclude', corps: 'short' }, person: { nom: 'short' } },
    });
    const html = await blob.text();
    expect(html).toContain('<title>Mails &#60;graph&#62;</title>');
    // Nothing inlined closes its own script early, and nothing is fetched from elsewhere.
    expect(html.match(/<script/g)!.length).toBe(html.match(/<\/script>/g)!.length);
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
    expect(html).toContain('forceSimulation');

    const data = await unpack(html);
    expect(data.concepts).toEqual([{ label: 'Message', color: '#059669', fields: ['Body'] }, { label: 'Correspondent', color: '#059669', fields: ['Name'] }]);
    expect(data.relations).toEqual(['sent by']);
    const [mail, person] = data.records;
    expect(mail[0]).toBe('Hello </script><b>');
    expect(mail[2]).toEqual(['Bonjour']);
    expect(person[2]).toEqual([null]);
    expect(person[3]).toBe(1);
    expect(data.meta.drawLimit).toBe(1500);
    expect(data.links).toEqual([[0, 1, 0]]);
  });
});
