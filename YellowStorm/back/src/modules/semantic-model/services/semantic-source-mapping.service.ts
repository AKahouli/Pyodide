import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { BadRequestException, ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import {
  type ResolvedMappingEntity,
  type SourcePreviewIssue,
} from '../domain/semantic-cross-source.types';
import { aiFieldHints,
  AI_EXTRACTION_CONTRACT_VERSION,
  computeFieldProfiles,
  resolveSheetEntities,
  usesAiExtraction,
  type ExtractionRules,
  type ResolvedEntity,
  type SourceAssetKind,
  type SourceFieldMapping,
} from '../domain/semantic-source-mapping.types';
import { SemanticAttributeExtractionService } from './semantic-attribute-extraction.service';
import { effectiveAiSettings, pickAiSettings, SemanticExtractionSettingsService } from './semantic-extraction-settings.service';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';
import type {
  CreateSourceMappingDto,
  BulkDocumentSourceMappingDto,
  SourceAssetProfileQueryDto,
  WorkspaceSourceMappingDto,
  SourceMappingPreviewDto,
  ComputedFieldPreviewDto,
  DocumentLabelsDto,
} from '../dto';
import { DocumentExtractionConceptResolver } from './document-extraction-concept.resolver';
import type { AttributeDefinition } from '../domain/semantic-model.types';
import { SemanticRuntimeClientService } from './semantic-runtime-client.service';
import {
  MAX_WORKSPACE_MAPPING_DOCUMENTS,
  MAX_WORKSPACE_SELECTION_ITEMS,
  mappingSelection,
  normalizeWorkspaceSelection,
  type SourceMappingScope,
  type WorkspaceSelection,
  workspaceMappingFiles,
  workspaceMappingKey,
} from '../domain/workspace-source-scope';

/** A mapping's own AI reading limits, or null when it uses the defaults for all of them. */
function storedAiSettings(settings: unknown): string | null {
  const picked = pickAiSettings(settings);
  return Object.keys(picked).length ? JSON.stringify(picked) : null;
}

export const STRUCTURED_MIME_PREFIXES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  // E-mail archives (.zip of .eml, or one .eml): read as three tables, messages, participants, attachments.
  'application/zip',
  'application/x-zip-compressed',
  'message/rfc822',
];
export const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Plain text: the message texts derived from an e-mail archive are read like any document.
  'text/plain',
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
  scope?: SourceMappingScope;
  folderId?: string | null;
  selection?: WorkspaceSelection | null;
  sourceLabel?: string | null;
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
    private readonly workspaces?: WorkspaceService,
    private readonly aiExtractionAgent?: SemanticAttributeExtractionService,
    private readonly extractionSettings?: SemanticExtractionSettingsService,
  ) {}

  /** The readable files a workspace mapping covers right now, and those still being indexed. */
  async workspaceFiles(workspaceId: string, selection?: WorkspaceSelection | null) {
    const all = await this.documents.listAllInWorkspace(workspaceId);
    return workspaceMappingFiles(all, DOCUMENT_MIME_TYPES, selection);
  }

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

  async listCanvasPositions(userId: string, modelId: string) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const result = await this.database.query<{ id: string; x: number; y: number }>(
      'SELECT element_id AS id, x, y FROM semantic_model.canvas_positions WHERE model_id=$1',
      [model.id],
    );
    return { positions: result.rows };
  }

  /** Layout only: moving a box changes no meaning, so it neither advances the model revision nor needs one. */
  async saveCanvasPositions(userId: string, modelId: string, positions: Array<{ id: string; x: number; y: number }>) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    if (positions.length) {
      await this.database.query(
        `INSERT INTO semantic_model.canvas_positions (model_id, element_id, x, y)
         SELECT $1, item.id, item.x, item.y
         FROM jsonb_to_recordset($2::jsonb) AS item(id text, x double precision, y double precision)
         ON CONFLICT (model_id, element_id) DO UPDATE SET x=EXCLUDED.x, y=EXCLUDED.y, updated_at=now()`,
        [model.id, JSON.stringify(positions)],
      );
    }
    return { saved: positions.length };
  }

  async profileAsset(userId: string, modelId: string, workspaceId: string, documentId: string, query: SourceAssetProfileQueryDto) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    await this.requireLinkedWorkspace(model.id, workspaceId);
    const document = await this.documents.findById(workspaceId, documentId);
    if (!STRUCTURED_MIME_PREFIXES.some((prefix) => document.mimeType.startsWith(prefix))) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Only Excel, CSV and e-mail archive assets can be profiled');
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
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Only Excel, CSV and e-mail archive assets can be profiled');
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
    if (kind === 'document') return this.previewDocument(input, document, dto.aiSettings);
    return this.requestDiscovery(userId, model.id, document, dto.sheetName, {
      fieldMappings: dto.fieldMappings,
      identityFields: dto.identityFields ?? [],
      limit: dto.limit,
    });
  }

  /**
   * Headings and `Label:` texts that recur across a few of a source's documents, so a person picks
   * the labels the documents really use. Each document is reauthorized by the runtime, as a run does.
   */
  async documentLabels(userId: string, modelId: string, dto: DocumentLabelsDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    await this.requireLinkedWorkspace(model.id, dto.workspaceId);
    const documents = await Promise.all([...new Set(dto.documentIds)].map((id) => this.documents.findById(dto.workspaceId, id)));
    return this.runtime.suggestDocumentLabels({
      actorUserId: userId,
      sources: documents.map((document) => ({
        workspaceId: dto.workspaceId, assetId: document.id, originalName: document.originalName,
        uploaderUserId: document.createdBy, mimeType: document.mimeType, sizeBytes: document.size,
        indexingStatus: document.indexingStatus, contentHash: document.contentHash, uploadedAt: document.uploadedAt,
      })),
    });
  }

  /** Try a computation on sample inputs (file names or field values) without a document. */
  async previewComputed(userId: string, modelId: string, dto: ComputedFieldPreviewDto) {
    await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    return this.runtime.previewComputedField({ computed: dto.computed, samples: dto.samples });
  }

  /**
   * Preview one document as a run reads it: the runtime applies the rules and the AI with the
   * limits this mapping would use, and says for each field how it was read or why it was not.
   */
  private async previewDocument(
    input: { userId: string; modelId: string; workspaceId: string; documentId: string; documentName: string;
      concept: { id?: string; label: string; attributes: AttributeDefinition[] }; fieldMappings: SourceFieldMapping[]; identityFields: string[] },
    document: Awaited<ReturnType<WorkspaceDocumentService['findById']>>,
    aiSettings: unknown,
  ) {
    const active = input.fieldMappings.filter((mapping) => mapping.mode !== 'ignore');
    const attributes = new Map(input.concept.attributes.map((attribute) => [attribute.key, attribute]));
    const fieldMappings = active.map((field) => {
      if (field.mode !== 'extract') return field;
      const attribute = attributes.get(field.targetAttribute);
      return {
        ...field,
        ...(!field.sourceField ? { sourceField: attribute?.label || field.targetAttribute } : {}),
        // The preview tells the AI what the run will: the field's definition, kind of value and allowed values.
        ...(field.extractionStrategy && field.extractionStrategy !== 'deterministic' && attribute
          ? aiFieldHints(attribute, field) : {}),
      };
    });
    const usesAi = usesAiExtraction(fieldMappings);
    const defaults = usesAi && this.extractionSettings ? (await this.extractionSettings.getDefaults()).configured : {};
    const agent = usesAi && this.aiExtractionAgent ? await this.aiExtractionAgent.resolveAgent() : null;
    const preview = await this.runtime.previewDocumentFields({
      actorUserId: input.userId,
      modelId: input.modelId,
      entry: {
        conceptId: input.concept.id ?? 'preview',
        conceptLabel: input.concept.label,
        source: {
          workspaceId: input.workspaceId, assetId: input.documentId, originalName: document.originalName,
          uploaderUserId: document.createdBy, mimeType: document.mimeType, sizeBytes: document.size,
          indexingStatus: document.indexingStatus, contentHash: document.contentHash, uploadedAt: document.uploadedAt,
        },
        fieldMappings,
        ...(usesAi ? { options: { aiSettings: effectiveAiSettings(defaults, aiSettings) } } : {}),
      },
      aiExtraction: agent ? { agentSlug: agent.slug, model: agent.llmModel ?? null, contractVersion: AI_EXTRACTION_CONTRACT_VERSION } : null,
    });
    const values: Record<string, unknown> = {};
    const provenance: NonNullable<ResolvedEntity['provenance']['fields']> = {};
    for (const mapping of fieldMappings) {
      if (mapping.mode === 'constant') {
        values[mapping.targetAttribute] = mapping.constantValue;
        provenance[mapping.targetAttribute] = { method: 'fixed_value' };
      } else if (mapping.mode === 'metadata') {
        values[mapping.targetAttribute] = mapping.sourceField === 'document_id' ? input.documentId
          : mapping.sourceField === 'workspace_id' ? input.workspaceId : input.documentName;
        provenance[mapping.targetAttribute] = { method: 'document_metadata' };
      } else if (mapping.mode === 'extract') {
        const field = preview.fields[mapping.targetAttribute];
        if (!field || field.reason !== 'found') continue;
        values[mapping.targetAttribute] = field.value;
        provenance[mapping.targetAttribute] = {
          method: 'semantic_extraction',
          ...(field.page != null ? { page: String(field.page) } : {}),
          ...(field.quote ? { quote: field.quote } : {}),
        };
      } else if (mapping.mode === 'computed') {
        const field = preview.fields[mapping.targetAttribute];
        if (!field || field.reason !== 'found') continue;
        values[mapping.targetAttribute] = field.value;
        provenance[mapping.targetAttribute] = { method: 'computed_field' };
      }
    }
    const identityValues = input.identityFields.map((field) => values[field]);
    const identityKey = identityValues.every((value) => value !== undefined && value !== null && String(value).trim())
      ? identityValues.map((value) => String(value).trim().toLowerCase()).join('|') : '';
    const warnings: string[] = [];
    if (preview.status !== 'read') warnings.push(`This document could not be read (${preview.detail ?? preview.status}).`);
    else if (!input.identityFields.length) warnings.push('No identity field selected: this document cannot be reconciled with other sources.');
    else if (!identityKey) warnings.push('The selected identity field was not populated by this document.');
    const entity: ResolvedEntity = {
      entityKey: identityKey || `document:${input.documentId}`,
      label: String(identityValues.find(Boolean) ?? Object.values(values).find(Boolean) ?? input.documentName),
      values,
      provenance: { fields: provenance },
    };
    return {
      entities: [entity],
      stats: { scannedRows: 1, resolvedEntities: 1, duplicateKeysSkipped: 0, nullIdentitySkipped: identityKey || !input.identityFields.length ? 0 : 1 },
      identityEvidence: [],
      warnings,
      complete: preview.status === 'read',
      // How each field was read, or why it was not, and what the AI was sent.
      fields: preview.fields,
      documentStatus: preview.status,
      aiSent: preview.aiSent ?? null,
    };
  }

  async list(userId: string, modelId: string) {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const result = await this.database.query<SourceMappingRow>(
      `SELECT m.id, m.concept_id AS "conceptId", m.workspace_id AS "workspaceId", m.document_id AS "documentId",
              m.sheet_name AS "sheetName", m.asset_kind AS "assetKind", m.field_mappings AS "fieldMappings", m.ai_settings AS "aiSettings",
              m.status, m.created_by AS "createdBy", m.created_at AS "createdAt", m.updated_at AS "updatedAt",
              i.fields AS "identityFields", m.validated_source_version AS "validatedSourceVersion",
              m.validated_at AS "validatedAt", m.scope, m.folder_id AS "folderId", m.selection, m.source_label AS "sourceLabel"
       FROM semantic_model.source_mappings m
       INNER JOIN semantic_model.workspace_links w
         ON w.model_id=m.model_id AND w.workspace_id=m.workspace_id AND w.enabled
       LEFT JOIN semantic_model.identity_rules i ON i.model_id = m.model_id AND i.concept_id = m.concept_id
       WHERE m.model_id=$1
       ORDER BY m.created_at`, [model.id]);
    const documentIds = [...new Set(result.rows.filter((row) => row.scope !== 'workspace').map((row) => row.documentId))];
    const documents = documentIds.length ? await this.documents.findByIds(documentIds) : [];
    const names = new Map(documents.map((document) => [document.id, document.originalName]));
    // A workspace mapping shows how many files it covers today; each workspace is listed once.
    const fileCounts = new Map<string, Promise<{ fileCount: number; waitingCount: number }>>();
    const countFiles = (row: SourceMappingRow) => {
      const selection = mappingSelection(row);
      const key = `${row.workspaceId}:${JSON.stringify(selection)}`;
      if (!fileCounts.has(key)) {
        fileCounts.set(key, this.workspaceFiles(row.workspaceId, selection)
          .then((files) => ({ fileCount: files.readable.length, waitingCount: files.waiting.length }))
          .catch(() => ({ fileCount: 0, waitingCount: 0 })));
      }
      return fileCounts.get(key)!;
    };
    return Promise.all(result.rows.map(async (row) => {
      const { scope, folderId, selection, sourceLabel, ...rest } = row;
      if (scope === 'workspace') {
        return {
          ...rest,
          scope,
          folderId: folderId ?? null,
          selection: mappingSelection({ folderId, selection }),
          identityFields: row.identityFields ?? [],
          documentName: sourceLabel || row.workspaceId,
          documentPath: '',
          mimeType: '',
          ...(await countFiles(row)),
        };
      }
      return {
        ...rest,
        scope: 'document' as const,
        identityFields: row.identityFields ?? [],
        documentName: names.get(row.documentId) ?? row.documentId,
        documentPath: documents.find((document) => document.id === row.documentId)?.path ?? '',
        mimeType: documents.find((document) => document.id === row.documentId)?.mimeType ?? '',
      };
    }));
  }

  /**
   * Map many files of a workspace with one document mapping: all of them, or the folders and files that
   * were picked. Files added later (to the workspace, or inside a picked folder) are included; each run
   * reads the files that are there at that moment. With `mappingId`, changes what that mapping covers.
   */
  async createWorkspace(userId: string, modelId: string, dto: WorkspaceSourceMappingDto) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    await this.requireLinkedWorkspace(model.id, dto.workspaceId);
    this.assertMappingModes('document', dto.fieldMappings);
    await this.assertConceptInDraft(model.id, model.currentDraftVersionId, dto.conceptId, dto.fieldMappings, dto.identityFields ?? []);
    let workspaceName = dto.workspaceId;
    try {
      workspaceName = (await this.workspaces?.findById(dto.workspaceId))?.name || workspaceName;
    } catch (error) {
      this.logger.warn(`Could not read the name of workspace ${dto.workspaceId}: ${(error as Error).name}`);
    }
    const selection = normalizeWorkspaceSelection([...(dto.folderIds ?? []), ...(dto.folderId ? [dto.folderId] : [])], dto.documentIds ?? []);
    if (selection && selection.folderIds.length + selection.documentIds.length > MAX_WORKSPACE_SELECTION_ITEMS) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `Pick at most ${MAX_WORKSPACE_SELECTION_ITEMS} folders and files; pick their folder instead`);
    }
    const all = await this.documents.listAllInWorkspace(dto.workspaceId);
    const byId = new Map(all.map((item) => [item.id, item]));
    const pickedNames: string[] = [];
    for (const folderId of selection?.folderIds ?? []) {
      const folder = byId.get(folderId);
      if (!folder?.isFolder) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'A picked folder is not a folder of this workspace');
      pickedNames.push(folder.folderName || folder.originalName);
    }
    for (const documentId of selection?.documentIds ?? []) {
      const document = byId.get(documentId);
      if (!document || document.isFolder || !DOCUMENT_MIME_TYPES.has(document.mimeType)) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${document?.originalName ?? 'A picked file'} cannot be read as a document`);
      }
      pickedNames.push(document.originalName);
    }
    const label = workspaceSourceLabel(workspaceName, pickedNames);
    const files = workspaceMappingFiles(all, DOCUMENT_MIME_TYPES, selection);
    const maxFiles = this.extractionSettings
      ? (await this.extractionSettings.getRunLimits()).runLimits.maxRunSources
      : MAX_WORKSPACE_MAPPING_DOCUMENTS;
    if (files.readable.length + files.waiting.length > maxFiles) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        `A workspace source can cover at most ${maxFiles} files; pick folders instead`);
    }
    const key = workspaceMappingKey(dto.workspaceId, selection);
    const storedSelection = selection ? JSON.stringify(selection) : null;
    const revision = await this.database.transaction(async (client) => {
      const nextRevision = await this.models.advanceRevision(client, modelId, dto.expectedRevision);
      if (dto.mappingId) {
        const clash = await client.query(
          `SELECT 1 FROM semantic_model.source_mappings
           WHERE model_id=$1 AND concept_id=$2 AND document_id=$3 AND sheet_name='' AND id<>$4`,
          [model.id, dto.conceptId, key, dto.mappingId],
        );
        if (clash.rows[0]) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'This concept already has a source covering exactly these files');
        const updated = await client.query(
          `UPDATE semantic_model.source_mappings
           SET document_id=$5, folder_id=NULL, selection=$6::jsonb, source_label=$7, field_mappings=$8::jsonb,
               ai_settings=$9::jsonb, status='ready', validated_at=now(), updated_at=now()
           WHERE id=$1 AND model_id=$2 AND concept_id=$3 AND workspace_id=$4 AND scope='workspace'`,
          [dto.mappingId, model.id, dto.conceptId, dto.workspaceId, key, storedSelection, label, JSON.stringify(dto.fieldMappings),
            storedAiSettings(dto.aiSettings)],
        );
        if (!updated.rowCount) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Source mapping not found');
      } else {
        await client.query(
          `INSERT INTO semantic_model.source_mappings
            (model_id,concept_id,workspace_id,document_id,sheet_name,asset_kind,field_mappings,status,created_by,
             validated_source_version,validated_at,scope,folder_id,selection,source_label,ai_settings)
            VALUES ($1,$2,$3,$4,'','document',$5::jsonb,'ready',$6,NULL,now(),'workspace',NULL,$7::jsonb,$8,$9::jsonb)
            ON CONFLICT (model_id,concept_id,document_id,sheet_name)
            DO UPDATE SET field_mappings=EXCLUDED.field_mappings,status='ready',source_label=EXCLUDED.source_label,
              selection=EXCLUDED.selection,folder_id=NULL,ai_settings=EXCLUDED.ai_settings,validated_at=now(),updated_at=now()`,
          [model.id, dto.conceptId, dto.workspaceId, key, JSON.stringify(dto.fieldMappings), userId, storedSelection, label,
            storedAiSettings(dto.aiSettings)],
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
        await client.query('DELETE FROM semantic_model.identity_rules WHERE model_id=$1 AND concept_id=$2', [model.id, dto.conceptId]);
      }
      await this.models.audit(client, model.id, model.currentDraftVersionId, userId, 'source_mapping.workspace_saved', {
        conceptId: dto.conceptId, workspaceId: dto.workspaceId, selection, mappingId: dto.mappingId ?? null,
      });
      return nextRevision;
    });
    return { revision, fileCount: files.readable.length, waitingCount: files.waiting.length };
  }

  async resolveConfigured(userId: string, modelId: string, conceptIds: string[] = [], limit = 25) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor', 'viewer']);
    if (!model.currentDraftVersionId) throw new ConflictException(ErrorCode.SEMANTIC_MODEL_NO_DRAFT);
    const params: unknown[] = [model.id];
    const conceptFilter = conceptIds.length ? ` AND m.concept_id=ANY($${params.push(conceptIds)}::uuid[])` : '';
    const result = await this.database.query<SourceMappingRow>(
      `SELECT m.id, m.concept_id AS "conceptId", m.workspace_id AS "workspaceId", m.document_id AS "documentId",
              m.sheet_name AS "sheetName", m.asset_kind AS "assetKind", m.field_mappings AS "fieldMappings", m.ai_settings AS "aiSettings",
              m.status, m.created_by AS "createdBy", m.created_at AS "createdAt", m.updated_at AS "updatedAt",
              i.fields AS "identityFields", COALESCE(w.enabled, false) AS "sourceEnabled",
              m.scope, m.folder_id AS "folderId", m.selection, m.source_label AS "sourceLabel"
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
        // A workspace source is previewed on its first readable file.
        const sampleId = mapping.scope === 'workspace'
          ? (await this.workspaceFiles(mapping.workspaceId, mappingSelection(mapping))).readable[0]?.id
          : mapping.documentId;
        if (!sampleId) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'This workspace has no readable file yet');
        const document = await this.documents.findById(mapping.workspaceId, sampleId);
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
          documentId: document.id,
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
            documentId: document.id,
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
    const workspaceNames = rows.filter((row) => row.scope === 'workspace')
      .map((row) => [row.documentId, row.sourceLabel || row.workspaceId] as [string, string]);
    const documentIds = [...new Set(rows.filter((row) => row.scope !== 'workspace').map((row) => row.documentId))];
    if (!documentIds.length) return new Map<string, string>(workspaceNames);
    try {
      const documents = await this.documents.findByIds(documentIds);
      return new Map([...documents.map((document) => [document.id, document.originalName] as [string, string]), ...workspaceNames]);
    } catch (error) {
      this.logger.warn(`Could not read source document names: ${(error as Error).message}`);
      return new Map<string, string>(workspaceNames);
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
         (model_id,concept_id,workspace_id,document_id,sheet_name,asset_kind,field_mappings,status,created_by,validated_source_version,validated_at,ai_settings)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'ready',$8,$9,now(),$10::jsonb)
         ON CONFLICT (model_id,concept_id,document_id,sheet_name)
         DO UPDATE SET field_mappings=EXCLUDED.field_mappings,asset_kind=EXCLUDED.asset_kind,status='ready',
           validated_source_version=EXCLUDED.validated_source_version,ai_settings=EXCLUDED.ai_settings,validated_at=now(),updated_at=now()`,
          [model.id, dto.conceptId, dto.workspaceId, dto.documentId, dto.sheetName ?? '', kind,
           JSON.stringify(dto.fieldMappings), userId, this.sourceVersion(document),
           kind === 'document' ? storedAiSettings(dto.aiSettings) : null],
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
            (model_id,concept_id,workspace_id,document_id,sheet_name,asset_kind,field_mappings,status,created_by,validated_source_version,validated_at,ai_settings)
            VALUES ($1,$2,$3,$4,'','document',$5::jsonb,'ready',$6,$7,now(),$8::jsonb)
            ON CONFLICT (model_id,concept_id,document_id,sheet_name)
            DO UPDATE SET field_mappings=EXCLUDED.field_mappings,asset_kind='document',status='ready',
              validated_source_version=EXCLUDED.validated_source_version,ai_settings=EXCLUDED.ai_settings,validated_at=now(),updated_at=now()`,
           [model.id, dto.conceptId, source.workspaceId, source.documentId, JSON.stringify(dto.fieldMappings), userId,
            this.sourceVersion(documents.get(`${source.workspaceId}:${source.documentId}`)!), storedAiSettings(dto.aiSettings)],
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

  private assertComputedInputs(mappings: SourceFieldMapping[]): void {
    const misplaced = mappings.find((mapping) => mapping.computed !== undefined && mapping.mode !== 'computed');
    if (misplaced) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'A computation is only supported for computed fields');
    }
    const inputs = new Set(mappings.filter((mapping) => mapping.mode !== 'computed' && mapping.mode !== 'ignore')
      .map((mapping) => mapping.targetAttribute));
    for (const mapping of mappings) {
      if (mapping.mode !== 'computed') continue;
      const input = mapping.computed?.input;
      if (!input) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${mapping.targetAttribute}: a computed field needs a computation`);
      }
      const valid = input.kind === 'file' ? input.name === 'document_name'
        : input.name !== mapping.targetAttribute && inputs.has(input.name);
      if (!valid) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
          `${mapping.targetAttribute}: a computed field reads the file name or another mapped, non-computed field`);
      }
    }
  }

  private assertMappingModes(kind: SourceAssetKind, mappings: SourceFieldMapping[]): void {
    const allowed = kind === 'document'
      ? new Set(['extract', 'metadata', 'constant', 'computed', 'ignore'])
      : new Set(['direct', 'constant', 'ignore']);
    const invalidMode = mappings.find((mapping) => !allowed.has(mapping.mode));
    if (invalidMode) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${invalidMode.mode} mappings are not supported for ${kind} assets`);
    }
    this.assertComputedInputs(mappings);
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
    const invalidAi = mappings.find((mapping) => (mapping.semanticDefinition !== undefined || mapping.agentId !== undefined)
      && (kind !== 'document' || mapping.mode !== 'extract'));
    if (invalidAi) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'A semantic definition or an extraction agent is only supported for extracted document fields');
    }
    const invalidRules = mappings.find((mapping) => mapping.rules !== undefined
      && (kind !== 'document' || mapping.mode !== 'extract'));
    if (invalidRules) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Reading rules are only supported for extracted document fields');
    }
    const anywhereWithoutPattern = mappings.find((mapping) => mapping.rules?.location === 'anywhere' && !mapping.rules.pattern?.trim());
    if (anywhereWithoutPattern) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        `${anywhereWithoutPattern.targetAttribute}: reading a value anywhere in the document needs a pattern`);
    }
    const badPages = mappings.find((mapping) => mapping.rules?.location === 'pages' && !validPageSpan(mapping.rules.pages));
    if (badPages) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED,
        `${badPages.targetAttribute}: whole pages need a first page, and a last page no more than ${MAX_PAGE_SPAN - 1} pages after it`);
    }
  }
}

const MAX_PAGE_SPAN = 50;

function validPageSpan(pages: ExtractionRules['pages']): boolean {
  if (!pages || !Number.isInteger(pages.from) || pages.from < 1) return false;
  const to = pages.to ?? pages.from;
  return Number.isInteger(to) && to >= pages.from && to - pages.from < MAX_PAGE_SPAN;
}

/** "Legal", "Legal / Contracts", "Legal / Contracts, NDA.pdf" or "Legal / Contracts, NDA.pdf +3". */
export function workspaceSourceLabel(workspaceName: string, picked: string[]): string {
  if (!picked.length) return workspaceName;
  const shown = picked.slice(0, 2).join(', ');
  return `${workspaceName} / ${shown}${picked.length > 2 ? ` +${picked.length - 2}` : ''}`;
}
