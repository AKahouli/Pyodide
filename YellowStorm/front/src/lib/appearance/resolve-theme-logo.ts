import type { ColorTheme, ThemeLogoValue } from '@/contexts/ThemeContext';
import type { AppearanceSettings } from '@/modules/admin/types';
import { appearanceLogoSrc } from './logo-url';

export function resolveThemeLogo(settings: AppearanceSettings | null, colorTheme: ColorTheme): ThemeLogoValue {
  const id = settings?.themes[colorTheme]?.logo ?? 'yellowmind';
  const entry = settings?.logos?.find((item) => item.id === id);
  return {
    id,
    url: entry ? appearanceLogoSrc(entry) : undefined,
    name: entry?.name,
  };
}
