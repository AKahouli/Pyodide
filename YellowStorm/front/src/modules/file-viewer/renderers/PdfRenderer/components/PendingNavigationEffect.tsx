import { useEffect } from 'react';
import { useCapability } from '@embedpdf/core/react';
import type { ScrollPlugin } from '@embedpdf/plugin-scroll';
import type { SearchPlugin } from '@embedpdf/plugin-search';
import { toast } from 'sonner';
import type { PendingNavigation } from '@/modules/file-viewer/types';
import { extractHighlightText } from '../utils/text';
import { useModuleTranslation } from '@/modules/localization';

interface PendingNavigationEffectProps {
  documentId: string;
  tabId: string;
  isActive: boolean;
  pendingNavigation: PendingNavigation | null;
}

/**
 * Preserve our existing behavior that jumps to a specific page/text selection
 * when the user navigates from search results or other modules.
 */
export function PendingNavigationEffect({ documentId, tabId, isActive, pendingNavigation }: PendingNavigationEffectProps) {
  const { provides: scrollCapability } = useCapability<ScrollPlugin>('scroll');
  const { provides: searchCapability } = useCapability<SearchPlugin>('search');
  const { t } = useModuleTranslation('file-viewer');

  useEffect(() => {
    if (!isActive || pendingNavigation?.tabId !== tabId) {
      return;
    }

    const targetPage = pendingNavigation?.page;
    const targetQuery = extractHighlightText(pendingNavigation?.highlightText);

    if (typeof targetPage === 'number' && scrollCapability) {
      try {
        scrollCapability.forDocument(documentId).scrollToPage({ pageNumber: targetPage, behavior: 'smooth' });
      } catch (error) {
        toast.warning(t('pdf.navigationFailed.title'), {
          description: error instanceof Error ? error.message : t('pdf.navigationFailed.description'),
        });
      }
    }

    if (targetQuery && searchCapability) {
      try {
        searchCapability.startSearch(documentId);
        searchCapability.searchAllPages(targetQuery, documentId);
      } catch (error) {
        toast.warning(t('pdf.highlightFailed.title'), {
          description: error instanceof Error ? error.message : t('pdf.highlightFailed.description'),
        });
      }
    }
  }, [documentId, isActive, pendingNavigation, tabId, scrollCapability, searchCapability, t]);

  return null;
}
