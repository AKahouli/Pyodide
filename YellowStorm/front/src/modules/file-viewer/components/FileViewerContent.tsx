/**
 * File Viewer Content
 * Custom tab bar + renderer instances (one per tab, all mounted, only active visible)
 */

import { useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { PluginRegistry } from '@embedpdf/react-pdf-viewer';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useFileViewerStore, useFileViewerTabs, useFileViewerActiveTabId } from '../store';
import { getRenderer } from '../renderers';
import { UnsupportedRenderer } from '../renderers/UnsupportedRenderer';

export function FileViewerContent() {
  const { t } = useModuleTranslation('file-viewer');
  const tabs = useFileViewerTabs();
  const activeTabId = useFileViewerActiveTabId();
  const setActiveTab = useFileViewerStore((s) => s.setActiveTab);
  const closeTab = useFileViewerStore((s) => s.closeTab);

  const registryMap = useRef<Map<string, PluginRegistry>>(new Map());

  return (
    <div className='flex flex-col flex-1 min-h-0'>
      {/* Tab bar - only when multiple tabs */}
      {tabs.length > 1 && (
        <div className='flex items-center gap-0.5 px-2 h-9 border-b bg-muted/30 overflow-x-auto shrink-0'>
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs whitespace-nowrap transition-colors ${tab.id === activeTabId ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-background/50'}`}>
              <span className='truncate max-w-35'>{tab.fileName}</span>
              <Button
                variant='ghost'
                size='icon'
                className='h-4 w-4 p-0 hover:bg-muted'
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                  registryMap.current.delete(tab.id);
                }}>
                <X className='h-3 w-3' />
              </Button>
            </button>
          ))}
        </div>
      )}

      {/* Renderer instances - all mounted, only active visible */}
      <div className='flex-1 min-h-0 relative'>
        {tabs.map((tab) => {
          const Renderer = getRenderer(tab.mimeType);
          const isActive = tab.id === activeTabId;
          const isLoading = tab.isLoading || !tab.url;

          let content;
          if (isLoading) {
            content = (
              <div className='flex flex-col items-center justify-center h-full gap-3 text-muted-foreground'>
                <Loader2 className='h-8 w-8 animate-spin' />
                <p className='text-sm'>{t('loading')} {tab.fileName}...</p>
              </div>
            );
          } else if (Renderer) {
            content = <Renderer tab={tab} isActive={isActive} registryRef={registryMap} />;
          } else {
            content = <UnsupportedRenderer tab={tab} isActive={isActive} />;
          }

          return (
            <div key={tab.id} className={`absolute inset-0 ${isActive ? 'visible' : 'invisible'}`}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
