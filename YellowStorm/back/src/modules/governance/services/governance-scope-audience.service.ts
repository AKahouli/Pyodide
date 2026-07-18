import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { User, UserDocument } from '@modules/user/schemas/user.schema';
import { UserGroupService } from '@modules/user-group';
import { UpdateGovernanceScopeAudienceDto } from '../dto';
import { GovernanceScope, GovernanceScopeDocument } from '../schemas/governance-scope.schema';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceAudienceAuthorizationService } from './governance-audience-authorization.service';
import { GovernanceDraftPreparationService } from './governance-draft-preparation.service';

export interface GovernanceScopeAudienceResponse {
  mode: 'all_authenticated' | 'restricted';
  users: Array<{ id: string; email: string; firstName?: string; lastName?: string }>;
  groups: Array<{ id: string; name: string; memberCount: number }>;
  estimatedAuthorizedUserCount?: number;
}

@Injectable()
export class GovernanceScopeAudienceService {
  constructor(
    @InjectModel(GovernanceScope.name) private readonly scopeModel: Model<GovernanceScopeDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly accessService: GovernanceAccessService,
    private readonly userGroupService: UserGroupService,
    private readonly auditLogService: AuditLogService,
    private readonly configService: ConfigService,
    private readonly audienceAuthorization: GovernanceAudienceAuthorizationService,
    private readonly draftPreparation: GovernanceDraftPreparationService,
  ) {}

  async getAudience(actorId: string, programId: string, scopeId: string): Promise<GovernanceScopeAudienceResponse> {
    this.assertAudienceFeatureEnabled();
    await this.accessService.assertScopeRole(actorId, programId, scopeId, ['scope_admin']);
    const scope = await this.findScope(programId, scopeId);
    return this.toResponse(actorId, scope);
  }

  async updateAudience(actorId: string, actorEmail: string, programId: string, scopeId: string, dto: UpdateGovernanceScopeAudienceDto): Promise<GovernanceScopeAudienceResponse> {
    this.assertAudienceFeatureEnabled();
    await this.accessService.assertScopeRole(actorId, programId, scopeId, ['scope_admin']);
    const scope = await this.findScope(programId, scopeId);
    const previousAudience = {
      mode: scope.audience?.mode === 'all_authenticated' ? 'all_authenticated' as const : 'restricted' as const,
      userIds: (scope.audience?.userIds ?? []).map(String).sort(),
      groupIds: (scope.audience?.groupIds ?? []).map(String).sort(),
    };
    const userIds = dto.mode === 'all_authenticated' ? [] : this.uniqueObjectIds(dto.userIds);
    const groupIds = dto.mode === 'all_authenticated' ? [] : this.uniqueObjectIds(dto.groupIds);
    scope.audience = { mode: dto.mode, userIds, groupIds };
    await scope.save();
    await this.draftPreparation.prepare(actorId, actorEmail, programId, scopeId, { previousAudience });
    this.auditLogService.logSuccess({
      actorId,
      actorEmail,
      action: 'governance.scope.audience.updated',
      targetType: 'governance_scope',
      targetId: scopeId,
      metadata: { programId, mode: dto.mode, userCount: userIds.length, groupCount: groupIds.length },
    });
    return this.toResponse(actorId, scope);
  }

  async isUserAuthorized(userId: string, scopeId: string): Promise<boolean> {
    return this.audienceAuthorization.isUserAuthorized(userId, scopeId);
  }

  async assertUserAuthorized(userId: string, scopeId: string): Promise<void> {
    return this.audienceAuthorization.assertUserAuthorized(userId, scopeId);
  }

  private async findScope(programId: string, scopeId: string): Promise<GovernanceScopeDocument> {
    const scope = await this.scopeModel.findOne({ _id: new Types.ObjectId(scopeId), programId: new Types.ObjectId(programId) }).exec();
    if (!scope) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    return scope;
  }

  private async toResponse(actorId: string, scope: GovernanceScopeDocument): Promise<GovernanceScopeAudienceResponse> {
    const audience = scope.audience ?? { mode: 'restricted' as const, userIds: [], groupIds: [] };
    const users = await this.userModel.find({ _id: { $in: audience.userIds ?? [] } }).select('email profile.firstName profile.lastName').lean().exec();
    const groups = await this.userGroupService.findOwnedGroupsByIds(actorId, (audience.groupIds ?? []).map(String));
    const estimatedAuthorizedUserCount = audience.mode === 'restricted'
      ? new Set([...(audience.userIds ?? []).map(String), ...groups.flatMap((group) => group.members.map((member) => member.id))]).size
      : undefined;
    return {
      mode: audience.mode,
      users: users.map((user) => ({ id: user._id.toString(), email: user.email, firstName: user.profile?.firstName, lastName: user.profile?.lastName })),
      groups: groups.map((group) => ({ id: group.id, name: group.name, memberCount: group.memberCount })),
      estimatedAuthorizedUserCount,
    };
  }

  private uniqueObjectIds(ids?: string[]): Types.ObjectId[] {
    return [...new Set(ids ?? [])].map((id) => new Types.ObjectId(id));
  }

  private assertAudienceFeatureEnabled(): void {
    if (!this.configService.get<boolean>('governedConversations.audienceEnabled', false)) {
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Scope audience is not enabled');
    }
  }
}
