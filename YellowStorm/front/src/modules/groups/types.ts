/**
 * Groups Module - Types
 *
 * A UserGroup is a private, user-owned list of registered users. Groups are a
 * convenience for sharing: a group can be expanded into its members' emails and
 * fed into the existing workspace-share flow.
 */

export interface GroupMember {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface UserGroup {
  id: string;
  name: string;
  description: string;
  members: GroupMember[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGroupData {
  name: string;
  description?: string;
  memberIds?: string[];
}

export interface UpdateGroupData {
  name?: string;
  description?: string;
}

/** A user returned by the autocomplete search when picking members. */
export interface UserSearchResult {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface GroupsState {
  groups: UserGroup[];
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
}

export interface GroupsActions {
  fetchGroups: () => Promise<void>;
  createGroup: (data: CreateGroupData) => Promise<UserGroup>;
  updateGroup: (id: string, data: UpdateGroupData) => Promise<UserGroup>;
  deleteGroup: (id: string) => Promise<void>;
  addMembers: (id: string, userIds: string[]) => Promise<UserGroup>;
  removeMember: (id: string, userId: string) => Promise<UserGroup>;
  reset: () => void;
}

export type GroupsStore = GroupsState & GroupsActions;
