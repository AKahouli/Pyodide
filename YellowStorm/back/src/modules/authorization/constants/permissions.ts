/**
 * Permission constants for documentation and autocomplete.
 * The PermissionRegistry is the source of truth for validation.
 */
export const Permissions = {
  // User Management
  USERS_READ: 'users.read',
  USERS_SUSPEND: 'users.suspend',
  USERS_ACTIVATE: 'users.activate',
  USERS_ASSIGN_PLAN: 'users.assign_plan',
  USERS_ASSIGN_ROLE: 'users.assign_role',
  USERS_ALL: 'users.*',

  // Plan Management
  PLANS_READ_ALL: 'plans.read_all',
  PLANS_CREATE: 'plans.create',
  PLANS_UPDATE: 'plans.update',
  PLANS_DELETE: 'plans.delete',
  PLANS_ALL: 'plans.*',

  // Report Management
  REPORTS_READ: 'reports.read',
  REPORTS_UPDATE: 'reports.update',
  REPORTS_ALL: 'reports.*',

  // System Management
  SYSTEM_MAINTENANCE: 'system.maintenance',
  SYSTEM_SKIP_MAINTENANCE: 'system.skip_maintenance',
  SYSTEM_REGISTRATION: 'system.registration',
  SYSTEM_ALL: 'system.*',

  // Workspace Admin
  WORKSPACES_ADMIN_DELETE: 'workspaces.admin_delete',
  WORKSPACES_MANAGE_TEMPLATES: 'workspaces.manage_templates',
  WORKSPACES_ALL: 'workspaces.*',

  // Analytics
  ANALYTICS_READ: 'analytics.read',
  ANALYTICS_ALL: 'analytics.*',

  // Conversation Admin
  CONVERSATIONS_ADMIN_DELETE: 'conversations.admin_delete',
  CONVERSATIONS_ALL: 'conversations.*',

  // Model Management
  MODELS_READ_ALL: 'models.read_all',
  MODELS_UPDATE: 'models.update',
  MODELS_SET_DEFAULT: 'models.set_default',
  MODELS_ALL: 'models.*',

  // Tool Management
  TOOLS_READ: 'tools.read',
  TOOLS_CREATE: 'tools.create',
  TOOLS_UPDATE: 'tools.update',
  TOOLS_DELETE: 'tools.delete',
  TOOLS_ALL: 'tools.*',

  // Skill Management
  SKILLS_READ: 'skills.read',
  SKILLS_CREATE: 'skills.create',
  SKILLS_UPDATE: 'skills.update',
  SKILLS_DELETE: 'skills.delete',
  SKILLS_ALL: 'skills.*',

  // Agent Type Management
  AGENT_TYPES_READ: 'agent_types.read',
  AGENT_TYPES_CREATE: 'agent_types.create',
  AGENT_TYPES_UPDATE: 'agent_types.update',
  AGENT_TYPES_DELETE: 'agent_types.delete',
  AGENT_TYPES_ALL: 'agent_types.*',

  // Agent Management (admin default agents)
  AGENTS_READ: 'agents.read',
  AGENTS_CREATE: 'agents.create',
  AGENTS_UPDATE: 'agents.update',
  AGENTS_DELETE: 'agents.delete',
  AGENTS_ALL: 'agents.*',

  // Auth Providers
  AUTH_PROVIDERS_READ: 'auth_providers.read',
  AUTH_PROVIDERS_CREATE: 'auth_providers.create',
  AUTH_PROVIDERS_UPDATE: 'auth_providers.update',
  AUTH_PROVIDERS_DELETE: 'auth_providers.delete',
  AUTH_PROVIDERS_ALL: 'auth_providers.*',

  // Chat Completion Management
  CHAT_COMPLETION_READ: 'chat_completion.read',
  CHAT_COMPLETION_UPDATE: 'chat_completion.update',
  CHAT_COMPLETION_ALL: 'chat_completion.*',

  // Admin UI (separate namespace)
  ADMIN_ROLES_READ: 'admin.roles.read',
  ADMIN_ROLES_MANAGE: 'admin.roles.manage',
  ADMIN_AUDIT_READ: 'admin.audit.read',
  ADMIN_LOGS_READ: 'admin.logs.read',
  ADMIN_ALL: 'admin.*',

  // Connector Management
  CONNECTORS_READ: 'connectors.read',
  CONNECTORS_CREATE: 'connectors.create',
  CONNECTORS_UPDATE: 'connectors.update',
  CONNECTORS_DELETE: 'connectors.delete',
  CONNECTORS_ALL: 'connectors.*',

  // Connected App Management
  CONNECTED_APPS_READ: 'connected_apps.read',
  CONNECTED_APPS_CREATE: 'connected_apps.create',
  CONNECTED_APPS_UPDATE: 'connected_apps.update',
  CONNECTED_APPS_DELETE: 'connected_apps.delete',
  CONNECTED_APPS_ALL: 'connected_apps.*',

  // Playbook
  PLAYBOOK_READ: 'playbook.read',
  PLAYBOOK_CREATE: 'playbook.create',
  PLAYBOOK_UPDATE: 'playbook.update',
  PLAYBOOK_DELETE: 'playbook.delete',
  PLAYBOOK_EXECUTE: 'playbook.execute',
  PLAYBOOK_ALL: 'playbook.*',

  // Team Auto-Builder
  TEAM_AUTO_BUILDER_READ: 'team_auto_builder.read',
  TEAM_AUTO_BUILDER_UPDATE: 'team_auto_builder.update',
  TEAM_AUTO_BUILDER_ALL: 'team_auto_builder.*',

  // Worky (Chief of Staff) — Part 1
  WORKY_STREAM_READ: 'worky.stream.read',
  WORKY_STREAM_WRITE: 'worky.stream.write',
  WORKY_STREAM_EXECUTE: 'worky.stream.execute',
  WORKY_INTERACTION_RESPOND: 'worky.interaction.respond',
  WORKY_ADMIN_GOVERNANCE: 'worky.admin.governance',
  WORKY_ADMIN_TRACE: 'worky.admin.trace',
  WORKY_ALL: 'worky.*',

  // Super Admin
  SUPER_ADMIN: '*',
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

/**
 * All valid permissions - source of truth for runtime validation
 */
const ALL_PERMISSIONS = new Set<string>([
  // User Management
  'users.read',
  'users.suspend',
  'users.activate',
  'users.assign_plan',
  'users.assign_role',
  'users.*',

  // Plan Management
  'plans.read_all',
  'plans.create',
  'plans.update',
  'plans.delete',
  'plans.*',

  // Report Management
  'reports.read',
  'reports.update',
  'reports.*',

  // System Management
  'system.maintenance',
  'system.skip_maintenance',
  'system.registration',
  'system.*',

  // Workspace Admin
  'workspaces.admin_delete',
  'workspaces.manage_templates',
  'workspaces.*',

  // Analytics
  'analytics.read',
  'analytics.*',

  // Conversation Admin
  'conversations.admin_delete',
  'conversations.*',

  // Model Management
  'models.read_all',
  'models.update',
  'models.set_default',
  'models.*',

  // Tool Management
  'tools.read',
  'tools.create',
  'tools.update',
  'tools.delete',
  'tools.*',

  // Skill Management
  'skills.read',
  'skills.create',
  'skills.update',
  'skills.delete',
  'skills.*',

  // Agent Type Management
  'agent_types.read',
  'agent_types.create',
  'agent_types.update',
  'agent_types.delete',
  'agent_types.*',

  // Agent Management
  'agents.read',
  'agents.create',
  'agents.update',
  'agents.delete',
  'agents.*',

  // Auth Providers
  'auth_providers.read',
  'auth_providers.create',
  'auth_providers.update',
  'auth_providers.delete',
  'auth_providers.*',

  // Chat Completion Management
  'chat_completion.read',
  'chat_completion.update',
  'chat_completion.*',

  // Admin UI
  'admin.roles.read',
  'admin.roles.manage',
  'admin.audit.read',
  'admin.logs.read',
  'admin.*',

  // Connector Management
  'connectors.read',
  'connectors.create',
  'connectors.update',
  'connectors.delete',
  'connectors.*',

  // Connected App Management
  'connected_apps.read',
  'connected_apps.create',
  'connected_apps.update',
  'connected_apps.delete',
  'connected_apps.*',

  // Playbook
  'playbook.read',
  'playbook.create',
  'playbook.update',
  'playbook.delete',
  'playbook.execute',
  'playbook.*',

  // Team Auto-Builder
  'team_auto_builder.read',
  'team_auto_builder.update',
  'team_auto_builder.*',

  // Worky (Chief of Staff) — Part 1
  'worky.stream.read',
  'worky.stream.write',
  'worky.stream.execute',
  'worky.interaction.respond',
  'worky.admin.governance',
  'worky.admin.trace',
  'worky.*',

  // Super Admin
  '*',
]);

/**
 * Validates if a permission string is valid.
 * Must be '*' or valid dot-notation registered in ALL_PERMISSIONS.
 */
export function isValidPermission(permission: string): boolean {
  if (permission === '*') return true;
  if (!/^[a-z_]+(\.[a-z_*]+)+$/.test(permission)) return false;
  return ALL_PERMISSIONS.has(permission);
}

/**
 * Validates an array of permissions.
 * Returns valid status and list of invalid permissions.
 */
export function validatePermissions(permissions: string[]): {
  valid: boolean;
  invalid: string[];
} {
  const invalid = permissions.filter((p) => !isValidPermission(p));
  return { valid: invalid.length === 0, invalid };
}

/**
 * Checks if user has a required permission using deep wildcard matching.
 *
 * Examples:
 * - hasPermission(['users.*'], 'users.read') → true
 * - hasPermission(['users.*'], 'users.roles.assign') → true
 * - hasPermission(['users.roles.*'], 'users.roles.assign') → true
 * - hasPermission(['users.roles.*'], 'users.read') → false
 */
export function hasPermission(userPerms: string[], required: string): boolean {
  // Super admin check
  if (userPerms.includes('*')) return true;

  // Direct match
  if (userPerms.includes(required)) return true;

  // Deep wildcard matching: check all parent wildcards
  // e.g., 'users.roles.assign' is matched by 'users.*' or 'users.roles.*'
  const parts = required.split('.');
  for (let i = 1; i < parts.length; i++) {
    const wildcardPath = parts.slice(0, i).join('.') + '.*';
    if (userPerms.includes(wildcardPath)) return true;
  }

  return false;
}

/**
 * Checks if user has all required permissions.
 */
export function hasAllPermissions(userPerms: string[], required: string[]): boolean {
  return required.every((p) => hasPermission(userPerms, p));
}

/**
 * Checks if user has any of the required permissions.
 */
export function hasAnyPermission(userPerms: string[], required: string[]): boolean {
  return required.some((p) => hasPermission(userPerms, p));
}
