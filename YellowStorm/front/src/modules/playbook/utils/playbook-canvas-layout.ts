import type { CSSProperties } from 'react';
import type { Edge } from '@xyflow/react';

const ITERATOR_CHILD_HORIZONTAL_GAP = 221;
const ITERATOR_CHILD_VERTICAL_GAP = 221;
const ITERATOR_CHILD_MAX_COLUMNS = 3;
const ITERATOR_CHILD_NODE_WIDTH = 384;
const ITERATOR_CHILD_NODE_HEIGHT = 240;

export const DEFAULT_NODE_SPACING_X = 520;
export const TOOLBAR_MIN_LEFT_OFFSET = 40;

export const EDGE_STYLES: Record<string, CSSProperties> = {
  completed: { stroke: 'var(--color-green-500)', strokeWidth: 2 },
  running: { stroke: 'var(--primary)', strokeWidth: 2, strokeDasharray: '6 3' },
  failed: { stroke: 'var(--destructive)', strokeWidth: 2 },
  interrupted: { stroke: 'var(--color-yellow-500)', strokeWidth: 2, strokeDasharray: '6 3' },
  pending: { stroke: 'var(--muted-foreground)', strokeWidth: 1, opacity: 0.4 },
  skipped: { stroke: 'var(--muted-foreground)', strokeWidth: 1, opacity: 0.3 },
};

export function getIteratorBodyChildPosition(
  iteratorX: number,
  iteratorY: number,
  childIndex: number,
  totalChildren: number,
) {
  const columnCount = Math.min(
    ITERATOR_CHILD_MAX_COLUMNS,
    Math.max(1, Math.ceil(Math.sqrt(totalChildren))),
  );
  const column = childIndex % columnCount;
  const row = Math.floor(childIndex / columnCount);

  return {
    x: iteratorX + 32 + column * (ITERATOR_CHILD_NODE_WIDTH + ITERATOR_CHILD_HORIZONTAL_GAP),
    y: iteratorY + 72 + row * (ITERATOR_CHILD_NODE_HEIGHT + ITERATOR_CHILD_VERTICAL_GAP),
  };
}

export function hasEdgeStyleChanged(edge: Edge, nextStyle: CSSProperties): boolean {
  const currentStyle = edge.style as CSSProperties | undefined;
  if (!currentStyle) return true;
  return currentStyle.stroke !== nextStyle.stroke
    || currentStyle.strokeWidth !== nextStyle.strokeWidth
    || currentStyle.strokeDasharray !== nextStyle.strokeDasharray
    || currentStyle.opacity !== nextStyle.opacity;
}
