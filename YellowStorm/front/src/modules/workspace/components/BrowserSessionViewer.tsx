import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
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
  frame, onInput, loading = false,
}: { frame: string | null; onInput: (e: InputEvent) => void; loading?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!frame || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      // Match the canvas backing store to the actual frame size so the image is
      // drawn 1:1 (no resampling blur) and coordinate mapping uses the real
      // remote viewport — even if the backend viewport is reconfigured.
      if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      ctx.drawImage(img, 0, 0);
    };
    img.src = frame;
  }, [frame]);

  const coordsFrom = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    return toViewportCoords(e.clientX, e.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height);
  };

  return (
    <div className='relative flex h-full w-full items-center justify-center'>
      {/* max-w/max-h keep the canvas within the box; its intrinsic width/height
          preserve the aspect ratio, so it letterboxes instead of stretching. */}
      <canvas
        ref={canvasRef}
        width={VIEWPORT_W}
        height={VIEWPORT_H}
        tabIndex={0}
        className='max-h-full max-w-full bg-white outline-none'
        onMouseMove={(e) => { const { x, y } = coordsFrom(e); onInput({ kind: 'mouse', type: 'move', x, y }); }}
        onMouseDown={(e) => { const { x, y } = coordsFrom(e); onInput({ kind: 'mouse', type: 'down', x, y, button: BTN[e.button] ?? 'left' }); }}
        onMouseUp={(e) => { const { x, y } = coordsFrom(e); onInput({ kind: 'mouse', type: 'up', x, y, button: BTN[e.button] ?? 'left' }); }}
        onWheel={(e) => { const { x, y } = coordsFrom(e); onInput({ kind: 'wheel', x, y, deltaX: e.deltaX, deltaY: e.deltaY }); }}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => { e.preventDefault(); onInput({ kind: 'key', type: 'down', key: e.key, text: e.key.length === 1 ? e.key : undefined }); }}
        onKeyUp={(e) => { e.preventDefault(); onInput({ kind: 'key', type: 'up', key: e.key }); }}
      />
      {/* While the page is loading, an overlay swallows clicks/keys (its
          pointer-events sit above the canvas) so a fast double-click can't fire a
          second navigation, and a spinner tells the user to wait. */}
      {loading && (
        <div
          role='status'
          aria-label='Chargement de la page'
          className='absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-[1px]'
          onMouseDown={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Loader2 className='h-8 w-8 animate-spin text-primary' />
        </div>
      )}
    </div>
  );
}
