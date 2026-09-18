import type { ProjectShareRecord } from './project-record.mapper';

export const PROJECT_SHARE_STORE = Symbol('PROJECT_SHARE_STORE');
export interface ProjectShareCreateInput {
  id?: string;
  projectId: string;
  ownerId: string;
  sharedWithUserId: string;
  permission: 'read' | 'readwrite';
  sharedBy: string;
}

export interface PageRequest {
  limit: number;
  offset: number;
}

export interface ProjectShareStore {
  findById(id: string): Promise<ProjectShareRecord | null>;
  findOneByProjectAndUser(projectId: string, userId: string): Promise<ProjectShareRecord | null>;
  existsForUser(projectId: string, userId: string): Promise<boolean>;
  /** Shares for one project, newest first, with total (replaces populate + skip/limit + count). */
  findByProject(projectId: string, page: PageRequest): Promise<{ rows: ProjectShareRecord[]; total: number }>;
  /** Shares granted to one user, newest first, with total. */
  findByUser(userId: string, page: PageRequest): Promise<{ rows: ProjectShareRecord[]; total: number }>;
  create(input: ProjectShareCreateInput): Promise<ProjectShareRecord>;
  updatePermission(id: string, permission: 'read' | 'readwrite'): Promise<ProjectShareRecord | null>;
  deleteById(id: string): Promise<void>;
  /** Cascade on project delete. Returns the number of removed shares. */
  deleteByProject(projectId: string): Promise<number>;
}

export type { ProjectShareRecord } from './project-record.mapper';
