import type { ColorTheme } from '@/contexts/ThemeContext';
import type { AppearanceLogo } from '@/modules/admin/types';

export const APPEARANCE_SETTINGS_UPDATED_EVENT = 'yellowstorm:appearance-updated';

export const FALLBACK_LOGOS: AppearanceLogo[] = [
  { id: 'yellowmind', name: 'Yellowmind', kind: 'builtin' },
  { id: 'kpmg', name: 'KPMG', kind: 'builtin' },
];

export const DEFAULT_LOGO_MAP: Record<ColorTheme, string> = {
  default: 'yellowmind',
  yellow: 'yellowmind',
  orange: 'yellowmind',
  blue: 'kpmg',
};
