import { Inject, Injectable } from '@nestjs/common';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import { AuditLogService } from '@modules/authorization/services/audit-log.service';
import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { USER_LOOKUP_PORT, type UserLookupPort } from '@common/ports/user-lookup.port';
import { UserGroupService } from '@modules/user-group';
import { UpdateGovernanceScopeAudienceDto } from '../dto';
import { type ScopeStore } from '../persistence';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceAudienceAuthorizationService } from './governance-audience-authorization.service';
import { GovernanceDraftPreparationService } from './governance-draft-preparation.service';
import { PgScopeStore } from '../persistence/postgres/pg-scope.store';

export interface GovernanceScopeAudienceResponse {
  mode: 'all_authenticated' | 'restricted';
  users: { id: string; email: string; firstName?: string; lastName?: string }[];
  groups: { id: string; name: string; memberCount: number }[];
  estimatedAuthorizedUserCount?: number;
}

@Injectable()
export class GovernanceScopeAudienceService {
  constructor(
    private readonly scopeStore: PgScopeStore,
    @Inject(USER_LOOKUP_PORT) private readonly userLookup: UserLookupPort,
    private readonly accessService: GovernanceAccessService,
    private readonly userGroupService: UserGroupService,
    private readonly auditLogService: AuditLogService,
    private readonly featureVisibility: FeatureVisibilityService,
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
    const userIds = dto.mode === 'all_authenticated' ? [] : [...new Set(dto.userIds ?? [])];
    const groupIds = dto.mode === 'all_authenticated' ? [] : [...new Set(dto.groupIds ?? [])];
    const updated = await this.scopeStore.update(scope.id, { audience: { mode: dto.mode, userIds, groupIds } });
    if (!updated) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    await this.draftPreparation.prepare(actorId, actorEmail, programId, scopeId, { previousAudience });
    this.auditLogService.logSuccess({
      actorId,
      actorEmail,
      action: 'governance.scope.audience.updated',
      targetType: 'governance_scope',
      targetId: scopeId,
      metadata: { programId, mode: dto.mode, userCount: userIds.length, groupCount: groupIds.length },
    });
    return this.toResponse(actorId, updated);
  }

  async isUserAuthorized(userId: string, scopeId: string): Promise<boolean> {
    return this.audienceAuthorization.isUserAuthorized(userId, scopeId);
  }

  async assertUserAuthorized(userId: string, scopeId: string): Promise<void> {
    return this.audienceAuthorization.assertUserAuthorized(userId, scopeId);
  }

  private async findScope(programId: string, scopeId: string) {
    const scope = await this.scopeStore.findByProgramAndId(programId, scopeId);
    if (!scope) throw new NotFoundException(ErrorCode.GOVERNANCE_SCOPE_NOT_FOUND);
    return scope;
  }

  private async toResponse(actorId: string, scope: NonNullable<Awaited<ReturnType<ScopeStore['findById']>>>): Promise<GovernanceScopeAudienceResponse> {
    const audience = scope.audience ?? { mode: 'restricted' as const, userIds: [], groupIds: [] };
    const users = audience.mode !== 'all_authenticated' && audience.userIds.length ? Array.from((await this.userLookup.byIds(audience.userIds)).values()) : [];
    const groups = await this.userGroupService.findOwnedGroupsByIds(actorId, (audience.groupIds ?? []).map(String));
    const estimatedAuthorizedUserCount = audience.mode === 'restricted'
      ? new Set([...(audience.userIds ?? []).map(String), ...groups.flatMap((group) => group.members.map((member) => member.id))]).size
      : undefined;
    return {
      mode: audience.mode,
      users: users.map((user) => ({ id: user.id, email: user.email, firstName: user.firstName || undefined, lastName: user.lastName || undefined })),
      groups: groups.map((group) => ({ id: group.id, name: group.name, memberCount: group.memberCount })),
      estimatedAuthorizedUserCount,
    };
  }

  private assertAudienceFeatureEnabled(): void {
    if (!this.featureVisibility.isEnabled('governanceScopeAudience')) {
      throw new ServiceUnavailableException(ErrorCode.SERVICE_UNAVAILABLE, 'Scope audience is not enabled');
    }
  }
}
