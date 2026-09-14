export interface IProjectResponse {
  id: string;
  name: string;
  createdBy: string;
  conversationCount: number;
  isPublic: boolean;
  shareCount: number;
  createdAt: string;
  updatedAt: string;
}

export type ProjectPermission = 'read' | 'readwrite';

export interface ISharedUserInfo {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface IProjectShareResponse {
  id: string;
  projectId: string;
  user: ISharedUserInfo;
  permission: ProjectPermission;
  sharedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface IShareProjectResult {
  shared: IProjectShareResponse[];
  notFound: string[];
  invalid: string[];
}

export interface IPaginatedProjectShares {
  shares: IProjectShareResponse[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface IProjectShareOwnerInfo {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface ISharedProjectResponse {
  id: string;
  name: string;
  owner: IProjectShareOwnerInfo;
  permission: ProjectPermission;
  shareId: string;
  conversationCount: number;
  sharedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface IPaginatedSharedProjects {
  projects: ISharedProjectResponse[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
