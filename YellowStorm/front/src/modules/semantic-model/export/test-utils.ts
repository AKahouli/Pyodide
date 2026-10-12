import type { GraphOutline, SemanticGraph } from '../types';
import { buildGraphIndex } from '../components/graph/graph-analytics';
import type { ExportStrings } from './types';

export const HOSTILE = 'Hello </script><img src=x onerror=alert(1)> <!-- &';

const model = {
  nodes: [
    { id: 'c-mail', key: 'mail', label: 'Message', attributes: [{ key: 'sujet', label: 'Subject', type: 'text' }, { key: 'corps', label: 'Body', type: 'text' }] },
    { id: 'c-person', key: 'person', label: 'Correspondent', attributes: [{ key: 'nom', label: 'Name', type: 'text' }] },
  ],
  relations: [{ id: 'r-sent', key: 'sent', label: 'sent by' }],
} as unknown as SemanticGraph;

export const outline: GraphOutline = {
  concepts: [{ id: 'c-mail', fields: ['sujet', 'corps'] }, { id: 'c-person', fields: ['nom'] }],
  records: [
    { id: 'm1', c: 'c-mail', l: HOSTILE, m: ['corps'] },
    { id: 'm2', c: 'c-mail', l: 'Invoice' },
    { id: 'p1', c: 'c-person', l: 'Ana Müller' },
    { id: 'p2', c: 'c-person', l: 'Zoe' },
  ],
  links: [{ id: 'e1', r: 'r-sent', s: 'm1', t: 'p1' }, { id: 'e2', r: 'r-sent', s: 'm2', t: 'p1' }, { id: 'e3', r: 'r-sent', s: 'm2', t: 'p2' }],
};

export const index = buildGraphIndex(outline, model);
export const everyone = new Set(index.records.map((record) => record.id));
export const positions = new Map(index.records.map((record, position) => [record.id, { x: position * 100, y: position * 50 }]));
export const colorOf = (concept: string) => (concept === 'mail' ? '#059669' : '#4f46e5');
export const labels = new Map(index.records.map((record) => [record.id, record.label]));
export const values = new Map<string, Record<string, unknown>>([
  ['m1', { sujet: 'Greetings', corps: null }],
  ['m2', { sujet: 'Invoice 42', corps: 'Please pay' }],
  ['p1', { nom: 'Ana' }],
]);

/** Each string is its own name, so tests can find it in the file. */
const NAMES = ['search', 'searchPlaceholder', 'searchResults', 'noMatch', 'legend', 'hideConcept', 'showConcept', 'showAll', 'fit', 'linkNames', 'showing', 'missingLegend', 'fields',
  'values', 'valuesNotIncluded', 'noAttributes', 'missingCount', 'missingValue', 'showMore', 'showLess', 'linked', 'noLinks', 'andMore', 'recordSummary', 'close', 'centerOn',
  'details', 'clearSelection', 'canvasLabel', 'loading', 'cannotOpen', 'noWebgl'] as const;
export const strings = Object.fromEntries(NAMES.map((name) => [name, name])) as ExportStrings;

/** The JSON a file carries. */
export function dataOf(html: string) {
  const match = /<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('no data in the file');
  return JSON.parse(match[1]);
}

export const format = (_field: unknown, value: unknown) => `<${String(value)}>`;
