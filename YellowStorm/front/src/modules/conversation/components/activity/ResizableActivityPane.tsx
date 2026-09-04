import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';

const MIN_HEIGHT = 80;
const AUTO_MAX_HEIGHT = 320;
const MAX_HEIGHT = 480;
const KEYBOARD_STEP = 16;

interface ResizableActivityPaneProps {
  children: ReactNode;
  paneRef: RefObject<HTMLDivElement>;
  resizeLabel: string;
}

export function ResizableActivityPane({ children, paneRef, resizeLabel }: Readonly<ResizableActivityPaneProps>) {
  const [manualHeight, setManualHeight] = useState<number>();
  const [measuredHeight, setMeasuredHeight] = useState(MIN_HEIGHT);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const activePointerId = useRef<number | null>(null);
  const clampHeight = (value: number) => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value));
  const height = manualHeight ?? measuredHeight;

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const updateHeight = () => {
      const nextHeight = clampHeight(Math.round(pane.getBoundingClientRect().height) || MIN_HEIGHT);
      setMeasuredHeight((current) => current === nextHeight ? current : nextHeight);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(pane);
    return () => observer.disconnect();
  }, [paneRef]);

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || activePointerId.current !== null) return;
    activePointerId.current = event.pointerId;
    dragStartY.current = event.clientY;
    dragStartHeight.current = height;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const resize = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    setManualHeight(clampHeight(dragStartHeight.current + event.clientY - dragStartY.current));
  };

  const stopResize = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    activePointerId.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const stopResizeAfterCaptureLoss = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current === event.pointerId) activePointerId.current = null;
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextHeight: number | undefined;
    if (event.key === 'ArrowUp') nextHeight = height - KEYBOARD_STEP;
    if (event.key === 'ArrowDown') nextHeight = height + KEYBOARD_STEP;
    if (event.key === 'Home') nextHeight = MIN_HEIGHT;
    if (event.key === 'End') nextHeight = MAX_HEIGHT;
    if (nextHeight === undefined) return;
    event.preventDefault();
    setManualHeight(clampHeight(nextHeight));
  };

  return (
    <div className='relative hidden md:block'>
      <div
        ref={paneRef}
        data-activity-pane
        data-auto-sized={manualHeight === undefined || undefined}
        className='overflow-y-auto pr-2'
        style={manualHeight === undefined ? { minHeight: MIN_HEIGHT, maxHeight: AUTO_MAX_HEIGHT } : { height: manualHeight }}
      >
        {children}
      </div>
      <div
        role='separator'
        aria-orientation='horizontal'
        aria-label={resizeLabel}
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={MAX_HEIGHT}
        aria-valuenow={height}
        tabIndex={0}
        onKeyDown={resizeWithKeyboard}
        onPointerDown={startResize}
        onPointerMove={resize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        onLostPointerCapture={stopResizeAfterCaptureLoss}
        className='group flex h-3 w-full cursor-row-resize items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        style={{ touchAction: 'none' }}
      >
        <span className='h-px w-12 rounded-full bg-border transition-colors group-hover:bg-muted-foreground group-focus-visible:bg-muted-foreground' aria-hidden='true' />
      </div>
    </div>
  );
}
