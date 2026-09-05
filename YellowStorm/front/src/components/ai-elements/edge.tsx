import { useLayoutEffect, useRef } from 'react';
import { BaseEdge, type EdgeProps, getBezierPath, getSimpleBezierPath } from '@xyflow/react';

type RoutedEdgeProps = EdgeProps & {
  sourceHandle?: string;
  targetHandle?: string;
};

const EDGE_ANIMATION_DURATION_MS = 2000;

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
  const animationRef = useRef<SVGAnimateMotionElement>(null);
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  useLayoutEffect(() => {
    const animation = animationRef.current;
    if (!animation) return;

    const phaseSeconds = (Date.now() % EDGE_ANIMATION_DURATION_MS) / 1000;
    if (typeof animation.beginElementAt === 'function') {
      animation.beginElementAt(-phaseSeconds);
      return;
    }

    animation.setAttribute('begin', '0s');
  }, []);

  return (
    <>
      <BaseEdge
        id={id}
        markerEnd={markerEnd}
        path={edgePath}
        style={{
          stroke: 'var(--muted-foreground)',
          ...style,
          strokeWidth: 2.5,
        }}
      />
      <circle fill='var(--primary)' r='4'>
        <animateMotion
          ref={animationRef}
          begin='indefinite'
          dur='2s'
          path={edgePath}
          repeatCount='indefinite'
        />
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
          strokeWidth: 2.5,
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
