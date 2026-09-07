import { useLayoutEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildMessagePdfDocument, printHtmlDocument } from './messagePdfHtml';
import type { ExportBlock } from '../utils/document-export';

interface ConversationPdfExportProps {
  blocks: ExportBlock[];
  title: string;
  onFinish: (ok: boolean) => void;
}

/**
 * Hidden render of the full conversation used to produce the print/PDF
 * document. Mirrors MessagePdfExport, but for every turn of the conversation.
 */
export function ConversationPdfExport({ blocks, title, onFinish }: Readonly<ConversationPdfExportProps>) {
  const contentRef = useRef<HTMLDivElement>(null);
  const serializedBlocks = useMemo(() => JSON.stringify(blocks), [blocks]);

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
        printHtmlDocument(buildMessagePdfDocument(title, content.innerHTML));
        onFinish(true);
      } catch {
        onFinish(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [onFinish, serializedBlocks, title]);

  return (
    <div ref={contentRef} className='hidden' aria-hidden='true'>
      {blocks.map((block, index) => (
        <div key={`${block.role}-${index}`} data-export-block>
          <h3 style={{ color: '#6b7280', fontSize: '12px', margin: '24px 0 8px', textTransform: 'uppercase' }}>
            {block.label}{block.timestamp ? ` · ${block.timestamp}` : ''}
          </h3>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.markdown}</ReactMarkdown>
        </div>
      ))}
    </div>
  );
}
