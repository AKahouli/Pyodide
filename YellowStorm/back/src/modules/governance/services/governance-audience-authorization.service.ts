import { Injectable } from '@nestjs/common';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import { ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { UserGroupService } from '@modules/user-group';
import { PgScopeStore } from '../persistence/postgres/pg-scope.store';

@Injectable()
export class GovernanceAudienceAuthorizationService {
  constructor(private readonly scopeStore: PgScopeStore, private readonly userGroupService: UserGroupService, private readonly features: FeatureVisibilityService) {}

  async isUserAuthorized(userId: string, scopeId: string): Promise<boolean> {
    if (!this.features.isEnabled('governanceScopeAudience')) return false;
    const scope = await this.scopeStore.findById(scopeId);
    if (!scope || scope.status !== 'active') return false;
    const audience = scope.audience ?? { mode: 'restricted' as const, userIds: [], groupIds: [] };
    if (audience.mode === 'all_authenticated' || (audience.userIds ?? []).some((id) => id === userId)) return true;
    const allowedGroups = new Set((audience.groupIds ?? []).map(String));
    return (await this.userGroupService.findGroupIdsForMember(userId)).some((id) => allowedGroups.has(id));
  }

  async assertUserAuthorized(userId: string, scopeId: string): Promise<void> {
    if (await this.isUserAuthorized(userId, scopeId)) return;
    throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED, 'You are not part of this governed audience');
  }
}
