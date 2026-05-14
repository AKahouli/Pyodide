/**
 * Data Binding Serializer
 * Handles DataBinding ↔ visual representation conversion.
 * Data bindings are NOT persisted as React Flow edges — they are a separate
 * collection rendered as a data-layer overlay (toggleable via canvas toolbar).
 */

import type { DataBinding } from '../../types';

export interface DataLayerEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  kind: string;
  iteration: string | null;
}

export function dataBindingsToLayerEdges(bindings: DataBinding[]): DataLayerEdge[] {
  return bindings.map((db) => ({
    id: db.id,
    source: db.sourceNode || '__none__',
    sourceHandle: db.sourcePort || 'default',
    target: db.targetNode,
    targetHandle: db.targetPort,
    kind: db.sourceKind,
    iteration: db.iteration ?? null,
  }));
}

export function layerEdgesToDataBindings(edges: DataLayerEdge[]): DataBinding[] {
  return edges.map((e) => ({
    id: e.id,
    targetNode: e.target,
    targetPort: e.targetHandle,
    sourceKind: e.kind as DataBinding['sourceKind'],
    sourceNode: e.source !== '__none__' ? e.source : undefined,
    sourcePort: e.sourceHandle !== 'default' ? e.sourceHandle : undefined,
    iteration: (e.iteration as DataBinding['iteration']) || undefined,
  }));
}
