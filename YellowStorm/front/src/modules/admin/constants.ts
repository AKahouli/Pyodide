/**
 * Admin Module Constants
 */

import { Users, Shield, FileText, CreditCard, BarChart3, Settings, ScrollText, Flag, Cpu, Wrench, Puzzle, Bot, KeyRound, Plug, Cable, Palette, Sparkles, FolderCog, Wand2, MessageSquare, Gauge, Network } from 'lucide-react';
import type { AdminMenuItem } from './types';
import type { FeatureVisibility } from './types';
import type { ModuleTranslationKey } from '@/modules/localization';

export const DEFAULT_FEATURE_VISIBILITY: FeatureVisibility = Object.freeze({
  conversation: true,
  workspace: true,
  playbook: true,
  governance: true,
  appBuilder: true,
  worky: true,
  agents: true,
  semanticModel: true,
  platformCopilot: false,
  playbookDevtools: false,
  playbookDeltaAutosave: true,
  playbookMcpAssistant: true,
  playbookMcpConnectorReconciliation: true,
  governedConversations: true,
  governanceScopeAudience: true,
  governedScopeCarousel: true,
  dataRoomDecisionFlows: true,
  dataRoomGovernance: true,
  dataRoomSourceVersioning: true,
  dataRoomWorkspaceEvents: true,
  dataRoomAutoSourceCreation: true,
  dataRoomOutboxDispatch: true,
  dataRoomValidityIntelligence: true,
  dataRoomKnowledgeAssessment: true,
});

export const FEATURE_SETTING_ITEMS: {
  key: keyof FeatureVisibility;
  group: 'playbook' | 'governance' | 'workspace';
  labelKey: ModuleTranslationKey<'admin'>;
  descriptionKey: ModuleTranslationKey<'admin'>;
}[] = [
  { key: 'playbookDevtools', group: 'playbook', labelKey: 'system.features.items.playbookDevtools.label', descriptionKey: 'system.features.items.playbookDevtools.description' },
  { key: 'playbookDeltaAutosave', group: 'playbook', labelKey: 'system.features.items.playbookDeltaAutosave.label', descriptionKey: 'system.features.items.playbookDeltaAutosave.description' },
  { key: 'playbookMcpAssistant', group: 'playbook', labelKey: 'system.features.items.playbookMcpAssistant.label', descriptionKey: 'system.features.items.playbookMcpAssistant.description' },
  { key: 'playbookMcpConnectorReconciliation', group: 'playbook', labelKey: 'system.features.items.playbookMcpConnectorReconciliation.label', descriptionKey: 'system.features.items.playbookMcpConnectorReconciliation.description' },
  { key: 'governedConversations', group: 'governance', labelKey: 'system.features.items.governedConversations.label', descriptionKey: 'system.features.items.governedConversations.description' },
  { key: 'governanceScopeAudience', group: 'governance', labelKey: 'system.features.items.governanceScopeAudience.label', descriptionKey: 'system.features.items.governanceScopeAudience.description' },
  { key: 'governedScopeCarousel', group: 'governance', labelKey: 'system.features.items.governedScopeCarousel.label', descriptionKey: 'system.features.items.governedScopeCarousel.description' },
  { key: 'dataRoomDecisionFlows', group: 'workspace', labelKey: 'system.features.items.dataRoomDecisionFlows.label', descriptionKey: 'system.features.items.dataRoomDecisionFlows.description' },
  { key: 'dataRoomGovernance', group: 'workspace', labelKey: 'system.features.items.dataRoomGovernance.label', descriptionKey: 'system.features.items.dataRoomGovernance.description' },
  { key: 'dataRoomSourceVersioning', group: 'workspace', labelKey: 'system.features.items.dataRoomSourceVersioning.label', descriptionKey: 'system.features.items.dataRoomSourceVersioning.description' },
  { key: 'dataRoomWorkspaceEvents', group: 'workspace', labelKey: 'system.features.items.dataRoomWorkspaceEvents.label', descriptionKey: 'system.features.items.dataRoomWorkspaceEvents.description' },
  { key: 'dataRoomAutoSourceCreation', group: 'workspace', labelKey: 'system.features.items.dataRoomAutoSourceCreation.label', descriptionKey: 'system.features.items.dataRoomAutoSourceCreation.description' },
  { key: 'dataRoomOutboxDispatch', group: 'workspace', labelKey: 'system.features.items.dataRoomOutboxDispatch.label', descriptionKey: 'system.features.items.dataRoomOutboxDispatch.description' },
  { key: 'dataRoomValidityIntelligence', group: 'workspace', labelKey: 'system.features.items.dataRoomValidityIntelligence.label', descriptionKey: 'system.features.items.dataRoomValidityIntelligence.description' },
  { key: 'dataRoomKnowledgeAssessment', group: 'workspace', labelKey: 'system.features.items.dataRoomKnowledgeAssessment.label', descriptionKey: 'system.features.items.dataRoomKnowledgeAssessment.description' },
];

export const FEATURE_PERMISSION_ITEMS: {
  key: keyof FeatureVisibility;
  permission: string;
  labelKey: ModuleTranslationKey<'admin'>;
  descriptionKey: ModuleTranslationKey<'admin'>;
}[] = [
  { key: 'conversation', permission: 'feature.conversation', labelKey: 'system.features.items.conversation.label', descriptionKey: 'system.features.items.conversation.description' },
  { key: 'workspace', permission: 'feature.workspace', labelKey: 'system.features.items.workspace.label', descriptionKey: 'system.features.items.workspace.description' },
  { key: 'playbook', permission: 'feature.playbook', labelKey: 'system.features.items.playbook.label', descriptionKey: 'system.features.items.playbook.description' },
  { key: 'governance', permission: 'feature.governance', labelKey: 'system.features.items.governance.label', descriptionKey: 'system.features.items.governance.description' },
  { key: 'appBuilder', permission: 'feature.app_marketplace', labelKey: 'system.features.items.appBuilder.label', descriptionKey: 'system.features.items.appBuilder.description' },
  { key: 'worky', permission: 'feature.worky', labelKey: 'system.features.items.worky.label', descriptionKey: 'system.features.items.worky.description' },
  { key: 'agents', permission: 'feature.agents', labelKey: 'system.features.items.agents.label', descriptionKey: 'system.features.items.agents.description' },
  { key: 'semanticModel', permission: 'feature.semantic_model', labelKey: 'system.features.items.semanticModel.label', descriptionKey: 'system.features.items.semanticModel.description' },
  { key: 'platformCopilot', permission: 'feature.platform_copilot', labelKey: 'system.features.items.platformCopilot.label', descriptionKey: 'system.features.items.platformCopilot.description' },
];

export const MENU_PERMISSION_ITEMS = [
  { key: 'platform', permission: 'menu.platform', labelKey: 'roles.permissions.menus.platform', depth: 0 },
  { key: 'ask', permission: 'menu.ask', labelKey: 'roles.permissions.menus.ask', depth: 0 },
  { key: 'newChat', permission: 'menu.new_chat', labelKey: 'roles.permissions.menus.newChat', depth: 1, parent: 'ask' },
  { key: 'projects', permission: 'menu.projects', labelKey: 'roles.permissions.menus.projects', depth: 1, parent: 'ask' },
  { key: 'history', permission: 'menu.history', labelKey: 'roles.permissions.menus.history', depth: 1, parent: 'ask' },
  { key: 'knowledge', permission: 'menu.knowledge', labelKey: 'roles.permissions.menus.knowledge', depth: 0 },
  { key: 'workspace', permission: 'menu.workspace', labelKey: 'roles.permissions.menus.workspace', depth: 1, parent: 'knowledge' },
  { key: 'semanticModels', permission: 'menu.semantic_models', labelKey: 'roles.permissions.menus.semanticModels', depth: 1, parent: 'knowledge' },
  { key: 'automate', permission: 'menu.automate', labelKey: 'roles.permissions.menus.automate', depth: 0 },
  { key: 'playbook', permission: 'menu.playbook', labelKey: 'roles.permissions.menus.playbook', depth: 1, parent: 'automate' },
  { key: 'agentNetwork', permission: 'menu.agent_network', labelKey: 'roles.permissions.menus.agentNetwork', depth: 1, parent: 'automate' },
  { key: 'agents', permission: 'menu.agents', labelKey: 'roles.permissions.menus.agents', depth: 2, parent: 'agentNetwork' },
  { key: 'teams', permission: 'menu.teams', labelKey: 'roles.permissions.menus.teams', depth: 2, parent: 'agentNetwork' },
  { key: 'groups', permission: 'menu.groups', labelKey: 'roles.permissions.menus.groups', depth: 2, parent: 'agentNetwork' },
  { key: 'worky', permission: 'menu.worky', labelKey: 'roles.permissions.menus.worky', depth: 1, parent: 'automate' },
  { key: 'integrations', permission: 'menu.integrations', labelKey: 'roles.permissions.menus.integrations', depth: 1, parent: 'automate' },
  { key: 'connectedApps', permission: 'menu.connected_apps', labelKey: 'roles.permissions.menus.connectedApps', depth: 2, parent: 'integrations' },
  { key: 'appMarketplace', permission: 'menu.app_marketplace', labelKey: 'roles.permissions.menus.appMarketplace', depth: 2, parent: 'integrations' },
  { key: 'govern', permission: 'menu.govern', labelKey: 'roles.permissions.menus.govern', depth: 0 },
  { key: 'governance', permission: 'menu.governance', labelKey: 'roles.permissions.menus.governance', depth: 1, parent: 'govern' },
  { key: 'admin', permission: 'menu.admin', labelKey: 'roles.permissions.menus.admin', depth: 1, parent: 'govern' },
] as const satisfies readonly {
  key: string;
  permission: string;
  labelKey: ModuleTranslationKey<'admin'>;
  depth: number;
  parent?: string;
}[];

export type MenuPermissionKey = (typeof MENU_PERMISSION_ITEMS)[number]['key'];

export function getMenuBranchPermissions(key: string): string[] {
  const branchKeys = new Set([key]);
  let added = true;
  while (added) {
    added = false;
    for (const item of MENU_PERMISSION_ITEMS) {
      if ('parent' in item && branchKeys.has(item.parent) && !branchKeys.has(item.key)) {
        branchKeys.add(item.key);
        added = true;
      }
    }
  }
  return MENU_PERMISSION_ITEMS.filter((item) => branchKeys.has(item.key)).map((item) => item.permission);
}

// Admin menu items with their required permissions
export const ADMIN_MENU_ITEMS: AdminMenuItem[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    labelKey: 'appearance.title',
    path: '/admin/appearance',
    icon: Palette,
    permissions: ['system.maintenance', 'system.registration', 'system.*', '*'],
    description: 'Configure colors and logos',
    descriptionKey: 'appearance.description',
  },
  {
    id: 'users',
    label: 'Users',
    labelKey: 'menu.users.label',
    path: '/admin/users',
    icon: Users,
    permissions: ['users.read', 'users.*', '*'],
    description: 'Manage user accounts',
    descriptionKey: 'menu.users.description',
  },
  {
    id: 'roles',
    label: 'Roles',
    labelKey: 'menu.roles.label',
    path: '/admin/roles',
    icon: Shield,
    permissions: ['admin.roles.read', 'admin.*', '*'],
    description: 'Configure roles and permissions',
    descriptionKey: 'menu.roles.description',
  },
  {
    id: 'auth-providers',
    label: 'Auth Providers',
    labelKey: 'menu.authProviders.label',
    path: '/admin/auth-providers',
    icon: KeyRound,
    permissions: ['auth_providers.read', 'auth_providers.*', '*'],
    description: 'Manage OAuth authentication providers',
    descriptionKey: 'menu.authProviders.description',
  },
  {
    id: 'connected-apps',
    label: 'Connected Apps',
    labelKey: 'menu.connectedApps.label',
    path: '/admin/connected-apps',
    icon: Plug,
    permissions: ['connected_apps.read', 'connected_apps.*', '*'],
    description: 'Manage external app integrations',
    descriptionKey: 'menu.connectedApps.description',
  },
  {
    id: 'audit',
    label: 'Audit Logs',
    labelKey: 'menu.audit.label',
    path: '/admin/audit',
    icon: FileText,
    permissions: ['admin.audit.read', 'admin.*', '*'],
    description: 'View system audit logs',
    descriptionKey: 'menu.audit.description',
  },
  {
    id: 'logs',
    label: 'System Logs',
    labelKey: 'menu.logs.label',
    path: '/admin/logs',
    icon: ScrollText,
    permissions: ['admin.logs.read', 'admin.*', '*'],
    description: 'View application logs',
    descriptionKey: 'menu.logs.description',
  },
  {
    id: 'plans',
    label: 'Plans',
    labelKey: 'menu.plans.label',
    path: '/admin/plans',
    icon: CreditCard,
    permissions: ['plans.read_all', 'plans.*', '*'],
    description: 'Manage subscription plans',
    descriptionKey: 'menu.plans.description',
  },
  {
    id: 'app-builder-ai',
    label: 'App Builder AI',
    labelKey: 'menu.appBuilderAi.label',
    path: '/admin/app-builder-ai',
    icon: Sparkles,
    permissions: ['app_builder_ai.read', 'app_builder_ai.manage', 'app_builder_ai.*', '*'],
    description: 'Control App Builder AI access, offers, and usage',
    descriptionKey: 'menu.appBuilderAi.description',
  },
  {
    id: 'reports',
    label: 'Reports',
    labelKey: 'menu.reports.label',
    path: '/admin/reports',
    icon: Flag,
    permissions: ['reports.read', 'reports.*', '*'],
    description: 'View and manage reported messages',
    descriptionKey: 'menu.reports.description',
  },
  {
    id: 'models',
    label: 'Models',
    labelKey: 'menu.models.label',
    path: '/admin/models',
    icon: Cpu,
    permissions: ['models.read_all', 'models.*', '*'],
    description: 'Manage AI models',
    descriptionKey: 'menu.models.description',
  },
  {
    id: 'guardrails',
    label: 'Guardrails',
    labelKey: 'menu.guardrails.label',
    path: '/admin/guardrails',
    icon: Shield,
    permissions: ['admin.*', '*'],
    description: 'Configure global agent guardrails',
    descriptionKey: 'menu.guardrails.description',
  },
  {
    id: 'evaluation-settings',
    label: 'Evaluation settings',
    labelKey: 'menu.evaluationSettings.label',
    path: '/admin/evaluation-settings',
    icon: Gauge,
    permissions: ['admin.*', '*'],
    description: 'Configure runtime answer reliability evaluation',
    descriptionKey: 'menu.evaluationSettings.description',
  },
  {
    id: 'semantic-model-settings',
    label: 'Semantic models',
    labelKey: 'menu.semanticModelSettings.label',
    path: '/admin/semantic-model-settings',
    icon: Network,
    permissions: ['admin.*', '*'],
    description: 'Set how documents are read into semantic models',
    descriptionKey: 'menu.semanticModelSettings.description',
  },
  {
    id: 'agent-types',
    label: 'Agent Types',
    labelKey: 'menu.agentTypes.label',
    path: '/admin/agent-types',
    icon: Puzzle,
    permissions: ['agent_types.read', 'agent_types.*', '*'],
    description: 'Manage agent type configurations',
    descriptionKey: 'menu.agentTypes.description',
  },
  {
    id: 'agents',
    label: 'Default Agents',
    labelKey: 'menu.agents.label',
    path: '/admin/agents',
    icon: Bot,
    permissions: ['agents.read', 'agents.*', '*'],
    description: 'Manage default agents',
    descriptionKey: 'menu.agents.description',
  },
  {
    id: 'playbook-prompts',
    label: 'Playbook Prompts',
    labelKey: 'menu.playbookPrompts.label',
    path: '/admin/playbook-prompts',
    icon: FileText,
    permissions: ['admin.*', '*'],
    description: 'Manage playbook prompt templates',
    descriptionKey: 'menu.playbookPrompts.description',
  },
  {
    id: 'playbook-settings',
    label: 'Playbook Settings',
    labelKey: 'menu.playbookSettings.label',
    path: '/admin/playbook-settings',
    icon: Sparkles,
    permissions: ['system.maintenance', 'system.*', '*'],
    description: 'Manage playbook AI inference settings',
    descriptionKey: 'menu.playbookSettings.description',
  },
  {
    id: 'platform-settings',
    label: 'Platform Settings',
    labelKey: 'menu.platformSettings.label',
    path: '/admin/platform-settings',
    icon: Settings,
    permissions: ['system.*', '*'],
    description: 'Manage rate limiting, session and upload limits, and export/import configuration',
    descriptionKey: 'menu.platformSettings.description',
  },
  {
    id: 'workspace-settings',
    label: 'Workspace Settings',
    labelKey: 'menu.workspaceSettings.label',
    path: '/admin/workspace-settings',
    icon: FolderCog,
    permissions: ['workspaces.*', '*'],
    description: 'Manage workspace upload policies',
    descriptionKey: 'menu.workspaceSettings.description',
  },
  {
    id: 'conversation-settings',
    label: 'Conversation Settings',
    labelKey: 'menu.conversationSettings.label',
    path: '/admin/conversation-settings',
    icon: MessageSquare,
    permissions: ['conversations.settings.manage', 'conversations.*', '*'],
    description: 'Manage conversation behavior',
    descriptionKey: 'menu.conversationSettings.description',
  },
  {
    id: 'tools',
    label: 'Tools',
    labelKey: 'menu.tools.label',
    path: '/admin/tools',
    icon: Wrench,
    permissions: ['tools.read', 'tools.*', '*'],
    description: 'Manage agent tools',
    descriptionKey: 'menu.tools.description',
  },
  {
    id: 'skills',
    label: 'Skills',
    labelKey: 'menu.skills.label',
    path: '/admin/skills',
    icon: Wrench,
    permissions: ['skills.read', 'skills.*', '*'],
    description: 'Manage agent skills',
    descriptionKey: 'menu.skills.description',
  },
  {
    id: 'connectors',
    label: 'Connectors',
    labelKey: 'menu.connectors.label',
    path: '/admin/connectors',
    icon: Cable,
    permissions: ['connectors.read', 'connectors.*', '*'],
    description: 'Manage MCP connector catalog',
    descriptionKey: 'menu.connectors.description',
  },
  {
    id: 'analytics',
    label: 'Analytics',
    labelKey: 'menu.analytics.label',
    path: '/admin/analytics',
    icon: BarChart3,
    permissions: ['analytics.read', 'analytics.*', '*'],
    description: 'View platform analytics',
    descriptionKey: 'menu.analytics.description',
  },
  {
    id: 'team-auto-builder',
    label: 'Team Auto-Builder',
    labelKey: 'menu.teamAutoBuilder.label',
    path: '/admin/team-auto-builder',
    icon: Wand2,
    permissions: ['team_auto_builder.read', 'team_auto_builder.*', '*'],
    description: 'Configure AI team generation',
    descriptionKey: 'menu.teamAutoBuilder.description',
  },
  {
    id: 'system',
    label: 'System',
    labelKey: 'menu.system.label',
    path: '/admin/system',
    icon: Settings,
    permissions: ['system.maintenance', 'system.registration', 'system.*', '*'],
    description: 'System settings and maintenance',
    descriptionKey: 'menu.system.description',
  },
];

// Permissions that grant admin panel access — derived from menu items
// Any permission that grants access to a menu item also grants admin panel entry
export const ADMIN_ACCESS_PERMISSIONS = [...new Set(ADMIN_MENU_ITEMS.flatMap((item) => item.permissions))];
