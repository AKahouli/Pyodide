/**
 * File Viewer Sidebar
 * Right-panel container that wraps FileViewerContent with its own title bar.
 * Used when files are opened from a conversation context.
 * Resizable via a left-edge drag handle. Animates open/close.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  useFileViewerStore,
  useFileViewerTabs,
  useFileViewerActiveTabId,
  useFileViewerMode,
  useFileViewerDisplayMode,
} from '../store';
import { FileViewerContent } from './FileViewerContent';
import { useModuleTranslation } from '@/modules/localization';

const SIDEBAR_DEFAULT_WIDTH = 768; // 3xl
const SIDEBAR_MIN_WIDTH = 480;
const SIDEBAR_MAX_WIDTH_RATIO = 0.6;
const ANIMATION_DURATION_MS = 250;

export function FileViewerSidebar() {
  const tabs = useFileViewerTabs();
  const activeTabId = useFileViewerActiveTabId();
  const switchToFloating = useFileViewerStore((s) => s.switchToFloating);
  const closeViewer = useFileViewerStore((s) => s.closeViewer);
  const mode = useFileViewerMode();
  const displayMode = useFileViewerDisplayMode();
  const { t } = useModuleTranslation('file-viewer');

  const isOpen = mode !== 'closed' && displayMode === 'sidebar';
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // --- Resize state ---
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // --- Animation state ---
  // Track whether the sidebar content should be rendered (stays true until exit animation finishes)
  const [mounted, setMounted] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Mount immediately, then trigger the animation on next frame
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimating(true);
        });
      });
    } else {
      // Start exit animation, unmount after it finishes
      setAnimating(false);
      const timer = setTimeout(() => setMounted(false), ANIMATION_DURATION_MS);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [width]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = startX.current - e.clientX;
    const maxWidth = Math.floor(window.innerWidth * SIDEBAR_MAX_WIDTH_RATIO);
    const newWidth = Math.min(maxWidth, Math.max(SIDEBAR_MIN_WIDTH, startWidth.current + dx));
    setWidth(newWidth);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  if (!mounted) return null;

  return (
    <div
      className="relative flex flex-col h-full shrink-0 border-l bg-background overflow-hidden"
      style={{
        width: animating ? width : 0,
        opacity: animating ? 1 : 0,
        transition: dragging.current
          ? 'none'
          : `width ${ANIMATION_DURATION_MS}ms cubic-bezier(0.4,0,0.2,1), opacity ${ANIMATION_DURATION_MS}ms cubic-bezier(0.4,0,0.2,1)`,
      }}
    >
      {/* Left-edge resize handle */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize z-10 hover:bg-primary/30 active:bg-primary/50 transition-colors"
        style={{ touchAction: 'none' }}
      />
      {/* Title bar */}
      <div className="flex items-center justify-between h-10 px-3 border-b bg-muted/50 shrink-0">
        <span className="text-sm font-medium truncate mr-2">
          {activeTab?.fileName ?? t('window.title')}
        </span>
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={switchToFloating}>
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('tooltip.popOut')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={closeViewer}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('tooltip.close')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      {/* Content */}
      <FileViewerContent />
    </div>
  );
}
