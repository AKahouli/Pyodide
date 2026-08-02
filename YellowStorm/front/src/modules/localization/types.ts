import type { NAMESPACES, SUPPORTED_LANGUAGES } from './constants';
import type common from './locales/en/common.json';
import type errors from './locales/en/errors.json';
import type admin from '../admin/locales/en.json';
import type agent from '../agent/locales/en.json';
import type appMarketplace from '../app-marketplace/locales/en.json';
import type auth from '../auth/locales/en.json';
import type connectedApp from '../connected-app/locales/en.json';
import type conversation from '../conversation/locales/en.json';
import type conversationV2 from '../conversation-v2/locales/en.json';
import type fileViewer from '../file-viewer/locales/en.json';
import type governance from '../governance/locales/en.json';
import type groups from '../groups/locales/en.json';
import type models from '../models/locales/en.json';
import type notifications from '../notifications/locales/en.json';
import type platformOverview from '../platform-overview/locales/en.json';
import type playbook from '../playbook/locales/en.json';
import type profile from '../profile/locales/en.json';
import type semanticModel from '../semantic-model/locales/en.json';
import type sidebar from '../sidebar/locales/en.json';
import type team from '../team/locales/en.json';
import type usage from '../usage/locales/en.json';
import type workspace from '../workspace/locales/en.json';
import type worky from '../worky/locales/en.json';

export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export type Namespace = (typeof NAMESPACES)[number];

export type NamespaceResourceMap = {
  common: typeof common;
  errors: typeof errors;
  admin: typeof admin;
  agent: typeof agent;
  'app-marketplace': typeof appMarketplace;
  auth: typeof auth;
  'connected-app': typeof connectedApp;
  conversation: typeof conversation;
  'conversation-v2': typeof conversationV2;
  'file-viewer': typeof fileViewer;
  governance: typeof governance;
  groups: typeof groups;
  models: typeof models;
  notifications: typeof notifications;
  'platform-overview': typeof platformOverview;
  playbook: typeof playbook;
  profile: typeof profile;
  'semantic-model': typeof semanticModel;
  sidebar: typeof sidebar;
  team: typeof team;
  usage: typeof usage;
  workspace: typeof workspace;
  worky: typeof worky;
};

type Keys<T> = Extract<keyof T, string>;

export type PluralForms = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

type FlattenKeys<T> = T extends object
  ? {
      [K in Keys<T>]:
        T[K] extends string | number | boolean
          ? K
          : T[K] extends PluralForms
          ? K
          : T[K] extends object
          ? `${K}.${FlattenKeys<T[K]>}`
          : never;
    }[Keys<T>]
  : never;

export type NamespaceKeyMap = {
  [K in keyof NamespaceResourceMap]: FlattenKeys<NamespaceResourceMap[K]>;
};

export type TranslationKey = {
  [K in keyof NamespaceKeyMap]: NamespaceKeyMap[K] extends never
    ? never
    : `${K & string}.${NamespaceKeyMap[K]}`
}[keyof NamespaceKeyMap];

export type ModuleTranslationKey<N extends Namespace> = NamespaceKeyMap[N];

export type TranslationEntry = string | PluralForms;
export type TranslationDictionary = Record<string, TranslationEntry>;

export type TranslationParams = Record<string, string | number | boolean | null | undefined> & {
  count?: number;
};

export type TranslationFunction = (key: TranslationKey, params?: TranslationParams) => string;

export interface LocalizationContextValue {
  language: Language;
  availableLanguages: Language[];
  isReady: boolean;
  isLoading: boolean;
  t: TranslationFunction;
  changeLanguage: (lang: Language) => Promise<void>;
  ensureNamespaces: (namespaces: Namespace | Namespace[]) => Promise<void>;
  loadedNamespaces: Record<Language, Partial<Record<Namespace, boolean>>>;
}
