/**
 * DOCX Renderer using @cyntler/react-doc-viewer
 */

import React, { useCallback, useMemo, useRef } from 'react';
import { Download } from 'lucide-react';
import DocViewer from '@cyntler/react-doc-viewer';
import type { RendererProps } from '../../types';
import { Button } from '@/components/ui/button';

export function DocxRenderer({ tab, isActive }: Readonly<RendererProps>) {
  const documents = useMemo(() => {
    return [{ uri: tab.url, fileType: 'docx', fileName: tab.fileName }];
  }, [tab.url, tab.fileName]);

  const handleDownload = useCallback(() => {
    const link = document.createElement('a');
    link.href = tab.url;
    link.download = tab.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [tab.url, tab.fileName]);

  const viewerRef = useRef<HTMLDivElement>(null);

  if (!isActive) {
    return null;
  }

  // Custom loading renderer to hide the package's internal loader
  const EmptyLoader = () => null;

  return (
    <div className='relative h-full flex flex-col'>
      {/* Download button in toolbar */}
      <div className='absolute top-3 right-3 z-10'>
        <Button variant='ghost' size='icon' className='h-7 w-7 bg-background/90 backdrop-blur-sm border shadow-sm' onClick={handleDownload}>
          <Download className='h-3.5 w-3.5' />
        </Button>
      </div>

      {/* DocViewer component */}
      <div ref={viewerRef} className='h-full overflow-auto bg-muted/30' style={{ height: '100%' }}>
        <DocViewer documents={documents} config={{ header: { disableHeader: true }, loadingRenderer: { overrideComponent: EmptyLoader } }} />
      </div>
    </div>
  );
}
