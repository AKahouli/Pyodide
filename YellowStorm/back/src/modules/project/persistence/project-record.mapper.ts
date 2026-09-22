import type * as schema from '@modules/postgres/schema';

type ProjectRow = typeof schema.projects.$inferSelect;
type ProjectShareRow = typeof schema.projectShares.$inferSelect;

/** Shape matching the Mongoose toJSON output (id, no _id, no __v). */
export interface ProjectRecord {
  id: string;
  name: string;
  createdBy: string;
  isPublic: boolean;
  shareCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectShareRecord {
  id: string;
  projectId: string;
  ownerId: string;
  sharedWithUserId: string;
  permission: 'read' | 'readwrite';
  sharedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export function projectRowToRecord(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.createdBy,
    isPublic: row.isPublic,
    shareCount: row.shareCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function projectShareRowToRecord(row: ProjectShareRow): ProjectShareRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    ownerId: row.ownerId,
    sharedWithUserId: row.sharedWithUserId,
    permission: row.permission as 'read' | 'readwrite',
    sharedBy: row.sharedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
