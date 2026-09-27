import type { ConceptSourceMapping, MappingHealthItem, SemanticGraph } from '../types';

/** A box on the designer canvas that feeds data into concepts: a spreadsheet, a set of documents, or records typed by hand. */
export interface DesignerSource {
  id: string;
  kind: 'spreadsheet' | 'documents' | 'typed';
  label: string;
  /** Rows, sheets or record count, whatever best describes what the box holds. */
  detail: string;
  position: { x: number; y: number };
  /** 'warn' when one of its mappings needs attention, 'ok' when every mapping was checked and is current. */
  tone: 'ok' | 'warn' | 'idle';
  mappings: ConceptSourceMapping[];
}

/** The line from a source to a concept: the mapping step, with how complete it is. */
export interface DesignerFeed {
  id: string;
  sourceId: string;
  conceptId: string;
  step: 'map' | 'extract' | 'typed';
  mapped: number;
  total: number;
  tone: 'ok' | 'warn' | 'idle';
  mapping?: ConceptSourceMapping;
}

export const SOURCE_COLUMN_OFFSET = 260;
const SOURCE_ROW_HEIGHT = 150;
// Rendered sizes of the round steps with their labels, used to keep boxes apart.
const CONCEPT_BOX = { w: 192, h: 180 };
const SOURCE_BOX = { w: 176, h: 140 };

export const typedSourceId = (conceptId: string) => `typed:${conceptId}`;
export const feedId = (mappingId: string) => `feed:${mappingId}`;
export const isDesignerSourceId = (id: string) => id.startsWith('source:') || id.startsWith('typed:');

function mappingTone(mapping: ConceptSourceMapping, health: MappingHealthItem | undefined): DesignerFeed['tone'] {
  if (!health) return mapping.status === 'ready' ? 'idle' : 'warn';
  if (health.state === 'checking') return 'idle';
  // Without a unique field a source yields no records, so the line says so.
  if (health.state !== 'healthy' || mapping.identityFields.length === 0) return 'warn';
  return 'ok';
}

const worst = (tones: DesignerFeed['tone'][]): DesignerFeed['tone'] =>
  tones.includes('warn') ? 'warn' : tones.length && tones.every((tone) => tone === 'ok') ? 'ok' : 'idle';

/**
 * Derive the source boxes and their lines from saved mappings and typed records. Each source is laid out
 * beside the first concept it feeds, so the canvas reads left to right: data in, concepts out.
 */
export function designerFlow(graph: SemanticGraph, mappings: ConceptSourceMapping[] = [], health: MappingHealthItem[] = []): { sources: DesignerSource[]; feeds: DesignerFeed[] } {
  const concepts = new Map(graph.nodes.map((node) => [node.id, node]));
  const groups = new Map<string, ConceptSourceMapping[]>();
  for (const mapping of mappings) {
    if (!concepts.has(mapping.conceptId)) continue;
    const key = `source:${mapping.workspaceId}:${mapping.documentId}:${mapping.sheetName ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), mapping]);
  }
  // Each source sits next to the concept it feeds, so its line never crosses another concept: left of it
  // when that space is free, otherwise stacked further left, above or below — never on top of another box.
  const occupied = [...concepts.values()].map((node) => ({ x: node.position.x, y: node.position.y, w: CONCEPT_BOX.w, h: CONCEPT_BOX.h }));
  const overlaps = (x: number, y: number) => occupied.some((box) => x < box.x + box.w && x + SOURCE_BOX.w > box.x && y < box.y + box.h && y + SOURCE_BOX.h > box.y);
  const place = (conceptId: string) => {
    const { x, y } = concepts.get(conceptId)!.position;
    const candidates = [
      ...[0, 1, -1, 2, -2, 3].map((row) => ({ x: x - SOURCE_COLUMN_OFFSET, y: y + row * SOURCE_ROW_HEIGHT })),
      ...[1, 2, 3].map((row) => ({ x, y: y - row * SOURCE_ROW_HEIGHT - 40 })),
      ...[1, 2, 3].map((row) => ({ x, y: y + CONCEPT_BOX.h + (row - 1) * SOURCE_ROW_HEIGHT + 40 })),
    ];
    const spot = candidates.find((candidate) => !overlaps(candidate.x, candidate.y))
      ?? { x: x - SOURCE_COLUMN_OFFSET * 2, y: y + occupied.length * 10 };
    occupied.push({ ...spot, w: SOURCE_BOX.w, h: SOURCE_BOX.h });
    return spot;
  };
  const sources: DesignerSource[] = [];
  const feeds: DesignerFeed[] = [];
  const conceptOrder = (conceptId: string) => { const { x, y } = concepts.get(conceptId)!.position; return y * 100000 + x; };
  const ordered = [...groups].sort(([, a], [, b]) => conceptOrder(a[0].conceptId) - conceptOrder(b[0].conceptId));
  for (const [id, group] of ordered) {
    const first = group[0];
    const tones = group.map((mapping) => mappingTone(mapping, health.find((item) => item.id === mapping.id)));
    const structured = first.assetKind !== 'document';
    sources.push({
      id,
      kind: structured ? 'spreadsheet' : 'documents',
      label: first.documentName || first.documentId,
      detail: structured ? first.sheetName : '',
      position: place(first.conceptId),
      tone: worst(tones),
      mappings: group,
    });
    group.forEach((mapping, index) => {
      const concept = concepts.get(mapping.conceptId)!;
      feeds.push({
        id: feedId(mapping.id),
        sourceId: id,
        conceptId: mapping.conceptId,
        step: structured ? 'map' : 'extract',
        mapped: new Set(mapping.fieldMappings.filter((field) => field.mode !== 'ignore' && field.targetAttribute).map((field) => field.targetAttribute)).size,
        total: concept.attributes.length,
        tone: tones[index],
        mapping,
      });
    });
  }
  const typedByConcept = new Map<string, number>();
  for (const record of graph.records) typedByConcept.set(record.nodeTypeId, (typedByConcept.get(record.nodeTypeId) ?? 0) + 1);
  for (const [conceptId, count] of typedByConcept) {
    if (!concepts.has(conceptId)) continue;
    const id = typedSourceId(conceptId);
    sources.push({ id, kind: 'typed', label: '', detail: String(count), position: place(conceptId), tone: 'ok', mappings: [] });
    feeds.push({ id: `feed:${id}`, sourceId: id, conceptId, step: 'typed', mapped: count, total: count, tone: 'ok' });
  }
  return { sources, feeds };
}
