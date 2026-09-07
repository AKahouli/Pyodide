import type { CitationData } from '@/components/ai-elements/ai-message-content';
import type { MessageComponent } from '../types';

/** Unique key used to de-duplicate citations repeated across parts of one answer. */
function citationKey(citation: CitationData): string {
  return [citation.source, citation.reference ?? '', citation.page ?? '', citation.fileName ?? ''].join('|');
}

function toCitationData(data: Record<string, unknown>): CitationData | null {
  if (typeof data.source !== 'string' || !data.source) return null;
  return {
    parentId: typeof data.parentId === 'string' ? data.parentId : '',
    sourceType: data.sourceType === 'image' ? 'image' : 'text',
    source: data.source,
    ...(typeof data.fileName === 'string' ? { fileName: data.fileName } : {}),
    externalId: typeof data.externalId === 'string' ? data.externalId : '',
    page: typeof data.page === 'string' ? data.page : '',
    pageContent: typeof data.pageContent === 'string' ? data.pageContent : '',
    workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId : '',
    ...(typeof data.reference === 'string' ? { reference: data.reference } : {}),
    ...(typeof data.path === 'string' ? { path: data.path } : {}),
  };
}

/**
 * Collect the documents / URLs referenced by an answer's source tags, in
 * first-appearance order and de-duplicated. Text parts carry their citations
 * inline; standalone `citation` parts map one-to-one.
 */
export function collectMessageCitations(components: MessageComponent[] | undefined): CitationData[] {
  if (!components?.length) return [];
  const byKey = new Map<string, CitationData>();
  for (const component of components) {
    if (!component?.data) continue;
    if (component.type === 'text' && Array.isArray(component.data.citations)) {
      for (const citation of component.data.citations as CitationData[]) {
        if (!citation?.source) continue;
        const key = citationKey(citation);
        if (!byKey.has(key)) byKey.set(key, citation);
      }
    } else if (component.type === 'citation') {
      const citation = toCitationData(component.data as Record<string, unknown>);
      if (citation) {
        const key = citationKey(citation);
        if (!byKey.has(key)) byKey.set(key, citation);
      }
    }
  }
  return Array.from(byKey.values());
}

/** Display label for the sources list: file name, else the path/URL tail. */
export function getCitationEntryLabel(citation: CitationData, fallback: string): string {
  const source = citation.fileName || citation.path || citation.source;
  return source?.split(/[\\/]/).filter(Boolean).at(-1) || fallback;
}

/** True when the citation points at a web URL rather than a stored document. */
export function isUrlCitation(citation: CitationData): boolean {
  return /^https?:\/\//i.test(citation.source);
}
