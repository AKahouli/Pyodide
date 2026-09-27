import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import {
  type ResolvedMappingEntity,
  type SourcePreviewIssue,
} from '../domain/semantic-cross-source.types';
import {
  computeFieldProfiles,
  resolveSheetEntities,
  type SourceAssetKind,
  type SourceFieldMapping,
} from '../domain/semantic-source-mapping.types';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';
import type {
  CreateSourceMappingDto,
  BulkDocumentSourceMappingDto,
  SourceAssetProfileQueryDto,
  SourceMappingPreviewDto,
} from '../dto';
import { DocumentExtractionConceptResolver } from './document-extraction-concept.resolver';
import type { AttributeDefinition } from '../domain/semantic-model.types';
import { SemanticRuntimeClientService } from './semantic-runtime-client.service';

export const STRUCTURED_MIME_PREFIXES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
];
export const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_DOCUMENT_EXTRACTION_FIELDS = 25;
const MAX_PREVIEW_MAPPINGS = 50;

interface SourceMappingRow {
  id: string;
  conceptId: string;
  workspaceId: string;
  documentId: string;
  sheetName: string;
  assetKind: SourceAssetKind;
  fieldMappings: SourceFieldMapping[];
  status: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  identityFields: string[] | null;
  sourceEnabled: boolean;
  validatedSourceVersion: string | null;
  validatedAt: Date | null;
}

@Injectable()
export class SemanticSourceMappingService {
  private readonly logger = new Logger(SemanticSourceMappingService.name);

  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly documents: WorkspaceDocumentService,
    private readonly runtime: SemanticRuntimeClientService,
    private readonly documentExtraction: DocumentExtractionConceptResolver,
  ) {}

  async listAssets(userId: string, modelId: string) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const links = await this.database.query<{ workspaceId: string }>(
      'SELECT workspace_id AS "workspaceId" FROM semantic_model.workspace_links WHERE model_id=$1 AND enabled',
      [model.id],
    );
    const assets = await Promise.all(links.rows.map(async (link) => {
      const page = await this.documents.findAllByWorkspace(link.workspaceId, { page: 1, limit: 200 });
      return page.documents
        .filter((document) => !document.isFolder && this.assetKind(document.mimeType))
        .map((document) => ({
          workspaceId: link.workspaceId,
          documentId: document.id,
          name: document.originalName,
          kind: this.assetKind(document.mimeType)!,
          mimeType: document.mimeType,
          path: document.path ?? '',
        }));
    }));
    return { assets: assets.flat() };
  }

  async profileAsset(userId: string, modelId: string, workspaceId: string, documentId: string, query: SourceAssetProfileQueryDto) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    await this.requireLinkedWorkspace(model.id, workspaceId);
    const document = await this.documents.findById(workspaceId, documentId);
    if (!STRUCTURED_MIME_PREFIXES.some((prefix) => document.mimeType.startsWith(prefix))) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Only Excel and CSV assets can be profiled');
    }
    const result = await this.database.query<{ profile: Record<string, unknown> }>(
      `SELECT profile FROM semantic_datasource.discovery_profiles
       WHERE workspace_id=$1 AND asset_id=$2
         AND source_version=$3
         AND ($4='' OR profile->'structure'->>'selectedSheet'=$4
              OR ($4='CSV' AND profile->'structure'->>'kind'='csv'))
       ORDER BY completed_at DESC LIMIT 1`,
      [workspaceId, documentId, this.sourceVersion(document), query.sheetName ?? ''],
    );
    if (!result.rows[0]) {
      throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'This source has not been analyzed yet');
    }
    return this.sheetProfile(result.rows[0].profile);
  }

  async requestProfile(userId: string, modelId: string, workspaceId: string, documentId: string, query: SourceAssetProfileQueryDto) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    await this.requireLinkedWorkspace(model.id, workspaceId);
    const document = await this.documents.findById(workspaceId, documentId);
    if (!STRUCTURED_MIME_PREFIXES.some((prefix) => document.mimeType.startsWith(prefix))) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Only Excel and CSV assets can be profiled');
    }
    return this.requestDiscovery(userId, model.id, document, query.sheetName);
  }

  async discoveryJob(userId: string, modelId: string, jobId: string) {
    await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const job = await this.runtime.getJob(jobId, userId);
    if (job.jobType !== 'datasource.discovery' || job.modelId !== modelId) {
      throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Datasource job not found');
    }
    return job;
  }

  async preview(userId: string, modelId: string, dto: SourceMappingPreviewDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    await this.requireLinkedWorkspace(model.id, dto.workspaceId);
    const document = await this.documents.findById(dto.workspaceId, dto.documentId);
    const kind = this.requireAssetKind(document.mimeType, dto.assetKind);
    this.assertMappingModes(kind, dto.fieldMappings);
    const concept = await this.assertConceptInDraft(model.id, model.currentDraftVersionId, dto.conceptId, dto.fieldMappings, dto.identityFields ?? []);
    const input = {
      userId,
      modelId: model.id,
      workspaceId: dto.workspaceId,
      documentId: dto.documentId,
      documentName: document.originalName,
      concept,
      fieldMappings: dto.fieldMappings,
      identityFields: dto.identityFields ?? [],
      limit: dto.limit,
    };
    if (kind === 'document') return this.documentExtraction.preview(input);
    return this.requestDiscovery(userId, model.id, document, dto.sheetName, {
      fieldMappings: dto.fieldMappings,
      identityFields: dto.identityFields ?? [],
      limit: dto.limit,
    });
  }

  async list(userId: string, modelId: string) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const result = await this.database.query<SourceMappingRow>(
      `SELECT m.id, m.concept_id AS "conceptId", m.workspace_id AS "workspaceId", m.document_id AS "documentId",
              m.sheet_name AS "sheetName", m.asset_kind AS "assetKind", m.field_mappings AS "fieldMappings",
              m.status, m.created_by AS "createdBy", m.created_at AS "createdAt", m.updated_at AS "updatedAt",
              i.fields AS "identityFields", m.validated_source_version AS "validatedSourceVersion",
              m.validated_at AS "validatedAt"
       FROM semantic_model.source_mappings m
       INNER JOIN semantic_model.workspace_links w
         ON w.model_id=m.model_id AND w.workspace_id=m.workspace_id AND w.enabled
       LEFT JOIN semantic_model.identity_rules i ON i.model_id = m.model_id AND i.concept_id = m.concept_id
       WHERE m.model_id=$1
       ORDER BY m.created_at`, [model.id]);
    const documentIds = [...new Set(result.rows.map((row) => row.documentId))];
    const documents = documentIds.length ? await this.documents.findByIds(documentIds) : [];
    const names = new Map(documents.map((document) => [document.id, document.originalName]));
    return result.rows.map((row) => ({
      ...row,
      identityFields: row.identityFields ?? [],
      documentName: names.get(row.documentId) ?? row.documentId,
      documentPath: documents.find((document) => document.id === row.documentId)?.path ?? '',
      mimeType: documents.find((document) => document.id === row.documentId)?.mimeType ?? '',
    }));
  }

  async resolveConfigured(userId: string, modelId: string, conceptIds: string[] = [], limit = 25) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor', 'viewer']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const params: unknown[] = [model.id];
    const conceptFilter = conceptIds.length ? ` AND m.concept_id=ANY($${params.push(conceptIds)}::uuid[])` : '';
    const result = await this.database.query<SourceMappingRow>(
      `SELECT m.id, m.concept_id AS "conceptId", m.workspace_id AS "workspaceId", m.document_id AS "documentId",
              m.sheet_name AS "sheetName", m.asset_kind AS "assetKind", m.field_mappings AS "fieldMappings",
              m.status, m.created_by AS "createdBy", m.created_at AS "createdAt", m.updated_at AS "updatedAt",
              i.fields AS "identityFields", COALESCE(w.enabled, false) AS "sourceEnabled"
       FROM semantic_model.source_mappings m
       LEFT JOIN semantic_model.workspace_links w
         ON w.model_id=m.model_id AND w.workspace_id=m.workspace_id
       LEFT JOIN semantic_model.identity_rules i ON i.model_id=m.model_id AND i.concept_id=m.concept_id
       WHERE m.model_id=$1${conceptFilter}
       ORDER BY m.created_at`, params);
    const entities: ResolvedMappingEntity[] = [];
    const issues: SourcePreviewIssue[] = [];
    const incompleteConceptIds = new Set<string>();
    const previewRows = result.rows.slice(0, MAX_PREVIEW_MAPPINGS);
    const documentNames = await this.documentNames(previewRows);
    for (const mapping of previewRows) {
      const documentName = documentNames.get(mapping.documentId) ?? '';
      const source = documentName || 'This source';
      if (!mapping.sourceEnabled) {
        issues.push({
          mappingId: mapping.id, conceptId: mapping.conceptId, documentName, code: 'source_disabled',
          reason: 'its workspace is no longer linked to this model',
          message: `${source} is not available: its workspace is no longer linked to this model.`,
        });
        incompleteConceptIds.add(mapping.conceptId);
        continue;
      }
      if (mapping.status !== 'ready') {
        issues.push({
          mappingId: mapping.id, conceptId: mapping.conceptId, documentName, code: 'source_not_ready',
          reason: `its mapping is marked "${mapping.status}"`,
          message: `${source} is not used yet: its mapping is marked "${mapping.status}".`,
        });
        incompleteConceptIds.add(mapping.conceptId);
        continue;
      }
      try {
        const document = await this.documents.findById(mapping.workspaceId, mapping.documentId);
        const kind = this.requireAssetKind(document.mimeType, mapping.assetKind);
        this.assertMappingModes(kind, mapping.fieldMappings);
        const concept = await this.assertConceptInDraft(
          model.id,
          model.currentDraftVersionId,
          mapping.conceptId,
          mapping.fieldMappings,
          mapping.identityFields ?? [],
        );
        const input = {
          userId,
          modelId: model.id,
          workspaceId: mapping.workspaceId,
          documentId: mapping.documentId,
          documentName: document.originalName,
          concept,
          fieldMappings: mapping.fieldMappings,
          identityFields: mapping.identityFields ?? [],
          limit,
        };
        const resolved = kind === 'document'
          ? await this.documentExtraction.preview(input)
          : await this.resolvePersisted(mapping, this.sourceVersion(document), limit);
        if (!resolved.complete) incompleteConceptIds.add(mapping.conceptId);
        entities.push(...resolved.entities.map((entity) => ({
          conceptId: mapping.conceptId,
          mappingId: mapping.id,
          identityFields: mapping.identityFields ?? [],
          source: {
            kind,
            workspaceId: mapping.workspaceId,
            documentId: mapping.documentId,
            documentName: document.originalName,
            documentPath: document.path ?? '',
            mimeType: document.mimeType,
            sheetName: mapping.sheetName || undefined,
          },
          entity,
        })));
      } catch (error) {
        const reason = this.previewFailureReason(error);
        this.logger.warn(`Could not resolve semantic source mapping ${mapping.id} (${documentName || mapping.documentId}): ${(error as Error).name}: ${reason}`);
        issues.push({
          mappingId: mapping.id, conceptId: mapping.conceptId, documentName, code: 'source_failed',
          reason,
          message: `${source} could not be read: ${reason}`,
          detail: `${(error as Error).name}: ${reason}`,
        });
        incompleteConceptIds.add(mapping.conceptId);
      }
    }
    if (result.rows.length > MAX_PREVIEW_MAPPINGS) {
      issues.push({ mappingId: '', code: 'preview_limited', message: `Preview is limited to ${MAX_PREVIEW_MAPPINGS} sources.` });
      result.rows.slice(MAX_PREVIEW_MAPPINGS).forEach((mapping) => incompleteConceptIds.add(mapping.conceptId));
    }
    return { entities, issues, incompleteConceptIds: [...incompleteConceptIds] };
  }

  private async documentNames(rows: SourceMappingRow[]) {
    const documentIds = [...new Set(rows.map((row) => row.documentId))];
    if (!documentIds.length) return new Map<string, string>();
    try {
      const documents = await this.documents.findByIds(documentIds);
      return new Map(documents.map((document) => [document.id, document.originalName]));
    } catch (error) {
      this.logger.warn(`Could not read source document names: ${(error as Error).message}`);
      return new Map<string, string>();
    }
  }

  /** Human-readable cause of a failed source preview, so the UI never has to say "could not be resolved". */
  private previewFailureReason(error: unknown) {
    const message = (error as Error)?.message?.trim();
    if (!message) return 'unexpected error';
    return message.endsWith('.') ? message.slice(0, -1) : message;
  }

  async create(userId: string, modelId: string, dto: CreateSourceMappingDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    await this.requireLinkedWorkspace(model.id, dto.workspaceId);
    const document = await this.documents.findById(dto.workspaceId, dto.documentId);
    const kind = this.requireAssetKind(document.mimeType, dto.assetKind);
    this.assertMappingModes(kind, dto.fieldMappings);
    if (kind !== 'document' && !dto.sheetName) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'A sheet is required for spreadsheet mappings');
    await this.assertConceptInDraft(model.id, model.currentDraftVersionId, dto.conceptId, dto.fieldMappings, dto.identityFields ?? []);
    const revision = await this.database.transaction(async (client) => {
      const revision = await this.models.advanceRevision(client, modelId, dto.expectedRevision);
      await client.query(
        `INSERT INTO semantic_model.source_mappings
         (model_id,concept_id,workspace_id,document_id,sheet_name,asset_kind,field_mappings,status,created_by,validated_source_version,validated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'ready',$8,$9,now())
         ON CONFLICT (model_id,concept_id,document_id,sheet_name)
         DO UPDATE SET field_mappings=EXCLUDED.field_mappings,asset_kind=EXCLUDED.asset_kind,status='ready',
           validated_source_version=EXCLUDED.validated_source_version,validated_at=now(),updated_at=now()`,
          [model.id, dto.conceptId, dto.workspaceId, dto.documentId, dto.sheetName ?? '', kind,
           JSON.stringify(dto.fieldMappings), userId, this.sourceVersion(document)],
      );
      if (dto.identityFields?.length) {
        await client.query(
          `INSERT INTO semantic_model.identity_rules (model_id,concept_id,fields,updated_by)
           VALUES ($1,$2,$3::jsonb,$4)
           ON CONFLICT (model_id,concept_id)
           DO UPDATE SET fields=EXCLUDED.fields,updated_by=EXCLUDED.updated_by,updated_at=now()`,
          [model.id, dto.conceptId, JSON.stringify(dto.identityFields), userId],
        );
      } else if (dto.identityFields) {
        // Explicitly empty identity list clears the concept's rule
        await client.query(
          'DELETE FROM semantic_model.identity_rules WHERE model_id=$1 AND concept_id=$2',
          [model.id, dto.conceptId],
        );
      }
      await this.models.audit(client, model.id, model.currentDraftVersionId, userId, 'source_mapping.saved', {
        conceptId: dto.conceptId, documentId: dto.documentId, sheetName: dto.sheetName ?? '',
      });
      return revision;
    });
    let analysisJob: unknown;
    try {
      analysisJob = await this.requestDiscovery(userId, model.id, document, dto.sheetName, {
        fieldMappings: dto.fieldMappings,
        identityFields: dto.identityFields ?? [],
      });
    } catch (error) {
      this.logger.warn(`Source mapping ${dto.documentId} was saved but health analysis could not be queued: ${(error as Error).name}`);
    }
    return { revision, ...(analysisJob ? { analysisJob } : {}) };
  }

  async createBulkDocuments(userId: string, modelId: string, dto: BulkDocumentSourceMappingDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    this.assertMappingModes('document', dto.fieldMappings);
    await this.assertConceptInDraft(model.id, model.currentDraftVersionId, dto.conceptId, dto.fieldMappings, dto.identityFields ?? []);
    const uniqueDocuments = [...new Map(dto.documents.map((document) => [`${document.workspaceId}:${document.documentId}`, document])).values()];
    const documents = new Map<string, Awaited<ReturnType<WorkspaceDocumentService['findById']>>>();
    for (const source of uniqueDocuments) {
      await this.requireLinkedWorkspace(model.id, source.workspaceId);
      const document = await this.documents.findById(source.workspaceId, source.documentId);
      if (this.assetKind(document.mimeType) !== 'document') {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${document.originalName} is not a supported document`);
      }
      documents.set(`${source.workspaceId}:${source.documentId}`, document);
    }
    const revision = await this.database.transaction(async (client) => {
      const nextRevision = await this.models.advanceRevision(client, modelId, dto.expectedRevision);
      for (const source of uniqueDocuments) {
        await client.query(
          `INSERT INTO semantic_model.source_mappings
            (model_id,concept_id,workspace_id,document_id,sheet_name,asset_kind,field_mappings,status,created_by,validated_source_version,validated_at)
            VALUES ($1,$2,$3,$4,'','document',$5::jsonb,'ready',$6,$7,now())
            ON CONFLICT (model_id,concept_id,document_id,sheet_name)
            DO UPDATE SET field_mappings=EXCLUDED.field_mappings,asset_kind='document',status='ready',
              validated_source_version=EXCLUDED.validated_source_version,validated_at=now(),updated_at=now()`,
           [model.id, dto.conceptId, source.workspaceId, source.documentId, JSON.stringify(dto.fieldMappings), userId,
            this.sourceVersion(documents.get(`${source.workspaceId}:${source.documentId}`)!)],
        );
      }
      if (dto.identityFields?.length) {
        await client.query(
          `INSERT INTO semantic_model.identity_rules (model_id,concept_id,fields,updated_by)
           VALUES ($1,$2,$3::jsonb,$4)
           ON CONFLICT (model_id,concept_id)
           DO UPDATE SET fields=EXCLUDED.fields,updated_by=EXCLUDED.updated_by,updated_at=now()`,
          [model.id, dto.conceptId, JSON.stringify(dto.identityFields), userId],
        );
      } else if (dto.identityFields) {
        await client.query(
          'DELETE FROM semantic_model.identity_rules WHERE model_id=$1 AND concept_id=$2',
          [model.id, dto.conceptId],
        );
      }
      await this.models.audit(client, model.id, model.currentDraftVersionId, userId, 'source_mapping.bulk_documents_saved', {
        conceptId: dto.conceptId,
        documentIds: uniqueDocuments.map((document) => document.documentId),
      });
      return nextRevision;
    });
    await Promise.all(uniqueDocuments.map(async (source) => {
      try {
        await this.requestDiscovery(
          userId, model.id, documents.get(`${source.workspaceId}:${source.documentId}`)!, undefined,
          { fieldMappings: dto.fieldMappings, identityFields: dto.identityFields ?? [] },
        );
      } catch (error) {
        this.logger.warn(`Source mapping ${source.documentId} was saved but health analysis could not be queued: ${(error as Error).name}`);
      }
    }));
    return { revision, mappingCount: uniqueDocuments.length };
  }

  async delete(userId: string, modelId: string, mappingId: string, expectedRevision: number) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const revision = await this.database.transaction(async (client) => {
      const revision = await this.models.advanceRevision(client, modelId, expectedRevision);
      const result = await client.query('DELETE FROM semantic_model.source_mappings WHERE id=$1 AND model_id=$2', [mappingId, model.id]);
      if (!result.rowCount) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Source mapping not found');
      await this.models.audit(client, model.id, model.currentDraftVersionId, userId, 'source_mapping.deleted', { mappingId });
      return revision;
    });
    return { revision };
  }

  private async requireLinkedWorkspace(modelId: string, workspaceId: string): Promise<void> {
    const link = await this.database.query(
      'SELECT 1 FROM semantic_model.workspace_links WHERE model_id=$1 AND workspace_id=$2 AND enabled',
      [modelId, workspaceId],
    );
    if (!link.rows[0]) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_WORKSPACE_INVALID);
  }

  private async requestDiscovery(
    userId: string,
    modelId: string,
    document: Awaited<ReturnType<WorkspaceDocumentService['findById']>>,
    sheetName?: string,
    mappingPreview?: Record<string, unknown>,
  ) {
    const sourceVersion = this.sourceVersion(document);
    const origin = await this.database.query<{ workspaceId: string }>(
      `SELECT workspace_id AS "workspaceId" FROM semantic_model.workspace_links
       WHERE model_id=$1 AND role='origin' AND enabled LIMIT 1`,
      [modelId],
    );
    if (!origin.rows[0]) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_WORKSPACE_INVALID);
    const command = {
      actorUserId: userId,
      modelId,
      workspaceId: origin.rows[0].workspaceId,
      payload: {
        source: {
          workspaceId: document.workspaceId,
          assetId: document.id,
          originalName: document.originalName,
          mimeType: document.mimeType,
          sizeBytes: document.size,
          contentHash: document.contentHash,
          uploadedAt: document.uploadedAt,
          indexingStatus: document.indexingStatus,
          sourceVersion,
        },
        options: sheetName ? { sheetName } : {},
        ...(mappingPreview ? { mappingPreview } : {}),
      },
    };
    const key = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    // Bump the version when discovery rules change, so a finished job made under the old rules is not
    // handed back as-is (v2: spreadsheets no longer wait for indexing).
    return this.runtime.requestDatasourceDiscovery(command, `datasource:v2:${key}`);
  }

  private sheetProfile(profile: Record<string, unknown>) {
    const structure = (profile.structure ?? {}) as Record<string, unknown>;
    const rawSheets = Array.isArray(structure.sheets) ? structure.sheets
      : structure.kind === 'csv' ? [{ name: 'CSV', reportedRows: structure.dataRows, reportedColumns: Array.isArray(structure.columns) ? structure.columns.length : 0 }]
      : [];
    const selected = typeof structure.selectedSheet === 'string' ? structure.selectedSheet
      : structure.kind === 'csv' ? 'CSV' : undefined;
    // Workbooks that do not declare their size report no counts; the sheet that was read has measured ones.
    const measuredRows = typeof structure.dataRows === 'number' ? structure.dataRows : undefined;
    const measuredFields = Array.isArray(structure.columns) ? structure.columns.length : undefined;
    const sheets = rawSheets.map((sheet) => {
      const value = sheet as Record<string, unknown>;
      const read = value.name === selected;
      return {
        name: String(value.name ?? ''),
        rowCount: Number(value.reportedRows ?? value.rowCount ?? (read ? measuredRows : undefined) ?? 0),
        fieldCount: Number(value.reportedColumns ?? value.fieldCount ?? (read ? measuredFields : undefined) ?? 0),
      };
    });
    return {
      sheets,
      ...(selected ? { sheet: sheets.find((sheet) => sheet.name === selected) } : {}),
      fields: Array.isArray(profile.fieldProfiles) ? profile.fieldProfiles : [],
      sampleRows: Array.isArray(profile.samples) ? profile.samples : [],
      totalRows: Number(profile.scannedRows ?? 0),
      complete: Boolean((profile.coverage as Record<string, unknown> | undefined)?.completeProfileDone),
    };
  }

  private async resolvePersisted(mapping: SourceMappingRow, sourceVersion: string, limit: number) {
    const result = await this.database.query<{ profile: Record<string, unknown> }>(
      `SELECT profile FROM semantic_datasource.discovery_profiles
       WHERE workspace_id=$1 AND asset_id=$2
         AND source_version=$3
         AND (profile->'structure'->>'selectedSheet'=$4
              OR ($4='CSV' AND profile->'structure'->>'kind'='csv'))
       ORDER BY completed_at DESC LIMIT 1`,
      [mapping.workspaceId, mapping.documentId, sourceVersion, mapping.sheetName],
    );
    const profile = result.rows[0]?.profile;
    if (!profile) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Source analysis is not ready');
    const rows = Array.isArray(profile.samples) ? profile.samples as Record<string, unknown>[] : [];
    const { entities, stats } = resolveSheetEntities(rows, mapping.fieldMappings, mapping.identityFields ?? [], limit);
    const profiles = computeFieldProfiles(rows);
    return {
      entities,
      stats,
      identityEvidence: (mapping.identityFields ?? []).flatMap((targetAttribute) => {
        const sourceField = mapping.fieldMappings.find((item) => item.targetAttribute === targetAttribute)?.sourceField;
        const evidence = profiles.find((item) => item.name === sourceField);
        return evidence ? [{ ...evidence, name: targetAttribute }] : [];
      }),
      warnings: ['Preview uses the persisted bounded source sample.'],
      complete: false,
    };
  }

  private async assertConceptInDraft(modelId: string, draftVersionId: string | null, conceptId: string, mappings: SourceFieldMapping[], identityFields: string[] = []) {
    if (!draftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const knownAttributes = await this.database.query<{ label: string; attributes: unknown }>(
      'SELECT label, attributes FROM semantic_model.node_types WHERE version_id=$1 AND id=$2',
      [draftVersionId, conceptId],
    );
    if (!knownAttributes.rows[0]) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Concept not found in the current draft');
    const attributes = (knownAttributes.rows[0].attributes ?? []) as AttributeDefinition[];
    const knownKeys = new Set(attributes.map((attribute) => attribute.key));
    const invalid = mappings.filter((mapping) => mapping.mode !== 'ignore' && (!mapping.targetAttribute || !knownKeys.has(mapping.targetAttribute)));
    if (invalid.length) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        `Unknown concept field(s): ${[...new Set(invalid.map((mapping) => mapping.targetAttribute || '(empty)'))].join(', ')}`);
    }
    const mappedKeys = new Set(mappings.filter((mapping) => mapping.mode !== 'ignore').map((mapping) => mapping.targetAttribute));
    const invalidIdentity = identityFields.filter((field) => !knownKeys.has(field) || !mappedKeys.has(field));
    if (invalidIdentity.length) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        `Identity field(s) must be mapped concept attributes: ${[...new Set(invalidIdentity)].join(', ')}`);
    }
    return { id: conceptId, label: knownAttributes.rows[0].label, attributes };
  }

  private assetKind(mimeType: string): SourceAssetKind | null {
    if (STRUCTURED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return mimeType.includes('csv') ? 'csv' : 'excel_sheet';
    return DOCUMENT_MIME_TYPES.has(mimeType) ? 'document' : null;
  }

  private sourceVersion(document: { contentHash?: string; updatedAt: string; size: number }): string {
    return document.contentHash || `${document.updatedAt}:${document.size}`;
  }

  private requireAssetKind(mimeType: string, claimedKind?: SourceAssetKind): SourceAssetKind {
    const actualKind = this.assetKind(mimeType);
    if (!actualKind) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'This file type cannot be mapped');
    if (claimedKind && claimedKind !== actualKind) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'The asset kind does not match the source document');
    }
    return actualKind;
  }

  private assertMappingModes(kind: SourceAssetKind, mappings: SourceFieldMapping[]): void {
    const allowed = kind === 'document'
      ? new Set(['extract', 'metadata', 'constant', 'ignore'])
      : new Set(['direct', 'constant', 'ignore']);
    const invalidMode = mappings.find((mapping) => !allowed.has(mapping.mode));
    if (invalidMode) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${invalidMode.mode} mappings are not supported for ${kind} assets`);
    }
    const invalidMetadata = mappings.find((mapping) => mapping.mode === 'metadata'
      && !['document_name', 'document_id', 'workspace_id'].includes(mapping.sourceField ?? ''));
    if (invalidMetadata) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Document metadata mappings require document_name, document_id, or workspace_id');
    }
    if (kind === 'document' && mappings.filter((mapping) => mapping.mode === 'extract').length > MAX_DOCUMENT_EXTRACTION_FIELDS) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Document mappings support at most ${MAX_DOCUMENT_EXTRACTION_FIELDS} extracted fields`);
    }
    const invalidStrategy = mappings.find((mapping) => mapping.extractionStrategy !== undefined
      && (kind !== 'document' || mapping.mode !== 'extract'));
    if (invalidStrategy) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'An extraction strategy is only supported for extracted document fields');
    }
  }
}
