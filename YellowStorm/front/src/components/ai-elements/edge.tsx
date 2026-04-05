import { BaseEdge, type EdgeProps, getBezierPath, getSimpleBezierPath, type InternalNode, type Node, Position, useInternalNode } from '@xyflow/react';

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

const getHandleCoordsById = (
  node: InternalNode<Node>,
  handleType: 'source' | 'target',
  handleId: string | null | undefined,
  fallbackPosition: Position,
) => {
  const handle = node.internals.handleBounds?.[handleType]?.find((h) => {
    if (handleId) return h.id === handleId;
    return h.position === fallbackPosition;
  });

  if (!handle) {
    return [0, 0] as const;
  }

  let offsetX = handle.width / 2;
  let offsetY = handle.height / 2;

  // this is a tiny detail to make the markerEnd of an edge visible.
  // The handle position that gets calculated has the origin top-left, so depending which side we are using, we add a little offset
  // when the handlePosition is Position.Right for example, we need to add an offset as big as the handle itself in order to get the correct position
  switch (fallbackPosition) {
    case Position.Left:
      offsetX = 0;
      break;
    case Position.Right:
      offsetX = handle.width;
      break;
    case Position.Top:
      offsetY = 0;
      break;
    case Position.Bottom:
      offsetY = handle.height;
      break;
    default:
      throw new Error(`Invalid handle position: ${fallbackPosition}`);
  }

  const x = node.internals.positionAbsolute.x + handle.x + offsetX;
  const y = node.internals.positionAbsolute.y + handle.y + offsetY;

  return [x, y] as const;
};

const getEdgeParams = (
  source: InternalNode<Node>,
  target: InternalNode<Node>,
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
) => {
  const sourcePos = Position.Right;
  const [sx, sy] = getHandleCoordsById(source, 'source', sourceHandle, sourcePos);
  const targetPos = Position.Left;
  const [tx, ty] = getHandleCoordsById(target, 'target', targetHandle, targetPos);

  return {
    sx,
    sy,
    tx,
    ty,
    sourcePos,
    targetPos,
  };
};

const Animated = ({ id, source, target, sourceHandle, targetHandle, markerEnd, style }: RoutedEdgeProps) => {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!(sourceNode && targetNode)) {
    return null;
  }

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode, sourceHandle, targetHandle);

  const [edgePath] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
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

const AnimatedWarning = ({ id, source, target, sourceHandle, targetHandle, markerEnd, style }: RoutedEdgeProps) => {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  if (!(sourceNode && targetNode)) {
    return null;
  }

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(sourceNode, targetNode, sourceHandle, targetHandle);

  const [edgePath] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sourcePos,
    targetX: tx,
    targetY: ty,
    targetPosition: targetPos,
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
