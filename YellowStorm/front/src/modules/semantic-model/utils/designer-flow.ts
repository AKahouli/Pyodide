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

export const SOURCE_COLUMN_OFFSET = 340;
const SOURCE_ROW_HEIGHT = 104;

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
 * Derive the source boxes and their lines from saved mappings and typed records. Sources are laid out
 * in a column to the left of the first concept they feed, so the canvas reads left to right: data in, concepts out.
 */
export function designerFlow(graph: SemanticGraph, mappings: ConceptSourceMapping[] = [], health: MappingHealthItem[] = []): { sources: DesignerSource[]; feeds: DesignerFeed[] } {
  const concepts = new Map(graph.nodes.map((node) => [node.id, node]));
  const groups = new Map<string, ConceptSourceMapping[]>();
  for (const mapping of mappings) {
    if (!concepts.has(mapping.conceptId)) continue;
    const key = `source:${mapping.workspaceId}:${mapping.documentId}:${mapping.sheetName ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), mapping]);
  }
  // One column left of every concept, so a source never sits on top of one; each box lines up with
  // the concept it feeds when there is room, otherwise it stacks below the previous box.
  const conceptList = [...concepts.values()];
  const columnX = Math.min(...conceptList.map((node) => node.position.x)) - SOURCE_COLUMN_OFFSET;
  let nextFreeY = -Infinity;
  const place = (conceptId: string) => {
    const y = Math.max(concepts.get(conceptId)!.position.y, nextFreeY);
    nextFreeY = y + SOURCE_ROW_HEIGHT;
    return { x: columnX, y };
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
