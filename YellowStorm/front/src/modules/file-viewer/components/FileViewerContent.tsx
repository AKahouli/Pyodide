/**
 * File Viewer Content
 * Renderer instances (one per file, all mounted, only active visible)
 */

import { useRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { PluginRegistry } from '@embedpdf/react-pdf-viewer';
import { useModuleTranslation } from '@/modules/localization';
import { useFileViewerTabs, useFileViewerActiveTabId } from '../store';
import { getRenderer } from '../renderers';
import { UnsupportedRenderer } from '../renderers/UnsupportedRenderer';
import { FileTransformationTools } from './FileTransformationTools';

export function FileViewerContent() {
  const { t } = useModuleTranslation('file-viewer');
  const tabs = useFileViewerTabs();
  const activeTabId = useFileViewerActiveTabId();

  const registryMap = useRef<Map<string, PluginRegistry>>(new Map());

  return (
    <div className='flex flex-col flex-1 min-h-0'>
      {tabs.find((tab) => tab.id === activeTabId) && <div className='flex justify-end border-b p-2'><FileTransformationTools key={activeTabId} tab={tabs.find((tab) => tab.id === activeTabId)!} /></div>}

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
