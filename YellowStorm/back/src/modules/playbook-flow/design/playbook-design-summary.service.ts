import { Injectable } from '@nestjs/common';

type DesignNode = { id: string };
type DesignEdge = { source: string; target: string };

@Injectable()
/**
 * Produces stable human-readable summaries for structural design changes
 * before design messages are persisted.
 */
export class PlaybookDesignSummaryService {
  summarizeStructuralChanges(
    oldNodes: DesignNode[],
    oldEdges: DesignEdge[],
    newNodes: DesignNode[],
    newEdges: DesignEdge[],
  ): string {
    const oldIds = new Set(oldNodes.map((node) => node.id));
    const newIds = new Set(newNodes.map((node) => node.id));
    const added = newNodes.filter((node) => !oldIds.has(node.id)).length;
    const removed = oldNodes.filter((node) => !newIds.has(node.id)).length;

    const parts: string[] = [];
    if (added > 0) parts.push(`Added ${added} node${added > 1 ? 's' : ''}`);
    if (removed > 0) parts.push(`Removed ${removed} node${removed > 1 ? 's' : ''}`);

    const oldEdgeKeys = new Set(oldEdges.map((edge) => `${edge.source}->${edge.target}`));
    const newEdgeKeys = new Set(newEdges.map((edge) => `${edge.source}->${edge.target}`));
    const edgesAdded = [...newEdgeKeys].filter((key) => !oldEdgeKeys.has(key)).length;
    const edgesRemoved = [...oldEdgeKeys].filter((key) => !newEdgeKeys.has(key)).length;

    if (edgesAdded > 0) parts.push(`Added ${edgesAdded} connection${edgesAdded > 1 ? 's' : ''}`);
    if (edgesRemoved > 0) parts.push(`Removed ${edgesRemoved} connection${edgesRemoved > 1 ? 's' : ''}`);

    return parts.length > 0 ? parts.join(', ') : 'No structural changes';
  }
}
