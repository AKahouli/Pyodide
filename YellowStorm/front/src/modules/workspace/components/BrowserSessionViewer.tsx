import { useEffect, useRef } from 'react';
import { VIEWPORT_W, VIEWPORT_H, type InputEvent, type MouseButton } from '../hooks/useBrowserSession';

export function toViewportCoords(
  clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number },
  w: number, h: number,
): { x: number; y: number } {
  const x = ((clientX - rect.left) / rect.width) * w;
  const y = ((clientY - rect.top) / rect.height) * h;
  return { x: Math.round(x), y: Math.round(y) };
}

const BTN: Record<number, MouseButton> = { 0: 'left', 1: 'middle', 2: 'right' };

export function BrowserSessionViewer({
  frame, onInput,
}: { frame: string | null; onInput: (e: InputEvent) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!frame || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, VIEWPORT_W, VIEWPORT_H);
    img.src = frame;
  }, [frame]);

  const coordsFrom = (e: React.MouseEvent) =>
    toViewportCoords(e.clientX, e.clientY, canvasRef.current!.getBoundingClientRect(), VIEWPORT_W, VIEWPORT_H);

  return (
    <canvas
      ref={canvasRef}
      width={VIEWPORT_W}
      height={VIEWPORT_H}
      tabIndex={0}
      className='h-full w-full bg-white outline-none'
      onMouseMove={(e) => { const { x, y } = coordsFrom(e); onInput({ kind: 'mouse', type: 'move', x, y }); }}
      onMouseDown={(e) => { const { x, y } = coordsFrom(e); onInput({ kind: 'mouse', type: 'down', x, y, button: BTN[e.button] ?? 'left' }); }}
      onMouseUp={(e) => { const { x, y } = coordsFrom(e); onInput({ kind: 'mouse', type: 'up', x, y, button: BTN[e.button] ?? 'left' }); }}
      onWheel={(e) => { const { x, y } = coordsFrom(e); onInput({ kind: 'wheel', x, y, deltaX: e.deltaX, deltaY: e.deltaY }); }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => { e.preventDefault(); onInput({ kind: 'key', type: 'down', key: e.key, text: e.key.length === 1 ? e.key : undefined }); }}
      onKeyUp={(e) => { e.preventDefault(); onInput({ kind: 'key', type: 'up', key: e.key }); }}
    />
  );
}
