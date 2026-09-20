import { Types } from 'mongoose';

export interface IRole {
  _id: Types.ObjectId;
  name: string;
  description: string;
  permissions: string[];
  isActive: boolean;
  isSystem: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleResponse {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isActive: boolean;
  isSystem: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Default roles to seed on application startup.
 * Priority is for UI display ordering ONLY - has NO effect on authorization.
 */
export const DEFAULT_ROLES: Array<{
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  priority: number;
}> = [
  {
    name: 'user',
    description: 'Default user role with no admin permissions',
    permissions: [],
    isSystem: true,
    priority: 0,
  },
  {
    name: 'tester',
    description: 'Tester with read-only analytics access',
    permissions: ['analytics.read'],
    isSystem: true,
    priority: 10,
  },
  {
    name: 'dev',
    description: 'Developer with analytics and system maintenance access',
    permissions: ['analytics.read', 'system.maintenance'],
    isSystem: true,
    priority: 20,
  },
  {
    name: 'moderator',
    description: 'Moderator with report and conversation management',
    permissions: ['reports.*', 'conversations.admin_delete'],
    isSystem: true,
    priority: 50,
  },
  {
    name: 'admin',
    description: 'Administrator with broad access except super admin features',
    permissions: [
      'users.*',
      'plans.*',
      'reports.*',
      'workspaces.*',
      'analytics.*',
      'conversations.*',
      'app_builder_ai.read',
      'app_builder_ai.manage',
      'admin.roles.read',
      'admin.audit.read',
    ],
    isSystem: true,
    priority: 90,
  },
  {
    name: 'super_admin',
    description: 'Super administrator with full system access',
    permissions: ['*'],
    isSystem: true,
    priority: 100,
  },
];
