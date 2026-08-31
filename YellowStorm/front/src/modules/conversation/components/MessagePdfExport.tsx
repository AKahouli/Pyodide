import { useLayoutEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { componentsToMarkdown } from '../utils';
import type { Message } from '../types';
import { buildMessagePdfDocument, printHtmlDocument } from './messagePdfHtml';

interface MessagePdfExportProps {
  message: Message;
  title: string;
  subtitle?: string;
  onFinish: (ok: boolean) => void;
}

export function MessagePdfExport({ message, title, subtitle, onFinish }: Readonly<MessagePdfExportProps>) {
  const contentRef = useRef<HTMLDivElement>(null);
  const markdown = useMemo(() => componentsToMarkdown(message.components || []), [message.components]);

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
  }, [onFinish, subtitle, title]);

  return (
    <div ref={contentRef} className='hidden' aria-hidden='true'>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
