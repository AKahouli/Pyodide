import { Injectable } from '@nestjs/common';
import { UserService } from '@modules/user';
import { ForbiddenException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticModelService } from './semantic-model.service';
import type { ShareSemanticModelDto, UpdateSemanticModelShareDto } from '../dto/semantic-model-share.dto';

export interface SemanticModelMemberRow {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: 'viewer' | 'editor';
  createdAt: string;
}

export interface SemanticModelShareResult {
  shared: { userId: string; email: string; role: string }[];
  notFound: string[];
  alreadyOwner: string[];
  alreadyShared: string[];
}

@Injectable()
export class SemanticModelShareService {
  constructor(
    private readonly database: SemanticModelDatabaseService,
    private readonly models: SemanticModelService,
    private readonly users: UserService,
  ) {}

  async list(requesterId: string, modelId: string): Promise<SemanticModelMemberRow[]> {
    await this.models.requireRole(requesterId, modelId, ['owner', 'editor', 'viewer']);
    const result = await this.database.query<SemanticModelMemberRow>(
      `SELECT user_id AS "userId", email, first_name AS "firstName", last_name AS "lastName",
              role, created_at AS "createdAt"
       FROM semantic_model.memberships
       WHERE model_id = $1 AND role != 'owner'
       ORDER BY created_at`,
      [modelId],
    );
    return result.rows;
  }

  async share(requesterId: string, modelId: string, dto: ShareSemanticModelDto): Promise<SemanticModelShareResult> {
    const model = await this.models.requireRole(requesterId, modelId, ['owner']);
    const result: SemanticModelShareResult = { shared: [], notFound: [], alreadyOwner: [], alreadyShared: [] };

    for (const entry of dto.shares) {
      const user = await this.users.findByEmail(entry.email);
      if (!user) { result.notFound.push(entry.email); continue; }
      const userId = user._id.toString();
      if (userId === model.ownerUserId) { result.alreadyOwner.push(entry.email); continue; }

      const upsert = await this.database.query<{ inserted: boolean }>(
        `INSERT INTO semantic_model.memberships (model_id, user_id, role, email, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (model_id, user_id) DO UPDATE
           SET role = EXCLUDED.role, email = EXCLUDED.email,
               first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
         RETURNING (xmax = 0) AS inserted`,
        [modelId, userId, entry.role, user.email, user.profile?.firstName ?? null, user.profile?.lastName ?? null],
      );

      const wasInserted = upsert.rows[0]?.inserted;
      if (!wasInserted) result.alreadyShared.push(entry.email);
      result.shared.push({ userId, email: entry.email, role: entry.role });
    }
    return result;
  }

  async updateRole(requesterId: string, modelId: string, targetUserId: string, dto: UpdateSemanticModelShareDto): Promise<void> {
    await this.models.requireRole(requesterId, modelId, ['owner']);
    const update = await this.database.query(
      `UPDATE semantic_model.memberships SET role = $3
       WHERE model_id = $1 AND user_id = $2 AND role != 'owner'`,
      [modelId, targetUserId, dto.role],
    );
    if (!update.rowCount) throw new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND);
  }

  async revoke(requesterId: string, modelId: string, targetUserId: string): Promise<void> {
    const model = await this.models.requireRole(requesterId, modelId, ['owner']);
    if (targetUserId === model.ownerUserId) throw new ForbiddenException(ErrorCode.SEMANTIC_MODEL_ACCESS_DENIED);
    await this.database.query(
      `DELETE FROM semantic_model.memberships WHERE model_id = $1 AND user_id = $2 AND role != 'owner'`,
      [modelId, targetUserId],
    );
  }
}
