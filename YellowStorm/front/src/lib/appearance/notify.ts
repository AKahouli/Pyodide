import type { AppearanceSettings } from '@/modules/admin/types';
import { APPEARANCE_SETTINGS_UPDATED_EVENT } from './event';

export function notifyAppearanceSettingsUpdated(settings?: AppearanceSettings): void {
  window.dispatchEvent(new CustomEvent(APPEARANCE_SETTINGS_UPDATED_EVENT, { detail: settings }));
}
