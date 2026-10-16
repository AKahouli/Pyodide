// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildExportView } from './build-view';
import { colorOf, everyone, index, labels, positions, values } from './test-utils';

const format = (_field: unknown, value: unknown) => `<${String(value)}>`;

describe('buildExportView', () => {
  it('keeps the records in view with their links, colours, positions and missing fields', () => {
    const ids = new Set(['m1', 'p1', 'p2']);
    const view = buildExportView({ index, ids, labels, colorOf, positions, format });
    expect(view.concepts).toEqual([
      { key: 'mail', label: 'Message', color: '#059669', fields: ['Subject', 'Body'] },
      { key: 'person', label: 'Correspondent', color: '#4f46e5', fields: ['Name'] },
    ]);
    expect(view.nodes.map((node) => node.id)).toEqual(['m1', 'p1', 'p2']);
    const [mail] = view.nodes;
    expect(mail).toMatchObject({ concept: 'mail', x: 0, y: 0, missing: [1], values: null });
    // Only the link between records in view is kept.
    expect(view.edges).toEqual([{ source: 'm1', target: 'p1', label: 'sent by' }]);
  });

  it('drops a concept with no record in view', () => {
    const view = buildExportView({ index, ids: new Set(['p1']), labels, colorOf, positions, format });
    expect(view.concepts.map((concept) => concept.key)).toEqual(['person']);
  });

  it('puts the values read as people read them, leaving missing ones null', () => {
    const view = buildExportView({ index, ids: everyone, labels, colorOf, positions, values, format });
    const byId = new Map(view.nodes.map((node) => [node.id, node]));
    expect(byId.get('m1')!.values).toEqual(['<Greetings>', null]);
    expect(byId.get('m2')!.values).toEqual(['<Invoice 42>', '<Please pay>']);
    // A record the server returned nothing for is left as one without values.
    expect(byId.get('p2')!.values).toBeNull();
    expect(byId.get('m1')!.missing).toEqual([1]);
  });

  it('shows records under the names the view gives them', () => {
    const view = buildExportView({ index, ids: new Set(['m2']), labels: new Map([['m2', 'Invoice · 2026-01-01']]), colorOf, positions, format });
    expect(view.nodes[0].label).toBe('Invoice · 2026-01-01');
  });

  it('refuses a record that has no position', () => {
    expect(() => buildExportView({ index, ids: everyone, labels, colorOf, positions: new Map(), format })).toThrow(/position/);
  });
});
