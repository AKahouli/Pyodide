export type GovernanceScopeAudienceMode = 'all_authenticated' | 'restricted';

/** Audience ids are 24-hex ObjectId strings (validate with `isObjectId` from `@common/postgres`). */
export interface GovernanceScopeAudience {
  mode: GovernanceScopeAudienceMode;
  userIds: string[];
  groupIds: string[];
}
