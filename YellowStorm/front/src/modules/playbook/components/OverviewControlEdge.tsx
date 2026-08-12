import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

import { cn } from '@/lib/utils';
import type { OverviewEdge } from '../utils/overview-canvas';

function polylinePath(points: { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function midpoint(points: { x: number; y: number }[]): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  return points[Math.floor(points.length / 2)];
}

export function OverviewControlEdge(props: EdgeProps<OverviewEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data } = props;
  const routePoints = data?.routePoints;
  const [fallbackPath, fallbackLabelX, fallbackLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });
  const path = routePoints?.length ? polylinePath(routePoints) : fallbackPath;
  const labelPoint = routePoints?.length ? midpoint(routePoints) : { x: fallbackLabelX, y: fallbackLabelY };
  const isConditional = data?.kind === 'conditional';
  const isError = data?.routerLabel === '__error__';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: isError ? 'var(--destructive)' : isConditional ? 'var(--primary)' : 'var(--muted-foreground)',
          strokeWidth: data?.dimmed ? 1 : 2.5,
          strokeDasharray: isConditional ? '6 4' : undefined,
          opacity: data?.dimmed ? 0.08 : 0.9,
          transition: 'opacity 180ms ease',
        }}
      />
      {data?.routerLabel ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute"
            style={{ transform: `translate(-50%, -50%) translate(${labelPoint.x}px,${labelPoint.y}px)` }}
          >
            <span className={cn(
              'rounded-md border bg-background/95 px-1.5 py-0.5 text-[10px] font-medium shadow-sm transition-opacity',
              isError ? 'border-destructive/40 text-destructive' : 'border-primary/30 text-primary',
              data.dimmed && 'opacity-10',
            )}>
              {data.routerLabel}
            </span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
