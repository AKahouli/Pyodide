export const NAVIGATION_TARGET_KEYS = [
  'platform',
  'newChat',
  'projects',
  'history',
  'workspace',
  'semanticModels',
  'playbook',
  'agents',
  'teams',
  'groups',
  'worky',
  'connectedApps',
  'appMarketplace',
  'governance',
  'admin',
] as const;

export type NavigationTargetKey = (typeof NAVIGATION_TARGET_KEYS)[number];

export interface NavigationLabels {
  en: string;
  fr: string;
}

export interface NavigationNode {
  id: string;
  type: 'group' | 'item';
  parentId: string | null;
  position: number;
  visible: boolean;
  labels: NavigationLabels;
  targetKey?: NavigationTargetKey;
}

export interface NavigationSettings {
  revision: number;
  nodes: NavigationNode[];
}

export const DEFAULT_NAVIGATION_SETTINGS: NavigationSettings = {
  revision: 1,
  nodes: [
    { id: 'work', type: 'group', parentId: null, position: 0, visible: true, labels: { en: 'Work', fr: 'Travail' } },
    { id: 'platform', type: 'item', parentId: 'work', position: 0, visible: true, labels: { en: 'Overview', fr: "Vue d'ensemble" }, targetKey: 'platform' },
    { id: 'projects', type: 'item', parentId: 'work', position: 1, visible: true, labels: { en: 'Projects', fr: 'Projets' }, targetKey: 'projects' },
    { id: 'build', type: 'group', parentId: null, position: 1, visible: true, labels: { en: 'Build', fr: 'Creation' } },
    { id: 'knowledge', type: 'group', parentId: 'build', position: 0, visible: true, labels: { en: 'Knowledge', fr: 'Connaissances' } },
    { id: 'workspace', type: 'item', parentId: 'knowledge', position: 0, visible: true, labels: { en: 'Workspace', fr: 'Espaces de travail' }, targetKey: 'workspace' },
    { id: 'semantic-models', type: 'item', parentId: 'knowledge', position: 1, visible: true, labels: { en: 'Business models', fr: 'Modeles metier' }, targetKey: 'semanticModels' },
    { id: 'agents', type: 'item', parentId: 'build', position: 1, visible: true, labels: { en: 'Agents & teams', fr: 'Agents & equipes' }, targetKey: 'agents' },
    { id: 'playbook', type: 'item', parentId: 'build', position: 2, visible: true, labels: { en: 'Playbooks', fr: 'Playbooks' }, targetKey: 'playbook' },
    { id: 'worky', type: 'item', parentId: 'build', position: 3, visible: true, labels: { en: 'Worky', fr: 'Worky' }, targetKey: 'worky' },
    { id: 'connected-apps', type: 'item', parentId: 'build', position: 4, visible: true, labels: { en: 'Integrations', fr: 'Integrations' }, targetKey: 'connectedApps' },
    { id: 'role-only', type: 'group', parentId: null, position: 2, visible: false, labels: { en: 'Additional access', fr: 'Acces supplementaire' } },
    { id: 'teams', type: 'item', parentId: 'role-only', position: 0, visible: false, labels: { en: 'Teams', fr: 'Equipes' }, targetKey: 'teams' },
    { id: 'groups', type: 'item', parentId: 'role-only', position: 1, visible: false, labels: { en: 'Groups', fr: 'Groupes' }, targetKey: 'groups' },
    { id: 'app-marketplace', type: 'item', parentId: 'role-only', position: 2, visible: false, labels: { en: 'App marketplace', fr: "Marketplace d'applications" }, targetKey: 'appMarketplace' },
    { id: 'ask', type: 'group', parentId: null, position: 3, visible: true, labels: { en: 'Ask', fr: 'Interroger' } },
    { id: 'new-chat', type: 'item', parentId: 'ask', position: 0, visible: true, labels: { en: 'New chat', fr: 'Nouvelle discussion' }, targetKey: 'newChat' },
    { id: 'history', type: 'item', parentId: 'ask', position: 1, visible: true, labels: { en: 'History', fr: 'Historique' }, targetKey: 'history' },
    { id: 'govern', type: 'group', parentId: null, position: 4, visible: true, labels: { en: 'Govern', fr: 'Gouverner' } },
    { id: 'governance', type: 'item', parentId: 'govern', position: 0, visible: true, labels: { en: 'Governance', fr: 'Gouvernance' }, targetKey: 'governance' },
    { id: 'admin', type: 'item', parentId: 'govern', position: 1, visible: true, labels: { en: 'Administration', fr: 'Administration' }, targetKey: 'admin' },
  ],
};
