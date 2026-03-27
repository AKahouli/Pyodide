import { useEffect, useRef } from 'react';
import { useCapability } from '@embedpdf/core/react';
import type { SearchPlugin } from '@embedpdf/plugin-search';
import { toast } from 'sonner';
import { useModuleTranslation } from '@/modules/localization';

interface HighlightOnLoadProps {
  documentId: string;
  text?: string;
}

/**
 * Triggers a search highlight once per document load using the provided text.
 * Useful for reproducing the static highlight behavior with real navigation payloads.
 */
export function HighlightOnLoad({ documentId, text }: HighlightOnLoadProps) {
  const { provides: searchCapability } = useCapability<SearchPlugin>('search');
  const hasHighlightedRef = useRef(false);
  const { t } = useModuleTranslation('file-viewer');

  useEffect(() => {
    if (!searchCapability || !text || hasHighlightedRef.current) {
      return;
    }

    const scope = searchCapability.forDocument(documentId);
    try {
      scope.startSearch();
      scope.searchAllPages(text);
      hasHighlightedRef.current = true;
    } catch (error) {
      toast.warning(t('pdf.highlightFailed.title'), {
        description: error instanceof Error ? error.message : t('pdf.highlightFailed.description'),
      });
    }
  }, [searchCapability, documentId, text, t]);

  useEffect(() => {
    hasHighlightedRef.current = false;
  }, [documentId]);

  return null;
}
