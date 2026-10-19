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
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      try {
        const content = contentRef.current;
        if (!content) {
          onFinish(false);
          return;
        }
        await printHtmlDocument(buildMessagePdfDocument(title, content.innerHTML, subtitle), controller.signal);
        if (!cancelled) onFinish(true);
      } catch {
        if (!cancelled) onFinish(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [onFinish, contentKey, subtitle, title]);

  return (
    <div ref={contentRef} className='hidden' aria-hidden='true'>
      {children}
    </div>
  );
}
