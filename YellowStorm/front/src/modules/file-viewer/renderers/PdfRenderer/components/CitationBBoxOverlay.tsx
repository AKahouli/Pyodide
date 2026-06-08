import type { CSSProperties } from 'react';
import { useDocumentState } from '@embedpdf/core/react';
import type { HighlightBBox } from '@/modules/file-viewer/types';

interface CitationBBoxOverlayProps {
  bbox?: HighlightBBox;
  documentId: string;
  page?: number;
  pageIndex: number;
}

function toBoxStyle(bbox: HighlightBBox, pageWidth: number, pageHeight: number): CSSProperties {
  const [left, top, boxWidth, boxHeight] = bbox;
  const isNormalized = bbox.every((value) => value >= 0 && value <= 1);
  const width = isNormalized ? 1 : pageWidth;
  const height = isNormalized ? 1 : pageHeight;

  return {
    left: `${(left / width) * 100}%`,
    top: `${(top / height) * 100}%`,
    width: `${(boxWidth / width) * 100}%`,
    height: `${(boxHeight / height) * 100}%`,
  };
}

export function CitationBBoxOverlay({ bbox, documentId, page, pageIndex }: CitationBBoxOverlayProps) {
  const documentState = useDocumentState(documentId);
  const pageSize = documentState?.document?.pages[pageIndex]?.size;

  if (!bbox || page !== pageIndex + 1 || !pageSize) {
    return null;
  }

  return (
    <div className='pointer-events-none absolute inset-0 z-20'>
      <div
        aria-hidden='true'
        className='absolute rounded-sm border border-yellow-500/80 bg-yellow-300/35 shadow-[0_0_0_1px_rgba(234,179,8,0.35)]'
        data-testid='citation-bbox-overlay'
        style={toBoxStyle(bbox, pageSize.width, pageSize.height)}
      />
    </div>
  );
}
