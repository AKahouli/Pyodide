import { Types } from 'mongoose';

export type GovernanceScopeAudienceMode = 'all_authenticated' | 'restricted';

export interface GovernanceScopeAudience {
  mode: GovernanceScopeAudienceMode;
  userIds: Types.ObjectId[];
  groupIds: Types.ObjectId[];
}
