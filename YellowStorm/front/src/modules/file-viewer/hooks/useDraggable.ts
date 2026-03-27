/**
 * Drag hook using pointer events with setPointerCapture
 */

import { useCallback, useRef } from 'react';
import type { WindowPosition } from '../types';

interface UseDraggableOptions {
  position: WindowPosition;
  onPositionChange: (pos: WindowPosition) => void;
}

export function useDraggable({ position, onPositionChange }: UseDraggableOptions) {
  const dragging = useRef(false);
  const startMouse = useRef({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only left mouse button
      if (e.button !== 0) return;

      dragging.current = true;
      startMouse.current = { x: e.clientX, y: e.clientY };
      startPos.current = { x: position.x, y: position.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [position.x, position.y],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;

      const dx = e.clientX - startMouse.current.x;
      const dy = e.clientY - startMouse.current.y;

      const newX = Math.max(0, Math.min(window.innerWidth - 100, startPos.current.x + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 40, startPos.current.y + dy));

      onPositionChange({ x: newX, y: newY });
    },
    [onPositionChange],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return {
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      style: { touchAction: 'none' as const, cursor: 'grab' },
    },
  };
}
