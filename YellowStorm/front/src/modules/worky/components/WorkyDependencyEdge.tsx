import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

/**
 * Draws the path dagre already computed (`data.dagrePoints`, set by
 * layoutCompactCanvasNodes) instead of React Flow's default straight-between-
 * endpoints bezier. An edge spanning more than one rank — e.g. a step that
 * depends directly on something several ranks back — has real waypoints
 * routing it around any same-rank nodes sitting in between; without this,
 * that edge is drawn straight through wherever those nodes happen to be,
 * which can look like a connection to a node it has nothing to do with.
 *
 * Falls back to the ordinary bezier when there are no waypoints (e.g. in
 * tests that build edges without running them through the dagre layout).
 */
export function WorkyDependencyEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps): JSX.Element {
  const points = (data as { dagrePoints?: { x: number; y: number }[] } | undefined)?.dagrePoints;

  if (!points || points.length < 2) {
    const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
    return <BaseEdge id={id} markerEnd={markerEnd} path={edgePath} style={style} />;
  }

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
  return <BaseEdge id={id} markerEnd={markerEnd} path={path} style={style} />;
}
