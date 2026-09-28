import type { ProjectShareRecord } from './project-record.mapper';

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

export type { ProjectShareRecord } from './project-record.mapper';
