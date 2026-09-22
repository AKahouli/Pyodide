export interface UserGroupMemberRecord {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

/** Group with members joined (the Mongo populate('members') output shape). */
export interface PopulatedGroupRecord {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  members: UserGroupMemberRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export const USER_GROUP_STORE = Symbol('USER_GROUP_STORE');

/**
 * Persistence port for user-owned groups. Read methods return populated
 * records; refs to deleted users are dropped, as the populate-null filtering
 * did. Every write stays owner-scoped at the service layer.
 */
export interface UserGroupStore {
  create(init: { ownerId: string; name: string; description: string; memberIds: string[] }): Promise<PopulatedGroupRecord>;
  existsOwnedByName(ownerId: string, name: string, excludeId?: string): Promise<boolean>;
  /** Owned groups, newest first, members populated. */
  findAllForUser(ownerId: string): Promise<PopulatedGroupRecord[]>;
  findOwnedById(ownerId: string, id: string): Promise<PopulatedGroupRecord | null>;
  findOwnedByIds(ownerId: string, ids: string[]): Promise<PopulatedGroupRecord[]>;
  update(id: string, patch: { name?: string; description?: string }): Promise<void>;
  deleteById(id: string): Promise<void>;
  addMembers(id: string, userIds: string[]): Promise<void>;
  removeMember(id: string, memberId: string): Promise<void>;
  findOwnedGroupIdsForMember(ownerId: string, memberId: string): Promise<string[]>;
  findGroupIdsForMember(memberId: string): Promise<string[]>;
}
