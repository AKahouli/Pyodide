/**
 * File Window Title Bar
 * Drag handle + minimize/close buttons
 */

import { Minus, X, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useConversationStore } from '@/modules/conversation/store';
import { useFileViewerStore, useFileViewerTabs, useFileViewerActiveTabId } from '../store';
import { useDraggable } from '../hooks';
import { useModuleTranslation } from '@/modules/localization';

export function FileWindowTitleBar() {
  const tabs = useFileViewerTabs();
  const activeTabId = useFileViewerActiveTabId();
  const position = useFileViewerStore((s) => s.position);
  const setPosition = useFileViewerStore((s) => s.setPosition);
  const minimize = useFileViewerStore((s) => s.minimize);
  const closeViewer = useFileViewerStore((s) => s.closeViewer);
  const switchToSidebar = useFileViewerStore((s) => s.switchToSidebar);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const { t } = useModuleTranslation('file-viewer');

  const { dragHandleProps } = useDraggable({
    position,
    onPositionChange: setPosition,
  });

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div
      {...dragHandleProps}
      className="flex items-center justify-between h-10 px-3 border-b bg-muted/50 select-none shrink-0"
    >
      <span className="text-sm font-medium truncate mr-2">
        {activeTab?.fileName ?? t('window.title')}
      </span>
      <div
        className="flex items-center gap-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {currentConversationId && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={switchToSidebar}>
                  <PanelRightClose className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('tooltip.dock')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={minimize}
        >
          <Minus className="h-3.5 w-3.5" />
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
