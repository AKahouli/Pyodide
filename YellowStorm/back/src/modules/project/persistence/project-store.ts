import type { ProjectRecord } from './project-record.mapper';

export const PROJECT_STORE = Symbol('PROJECT_STORE');

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

export interface ProjectStore {
  findById(id: string): Promise<ProjectRecord | null>;
  /** In-memory join source for share listings (replaces the projectId populate). */
  findByIds(ids: string[]): Promise<Map<string, ProjectRecord>>;
  findOne(filter: ProjectOneFilter): Promise<ProjectRecord | null>;
  /** Owner's projects, newest first; optional case-insensitive name search. */
  findByOwner(createdBy: string, search?: string): Promise<ProjectRecord[]>;
  create(input: { name: string; createdBy: string }): Promise<ProjectRecord>;
  updateById(id: string, patch: ProjectPatch): Promise<ProjectRecord | null>;
  deleteById(id: string): Promise<void>;
  existsOwnedBy(id: string, createdBy: string): Promise<boolean>;
  existsPublic(id: string): Promise<boolean>;
  /** Stored counter (copied at backfill, never recomputed); called inside the share tx. */
  incrementShareCount(id: string, delta: number): Promise<void>;
}

export type { ProjectRecord };
