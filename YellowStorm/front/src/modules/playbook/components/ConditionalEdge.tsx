import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from '@xyflow/react';

type ConditionalEdgeData = {
  routerLabel?: string | null;
  kind?: string;
  priority?: number | null;
};

export function ConditionalEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  const edgeData = data as ConditionalEdgeData | undefined;
  const routerLabel = edgeData?.routerLabel;
  const isError = routerLabel === '__error__';

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          strokeDasharray: '6 4',
          stroke: isError ? 'var(--destructive)' : undefined,
        }}
      />
      {routerLabel && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <span
              className="rounded border bg-background/95 px-1.5 py-0.5 text-[10px] font-medium shadow-sm"
              style={{
                borderColor: isError ? 'var(--destructive)' : 'hsl(var(--primary) / 0.3)',
                color: isError ? 'var(--destructive)' : 'hsl(var(--primary))',
              }}
            >
              {routerLabel}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
