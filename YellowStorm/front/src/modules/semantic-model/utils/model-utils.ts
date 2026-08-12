import Dagre from '@dagrejs/dagre';
import type { CanvasPosition, SemanticGraph, SemanticNodeType, SemanticRelationType } from '../types';

export function businessKey(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}

export function uniqueBusinessKey(label: string, existingKeys: string[]): string {
  const base = businessKey(label) || 'item';
  const keys = new Set(existingKeys);
  if (!keys.has(base)) return base;
  let suffix = 2;
  while (keys.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

export function nextConceptPosition(nodes: SemanticNodeType[]): CanvasPosition {
  const width = 240;
  const height = 108;
  const horizontalGap = 64;
  const verticalGap = 56;

  for (let index = 0; index <= nodes.length; index += 1) {
    const candidate = {
      x: 120 + (index % 3) * (width + horizontalGap),
      y: 120 + Math.floor(index / 3) * (height + verticalGap),
    };
    const overlaps = nodes.some((node) =>
      candidate.x < node.position.x + width + horizontalGap
      && candidate.x + width + horizontalGap > node.position.x
      && candidate.y < node.position.y + height + verticalGap
      && candidate.y + height + verticalGap > node.position.y,
    );
    if (!overlaps) return candidate;
  }

  return { x: 120, y: 120 + (nodes.length + 1) * (height + verticalGap) };
}

export function nextLinkedConceptPosition(source: CanvasPosition, nodes: SemanticNodeType[]): CanvasPosition {
  const width = 240;
  const height = 108;
  const gap = 72;
  const candidate = { x:source.x+width+gap,y:source.y };
  while (nodes.some((node) => Math.abs(node.position.x-candidate.x)<width+gap/2 && Math.abs(node.position.y-candidate.y)<height+gap/2)) {
    candidate.y += height+gap;
  }
  return candidate;
}

export interface CompatibleRecordRelation {
  relation: SemanticRelationType;
  sourceRecordId: string;
  targetRecordId: string;
}

export function compatibleRecordRelations(graph: SemanticGraph, draggedSourceId: string, draggedTargetId: string): CompatibleRecordRelation[] {
  const draggedSource = graph.records.find((record) => record.id === draggedSourceId);
  const draggedTarget = graph.records.find((record) => record.id === draggedTargetId);
  if (!draggedSource || !draggedTarget || draggedSource.id === draggedTarget.id) return [];
  return graph.relations.flatMap((relation) => {
    if (relation.sourceNodeTypeId === draggedSource.nodeTypeId && relation.targetNodeTypeId === draggedTarget.nodeTypeId) {
      return [{ relation,sourceRecordId:draggedSource.id,targetRecordId:draggedTarget.id }];
    }
    if (relation.sourceNodeTypeId === draggedTarget.nodeTypeId && relation.targetNodeTypeId === draggedSource.nodeTypeId) {
      return [{ relation,sourceRecordId:draggedTarget.id,targetRecordId:draggedSource.id }];
    }
    return [];
  });
}

export function layoutStructure(nodes: SemanticNodeType[], relations: SemanticRelationType[]): Map<string, CanvasPosition> {
  const graph = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120 });
  nodes.forEach((node) => graph.setNode(node.id, { width: 240, height: 108 }));
  relations.forEach((relation) => graph.setEdge(relation.sourceNodeTypeId, relation.targetNodeTypeId));
  Dagre.layout(graph);
  return new Map(nodes.map((node) => {
    const point = graph.node(node.id);
    return [node.id, { x: point.x - 120, y: point.y - 54 }];
  }));
}
