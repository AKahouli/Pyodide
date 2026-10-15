/**
 * File Floating Window
 * Top-level component: routes mode -> open/minimized/closed
 */

import { useEffect, useRef } from 'react';
import { useFileViewerStore, useFileViewerMode, useFileViewerDisplayMode, useFileViewerPosition, useFileViewerSize } from '../store';
import { useResizable } from '../hooks';
import type { ResizeEdge } from '../hooks';
import { FileWindowTitleBar } from './FileWindowTitleBar';
import { FileMinimizedWindow } from './FileMinimizedWindow';
import { FileViewerContent } from './FileViewerContent';

const RESIZE_EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export function FileFloatingWindow() {
  const mode = useFileViewerMode();
  const displayMode = useFileViewerDisplayMode();
  const position = useFileViewerPosition();
  const size = useFileViewerSize();
  const setPosition = useFileViewerStore((s) => s.setPosition);
  const setSize = useFileViewerStore((s) => s.setSize);
  const setMinimizedPosition = useFileViewerStore((s) => s.setMinimizedPosition);
  const closeViewer = useFileViewerStore((s) => s.closeViewer);
  const closeOnOutsideClick = useFileViewerStore((s) => s.closeOnOutsideClick);
  const viewport = useRef({ width: window.innerWidth, height: window.innerHeight });

  // Clamp position and size when the browser window is resized
  useEffect(() => {
    const handleResize = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const state = useFileViewerStore.getState();

      // Clamp floating window size (don't exceed viewport)
      const clampedW = Math.min(state.size.width, vw);
      const clampedH = Math.min(state.size.height, vh);
      if (clampedW !== state.size.width || clampedH !== state.size.height) {
        setSize({ width: clampedW, height: clampedH });
      }

      // Keep centered previews centered; preserve dragged placement within the new viewport.
      const wasCentered = Math.abs(state.position.x - Math.max(0, Math.round((viewport.current.width - state.size.width) / 2))) <= 1
        && Math.abs(state.position.y - Math.max(0, Math.round((viewport.current.height - state.size.height) / 2))) <= 1;
      const clampedX = wasCentered ? Math.round((vw - clampedW) / 2) : Math.max(0, Math.min(state.position.x, vw - clampedW));
      const clampedY = wasCentered ? Math.round((vh - clampedH) / 2) : Math.max(0, Math.min(state.position.y, vh - clampedH));
      viewport.current = { width: vw, height: vh };
      if (clampedX !== state.position.x || clampedY !== state.position.y) {
        setPosition({ x: clampedX, y: clampedY });
      }

      // Clamp minimized pill position
      const pillMaxX = Math.max(0, vw - 100);
      const pillMaxY = Math.max(0, vh - 40);
      const pillX = Math.min(state.minimizedPosition.x, pillMaxX);
      const pillY = Math.min(state.minimizedPosition.y, pillMaxY);
      if (pillX !== state.minimizedPosition.x || pillY !== state.minimizedPosition.y) {
        setMinimizedPosition({ x: pillX, y: pillY });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setPosition, setSize, setMinimizedPosition]);

  const { getResizeHandleProps } = useResizable({
    position,
    size,
    onPositionChange: setPosition,
    onSizeChange: setSize,
  });
  const widthConstrained = size.width > window.innerWidth;
  const heightConstrained = size.height > window.innerHeight;
  const renderedSize = {
    width: Math.min(size.width, window.innerWidth),
    height: Math.min(size.height, window.innerHeight),
  };
  const renderedPosition = {
    x: widthConstrained ? 0 : position.x,
    y: heightConstrained ? 0 : position.y,
  };

  if (mode === 'closed' || displayMode !== 'floating') return null;

  return (
    <>
      {mode === 'minimized' && <FileMinimizedWindow />}
      {mode === 'open' && (
        <div
          className={`fixed inset-0 bg-black/80 z-51 ${closeOnOutsideClick ? '' : 'pointer-events-none'}`}
          onClick={closeOnOutsideClick ? closeViewer : undefined}
          data-testid='file-viewer-backdrop'
        />
      )}
      <div data-testid='file-viewer-window' className={`fixed z-55 rounded-lg border shadow-2xl bg-background overflow-hidden flex flex-col ${mode === 'minimized' ? 'opacity-0 pointer-events-none' : ''}`} style={{ left: renderedPosition.x, top: renderedPosition.y, width: renderedSize.width, height: renderedSize.height }}>
        {/* 8 invisible resize handles */}
        {RESIZE_EDGES.map((edge) => (
          <div key={edge} {...getResizeHandleProps(edge)} />
        ))}

        <FileWindowTitleBar />
        <FileViewerContent />
      </div>
    </>
  );
}
