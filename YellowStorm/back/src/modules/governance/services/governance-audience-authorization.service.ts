import { Injectable } from '@nestjs/common';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { UserGroupService } from '@modules/user-group';
import { GovernanceScope, GovernanceScopeDocument } from '../schemas/governance-scope.schema';

@Injectable()
export class GovernanceAudienceAuthorizationService {
  constructor(@InjectModel(GovernanceScope.name) private readonly scopeModel: Model<GovernanceScopeDocument>, private readonly userGroupService: UserGroupService, private readonly features: FeatureVisibilityService) {}

  async isUserAuthorized(userId: string, scopeId: string): Promise<boolean> {
    if (!this.features.isEnabled('governanceScopeAudience') || !Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(scopeId)) return false;
    const scope = await this.scopeModel.findOne({ _id: new Types.ObjectId(scopeId), status: 'active' }).select('audience').lean().exec();
    if (!scope) return false;
    const audience = scope.audience ?? { mode: 'restricted', userIds: [], groupIds: [] };
    if (audience.mode === 'all_authenticated' || (audience.userIds ?? []).some((id) => id.toString() === userId)) return true;
    const allowedGroups = new Set((audience.groupIds ?? []).map(String));
    return (await this.userGroupService.findGroupIdsForMember(userId)).some((id) => allowedGroups.has(id));
  }

  async assertUserAuthorized(userId: string, scopeId: string): Promise<void> {
    if (await this.isUserAuthorized(userId, scopeId)) return;
    throw new ForbiddenException(ErrorCode.GOVERNANCE_ACCESS_DENIED, 'You are not part of this governed audience');
  }
}
