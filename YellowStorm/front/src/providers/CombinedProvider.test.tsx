import { useContext, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CombinedProvider } from './CombinedProvider';
import { ThemeProviderContext } from '@/contexts/ThemeContext';
import { APPEARANCE_SETTINGS_UPDATED_EVENT } from '@/lib/appearance';
import type { AppearanceSettings } from '@/modules/admin/types';

const getGlobalAppearanceSettings = vi.hoisted(() => vi.fn());

vi.mock('@/modules/auth/api', () => ({
  getGlobalAppearanceSettings,
}));

vi.mock('@/modules/auth', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: 'admin', appearance: { colorTheme: 'yellow' as const } },
  }),
}));

vi.mock('@/modules/localization', () => ({
  LocalizationProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/modules/playbook/query/queryProvider', () => ({
  PlaybookQueryProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/modules/notifications', () => ({
  NotificationsProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/modules/usage/UsageContext', () => ({
  UsageProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/modules/profile', () => ({
  SettingsModalProvider: ({ children }: { children: ReactNode }) => children,
}));

const globalSettings: AppearanceSettings = {
  defaultColorTheme: 'default',
  logos: [
    { id: 'yellowmind', name: 'Yellowmind', kind: 'builtin' },
    { id: 'kpmg', name: 'KPMG', kind: 'builtin' },
  ],
  themes: {
    default: { labelKey: 'appearance.colorTheme.default', logo: 'yellowmind' },
    yellow: { labelKey: 'appearance.colorTheme.yellow', logo: 'yellowmind' },
    orange: { labelKey: 'appearance.colorTheme.orange', logo: 'kpmg' },
    blue: { labelKey: 'appearance.colorTheme.blue', logo: 'kpmg' },
  },
};

function ThemeProbe() {
  const { colorTheme } = useContext(ThemeProviderContext);
  return <div data-testid='color-theme'>{colorTheme}</div>;
}

describe('CombinedProvider appearance sync', () => {
  beforeEach(() => {
    getGlobalAppearanceSettings.mockReset();
    getGlobalAppearanceSettings.mockResolvedValue(globalSettings);
    document.documentElement.className = '';
  });

  it('keeps the authenticated user palette when global appearance syncs', async () => {
    render(
      <CombinedProvider>
        <ThemeProbe />
      </CombinedProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('color-theme')).toHaveTextContent('yellow');
    });
    expect(document.documentElement.classList.contains('theme-yellowsys')).toBe(true);

    window.dispatchEvent(new CustomEvent(APPEARANCE_SETTINGS_UPDATED_EVENT, { detail: globalSettings }));

    await waitFor(() => {
      expect(screen.getByTestId('color-theme')).toHaveTextContent('yellow');
    });
    expect(document.documentElement.classList.contains('theme-yellowsys')).toBe(true);
    expect(document.documentElement.classList.contains('theme-kpmg')).toBe(false);
  });
});
