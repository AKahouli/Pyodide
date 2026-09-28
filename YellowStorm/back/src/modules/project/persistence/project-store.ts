import type { ProjectRecord } from './project-record.mapper';

export interface ProjectOneFilter {
  name: string;
  createdBy: string;
  /** Exclude this id from the match (rename duplicate check). */
  excludeId?: string;
}

export interface ProjectPatch {
  name?: string;
  isPublic?: boolean;
}

export type { ProjectRecord };
