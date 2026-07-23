/**
 * File Floating Window
 * Top-level component: routes mode -> open/minimized/closed
 */

import { useEffect } from 'react';
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

      // Clamp floating window position (keep at least 100px visible horizontally, 40px vertically)
      const maxX = Math.max(0, vw - 100);
      const maxY = Math.max(0, vh - 40);
      const clampedX = Math.min(state.position.x, maxX);
      const clampedY = Math.min(state.position.y, maxY);
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
      <div className={`fixed z-55 rounded-lg border shadow-2xl bg-background overflow-hidden flex flex-col ${mode === 'minimized' ? 'opacity-0 pointer-events-none' : ''}`} style={{ left: position.x, top: position.y, width: size.width, height: size.height }}>
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
