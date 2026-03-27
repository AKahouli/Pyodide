/**
 * Minimized File Viewer Pill
 * Small draggable pill in the bottom-right corner
 */

import { FileText, Maximize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  useFileViewerStore,
  useFileViewerTabs,
  useFileViewerActiveTabId,
  useFileViewerMinimizedPosition,
} from '../store';
import { useDraggable } from '../hooks';
import { useModuleTranslation } from '@/modules/localization';

export function FileMinimizedWindow() {
  const tabs = useFileViewerTabs();
  const activeTabId = useFileViewerActiveTabId();
  const minimizedPosition = useFileViewerMinimizedPosition();
  const setMinimizedPosition = useFileViewerStore((s) => s.setMinimizedPosition);
  const restore = useFileViewerStore((s) => s.restore);
  const closeViewer = useFileViewerStore((s) => s.closeViewer);
  const { t } = useModuleTranslation('file-viewer');

  const { dragHandleProps } = useDraggable({
    position: minimizedPosition,
    onPositionChange: setMinimizedPosition,
  });

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div
      {...dragHandleProps}
      className="fixed z-[55] flex items-center gap-2 h-10 px-3 rounded-lg border shadow-lg bg-background select-none"
      style={{
        left: minimizedPosition.x,
        top: minimizedPosition.y,
      }}
    >
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-sm font-medium truncate max-w-[160px]">
        {activeTab?.fileName ?? t('window.title')}
      </span>
      {tabs.length > 1 && (
        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
          {tabs.length}
        </Badge>
      )}
      <div
        className="flex items-center gap-1 ml-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={restore}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={closeViewer}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
