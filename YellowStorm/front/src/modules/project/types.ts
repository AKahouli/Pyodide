import type { WorkspacePermission } from '@/modules/workspace/types';

export interface Project {
  id: string;
  name: string;
  createdBy: string;
  conversationCount: number;
  isPublic: boolean;
  shareCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectData {
  name: string;
}

export interface UpdateProjectData {
  name?: string;
}

export interface SharedUserInfo {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface ProjectShareResponse {
  id: string;
  projectId: string;
  user: SharedUserInfo;
  permission: WorkspacePermission;
  sharedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShareProjectData {
  shares: { email: string; permission: WorkspacePermission }[];
}

export interface ShareProjectResult {
  shared: ProjectShareResponse[];
  notFound: string[];
  invalid: string[];
}

export interface PaginatedProjectShares {
  shares: ProjectShareResponse[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface SharedProjectResponse {
  id: string;
  name: string;
  owner: SharedUserInfo;
  permission: WorkspacePermission;
  shareId: string;
  conversationCount: number;
  sharedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedSharedProjects {
  projects: SharedProjectResponse[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
