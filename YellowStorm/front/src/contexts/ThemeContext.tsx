import { createContext, useEffect, useState } from 'react';

export const COLOR_THEMES = [
  { value: 'default', labelKey: 'appearance.colorTheme.default' },
  { value: 'yellow', labelKey: 'appearance.colorTheme.yellow' },
  { value: 'orange', labelKey: 'appearance.colorTheme.orange' },
  { value: 'blue', labelKey: 'appearance.colorTheme.blue' },
] as const;

export type ColorTheme = (typeof COLOR_THEMES)[number]['value'];

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: string;
  defaultColorTheme?: ColorTheme;
  initialColorTheme?: ColorTheme;
};

export type ThemeProviderState = {
  theme: string;
  setTheme: (theme: string) => void;
  colorTheme: ColorTheme;
  setColorTheme: (colorTheme: ColorTheme) => void;
  colorThemeLabels: Record<ColorTheme, string>;
};

const COLOR_THEME_LABELS: Record<ColorTheme, string> = {
  default: 'Original',
  yellow: 'Jaune',
  orange: 'Orange',
  blue: 'Bleu',
};

const initialState: ThemeProviderState = {
  theme: 'dark',
  setTheme: () => null,
  colorTheme: 'default',
  setColorTheme: () => null,
  colorThemeLabels: COLOR_THEME_LABELS,
};

export const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({ children, defaultTheme = 'dark', defaultColorTheme = 'default', initialColorTheme, ...props }: ThemeProviderProps) {
  const [theme, setTheme] = useState(() => localStorage.getItem('ui-theme') ?? defaultTheme);
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => {
    const storedColorTheme = localStorage.getItem('ui-color-theme') as ColorTheme | null;
    return storedColorTheme ?? initialColorTheme ?? defaultColorTheme;
  });

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('theme-default', 'theme-yellow', 'theme-orange', 'theme-blue', 'theme-yellowsys', 'theme-claude', 'theme-kpmg');
    if (colorTheme === 'yellow') root.classList.add('theme-yellowsys');
    if (colorTheme === 'orange') root.classList.add('theme-claude');
    if (colorTheme === 'blue') root.classList.add('theme-kpmg');
    localStorage.setItem('ui-color-theme', colorTheme);
  }, [colorTheme]);

  return (
    <ThemeProviderContext.Provider
      {...props}
      value={{
        theme,
        setTheme: (nextTheme: string) => {
          localStorage.setItem('ui-theme', nextTheme);
          setTheme(nextTheme);
        },
        colorTheme,
        setColorTheme,
        colorThemeLabels: COLOR_THEME_LABELS,
      }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}
