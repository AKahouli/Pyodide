import { useCallback, useEffect, useRef, useState } from 'react';

export const SIDEBAR_MIN_WIDTH = 280;
export const SIDEBAR_MAX_WIDTH = 640;
export const SIDEBAR_DEFAULT_WIDTH = 344;
const KEYBOARD_STEP = 24;

/** Clamp a width to the sidebar's allowed range. */
export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

/**
 * Width while dragging the sidebar's LEFT-edge handle. The sidebar is docked on
 * the right, so dragging the handle left (negative delta from the drag origin)
 * grows it and dragging right shrinks it.
 */
export function computeDragWidth(startWidth: number, deltaX: number): number {
  return clampSidebarWidth(startWidth - deltaX);
}

function readStoredWidth(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return SIDEBAR_DEFAULT_WIDTH;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function writeStoredWidth(key: string, width: number): void {
  try {
    localStorage.setItem(key, String(width));
  } catch {
    // Ignore quota / disabled storage — width simply won't persist.
  }
}

export interface SeparatorProps {
  role: 'separator';
  'aria-orientation': 'vertical';
  'aria-valuenow': number;
  'aria-valuemin': number;
  'aria-valuemax': number;
  tabIndex: 0;
  onPointerDown: (e: React.PointerEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDoubleClick: () => void;
}

export interface ResizableSidebar {
  width: number;
  isResizing: boolean;
  separatorProps: SeparatorProps;
}

/**
 * Drag/keyboard-resizable docked sidebar. Persists the chosen width to
 * `localStorage[storageKey]` so it survives reloads and stream switches.
 * Pointer drag uses window-level listeners (robust across the whole viewport);
 * ArrowLeft/ArrowRight nudge the width; double-click resets to the default.
 */
export function useResizableSidebar(storageKey: string): ResizableSidebar {
  const [width, setWidthState] = useState<number>(() => readStoredWidth(storageKey));
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const commitWidth = useCallback(
    (next: number) => {
      const clamped = clampSidebarWidth(next);
      widthRef.current = clamped;
      setWidthState(clamped);
      writeStoredWidth(storageKey, clamped);
      return clamped;
    },
    [storageKey],
  );

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    setIsResizing(true);

    const handleMove = (moveEvent: PointerEvent) => {
      const next = computeDragWidth(startWidth, moveEvent.clientX - startX);
      widthRef.current = next;
      setWidthState(next);
    };
    const handleUp = () => {
      writeStoredWidth(storageKey, widthRef.current);
      setIsResizing(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [storageKey]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Sidebar is on the right: ArrowLeft moves the divider left → grow.
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        commitWidth(widthRef.current + KEYBOARD_STEP);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        commitWidth(widthRef.current - KEYBOARD_STEP);
      }
    },
    [commitWidth],
  );

  const onDoubleClick = useCallback(() => {
    commitWidth(SIDEBAR_DEFAULT_WIDTH);
  }, [commitWidth]);

  // Safety net: never leave stray window listeners if unmounted mid-drag.
  useEffect(() => () => setIsResizing(false), []);

  return {
    width,
    isResizing,
    separatorProps: {
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-valuenow': width,
      'aria-valuemin': SIDEBAR_MIN_WIDTH,
      'aria-valuemax': SIDEBAR_MAX_WIDTH,
      tabIndex: 0,
      onPointerDown,
      onKeyDown,
      onDoubleClick,
    },
  };
}
