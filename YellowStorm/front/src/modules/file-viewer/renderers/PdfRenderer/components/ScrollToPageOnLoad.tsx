import { useEffect } from 'react';
import { useCapability } from '@embedpdf/core/react';
import type { ScrollPlugin } from '@embedpdf/plugin-scroll';

interface ScrollToPageOnLoadProps {
  documentId: string;
  initialPage: number;
}

/**
 * This component scrolls to a specific page when the document layout is ready.
 * It uses the `onLayoutReady` event from the scroll capability exactly like the docs.
 */
export function ScrollToPageOnLoad({ documentId, initialPage }: ScrollToPageOnLoadProps) {
  const { provides: scrollCapability } = useCapability<ScrollPlugin>('scroll');

  useEffect(() => {
    if (!scrollCapability) return;

    const unsubscribe = scrollCapability.onLayoutReady((event) => {
      if (event.documentId === documentId && event.isInitial) {
        scrollCapability.forDocument(documentId).scrollToPage({ pageNumber: initialPage, behavior: 'instant' });
      }
    });

    return unsubscribe;
  }, [scrollCapability, documentId, initialPage]);

  return null;
}
