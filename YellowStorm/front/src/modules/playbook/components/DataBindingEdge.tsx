import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from '@xyflow/react';

type DataBindingEdgeData = {
  label?: string;
  details?: string[];
  status?: 'ok' | 'warning';
  sourceKind?: string;
};

export function DataBindingEdge({
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
  const edgeData = data as DataBindingEdgeData | undefined;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const isWarning = edgeData?.status === 'warning';
  const title = edgeData?.details?.join('\n');

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: isWarning ? 'var(--destructive)' : 'var(--chart-4)',
          strokeDasharray: edgeData?.sourceKind === 'trigger' ? '3 3' : '4 4',
          strokeWidth: 2.5,
          opacity: 1,
        }}
      />
      {edgeData?.label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'none',
            }}
          >
            <span
              className="rounded border bg-background/95 px-1.5 py-0.5 text-[10px] font-medium shadow-sm"
              style={{
                borderColor: isWarning ? 'var(--destructive)' : 'color-mix(in oklch, var(--chart-4) 35%, transparent)',
                color: isWarning ? 'var(--destructive)' : 'var(--chart-4)',
              }}
              title={title}
            >
              {edgeData.label}
            </span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
