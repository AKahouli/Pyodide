import type { GovernanceMembershipRecord } from './governance-records';
import type { GovernanceMembershipRole } from '../domain/governance-types';

export const MEMBERSHIP_STORE = Symbol('GOVERNANCE_MEMBERSHIP_STORE');

export interface GovernanceMembershipCreateInput {
  programId: string;
  scopeId?: string;
  userId?: string;
  groupId?: string;
  invitedBy: string;
  role: GovernanceMembershipRole;
  status: GovernanceMembershipRecord['status'];
  permissions: string[];
}

export interface GovernanceMembershipPatch {
  /** `undefined` = no change; `null` clears the scope (program-level membership). */
  scopeId?: string | null;
  role?: GovernanceMembershipRole;
  status?: GovernanceMembershipRecord['status'];
  permissions?: string[];
  invitedBy?: string;
}

/** Internal write/read store for governance_memberships. */
export interface MembershipStore {
  /** Throws {@link DuplicateKeyError} on a (program, scope, target) collision. */
  insert(input: GovernanceMembershipCreateInput): Promise<GovernanceMembershipRecord>;
  findById(membershipId: string): Promise<GovernanceMembershipRecord | null>;
  findByIdAndProgram(programId: string, membershipId: string): Promise<GovernanceMembershipRecord | null>;
  findDuplicate(programId: string, scopeId: string | null, target: { userId?: string; groupId?: string }): Promise<GovernanceMembershipRecord | null>;
  /** Active memberships of `userId` plus any of `groupIds` (empty array = user only). */
  findActiveForUser(programId: string, userId: string, groupIds: string[]): Promise<GovernanceMembershipRecord[]>;
  /** Active user memberships across all programs (program directory). */
  findActiveByUser(userId: string): Promise<GovernanceMembershipRecord[]>;
  listByProgram(programId: string): Promise<GovernanceMembershipRecord[]>;
  countByProgram(programId: string): Promise<number>;
  update(membershipId: string, patch: GovernanceMembershipPatch): Promise<GovernanceMembershipRecord | null>;
  deleteById(membershipId: string): Promise<void>;
  /** Scope-tree cleanup: removes every membership scoped to (program, scope). */
  deleteByProgramAndScope(programId: string, scopeId: string): Promise<void>;
}
