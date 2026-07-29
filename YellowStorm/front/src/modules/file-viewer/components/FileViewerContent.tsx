/**
 * File Viewer Content
 * Custom tab bar + renderer instance for the active tab only.
 */

import { useRef } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { PluginRegistry } from '@embedpdf/react-pdf-viewer';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useFileViewerStore, useFileViewerTabs, useFileViewerActiveTabId } from '../store';
import { getRenderer } from '../renderers';
import { UnsupportedRenderer } from '../renderers/UnsupportedRenderer';
import { FileTransformationTools } from './FileTransformationTools';

export function FileViewerContent() {
  const { t } = useModuleTranslation('file-viewer');
  const tabs = useFileViewerTabs();
  const activeTabId = useFileViewerActiveTabId();
  const setActiveTab = useFileViewerStore((s) => s.setActiveTab);
  const closeTab = useFileViewerStore((s) => s.closeTab);

  const registryMap = useRef<Map<string, PluginRegistry>>(new Map());

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

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
      {activeTab && <div className='flex justify-end border-b p-2'><FileTransformationTools key={activeTabId} tab={activeTab} /></div>}

      {/* Renderer instance — only the active tab is mounted */}
      <div className='flex-1 min-h-0'>
        {activeTab && (() => {
          const Renderer = getRenderer(activeTab.mimeType);
          const isLoading = activeTab.isLoading || !activeTab.url;

          if (isLoading) {
            return (
              <div className='flex flex-col items-center justify-center h-full gap-3 text-muted-foreground'>
                <Loader2 className='h-8 w-8 animate-spin' />
                <p className='text-sm'>{t('loading')} {activeTab.fileName}...</p>
              </div>
            );
          }
          if (Renderer) {
            return <Renderer key={activeTab.id} tab={activeTab} isActive registryRef={registryMap} />;
          }
          return <UnsupportedRenderer tab={activeTab} isActive />;
        })()}
      </div>
    </div>
  );
}
