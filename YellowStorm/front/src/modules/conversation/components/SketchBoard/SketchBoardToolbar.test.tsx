import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SketchBoardToolbar } from './SketchBoardToolbar';

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe('SketchBoardToolbar', () => {
  it('switches tools and handles color/background inputs', async () => {
    const setTool = vi.fn();
    const setColor = vi.fn();
    const setBrushSize = vi.fn();
    const onBackgroundImage = vi.fn();

    const { container } = render(
      <SketchBoardToolbar
        tool='pen'
        setTool={setTool}
        color='#000000'
        setColor={setColor}
        brushSize={3}
        setBrushSize={setBrushSize}
        onBackgroundImage={onBackgroundImage}
      />,
    );

    const buttons = screen.getAllByRole('button');
    await userEvent.click(buttons[1]);
    expect(setTool).toHaveBeenCalledWith('eraser');

    const colorInput = container.querySelector("input[type='color']") as HTMLInputElement;
    fireEvent.change(colorInput, { target: { value: '#123456' } });
    expect(setColor).toHaveBeenCalledWith('#123456');
    expect(setTool).toHaveBeenCalledWith('pen');

    const bgInput = container.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(['img'], 'bg.png', { type: 'image/png' });
    fireEvent.change(bgInput, { target: { files: [file] } });
    expect(onBackgroundImage).toHaveBeenCalledWith(file);
  });
});
