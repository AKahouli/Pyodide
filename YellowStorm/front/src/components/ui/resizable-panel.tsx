'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export function OverflowTooltip({ children, text }: { children?: ReactNode; text: string }) {
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
        <span ref={ref} className="min-w-0 truncate">{content}</span>
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
  className,
  style,
}: ResizablePanelProps) {
  const dragActive = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  function readStoredWidth(): number {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed)) {
          const max = Math.floor(window.innerWidth * maxWidthRatio);
          return Math.min(max, Math.max(minWidth, parsed));
        }
      }
    } catch { /* noop */ }
    return defaultWidth;
  }

  const [width, setWidth] = useState(readStoredWidth);

  useEffect(() => {
    const clamp = () => {
      const max = Math.floor(window.innerWidth * maxWidthRatio);
      setWidth((current) => Math.min(max, Math.max(minWidth, current)));
    };
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [minWidth, maxWidthRatio]);

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
      const max = Math.floor(window.innerWidth * maxWidthRatio);
      const next = Math.min(max, Math.max(minWidth, dragStartWidth.current + delta));
      setWidth(next);
    },
    [minWidth, maxWidthRatio, handlePosition],
  );

  const onResizeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragActive.current) return;
    dragActive.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

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
      <div
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        className={`absolute top-0 bottom-0 z-20 w-1 cursor-ew-resize transition-colors hover:bg-primary/30 active:bg-primary/50 ${
          handlePosition === 'left' ? 'left-0' : 'right-0'
        }`}
        style={{ touchAction: 'none' }}
      />
      {children}
    </div>
  );
}
