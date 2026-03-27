/**
 * Unsupported Renderer
 * Fallback UI for file types without a dedicated renderer
 */

import { FileQuestion } from 'lucide-react';
import type { RendererProps } from '../types';
import { useModuleTranslation } from '@/modules/localization';

export function UnsupportedRenderer({ tab }: RendererProps) {
  const { t } = useModuleTranslation('file-viewer');

  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground p-8">
      <FileQuestion className="h-12 w-12" />
      <p className="text-sm text-center">
        {t('unsupported.message')}
      </p>
      <p className="text-xs text-center truncate max-w-[300px]">
        {tab.fileName}
      </p>
    </div>
  );
}
