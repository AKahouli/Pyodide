import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDrawingCanvas } from './useDrawingCanvas';

describe('useDrawingCanvas', () => {
  it('exposes expected defaults and resets state', () => {
    const { result } = renderHook(() => useDrawingCanvas());

    expect(result.current.tool).toBe('pen');
    expect(result.current.color).toBe('#000000');
    expect(result.current.brushSize).toBe(3);
    expect(result.current.isEmpty).toBe(true);

    act(() => {
      result.current.setTool('eraser');
      result.current.setColor('#ff0000');
      result.current.setBrushSize(9);
    });

    expect(result.current.tool).toBe('eraser');
    expect(result.current.color).toBe('#ff0000');
    expect(result.current.brushSize).toBe(9);

    act(() => {
      result.current.reset();
    });

    expect(result.current.tool).toBe('pen');
    expect(result.current.color).toBe('#000000');
    expect(result.current.brushSize).toBe(3);
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('rejects export when canvas is not available', async () => {
    const { result } = renderHook(() => useDrawingCanvas());
    await expect(result.current.exportToPng()).rejects.toThrow('Canvas not available');
  });
});
