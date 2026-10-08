import type { KnowledgeResource } from '../hooks/use-knowledge-linking';
import type { CanvasPosition, SemanticNodeType } from '../types';
import type { DesignerSource } from './designer-flow';
import { uniqueBusinessKey } from './model-utils';

type DocumentResource = Extract<KnowledgeResource, { kind: 'document' }>;

/** What Copy took from the canvas: a concept's definition, or the file (and table) a source box reads. */
export type CanvasClipboard =
  | { kind: 'concept'; concept: SemanticNodeType }
  | { kind: 'source'; resource: DocumentResource };

const PASTE_OFFSET = 48;
const clone = <T,>(value: T): T => structuredClone(value);

/** Held for the page, so a copy can be pasted into another model too. */
let held: CanvasClipboard | null = null;
export const readCanvasClipboard = () => held;
export const writeCanvasClipboard = (next: CanvasClipboard | null) => { held = next; };

/** A concept's definition. Its relationships, sources and records stay with the original. */
export function copyConcept(concept: SemanticNodeType): CanvasClipboard {
  return { kind: 'concept', concept: clone(concept) };
}

/**
 * The source box as the file its mappings read, or null for boxes that are not a file: typed records and
 * whole workspaces have nothing a concept could be mapped from again.
 */
export function copySource(source: DesignerSource): CanvasClipboard | null {
  const mapping = source.mappings[0];
  if (!mapping || source.kind === 'typed' || source.kind === 'workspace' || mapping.scope === 'workspace') return null;
  return {
    kind: 'source',
    resource: {
      kind: 'document', workspaceId: mapping.workspaceId, documentId: mapping.documentId, name: mapping.documentName || mapping.documentId,
      structured: mapping.assetKind !== 'document', mappable: true, mimeType: mapping.mimeType, path: mapping.documentPath,
      sheetName: mapping.sheetName || undefined,
    },
  };
}

/** A new concept with the copied one's fields, named after it, beside it and clear of the other boxes. */
export function pasteConcept(copied: SemanticNodeType, existing: SemanticNodeType[], copyName: string): SemanticNodeType {
  const taken = existing.map((node) => node.position);
  let position: CanvasPosition = { x: copied.position.x + PASTE_OFFSET, y: copied.position.y + PASTE_OFFSET };
  while (taken.some((spot) => Math.abs(spot.x - position.x) < PASTE_OFFSET / 2 && Math.abs(spot.y - position.y) < PASTE_OFFSET / 2)) {
    position = { x: position.x + PASTE_OFFSET, y: position.y + PASTE_OFFSET };
  }
  return {
    ...clone(copied), id: crypto.randomUUID(), label: copyName.slice(0, 120), key: uniqueBusinessKey(copyName, existing.map((node) => node.key)),
    systemKey: null, category: copied.category === 'system_collection' ? 'business_object' : copied.category, position,
  };
}
