import { BaseEdge, type EdgeProps, getBezierPath, getSimpleBezierPath } from '@xyflow/react';

type RoutedEdgeProps = EdgeProps & {
  sourceHandle?: string;
  targetHandle?: string;
};

const Temporary = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps) => {
  const [edgePath] = getSimpleBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <BaseEdge
      className='stroke-1 stroke-ring'
      id={id}
      path={edgePath}
      style={{
        strokeDasharray: '5, 5',
      }}
    />
  );
};

const Animated = ({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, markerEnd, style }: RoutedEdgeProps) => {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} markerEnd={markerEnd} path={edgePath} style={style} />
      <circle fill='var(--primary)' r='4'>
        <animateMotion dur='2s' path={edgePath} repeatCount='indefinite' />
      </circle>
    </>
  );
};

const AnimatedWarning = ({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, markerEnd, style }: RoutedEdgeProps) => {
  const [edgePath] = getBezierPath({
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
        markerEnd={markerEnd}
        path={edgePath}
        style={{
          ...style,
          strokeDasharray: '6 4',
          stroke: 'var(--color-yellow-500)',
        }}
      />
    </>
  );
};

export const Edge = {
  Temporary,
  Animated,
  AnimatedWarning,
};
