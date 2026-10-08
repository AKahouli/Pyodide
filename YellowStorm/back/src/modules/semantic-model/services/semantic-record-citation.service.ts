import { Injectable } from '@nestjs/common';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import type { DocumentResponse } from '@modules/workspace/interfaces/workspace-document.interface';
import type { SemanticGraph } from '../domain/semantic-model.types';
import type { RuntimeSearchEnvironment, RuntimeValueOrigin } from './semantic-runtime-client.service';
import { SemanticGraphSearchService } from './semantic-graph-search.service';

/** A document a cited record was read from, as the file viewer opens it; only those the person may open. */
export interface CitedRecordDocument {
  documentId: string;
  workspaceId: string;
  name: string;
  path: string;
  mimeType: string;
}

export interface CitedRecordField {
  key: string;
  label: string;
  value: unknown;
  truncated?: boolean;
  /** What other sources stated for this field than the value shown: a disagreement, or a second source. */
  alternatives?: Array<{ value: unknown; origin: NonNullable<CitedRecordField['origin']> }>;
  /** Where the value came from: a document (page, row, column), another record, the AI, or a person. */
  origin?: {
    kind: RuntimeValueOrigin['kind'];
    documentId?: string;
    page?: number;
    row?: number;
    column?: string;
    sheet?: string;
    fromRecord?: { entityId: string; name: string };
    corrected?: boolean;
  };
}

export interface CitedRecordView {
  model: { id: string; name: string };
  data: 'published' | 'draft';
  dataRevisionId: string;
  /** The data was rebuilt since the answer: the record is shown as it is now. */
  changed: boolean;
  status: 'ok' | 'hidden' | 'missing';
  record?: {
    entityId: string;
    concept: string;
    conceptKey: string;
    name: string;
    keyFields: Record<string, unknown>;
    fields: CitedRecordField[];
    /** The documents the record was read from, with the spreadsheet rows when it came from rows. */
    sources: Array<CitedRecordDocument & { rows?: number[] }>;
    /** Documents the record was read from that the person cannot open (or that no longer exist). */
    unavailableSources: number;
  };
}

/**
 * The record behind a chat citation, read again for whoever opens it. The citation only points (model, data,
 * revision, record id): values, origins and documents come from the data in use and the person's access now,
 * so a shared conversation never shows more than its reader may see.
 */
@Injectable()
export class SemanticRecordCitationService {
  constructor(
    private readonly graphSearch: SemanticGraphSearchService,
    private readonly documents: WorkspaceDocumentService,
  ) {}

  async citedRecord(userId: string, modelId: string, input: { entityId: string; data?: 'published' | 'draft'; dataRevisionId?: string }): Promise<CitedRecordView> {
    const data = input.data === 'draft' ? 'draft' : 'published';
    const environment: RuntimeSearchEnvironment = data === 'draft' ? 'draft' : 'production';
    const { model, cited, allowedWorkspaceIds, graph } = await this.graphSearch.citedRecord(userId, modelId, {
      environment, entityId: input.entityId, dataRevisionId: input.dataRevisionId,
    });
    const base = { model, data, dataRevisionId: cited.dataRevisionId, changed: cited.changed, status: cited.status } as const;
    const record = cited.record;
    if (cited.status !== 'ok' || !record) return base;

    const assetIds = [...new Set([
      ...record.provenance.map((source) => source.assetId),
      ...Object.values(record.origins).map((origin) => origin.assetId),
      ...Object.values(record.alternatives ?? {}).flatMap((items) => items.map((item) => item.origin.assetId)),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0))];
    const readable = new Set(allowedWorkspaceIds);
    const found = assetIds.length ? await this.documents.findByIds(assetIds) : [];
    const openable = new Map(found.filter((document) => !document.isFolder && document.path && readable.has(document.workspaceId))
      .map((document) => [document.id, toDocument(document)]));

    const labels = fieldLabels(graph, record.conceptKey);
    const keys = new Set(Object.keys(record.keyFields));
    const ordered = [...Object.keys(record.keyFields), ...(labels.order.filter((key) => key in record.values && !keys.has(key))),
      ...Object.keys(record.values).filter((key) => !keys.has(key) && !labels.order.includes(key))];
    const truncated = new Set(record.truncatedFields);
    const fields: CitedRecordField[] = [...new Set(ordered)].map((key) => {
      const origin = record.origins[key];
      return {
        key, label: labels.byKey.get(key) ?? key, value: record.values[key] ?? record.keyFields[key] ?? null,
        ...(truncated.has(key) ? { truncated: true } : {}),
        ...(origin ? { origin: describeOrigin(origin, openable) } : {}),
        ...(record.alternatives?.[key]?.length
          ? { alternatives: record.alternatives[key].map((item) => ({ value: item.value, origin: describeOrigin(item.origin, openable) })) }
          : {}),
      };
    });
    const sources = [...new Map(record.provenance.filter((source) => openable.has(source.assetId))
      .map((source) => [source.assetId, { ...openable.get(source.assetId)!, ...(source.rowNumbers?.length ? { rows: source.rowNumbers } : {}) }])).values()];
    const unavailableSources = new Set(record.provenance.map((source) => source.assetId).filter((id) => !openable.has(id))).size;
    return {
      ...base,
      record: {
        entityId: record.entityId, concept: record.conceptLabel, conceptKey: record.conceptKey, name: record.label,
        keyFields: record.keyFields, fields, sources, unavailableSources,
      },
    };
  }
}

function toDocument(document: DocumentResponse): CitedRecordDocument {
  return { documentId: document.id, workspaceId: document.workspaceId, name: document.originalName, path: document.path ?? '', mimeType: document.mimeType };
}

/** The fields of a concept in the model's order, with their labels. */
function fieldLabels(graph: SemanticGraph | null, conceptKey: string): { order: string[]; byKey: Map<string, string> } {
  const node = graph?.nodes.find((candidate) => candidate.key === conceptKey);
  const attributes = node?.attributes ?? [];
  return { order: attributes.map((field) => field.key), byKey: new Map(attributes.map((field) => [field.key, field.label || field.key])) };
}

function describeOrigin(origin: RuntimeValueOrigin, openable: Map<string, CitedRecordDocument>): NonNullable<CitedRecordField['origin']> {
  const documentId = origin.assetId && openable.has(origin.assetId) ? origin.assetId : undefined;
  const from = origin.derivedFrom;
  return {
    kind: origin.kind,
    ...(documentId ? { documentId } : {}),
    ...(origin.pageNumber !== undefined && origin.pageNumber !== null ? { page: origin.pageNumber } : {}),
    ...(origin.rowNumber !== undefined && origin.rowNumber !== null && Number.isFinite(Number(origin.rowNumber)) ? { row: Number(origin.rowNumber) } : {}),
    ...(origin.column ? { column: origin.column } : {}),
    ...(origin.sheet ? { sheet: origin.sheet } : {}),
    ...(from?.entityId ? { fromRecord: { entityId: from.entityId, name: from.label ?? from.entityId } } : {}),
    ...(origin.correctedBy ? { corrected: true } : {}),
  };
}
