import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useResizable } from './useResizable';

describe('useResizable', () => {
  it('resizes from south-east edge and updates size', () => {
    const onPositionChange = vi.fn();
    const onSizeChange = vi.fn();
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();

    const { result } = renderHook(() =>
      useResizable({
        position: { x: 20, y: 30 },
        size: { width: 600, height: 400 },
        onPositionChange,
        onSizeChange,
      }),
    );

    const se = result.current.getResizeHandleProps('se');

    se.onPointerDown({
      button: 0,
      clientX: 200,
      clientY: 200,
      pointerId: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: { setPointerCapture },
    } as unknown as React.PointerEvent);

    se.onPointerMove({
      clientX: 260,
      clientY: 250,
    } as unknown as React.PointerEvent);

    expect(onPositionChange).toHaveBeenCalledWith({ x: 20, y: 30 });
    expect(onSizeChange).toHaveBeenCalledWith({ width: 660, height: 450 });

    se.onPointerUp({
      pointerId: 1,
      currentTarget: { releasePointerCapture },
    } as unknown as React.PointerEvent);

    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
  });
});
