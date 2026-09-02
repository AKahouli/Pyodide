import type { ColorTheme } from '@/contexts/ThemeContext';

export const THEME_PALETTES: Record<ColorTheme, { surface: string; sidebar: string; muted: string; primary: string; onPrimary: string }> = {
  default: {
    surface: 'oklch(0.98 0 0)',
    sidebar: 'oklch(0.94 0 0)',
    muted: 'oklch(0.908 0 0)',
    primary: 'oklch(0.205 0 0)',
    onPrimary: 'oklch(0.985 0 0)',
  },
  yellow: {
    surface: 'oklch(1 0 180)',
    sidebar: 'oklch(0.97 0.001 106.424)',
    muted: 'oklch(0.923 0.003 48.716)',
    primary: 'oklch(0.86 0.173 91.838)',
    onPrimary: 'oklch(0.285 0.064 53.823)',
  },
  orange: {
    surface: 'oklch(0.98 0.01 93.48)',
    sidebar: 'oklch(0.97 0.01 93.49)',
    muted: 'oklch(0.91 0.01 106.47)',
    primary: 'oklch(0.62 0.14 39.15)',
    onPrimary: 'oklch(1 0 0)',
  },
  blue: {
    surface: 'oklch(0.96 0.01 271.34)',
    sidebar: 'oklch(0.97 0 0)',
    muted: 'oklch(0.89 0.02 259.43)',
    primary: 'oklch(0.48 0.2 260.47)',
    onPrimary: 'oklch(1 0 0)',
  },
};
