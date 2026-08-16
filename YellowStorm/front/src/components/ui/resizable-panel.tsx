'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { GripVertical } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const KEYBOARD_RESIZE_STEP = 16;

export function OverflowTooltip({ children, text, className }: { children?: ReactNode; text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setIsOverflowing(el.scrollWidth > el.clientWidth);
  }, [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setIsOverflowing(el.scrollWidth > el.clientWidth);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  const content = children ?? text;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span ref={ref} className={cn('min-w-0 truncate', className)}>{content}</span>
      </TooltipTrigger>
      {isOverflowing && (
        <TooltipContent side="right" sideOffset={8}>
          <span className="max-w-xs break-all">{text}</span>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

interface ResizablePanelProps {
  children: ReactNode;
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidthRatio?: number;
  handlePosition?: 'left' | 'right';
  withHandle?: boolean;
  resizeHandleLabel?: string;
  className?: string;
  style?: CSSProperties;
}

export function ResizablePanel({
  children,
  storageKey,
  defaultWidth,
  minWidth,
  maxWidthRatio = 0.6,
  handlePosition = 'right',
  withHandle = false,
  resizeHandleLabel,
  className,
  style,
}: ResizablePanelProps) {
  const dragActive = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const getMaxWidth = useCallback(
    () => Math.max(minWidth, Math.floor(window.innerWidth * maxWidthRatio)),
    [maxWidthRatio, minWidth],
  );

  const clampWidth = useCallback(
    (value: number) => Math.min(getMaxWidth(), Math.max(minWidth, value)),
    [getMaxWidth, minWidth],
  );

  function readStoredWidth(): number {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) {
          return clampWidth(parsed);
        }
      }
    } catch { /* noop */ }
    return clampWidth(defaultWidth);
  }

  const [width, setWidth] = useState(readStoredWidth);

  useEffect(() => {
    const clamp = () => {
      setWidth((current) => clampWidth(current));
    };
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [clampWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(width));
    } catch { /* noop */ }
  }, [storageKey, width]);

  const onResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      dragActive.current = true;
      dragStartX.current = event.clientX;
      dragStartWidth.current = width;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [width],
  );

  const onResizeMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragActive.current) return;
      const delta = handlePosition === 'left'
        ? dragStartX.current - event.clientX
        : event.clientX - dragStartX.current;
      setWidth(clampWidth(dragStartWidth.current + delta));
    },
    [clampWidth, handlePosition],
  );

  const onResizeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragActive.current) return;
    dragActive.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const onResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | null = null;
    if (event.key === 'Home') nextWidth = minWidth;
    if (event.key === 'End') nextWidth = getMaxWidth();
    if (event.key === 'ArrowLeft') nextWidth = width + (handlePosition === 'left' ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP);
    if (event.key === 'ArrowRight') nextWidth = width + (handlePosition === 'left' ? -KEYBOARD_RESIZE_STEP : KEYBOARD_RESIZE_STEP);
    if (nextWidth == null) return;
    event.preventDefault();
    setWidth(clampWidth(nextWidth));
  }, [clampWidth, getMaxWidth, handlePosition, minWidth, width]);

  const maxWidth = getMaxWidth();

  const handle = (
    <div
      onPointerDown={onResizeStart}
      onPointerMove={onResizeMove}
      onPointerUp={onResizeEnd}
      onPointerCancel={onResizeEnd}
      role='separator'
      aria-orientation='vertical'
      aria-label={resizeHandleLabel}
      aria-valuemin={resizeHandleLabel ? minWidth : undefined}
      aria-valuemax={resizeHandleLabel ? maxWidth : undefined}
      aria-valuenow={resizeHandleLabel ? width : undefined}
      tabIndex={resizeHandleLabel ? 0 : undefined}
      onKeyDown={onResizeKeyDown}
      className={cn(
        'group/resize absolute top-0 bottom-0 z-20 flex cursor-ew-resize items-center justify-center transition-colors hover:bg-primary/20 active:bg-primary/30',
        withHandle ? 'w-3' : 'w-1 hover:bg-primary/30 active:bg-primary/50',
        handlePosition === 'left' ? 'left-0' : 'right-0',
      )}
      style={{ touchAction: 'none' }}
    >
      {withHandle && (
        <div className='flex h-8 w-3 items-center justify-center rounded-sm border bg-background text-muted-foreground shadow-sm transition-colors group-hover/resize:border-primary/40 group-hover/resize:text-foreground group-active/resize:border-primary/60'>
          <GripVertical className='size-3' aria-hidden />
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`relative flex h-full shrink-0 flex-col overflow-hidden ${className ?? ''}`}
      style={{
        width,
        flex: '0 0 auto',
        transition: dragActive.current ? 'none' : 'width 180ms ease',
        ...style,
      }}
    >
      {resizeHandleLabel ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{handle}</TooltipTrigger>
            <TooltipContent side={handlePosition === 'left' ? 'left' : 'right'} sideOffset={8}>
              {resizeHandleLabel}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        handle
      )}
      {children}
    </div>
  );
}
