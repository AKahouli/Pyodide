// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createViewExport, type ExportStep } from './export-view';
import { viewFileName } from './download';
import { colorOf, dataOf, everyone, format, index, labels, positions, strings } from './test-utils';

const meta = { title: 'Mails', subtitle: 'Exported', language: 'en', strings };

describe('createViewExport', () => {
  it('uses the positions the graph view has, without laying anything out', async () => {
    const steps: ExportStep[] = [];
    const html = await createViewExport({ mode: 'svg', index, ids: everyone, labels, colorOf, format, meta, canvasPositions: positions, onStep: (step) => steps.push(step) });
    expect(steps).toEqual(['packing']);
    expect(dataOf(html).nodes.map((node: number[]) => [node[2], node[3]])).toEqual([[0, 0], [100, 50], [200, 100], [300, 150]]);
  });

  it('lays the records out when the graph view does not draw them', async () => {
    const steps: ExportStep[] = [];
    // The view only holds some of the records (or none, drawn as bubbles per concept).
    const partial = new Map([...positions].slice(0, 2));
    const html = await createViewExport({ mode: 'sigma', index, ids: everyone, labels, colorOf, format, meta, canvasPositions: partial, onStep: (step) => steps.push(step) });
    expect(steps).toEqual(['layout', 'packing']);
    const nodes: number[][] = dataOf(html).nodes;
    expect(nodes).toHaveLength(4);
    for (const node of nodes) expect(Number.isFinite(node[2]) && Number.isFinite(node[3])).toBe(true);
    expect(new Set(nodes.map((node) => `${node[2]},${node[3]}`)).size).toBe(4);
  });

  it('only exports the records asked for', async () => {
    const html = await createViewExport({ mode: 'svg', index, ids: new Set(['m2', 'p1']), labels, colorOf, format, meta, canvasPositions: positions });
    const data = dataOf(html);
    expect(data.nodes.map((node: unknown[]) => node[7])).toEqual(['m2', 'p1']);
    expect(data.edges).toEqual([[0, 1, 0]]);
  });
});

describe('viewFileName', () => {
  it('names the file after the model and the day, keeping letters of any language', () => {
    expect(viewFileName('Courriels : été / 2026', new Date('2026-10-11T08:00:00Z'))).toBe('Courriels-été-2026-2026-10-11.html');
    expect(viewFileName('///', new Date('2026-10-11T08:00:00Z'))).toBe('graph-2026-10-11.html');
  });
});
