import { Injectable } from '@nestjs/common';
import { ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';

/**
 * The single authorization path for every semantic-model SOURCE operation
 * (SEC-03 / SEC-04 / WP-03): listing assets, reading or requesting profiles,
 * previews, document labels and mapping creation.
 *
 * Authorization is the intersection of:
 *  (a) the actor's model role — checked by the caller via
 *      `SemanticModelService.requireRole/requireActiveRole`, because callers
 *      need the loaded model anyway and each operation declares its own roles;
 *  (b) an ENABLED link from that model to the workspace (this service);
 *  (c) the actor's CURRENT workspace membership/share
 *      (`WorkspaceShareService`, authoritative, rechecked on every request);
 *  (d) document-level permission — the workspace module has no per-document
 *      ACL: workspace access is the document access boundary, so (c) covers it.
 *
 * A link, model membership, `createdBy`, agent identity or a cached profile
 * never substitutes for (c)/(d). Workspace/document ids always come from the
 * server's own model state or are re-validated here — never trusted from the
 * client. Denials are non-enumerating: the same `SEMANTIC_MODEL_WORKSPACE_INVALID`
 * error for unknown and forbidden references.
 */
@Injectable()
export class SemanticSourceAccessService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly workspaceShares: WorkspaceShareService,
  ) {}

  /**
   * The model's enabled linked workspaces the actor may read RIGHT NOW
   * (enabled links ∩ current workspace access), batched for lists.
   */
  async accessibleWorkspaceIds(actorUserId: string, modelId: string): Promise<string[]> {
    const links = await this.database.query<{ workspaceId: string }>(
      'SELECT workspace_id AS "workspaceId" FROM semantic_model.workspace_links WHERE model_id=$1 AND enabled',
      [modelId],
    );
    const candidates = [...new Set(links.rows.map((row) => row.workspaceId).filter(Boolean))];
    if (!candidates.length) return [];
    return this.workspaceShares.filterAccessible(actorUserId, candidates);
  }

  /** Assert (b)+(c)+(d) for reading a source document, or any document of a workspace. */
  async assertSourceReadable(actorUserId: string, modelId: string, workspaceId: string, documentId?: string): Promise<void> {
    await this.assertWorkspaceSourceAccess(actorUserId, modelId, workspaceId);
  }

  /** Assert (b)+(c)+(d) for mapping or previewing a source document (callers enforce the model edit role). */
  async assertSourceEditable(actorUserId: string, modelId: string, workspaceId: string, documentId?: string): Promise<void> {
    await this.assertWorkspaceSourceAccess(actorUserId, modelId, workspaceId);
  }

  private async assertWorkspaceSourceAccess(actorUserId: string, modelId: string, workspaceId: string): Promise<void> {
    const links = await this.database.query<{ workspaceId: string }>(
      'SELECT 1 FROM semantic_model.workspace_links WHERE model_id=$1 AND workspace_id=$2 AND enabled',
      [modelId, workspaceId],
    );
    if (!links.rows[0] || !(await this.workspaceShares.hasAccess(actorUserId, workspaceId))) {
      // Non-enumerating: unknown and forbidden references deny identically.
      throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_WORKSPACE_INVALID);
    }
  }
}
