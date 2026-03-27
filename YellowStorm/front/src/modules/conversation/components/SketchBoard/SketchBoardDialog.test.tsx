import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SketchBoardDialog } from './SketchBoardDialog';

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const drawingState = vi.hoisted(() => ({
  canvasRef: { current: null as HTMLCanvasElement | null },
  ensureSize: vi.fn(),
  tool: 'pen' as const,
  setTool: vi.fn(),
  color: '#000000',
  setColor: vi.fn(),
  brushSize: 3,
  setBrushSize: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  clear: vi.fn(),
  canUndo: false,
  canRedo: false,
  setBackgroundImage: vi.fn(),
  exportToPng: vi.fn(),
  isEmpty: true,
  startStroke: vi.fn(),
  continueStroke: vi.fn(),
  endStroke: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('./useDrawingCanvas', () => ({
  useDrawingCanvas: () => drawingState,
}));

describe('SketchBoardDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drawingState.isEmpty = true;
    drawingState.canUndo = false;
    drawingState.canRedo = false;
    drawingState.exportToPng.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  });

  it('cancels and resets on cancel click', async () => {
    const onOpenChange = vi.fn();
    const onDone = vi.fn();

    render(<SketchBoardDialog open onOpenChange={onOpenChange} onDone={onDone} />);

    await userEvent.click(screen.getByRole('button', { name: 'actionCancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(drawingState.reset).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('exports and calls onDone when clicking done', async () => {
    drawingState.isEmpty = false;
    const onOpenChange = vi.fn();
    const onDone = vi.fn();

    render(<SketchBoardDialog open onOpenChange={onOpenChange} onDone={onDone} />);

    await userEvent.click(screen.getByRole('button', { name: 'sketch.buttons.done' }));

    await waitFor(() => {
      expect(drawingState.exportToPng).toHaveBeenCalled();
      expect(onDone).toHaveBeenCalledTimes(1);
      const file = onDone.mock.calls[0][0] as File;
      expect(file).toBeInstanceOf(File);
      expect(file.type).toBe('image/png');
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(drawingState.reset).toHaveBeenCalled();
    });
  });
});
