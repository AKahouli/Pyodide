import type { ColorTheme } from '@/contexts/ThemeContext';

const COLOR_THEME_CLASSES = [
  'theme-default',
  'theme-yellow',
  'theme-orange',
  'theme-blue',
  'theme-yellowsys',
  'theme-claude',
  'theme-kpmg',
] as const;

export function applyColorThemeClass(colorTheme: ColorTheme): void {
  const root = globalThis.document.documentElement;
  root.classList.remove(...COLOR_THEME_CLASSES);
  if (colorTheme === 'yellow') {
    root.classList.add('theme-yellowsys');
  }
  if (colorTheme === 'orange') {
    root.classList.add('theme-claude');
  }
  if (colorTheme === 'blue') {
    root.classList.add('theme-kpmg');
  }
}
