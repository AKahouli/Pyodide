import type { ColorTheme } from '@/contexts/ThemeContext';
import type { AppearanceLogo } from '@/modules/admin/types';

export { APPEARANCE_SETTINGS_UPDATED_EVENT } from '@/lib/appearance';

export const FALLBACK_LOGOS: AppearanceLogo[] = [
  { id: 'yellowmind', name: 'Yellowmind', kind: 'builtin' },
  { id: 'kpmg', name: 'KPMG', kind: 'builtin' },
];

export const DEFAULT_LOGO_MAP: Record<ColorTheme, string> = {
  default: 'yellowmind',
  yellow: 'yellowmind',
  orange: 'kpmg',
  blue: 'kpmg',
};
