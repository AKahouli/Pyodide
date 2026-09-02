import { COLOR_THEMES, type ColorTheme, type ThemeLogoValue } from '@/contexts/ThemeContext';
import { APPEARANCE_SETTINGS_UPDATED_EVENT, FALLBACK_LOGOS } from '../constants';
import type { AppearanceLogo, AppearanceSettings } from '@/modules/admin/types';
import { appearanceLogoSrc } from './logo-url';

export function notifyAppearanceSettingsUpdated(): void {
  window.dispatchEvent(new Event(APPEARANCE_SETTINGS_UPDATED_EVENT));
}

export function logosFromSettings(settings: AppearanceSettings): AppearanceLogo[] {
  const fromApi = settings.logos?.length ? settings.logos : FALLBACK_LOGOS;
  const builtins = FALLBACK_LOGOS.filter((item) => !fromApi.some((logo) => logo.id === item.id));
  return [...builtins, ...fromApi.filter((logo, index, all) => all.findIndex((entry) => entry.id === logo.id) === index)];
}

export function mapFromSettings(settings: AppearanceSettings): Record<ColorTheme, string> {
  return {
    default: settings.themes.default.logo,
    yellow: settings.themes.yellow.logo,
    orange: settings.themes.orange.logo,
    blue: settings.themes.blue.logo,
  };
}

export function logoMapForAllThemes(logoId: string): Record<ColorTheme, string> {
  return { default: logoId, yellow: logoId, orange: logoId, blue: logoId };
}

export function buildAppearanceSettings(
  defaultColorTheme: ColorTheme,
  logos: Record<ColorTheme, string>,
  catalog: AppearanceLogo[],
): AppearanceSettings {
  return {
    defaultColorTheme,
    logos: catalog,
    themes: {
      default: { labelKey: 'appearance.colorTheme.default', logo: logos.default },
      yellow: { labelKey: 'appearance.colorTheme.yellow', logo: logos.yellow },
      orange: { labelKey: 'appearance.colorTheme.orange', logo: logos.orange },
      blue: { labelKey: 'appearance.colorTheme.blue', logo: logos.blue },
    },
  };
}

export function replaceMissingLogos(map: Record<ColorTheme, string>, validIds: Set<string>): Record<ColorTheme, string> {
  const next = { ...map };
  for (const theme of COLOR_THEMES) {
    if (!validIds.has(next[theme.value])) {
      next[theme.value] = 'yellowmind';
    }
  }
  return next;
}

export function resolveThemeLogo(settings: AppearanceSettings | null, colorTheme: ColorTheme): ThemeLogoValue {
  const id = settings?.themes[colorTheme]?.logo ?? 'yellowmind';
  const entry = settings?.logos?.find((item) => item.id === id);
  return { id, url: entry ? appearanceLogoSrc(entry) : undefined };
}
