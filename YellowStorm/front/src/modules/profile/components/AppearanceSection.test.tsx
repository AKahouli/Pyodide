import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppearanceSection } from './AppearanceSection';

const changeLanguageMock = vi.fn();
const themeContextValue = vi.hoisted(() => ({
  theme: 'light',
  setTheme: vi.fn(),
  colorTheme: 'default',
  setColorTheme: vi.fn(),
}));

vi.mock('@/contexts/ThemeContext', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    ThemeProviderContext: React.createContext(themeContextValue),
    COLOR_THEMES: [
      { value: 'default' },
      { value: 'yellow' },
      { value: 'orange' },
    ],
  };
});

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
  useLocalization: () => ({
    language: 'en',
    availableLanguages: ['en', 'fr'],
    changeLanguage: changeLanguageMock,
  }),
}));

vi.mock('@/components/ui/separator', () => ({ Separator: () => <div>sep</div> }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({
    user: { appearance: { colorTheme: 'default' } },
  }),
}));

vi.mock('../api', () => ({
  updateAppearance: vi.fn().mockResolvedValue({ appearance: { colorTheme: 'default' } }),
  updateLanguage: vi.fn().mockResolvedValue({}),
}));

describe('AppearanceSection', () => {
  it('changes theme and color theme on click', () => {
    render(<AppearanceSection />);

    fireEvent.click(screen.getByText('appearance.theme.light'));
    fireEvent.click(screen.getByText('appearance.colorTheme.default'));

    expect(themeContextValue.setTheme).toHaveBeenCalledWith('light');
    expect(themeContextValue.setColorTheme).toHaveBeenCalledWith('default');
  });
});
