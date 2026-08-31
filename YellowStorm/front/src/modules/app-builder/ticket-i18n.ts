import type { ModuleTranslationKey } from '@/modules/localization/types';
import type { AppBuilderTab } from './types';

export const APP_BUILDER_TAB_LABEL_KEYS = {
  deployed: 'hub.tickets.deployed.label',
  shared: 'hub.tickets.shared.label',
  draft: 'hub.tickets.draft.label',
} as const satisfies Record<AppBuilderTab, ModuleTranslationKey<'app-builder'>>;

export const APP_BUILDER_TAB_DESCRIPTION_KEYS = {
  deployed: 'hub.tickets.deployed.description',
  shared: 'hub.tickets.shared.description',
  draft: 'hub.tickets.draft.description',
} as const satisfies Record<AppBuilderTab, ModuleTranslationKey<'app-builder'>>;

export const APP_BUILDER_TAB_EMPTY_KEYS = {
  deployed: 'hub.tickets.deployed.empty',
  shared: 'hub.tickets.shared.empty',
  draft: 'hub.tickets.draft.empty',
} as const satisfies Record<AppBuilderTab, ModuleTranslationKey<'app-builder'>>;

export const APP_BUILDER_TAB_LIST_HEADING_KEYS = {
  deployed: 'hub.tickets.deployed.listHeading',
  shared: 'hub.tickets.shared.listHeading',
  draft: 'hub.tickets.draft.listHeading',
} as const satisfies Record<AppBuilderTab, ModuleTranslationKey<'app-builder'>>;
