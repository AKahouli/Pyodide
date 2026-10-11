import type { GraphField, GraphIndex } from '../components/graph/graph-analytics';
import type { ExportConcept, ExportEdge, ExportNode } from './types';

export interface ViewSource {
  index: GraphIndex;
  /** The records in the view. */
  ids: Set<string>;
  /** The name each record is shown under. */
  labels: Map<string, string>;
  colorOf: (concept: string) => string;
  /** Where the view lays each record; every record in `ids` needs one. */
  positions: Map<string, { x: number; y: number }>;
  /** Values read for the records, by field key; absent when values are left out. */
  values?: Map<string, Record<string, unknown>>;
  format: (field: Pick<GraphField, 'type' | 'value'>, value: unknown) => string;
}

/** A record's radius: larger the more it is linked, as the graph view draws it. */
export const exportNodeSize = (index: GraphIndex, id: string) => 24 + Math.min(26, Math.sqrt(index.degree.get(id) ?? 0) * 5);

const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || value === '__missing__';

/** The part of the data graph the view shows, as the file holds it: records placed and sized as drawn, links, concepts. */
export function buildExportView(source: ViewSource): { nodes: ExportNode[]; edges: ExportEdge[]; concepts: ExportConcept[] } {
  const { index, ids, labels, positions, values } = source;
  const records = index.records.filter((record) => ids.has(record.id));
  const concepts: ExportConcept[] = index.concepts
    .filter((concept) => records.some((record) => record.concept === concept.key))
    .map((concept) => {
      const sample = records.find((record) => record.concept === concept.key)!;
      return { key: concept.key, label: concept.label, color: source.colorOf(concept.key), fields: sample.fields.map((field) => field.label) };
    });
  const nodes = records.map((record): ExportNode => {
    const place = positions.get(record.id);
    if (!place) throw new Error(`No position for record ${record.id}`);
    const read = values?.get(record.id);
    return {
      id: record.id,
      label: labels.get(record.id) ?? record.label,
      concept: record.concept,
      x: Math.round(place.x * 10) / 10,
      y: Math.round(place.y * 10) / 10,
      size: exportNodeSize(index, record.id),
      missing: record.fields.flatMap((field, position) => (field.missing || (read && isEmpty(read[field.key])) ? [position] : [])),
      // A record the server returned no values for is shown as one whose values are not part of the file.
      values: read ? record.fields.map((field) => (isEmpty(read[field.key]) ? null : source.format(field, read[field.key]))) : null,
    };
  });
  const edges = index.links.filter((link) => ids.has(link.source) && ids.has(link.target))
    .map((link): ExportEdge => ({ source: link.source, target: link.target, label: link.label }));
  return { nodes, edges, concepts };
}
