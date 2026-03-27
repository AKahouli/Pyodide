import { useRef, useState, useCallback, useEffect } from 'react';

const MAX_HISTORY = 50;

export function useDrawingCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(3);
  const [isDrawing, setIsDrawing] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  const historyStack = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);
  const backgroundImage = useRef<HTMLImageElement | null>(null);
  const backgroundCanvas = useRef<HTMLCanvasElement | null>(null);
  const strokeCount = useRef(0);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const getCtx = useCallback(() => {
    return canvasRef.current?.getContext('2d') ?? null;
  }, []);

  // Ensure the canvas pixel buffer matches its CSS display size × DPR.
  // Returns the current DPR so callers can scale coordinates.
  // Only actually resets the buffer when dimensions changed.
  const ensureSize = useCallback((): number => {
    const canvas = canvasRef.current;
    if (!canvas) return 1;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.offsetWidth * dpr);
    const h = Math.round(canvas.offsetHeight * dpr);
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
    return dpr;
  }, []);

  const drawBackground = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!backgroundCanvas.current) return;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.drawImage(backgroundCanvas.current, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }, []);

  const saveSnapshot = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    const snapshot = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    historyStack.current.push(snapshot);
    if (historyStack.current.length > MAX_HISTORY) {
      historyStack.current.shift();
    }
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [getCtx]);

  const startStroke = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const ctx = getCtx();
      if (!ctx) return;

      // Guarantee canvas resolution is correct before first pixel is drawn.
      const dpr = ensureSize();

      saveSnapshot();
      setIsDrawing(true);

      const rect = ctx.canvas.getBoundingClientRect();
      const scaleX = ctx.canvas.width / rect.width;
      const scaleY = ctx.canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      lastPoint.current = { x, y };

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = brushSize * dpr;

      if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.fillStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
      }

      // Draw a dot for single clicks
      ctx.beginPath();
      ctx.arc(x, y, (brushSize * dpr) / 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.canvas.setPointerCapture(e.pointerId);
    },
    [getCtx, ensureSize, saveSnapshot, tool, color, brushSize],
  );

  const continueStroke = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawing) return;
      const ctx = getCtx();
      if (!ctx || !lastPoint.current) return;

      const rect = ctx.canvas.getBoundingClientRect();
      const scaleX = ctx.canvas.width / rect.width;
      const scaleY = ctx.canvas.height / rect.height;

      // Gather all intermediate points the OS sampled between frames.
      const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? [];
      const events = coalesced.length > 0 ? coalesced : [e.nativeEvent];

      for (const pe of events) {
        const x: number = (pe.clientX - rect.left) * scaleX;
        const y: number = (pe.clientY - rect.top) * scaleY;
        const prev = lastPoint.current!;

        // Quadratic bezier: control point is the previous position,
        // end point is the midpoint between previous and current.
        // This produces smooth curves through every sampled point.
        const mx: number = (prev.x + x) / 2;
        const my: number = (prev.y + y) / 2;

        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        ctx.stroke();

        lastPoint.current = { x: mx, y: my };
      }
    },
    [isDrawing, getCtx],
  );

  const endStroke = useCallback(() => {
    if (!isDrawing) return;
    const ctx = getCtx();
    if (!ctx) return;

    ctx.globalCompositeOperation = 'source-over';
    lastPoint.current = null;
    setIsDrawing(false);
    strokeCount.current += 1;
    setIsEmpty(false);
  }, [isDrawing, getCtx]);

  const undo = useCallback(() => {
    const ctx = getCtx();
    if (!ctx || historyStack.current.length === 0) return;

    const current = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    redoStack.current.push(current);

    const prev = historyStack.current.pop()!;
    ctx.putImageData(prev, 0, 0);
    drawBackground(ctx);

    setCanUndo(historyStack.current.length > 0);
    setCanRedo(true);

    strokeCount.current = Math.max(0, strokeCount.current - 1);
    if (strokeCount.current === 0 && !backgroundImage.current) {
      setIsEmpty(true);
    }
  }, [getCtx, drawBackground]);

  const redo = useCallback(() => {
    const ctx = getCtx();
    if (!ctx || redoStack.current.length === 0) return;

    const current = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    historyStack.current.push(current);

    const next = redoStack.current.pop()!;
    ctx.putImageData(next, 0, 0);
    drawBackground(ctx);

    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
    strokeCount.current += 1;
    setIsEmpty(false);
  }, [getCtx, drawBackground]);

  const clear = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;

    saveSnapshot();
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if (backgroundCanvas.current) {
      ctx.drawImage(backgroundCanvas.current, 0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    strokeCount.current = 0;
    setIsEmpty(!backgroundImage.current);
  }, [getCtx, saveSnapshot]);

  const setBackgroundImage = useCallback(
    (file: File) => {
      const img = new Image();
      img.onload = () => {
        backgroundImage.current = img;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const offscreen = document.createElement('canvas');
        offscreen.width = canvas.width;
        offscreen.height = canvas.height;
        const offCtx = offscreen.getContext('2d');
        if (!offCtx) return;

        const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (canvas.width - w) / 2;
        const y = (canvas.height - h) / 2;
        offCtx.drawImage(img, x, y, w, h);
        backgroundCanvas.current = offscreen;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          saveSnapshot();
          drawBackground(ctx);
        }

        setIsEmpty(false);
      };
      img.src = URL.createObjectURL(file);
    },
    [saveSnapshot, drawBackground],
  );

  const exportToPng = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        reject(new Error('Canvas not available'));
        return;
      }

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = canvas.width;
      exportCanvas.height = canvas.height;
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get context'));
        return;
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

      if (backgroundCanvas.current) {
        ctx.drawImage(backgroundCanvas.current, 0, 0);
      }

      ctx.drawImage(canvas, 0, 0);

      exportCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to export canvas'));
      }, 'image/png');
    });
  }, []);

  const reset = useCallback(() => {
    const ctx = getCtx();
    if (ctx) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    historyStack.current = [];
    redoStack.current = [];
    backgroundImage.current = null;
    backgroundCanvas.current = null;
    strokeCount.current = 0;
    lastPoint.current = null;
    setTool('pen');
    setColor('#000000');
    setBrushSize(3);
    setIsDrawing(false);
    setCanUndo(false);
    setCanRedo(false);
    setIsEmpty(true);
  }, [getCtx]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          redo();
        } else {
          e.preventDefault();
          undo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return {
    canvasRef,
    ensureSize,
    tool,
    setTool,
    color,
    setColor,
    brushSize,
    setBrushSize,
    undo,
    redo,
    clear,
    canUndo,
    canRedo,
    setBackgroundImage,
    exportToPng,
    isEmpty,
    startStroke,
    continueStroke,
    endStroke,
    reset,
  };
}
