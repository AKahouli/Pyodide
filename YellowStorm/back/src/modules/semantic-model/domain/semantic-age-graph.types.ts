export type SemanticAgeGraphOperation =
  | { type: 'node.create'; nodeTypeId: string; label: string; values: Record<string, unknown> }
  | { type: 'node.delete'; nodeId: string }
  | { type: 'edge.create'; relationTypeId: string; sourceId: string; targetId: string }
  | { type: 'edge.delete'; edgeId: string };
