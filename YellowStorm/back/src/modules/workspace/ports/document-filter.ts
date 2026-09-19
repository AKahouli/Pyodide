/**
 * Explicit, typed document filter — NOT a passthrough Mongo query. The Step D
 * PG adapter is a straight translation of these fields.
 *
 * Measured consumer call sites (Step C inventory): governance (by id / ids /
 * workspaceId / isFolder / indexingStatus / afterId keyset), indexing (status +
 * indexingStatus + indexingStartedBefore), classifier (workspaceId + isFolder +
 * originalName search + count).
 */
export interface DocumentFilter {
  id?: string;
  workspaceId?: string;
  workspaceIds?: string[];
  ids?: string[];
  status?: string;
  indexingStatus?: string;
  /** Stale-processing scan: indexingStartedAt < cutoff. */
  indexingStartedBefore?: Date;
  parentId?: string;
  /**
   * NOTE: `false` here means "not a folder". The Mongo adapter maps it to
   * `{isFolder: false}` (NOT `$ne: true`) — every doc carries the schema
   * default, so the predicates are equivalent on real data; the Step D PG
   * column is boolean NOT NULL DEFAULT false and stays equivalent.
   */
  isFolder?: boolean;
  type?: string;
  /** Exact originalName match. */
  originalName?: string;
  /** Case-insensitive substring match on originalName (input is escaped by the adapter). */
  originalNameSearch?: string;
  /** Keyset pagination: _id > afterId (ascending id sort implied). */
  afterId?: string;
}

export type DocumentSortField = 'createdAt' | 'id';

export interface DocumentFindOptions {
  sort?: { field: DocumentSortField; direction: 'asc' | 'desc' };
  limit?: number;
  skip?: number;
}
