import type { CitationData } from '@/components/ai-elements/ai-message-content';
import type { MessageComponent } from '../types';

/**
 * Unique key used to de-duplicate citations to one entry per source document:
 * page and reference are ignored so repeated citations of the same document
 * (across pages or markers) collapse into a single sources-list entry.
 */
function citationKey(citation: CitationData): string {
  if (citation.record) return ['record', citation.record.modelId, citation.record.entityId].join('|');
  return [citation.source, citation.fileName ?? ''].join('|');
}

export const citationText = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A cited semantic model record, from the persisted (camelCase) or streamed (snake_case) component. */
export function buildRecordCitation(data: Record<string, unknown>): CitationData['record'] | undefined {
  const source = (data.record_source as Record<string, unknown> | undefined)
    ?? (data.sourceType === 'record' || data.sourceKind === 'record' ? data : undefined);
  const entityId = citationText(source?.entityId) || citationText(source?.entity_id);
  const modelId = citationText(source?.modelId) || citationText(source?.model_id);
  if (!source || !entityId || !modelId) return undefined;
  const keys = (source.keyFields ?? source.key_fields) as Record<string, unknown> | undefined;
  return {
    modelId, entityId,
    modelName: citationText(source.modelName) || citationText(source.model_name),
    data: (source.data === 'draft' ? 'draft' : 'published'),
    dataRevisionId: citationText(source.dataRevisionId) || citationText(source.data_revision_id),
    concept: citationText(source.concept),
    name: citationText(source.name),
    keyFields: Object.fromEntries(Object.entries(keys && typeof keys === 'object' ? keys : {}).map(([key, value]) => [key, String(value)])),
    ...(citationText(source.field) ? { field: citationText(source.field) } : {}),
    ...(citationText(source.quote) ? { quote: citationText(source.quote) } : {}),
  };
}


function toCitationData(data: Record<string, unknown>): CitationData | null {
  const record = buildRecordCitation(data);
  if (record) {
    return {
      parentId: citationText(data.parentId), sourceType: 'record', sourceKind: 'record', source: record.name || record.entityId,
      externalId: '', page: '', pageContent: record.quote ?? '', workspaceId: '',
      ...(citationText(data.reference) ? { reference: citationText(data.reference) } : {}), record,
    };
  }
  if (typeof data.source !== 'string' || !data.source) return null;
  return {
    parentId: typeof data.parentId === 'string' ? data.parentId : '',
    sourceType: data.sourceType === 'web' ? 'web' : data.sourceType === 'image' ? 'image' : 'text',
    ...(data.sourceKind === 'web' ? { sourceKind: 'web' as const } : {}),
    source: data.source,
    ...(typeof data.fileName === 'string' ? { fileName: data.fileName } : {}),
    externalId: typeof data.externalId === 'string' ? data.externalId : '',
    page: typeof data.page === 'string' ? data.page : '',
    pageContent: typeof data.pageContent === 'string' ? data.pageContent : '',
    workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId : '',
    ...(typeof data.reference === 'string' ? { reference: data.reference } : {}),
    ...(typeof data.path === 'string' ? { path: data.path } : {}),
    ...(typeof data.title === 'string' ? { title: data.title } : {}),
    ...(typeof data.exactText === 'string' ? { exactText: data.exactText } : {}),
    ...(typeof data.prefix === 'string' ? { prefix: data.prefix } : {}),
    ...(typeof data.suffix === 'string' ? { suffix: data.suffix } : {}),
    ...(data.evidenceOrigin === 'page_content' || data.evidenceOrigin === 'search_snippet' ? { evidenceOrigin: data.evidenceOrigin } : {}),
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
  if (citation.record) return [citation.record.concept, citation.record.name].filter(Boolean).join(' · ') || fallback;
  const source = citation.fileName || citation.path || citation.source;
  return source?.split(/[\\/]/).filter(Boolean).at(-1) || fallback;
}

/** True when the citation points at a web URL rather than a stored document. */
export function isUrlCitation(citation: CitationData): boolean {
  if (citation.record) return false;
  return /^https?:\/\//i.test(citation.source);
}
