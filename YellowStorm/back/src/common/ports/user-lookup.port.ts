export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export const USER_LOOKUP_PORT = Symbol('USER_LOOKUP_PORT');

/**
 * Read-only access to user display data, replacing `.populate('…UserId',
 * 'email profile.firstName profile.lastName')` at Mongo boundaries. Backed by
 * Mongo today; swapped to PostgreSQL when identity migrates, with no caller
 * changes.
 */
export interface UserLookupPort {
  byId(id: string): Promise<UserSummary | null>;
  byIds(ids: string[]): Promise<Map<string, UserSummary>>;
}
