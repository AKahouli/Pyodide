/**
 * Resize hook using pointer events with 8 edge/corner handles
 */

import { useCallback, useRef } from 'react';
import type { WindowPosition, WindowSize } from '../types';

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;

const CURSOR_MAP: Record<ResizeEdge, string> = {
  n: 'n-resize',
  s: 's-resize',
  e: 'e-resize',
  w: 'w-resize',
  ne: 'ne-resize',
  nw: 'nw-resize',
  se: 'se-resize',
  sw: 'sw-resize',
};

interface UseResizableOptions {
  position: WindowPosition;
  size: WindowSize;
  onPositionChange: (pos: WindowPosition) => void;
  onSizeChange: (size: WindowSize) => void;
}

export function useResizable({ position, size, onPositionChange, onSizeChange }: UseResizableOptions) {
  const resizing = useRef(false);
  const edgeRef = useRef<ResizeEdge>('se');
  const startMouse = useRef({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });
  const startSize = useRef({ width: 0, height: 0 });

  const onPointerDown = useCallback(
    (edge: ResizeEdge, e: React.PointerEvent) => {
      if (e.button !== 0) return;

      resizing.current = true;
      edgeRef.current = edge;
      startMouse.current = { x: e.clientX, y: e.clientY };
      startPos.current = { x: position.x, y: position.y };
      startSize.current = { width: size.width, height: size.height };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    },
    [position.x, position.y, size.width, size.height],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!resizing.current) return;

      const dx = e.clientX - startMouse.current.x;
      const dy = e.clientY - startMouse.current.y;
      const edge = edgeRef.current;

      let newX = startPos.current.x;
      let newY = startPos.current.y;
      let newW = startSize.current.width;
      let newH = startSize.current.height;

      // Horizontal
      if (edge.includes('e')) {
        newW = Math.max(MIN_WIDTH, startSize.current.width + dx);
      }
      if (edge.includes('w')) {
        const proposedW = startSize.current.width - dx;
        if (proposedW >= MIN_WIDTH) {
          newW = proposedW;
          newX = startPos.current.x + dx;
        } else {
          newW = MIN_WIDTH;
          newX = startPos.current.x + startSize.current.width - MIN_WIDTH;
        }
      }

      // Vertical
      if (edge.includes('s')) {
        newH = Math.max(MIN_HEIGHT, startSize.current.height + dy);
      }
      if (edge === 'n' || edge === 'ne' || edge === 'nw') {
        const proposedH = startSize.current.height - dy;
        if (proposedH >= MIN_HEIGHT) {
          newH = proposedH;
          newY = startPos.current.y + dy;
        } else {
          newH = MIN_HEIGHT;
          newY = startPos.current.y + startSize.current.height - MIN_HEIGHT;
        }
      }

      // Clamp to viewport
      newX = Math.max(0, newX);
      newY = Math.max(0, newY);

      onPositionChange({ x: newX, y: newY });
      onSizeChange({ width: newW, height: newH });
    },
    [onPositionChange, onSizeChange],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    resizing.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const getResizeHandleProps = useCallback(
    (edge: ResizeEdge) => {
      const isCorner = edge.length === 2;
      const edgeSize = 4;
      const cornerSize = 12;

      const baseStyle: React.CSSProperties = {
        position: 'absolute',
        zIndex: 10,
        cursor: CURSOR_MAP[edge],
        touchAction: 'none',
      };

      // Position each handle
      switch (edge) {
        case 'n':
          Object.assign(baseStyle, {
            top: 0,
            left: cornerSize,
            right: cornerSize,
            height: edgeSize,
          });
          break;
        case 's':
          Object.assign(baseStyle, {
            bottom: 0,
            left: cornerSize,
            right: cornerSize,
            height: edgeSize,
          });
          break;
        case 'e':
          Object.assign(baseStyle, {
            right: 0,
            top: cornerSize,
            bottom: cornerSize,
            width: edgeSize,
          });
          break;
        case 'w':
          Object.assign(baseStyle, {
            left: 0,
            top: cornerSize,
            bottom: cornerSize,
            width: edgeSize,
          });
          break;
        case 'nw':
          Object.assign(baseStyle, {
            top: 0,
            left: 0,
            width: cornerSize,
            height: cornerSize,
          });
          break;
        case 'ne':
          Object.assign(baseStyle, {
            top: 0,
            right: 0,
            width: cornerSize,
            height: cornerSize,
          });
          break;
        case 'sw':
          Object.assign(baseStyle, {
            bottom: 0,
            left: 0,
            width: cornerSize,
            height: cornerSize,
          });
          break;
        case 'se':
          Object.assign(baseStyle, {
            bottom: 0,
            right: 0,
            width: cornerSize,
            height: cornerSize,
          });
          break;
      }

      return {
        onPointerDown: (e: React.PointerEvent) => onPointerDown(edge, e),
        onPointerMove,
        onPointerUp,
        style: baseStyle,
        'data-resize-edge': edge,
        'data-is-corner': isCorner,
      };
    },
    [onPointerDown, onPointerMove, onPointerUp],
  );

  return { getResizeHandleProps };
}

export type { ResizeEdge };
