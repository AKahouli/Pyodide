import type { ModuleTranslationKey } from '@/modules/localization/types';
import type { AppBuilderTab } from './types';

export const APP_BUILDER_TAB_LABEL_KEYS = {
  all: 'hub.status.all.label',
  deployed: 'hub.status.deployed.label',
  shared: 'hub.status.shared.label',
  draft: 'hub.status.draft.label',
} as const satisfies Record<AppBuilderTab, ModuleTranslationKey<'app-builder'>>;

export const APP_BUILDER_TAB_DESCRIPTION_KEYS = {
  all: 'hub.status.all.description',
  deployed: 'hub.status.deployed.description',
  shared: 'hub.status.shared.description',
  draft: 'hub.status.draft.description',
} as const satisfies Record<AppBuilderTab, ModuleTranslationKey<'app-builder'>>;

export const APP_BUILDER_TAB_EMPTY_KEYS = {
  all: 'hub.status.all.empty',
  deployed: 'hub.status.deployed.empty',
  shared: 'hub.status.shared.empty',
  draft: 'hub.status.draft.empty',
} as const satisfies Record<AppBuilderTab, ModuleTranslationKey<'app-builder'>>;

export const APP_BUILDER_TAB_LIST_HEADING_KEYS = {
  all: 'hub.status.all.listHeading',
  deployed: 'hub.status.deployed.listHeading',
  shared: 'hub.status.shared.listHeading',
  draft: 'hub.status.draft.listHeading',
} as const satisfies Record<AppBuilderTab, ModuleTranslationKey<'app-builder'>>;
