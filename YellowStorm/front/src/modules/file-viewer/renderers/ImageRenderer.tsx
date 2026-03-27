/**
 * Image Renderer
 * Displays image files with zoom, pan, and checkerboard transparency background
 */

import { useCallback, useRef, useState } from 'react';
import { FileWarning, X, RotateCw, Loader2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFileViewerStore } from '../store';
import type { RendererProps } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface ImageRendererInternalProps extends RendererProps {
  registryRef?: React.MutableRefObject<Map<string, unknown>>;
}

type LoadState = 'loading' | 'ready' | 'error';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.25;

export function ImageRenderer({ tab }: ImageRendererInternalProps) {
  const closeTab = useFileViewerStore((s) => s.closeTab);
  const refreshTabUrl = useFileViewerStore((s) => s.refreshTabUrl);
  const { t } = useModuleTranslation('file-viewer');

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const posStart = useRef({ x: 0, y: 0 });

  const handleLoad = useCallback(() => {
    setLoadState('ready');
  }, []);

  const handleError = useCallback(() => {
    setErrorMessage(t('image.error.description'));
    setLoadState('error');
  }, [t]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      await refreshTabUrl(tab.id);
      setLoadState('loading');
      setErrorMessage('');
    } finally {
      setRetrying(false);
    }
  }, [tab.id, refreshTabUrl]);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP));
  }, []);

  const handleReset = useCallback(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta)));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    posStart.current = { ...position };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [position]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPosition({
      x: posStart.current.x + dx,
      y: posStart.current.y + dy,
    });
  }, [dragging]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, [dragging]);

  if (loadState === 'error') {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center p-6">
          <div className="rounded-full bg-destructive/10 p-4">
            <FileWarning className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">{t('image.error.title')}</h3>
            <p className="text-xs text-muted-foreground">{errorMessage}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
              <RotateCw className={`h-3.5 w-3.5 mr-1.5 ${retrying ? 'animate-spin' : ''}`} />
              {t('actions.retry')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => closeTab(tab.id)}>
              <X className="h-3.5 w-3.5 mr-1.5" />
              {t('actions.closeTab')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="relative h-full flex flex-col">
      {/* Zoom controls */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-background/90 backdrop-blur-sm border rounded-lg px-1.5 py-1 shadow-sm">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomOut} disabled={zoom <= MIN_ZOOM}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground w-12 text-center tabular-nums">
          {zoomPercent}%
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleZoomIn} disabled={zoom >= MAX_ZOOM}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <div className="w-px h-4 bg-border mx-0.5" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleReset}>
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Image area with checkerboard background */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden"
        style={{
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          /* Checkerboard for transparency */
          backgroundImage: `
            linear-gradient(45deg, var(--muted) 25%, transparent 25%),
            linear-gradient(-45deg, var(--muted) 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, var(--muted) 75%),
            linear-gradient(-45deg, transparent 75%, var(--muted) 75%)
          `,
          backgroundSize: '20px 20px',
          backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
        }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          className="w-full h-full flex items-center justify-center"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: dragging ? 'none' : 'transform 0.1s ease-out',
          }}
        >
          {/* Loading spinner */}
          {loadState === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          <img
            src={tab.url}
            alt={tab.fileName}
            className="max-w-full max-h-full object-contain select-none"
            draggable={false}
            onLoad={handleLoad}
            onError={handleError}
          />
        </div>
      </div>
    </div>
  );
}
