import type { FeatureVisibility, NavigationSettings, NavigationTargetKey } from './types';

export const NAVIGATION_TARGETS: Record<NavigationTargetKey, {
  permission: string;
  path: string;
  defaultLabels: { en: string; fr: string; ar?: string };
  feature?: keyof FeatureVisibility;
}> = {
  platform: { permission: 'menu.platform', path: '/platform', defaultLabels: { en: 'Overview', fr: "Vue d'ensemble", ar: 'نظرة عامة' } },
  newChat: { permission: 'menu.new_chat', path: '/', defaultLabels: { en: 'New chat', fr: 'Nouvelle discussion', ar: 'محادثة جديدة' }, feature: 'conversation' },
  projects: { permission: 'menu.projects', path: '/', defaultLabels: { en: 'Projects', fr: 'Projets', ar: 'المشاريع' } },
  history: { permission: 'menu.history', path: '/chats', defaultLabels: { en: 'History', fr: 'Historique', ar: 'السجل' } },
  workspace: { permission: 'menu.workspace', path: '/workspace', defaultLabels: { en: 'Workspace', fr: 'Espaces de travail', ar: 'مساحة العمل' }, feature: 'workspace' },
  semanticModels: { permission: 'menu.semantic_models', path: '/semantic-models', defaultLabels: { en: 'Business models', fr: 'Modeles metier', ar: 'نماذج الأعمال' }, feature: 'semanticModel' },
  playbook: { permission: 'menu.playbook', path: '/playbooks', defaultLabels: { en: 'Playbooks', fr: 'Playbooks', ar: 'Playbooks' }, feature: 'playbook' },
  agents: { permission: 'menu.agents', path: '/agents', defaultLabels: { en: 'Agents', fr: 'Agents', ar: 'الوكلاء' }, feature: 'agents' },
  teams: { permission: 'menu.teams', path: '/teams', defaultLabels: { en: 'Teams', fr: 'Equipes', ar: 'الفرق' } },
  groups: { permission: 'menu.groups', path: '/groups', defaultLabels: { en: 'Groups', fr: 'Groupes', ar: 'المجموعات' } },
  worky: { permission: 'menu.worky', path: '/worky', defaultLabels: { en: 'Worky', fr: 'Worky', ar: 'Worky' }, feature: 'worky' },
  connectedApps: { permission: 'menu.connected_apps', path: '/apps', defaultLabels: { en: 'Connected apps', fr: 'Applications connectees', ar: 'التطبيقات المتصلة' } },
  appMarketplace: { permission: 'menu.app_marketplace', path: '/app-market', defaultLabels: { en: 'App marketplace', fr: "Marketplace d'applications", ar: 'متجر التطبيقات' }, feature: 'appBuilder' },
  governance: { permission: 'menu.governance', path: '/governance', defaultLabels: { en: 'Governance', fr: 'Gouvernance', ar: 'الحوكمة' }, feature: 'governance' },
  admin: { permission: 'menu.admin', path: '/admin', defaultLabels: { en: 'Administration', fr: 'Administration', ar: 'الإدارة' } },
};

export const DEFAULT_NAVIGATION_SETTINGS: NavigationSettings = {
  revision: 1,
  nodes: [
    { id: 'work', type: 'group', parentId: null, position: 0, visible: true, labels: { en: 'Work', fr: 'Travail', ar: 'العمل' } },
    { id: 'platform', type: 'item', parentId: 'work', position: 0, visible: true, labels: NAVIGATION_TARGETS.platform.defaultLabels, targetKey: 'platform' },
    { id: 'projects', type: 'item', parentId: 'work', position: 1, visible: true, labels: NAVIGATION_TARGETS.projects.defaultLabels, targetKey: 'projects' },
    { id: 'build', type: 'group', parentId: null, position: 1, visible: true, labels: { en: 'Build', fr: 'Creation', ar: 'البناء' } },
    { id: 'knowledge', type: 'group', parentId: 'build', position: 0, visible: true, labels: { en: 'Knowledge', fr: 'Connaissances', ar: 'المعرفة' } },
    { id: 'workspace', type: 'item', parentId: 'knowledge', position: 0, visible: true, labels: NAVIGATION_TARGETS.workspace.defaultLabels, targetKey: 'workspace' },
    { id: 'semantic-models', type: 'item', parentId: 'knowledge', position: 1, visible: true, labels: NAVIGATION_TARGETS.semanticModels.defaultLabels, targetKey: 'semanticModels' },
    { id: 'agents', type: 'item', parentId: 'build', position: 1, visible: true, labels: { en: 'Agents & teams', fr: 'Agents & equipes', ar: 'الوكلاء والفرق' }, targetKey: 'agents' },
    { id: 'playbook', type: 'item', parentId: 'build', position: 2, visible: true, labels: NAVIGATION_TARGETS.playbook.defaultLabels, targetKey: 'playbook' },
    { id: 'worky', type: 'item', parentId: 'build', position: 3, visible: true, labels: NAVIGATION_TARGETS.worky.defaultLabels, targetKey: 'worky' },
    { id: 'connected-apps', type: 'item', parentId: 'build', position: 4, visible: true, labels: { en: 'Integrations', fr: 'Integrations', ar: 'التكاملات' }, targetKey: 'connectedApps' },
    { id: 'role-only', type: 'group', parentId: null, position: 2, visible: false, labels: { en: 'Additional access', fr: 'Acces supplementaire', ar: 'صلاحيات إضافية' } },
    { id: 'teams', type: 'item', parentId: 'role-only', position: 0, visible: false, labels: NAVIGATION_TARGETS.teams.defaultLabels, targetKey: 'teams' },
    { id: 'groups', type: 'item', parentId: 'role-only', position: 1, visible: false, labels: NAVIGATION_TARGETS.groups.defaultLabels, targetKey: 'groups' },
    { id: 'app-marketplace', type: 'item', parentId: 'role-only', position: 2, visible: false, labels: NAVIGATION_TARGETS.appMarketplace.defaultLabels, targetKey: 'appMarketplace' },
    { id: 'ask', type: 'group', parentId: null, position: 3, visible: true, labels: { en: 'Ask', fr: 'Interroger', ar: 'اسأل' } },
    { id: 'new-chat', type: 'item', parentId: 'ask', position: 0, visible: true, labels: NAVIGATION_TARGETS.newChat.defaultLabels, targetKey: 'newChat' },
    { id: 'history', type: 'item', parentId: 'ask', position: 1, visible: true, labels: NAVIGATION_TARGETS.history.defaultLabels, targetKey: 'history' },
    { id: 'govern', type: 'group', parentId: null, position: 4, visible: true, labels: { en: 'Govern', fr: 'Gouverner', ar: 'الحوكمة' } },
    { id: 'governance', type: 'item', parentId: 'govern', position: 0, visible: true, labels: NAVIGATION_TARGETS.governance.defaultLabels, targetKey: 'governance' },
    { id: 'admin', type: 'item', parentId: 'govern', position: 1, visible: true, labels: NAVIGATION_TARGETS.admin.defaultLabels, targetKey: 'admin' },
  ],
};

export function sortNavigationNodes(settings: NavigationSettings, parentId: string | null) {
  return settings.nodes
    .filter((node) => node.parentId === parentId)
    .sort((left, right) => left.position - right.position);
}

export function flattenNavigationNodes(settings: NavigationSettings): Array<{ node: NavigationSettings['nodes'][number]; depth: number }> {
  const rows: Array<{ node: NavigationSettings['nodes'][number]; depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const node of sortNavigationNodes(settings, parentId)) {
      rows.push({ node, depth });
      if (node.type === 'group') visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

export function navigationLabel(labels: { en: string; fr: string; ar?: string }, language: string): string {
  if (language === 'fr') return labels.fr || labels.en;
  if (language === 'ar') return labels.ar || labels.en;
  return labels.en;
}

/**
 * Stored navigation settings predate Arabic and admins save en/fr labels only,
 * so inject the default Arabic label whenever a node has none. Admin-customized
 * en/fr text is preserved; ceiling: a truly custom concept gets the default
 * Arabic label of its target until admins can author Arabic labels.
 */
export function withDefaultArabicLabels(settings: NavigationSettings): NavigationSettings {
  return {
    ...settings,
    nodes: settings.nodes.map((node) => {
      if (node.labels.ar) return node;
      const defaultLabels = node.targetKey
        ? NAVIGATION_TARGETS[node.targetKey]?.defaultLabels
        : DEFAULT_NAVIGATION_SETTINGS.nodes.find((candidate) => candidate.id === node.id)?.labels;
      return defaultLabels?.ar ? { ...node, labels: { ...node.labels, ar: defaultLabels.ar } } : node;
    }),
  };
}

export function findNavigationTarget(settings: NavigationSettings, targetKey: NavigationTargetKey) {
  return settings.nodes.find((node) => node.targetKey === targetKey);
}

export function isNavigationNodeVisible(settings: NavigationSettings, id: string, placement: 'sidebar' | 'launcher' = 'sidebar'): boolean {
  const byId = new Map(settings.nodes.map((node) => [node.id, node]));
  let node = byId.get(id);
  while (node) {
    if (placement === 'sidebar' ? !node.visible : node.launcherVisible === false) return false;
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return true;
}

export function visibleNavigationItems(settings: NavigationSettings, placement: 'sidebar' | 'launcher' = 'sidebar') {
  return flattenNavigationNodes(settings)
    .map(({ node }) => node)
    .filter((node) => node.type === 'item' && node.targetKey && isNavigationNodeVisible(settings, node.id, placement));
}
