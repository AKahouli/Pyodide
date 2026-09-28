import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { buildMessagePdfDocument, printHtmlDocument } from './messagePdfHtml';

interface PdfExportPortalProps {
  title: string;
  subtitle?: string;
  /** Serialized content; the print effect re-runs when it changes. */
  contentKey: string;
  onFinish: (ok: boolean) => void;
  children: ReactNode;
}

/**
 * Hidden render of markdown content used to produce the print/PDF document.
 * Mounted one-shot by the export flows; prints on the next tick after render.
 */
export function PdfExportPortal({ title, subtitle, contentKey, onFinish, children }: Readonly<PdfExportPortalProps>) {
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      try {
        const content = contentRef.current;
        if (!content) {
          onFinish(false);
          return;
        }
        printHtmlDocument(buildMessagePdfDocument(title, content.innerHTML, subtitle));
        onFinish(true);
      } catch {
        onFinish(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onFinish, contentKey, subtitle, title]);

  return (
    <div ref={contentRef} className='hidden' aria-hidden='true'>
      {children}
    </div>
  );
}
