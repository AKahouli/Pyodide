import { Injectable } from '@nestjs/common';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import type { DocumentResponse } from '@modules/workspace/interfaces/workspace-document.interface';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';
import {
  isMailArchive, pickArchiveLimits, type ArchiveReadCeilings, type ArchiveReadLimits, type DataConnection, type DataConnectionKind,
} from '../domain/semantic-data-connection.types';
import type { CreateDataConnectionDto, UpdateDataConnectionDto } from '../dto/semantic-model.dto';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticExtractionSettingsService } from './semantic-extraction-settings.service';
import { SemanticModelService } from './semantic-model.service';

// Enough for any real model; a cap keeps the explorer short and the table bounded.
export const MAX_CONNECTIONS_PER_MODEL = 100;

interface ConnectionRow { id: string; kind: DataConnectionKind; name: string; workspaceId: string; documentId: string; indexInWorkspace: boolean; limits: unknown; createdAt: Date | string }

const COLUMNS = `id::text AS id, kind, name, workspace_id AS "workspaceId", document_id AS "documentId",
  coalesce((config->>'indexInWorkspace')::boolean, false) AS "indexInWorkspace",
  coalesce(config->'limits', '{}'::jsonb) AS "limits", created_at AS "createdAt"`;

const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : value;

/**
 * The data sources a model reads from, listed in its source explorer. A connection is model
 * settings, not model content: adding or removing one changes no revision, and removing one keeps
 * the mappings already made from it.
 */
@Injectable()
export class SemanticDataConnectionService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly documents: WorkspaceDocumentService,
    private readonly workspaceShares: WorkspaceShareService,
    private readonly extractionSettings: SemanticExtractionSettingsService,
  ) {}

  /** The most read time and memory an admin allows a connection; also the value of one that sets none. */
  async ceilings(): Promise<ArchiveReadCeilings> {
    const { runLimits } = await this.extractionSettings.getRunLimits();
    return { archiveTimeoutSeconds: runLimits.archiveTimeoutSeconds, parserMemoryMb: runLimits.parserMemoryMb };
  }

  private shown(row: ConnectionRow, ceilings: ArchiveReadCeilings, available: boolean): DataConnection {
    return { ...row, limits: pickArchiveLimits(row.limits, ceilings), ceilings, createdAt: iso(row.createdAt), available };
  }

  async list(userId: string, modelId: string): Promise<DataConnection[]> {
    const model = await this.models.requireRole(userId, modelId, ['owner', 'editor', 'viewer']);
    const result = await this.database.query<ConnectionRow>(
      `SELECT ${COLUMNS} FROM semantic_model.data_connections WHERE model_id=$1 ORDER BY lower(name), id`, [model.id]);
    if (!result.rows.length) return [];
    const workspaceIds = [...new Set(result.rows.map((row) => row.workspaceId))];
    const reachable = new Set(await this.workspaceShares.filterAccessible(userId, workspaceIds));
    // A file counts only while it is still in the workspace it was connected from.
    const found = new Set((await this.documents.findByIds(result.rows.map((row) => row.documentId))).map((document) => `${document.workspaceId}:${document.id}`));
    const ceilings = await this.ceilings();
    return result.rows.map((row) => this.shown(row, ceilings, reachable.has(row.workspaceId) && found.has(`${row.workspaceId}:${row.documentId}`)));
  }

  async create(userId: string, modelId: string, dto: CreateDataConnectionDto): Promise<DataConnection> {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    if (!await this.workspaceShares.hasAccess(userId, dto.workspaceId)) throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_WORKSPACE_INVALID);
    const document = (await this.documents.findByIdsInWorkspace(dto.workspaceId, [dto.documentId]))[0] as DocumentResponse | undefined;
    if (!document || document.isFolder) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'File not found in this workspace');
    if (!isMailArchive(document.mimeType)) {
      throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'A mail archive is a .zip of .eml files or one .eml file');
    }
    // The model row is locked, so two connections made at once neither pass the cap nor collide on one file;
    // connecting the same file again answers the connection it already has.
    const row = await this.database.transaction(async (client) => {
      await client.query('SELECT id FROM semantic_model.models WHERE id=$1 FOR UPDATE', [model.id]);
      const existing = await client.query<ConnectionRow>(
        `SELECT ${COLUMNS} FROM semantic_model.data_connections WHERE model_id=$1 AND kind=$2 AND document_id=$3`, [model.id, dto.kind, dto.documentId]);
      if (existing.rows[0]) return existing.rows[0];
      const count = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM semantic_model.data_connections WHERE model_id=$1', [model.id]);
      if ((count.rows[0]?.count ?? 0) >= MAX_CONNECTIONS_PER_MODEL) {
        throw new ConflictException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `A model can have at most ${String(MAX_CONNECTIONS_PER_MODEL)} data sources`);
      }
      const inserted = await client.query<ConnectionRow>(
        `INSERT INTO semantic_model.data_connections (model_id, kind, name, workspace_id, document_id, config, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING ${COLUMNS}`,
        [model.id, dto.kind, (dto.name?.trim() ? dto.name.trim() : document.originalName).slice(0, 120), dto.workspaceId, dto.documentId,
          JSON.stringify({ indexInWorkspace: dto.indexInWorkspace === true }), userId],
      );
      return inserted.rows[0];
    });
    return this.shown(row, await this.ceilings(), true);
  }

  /**
   * Changes whether the archive is also indexed in its workspace, or its reading limits (the limits given
   * replace the saved ones). Takes effect at the next run.
   */
  async update(userId: string, modelId: string, connectionId: string, dto: UpdateDataConnectionDto): Promise<DataConnection> {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const change: { indexInWorkspace?: boolean; limits?: ArchiveReadLimits } = {};
    if (dto.indexInWorkspace !== undefined) change.indexInWorkspace = dto.indexInWorkspace;
    if (dto.limits) change.limits = await this.allowedLimits(dto.limits);
    if (!Object.keys(change).length) throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, 'Nothing to change');
    const result = await this.database.query<ConnectionRow>(
      `UPDATE semantic_model.data_connections
       SET config = coalesce(config, '{}'::jsonb) || $3::jsonb, updated_at = now()
       WHERE id=$1 AND model_id=$2 RETURNING ${COLUMNS}`, [connectionId, model.id, JSON.stringify(change)]);
    const row = result.rows[0] as ConnectionRow | undefined;
    if (!row) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Data source not found');
    const listed = (await this.list(userId, modelId)).find((connection) => connection.id === row.id);
    return listed ?? this.shown(row, await this.ceilings(), false);
  }

  /** The limits as given, refused when read time or memory is above what the admin allows. */
  private async allowedLimits(limits: ArchiveReadLimits): Promise<ArchiveReadLimits> {
    const ceilings = await this.ceilings();
    for (const key of ['archiveTimeoutSeconds', 'parserMemoryMb'] as const) {
      const value = limits[key];
      if (value !== undefined && value > ceilings[key]) {
        throw new BadRequestException(ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED, `${key} must be at most ${String(ceilings[key])} on this server`);
      }
    }
    return pickArchiveLimits(limits);
  }

  async delete(userId: string, modelId: string, connectionId: string) {
    const model = await this.models.requireActiveRole(userId, modelId, ['owner', 'editor']);
    const result = await this.database.query('DELETE FROM semantic_model.data_connections WHERE id=$1 AND model_id=$2', [connectionId, model.id]);
    if (!result.rowCount) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND, 'Data source not found');
    return { deleted: true };
  }
}
