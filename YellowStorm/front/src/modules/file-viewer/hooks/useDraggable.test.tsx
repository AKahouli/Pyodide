import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDraggable } from './useDraggable';

describe('useDraggable', () => {
  it('updates position during drag and clamps to viewport', () => {
    const onPositionChange = vi.fn();
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();

    const { result } = renderHook(() =>
      useDraggable({
        position: { x: 50, y: 40 },
        onPositionChange,
      }),
    );

    result.current.dragHandleProps.onPointerDown({
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
      preventDefault: vi.fn(),
      currentTarget: { setPointerCapture },
    } as unknown as React.PointerEvent);

    result.current.dragHandleProps.onPointerMove({
      clientX: 9999,
      clientY: 9999,
    } as unknown as React.PointerEvent);

    expect(onPositionChange).toHaveBeenCalled();
    const last = onPositionChange.mock.calls.at(-1)?.[0] as { x: number; y: number };
    expect(last.x).toBeLessThanOrEqual(window.innerWidth - 100);
    expect(last.y).toBeLessThanOrEqual(window.innerHeight - 40);

    result.current.dragHandleProps.onPointerUp({
      pointerId: 1,
      currentTarget: { releasePointerCapture },
    } as unknown as React.PointerEvent);

    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
  });
});
