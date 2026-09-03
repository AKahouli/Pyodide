import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import { renderWithProviders } from '@/test/renderWithProviders';
import { AppearancePage } from './AppearancePage';
import { getAppearanceSettings, setAppearanceSettings } from '../api';
import type { AppearanceSettings } from '../types';

const { refreshUserMock, useAuthMock } = vi.hoisted(() => {
  const refreshUser = vi.fn().mockResolvedValue(undefined);
  const user = { id: 'admin', appearance: { colorTheme: 'default' as const } };
  return {
    refreshUserMock: refreshUser,
    useAuthMock: vi.fn(() => ({
      isAuthenticated: true,
      user,
      refreshUser,
    })),
  };
});
const translateMock = vi.hoisted(() => (key: string) => key);
vi.mock('@/modules/auth/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return { ...actual, useModuleTranslation: () => ({ t: translateMock, ready: true, language: 'en' }) };
});
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('../api', () => ({
  getAppearanceSettings: vi.fn(),
  setAppearanceSettings: vi.fn(),
  createAppearanceLogo: vi.fn(),
  updateAppearanceLogo: vi.fn(),
  deleteAppearanceLogo: vi.fn(),
}));

const settings: AppearanceSettings = {
  defaultColorTheme: 'default',
  logos: [
    { id: 'yellowmind', name: 'Yellowmind', kind: 'builtin' },
    { id: 'kpmg', name: 'KPMG', kind: 'builtin' },
  ],
  themes: {
    default: { labelKey: 'appearance.colorTheme.default', logo: 'yellowmind' },
    yellow: { labelKey: 'appearance.colorTheme.yellow', logo: 'yellowmind' },
    orange: { labelKey: 'appearance.colorTheme.orange', logo: 'yellowmind' },
    blue: { labelKey: 'appearance.colorTheme.blue', logo: 'kpmg' },
  },
};

describe('AppearancePage', () => {
  beforeEach(() => {
    vi.mocked(getAppearanceSettings).mockReset();
    vi.mocked(setAppearanceSettings).mockReset();
    refreshUserMock.mockReset();
    refreshUserMock.mockResolvedValue(undefined);
    vi.mocked(getAppearanceSettings).mockResolvedValue(settings);
    vi.mocked(setAppearanceSettings).mockResolvedValue(settings);
  });

  it('renders color themes as palettes without logos', async () => {
    renderWithProviders(<AppearancePage />);

    const group = await screen.findByRole('radiogroup', { name: 'appearance.colorTheme.label' });
    expect(within(group).getByRole('radio', { name: 'appearance.colorTheme.default' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'appearance.colorTheme.yellow' })).toBeInTheDocument();
    expect(within(group).queryByText('Yellowmind')).not.toBeInTheDocument();
    expect(within(group).queryByText('KPMG')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'appearance.actions.applyToAll' })).toBeDisabled();
  });

  it('does not persist before settings have loaded', async () => {
    vi.mocked(getAppearanceSettings).mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<AppearancePage />);

    expect(screen.getAllByText('appearance.actions.loading').length).toBeGreaterThan(0);
    expect(screen.queryByRole('radio', { name: 'Yellowmind' })).not.toBeInTheDocument();
    expect(setAppearanceSettings).not.toHaveBeenCalled();
  });

  it('shows retry instead of the catalog when load fails', async () => {
    vi.mocked(getAppearanceSettings).mockRejectedValue(new Error('unavailable'));
    renderWithProviders(<AppearancePage />);

    expect(await screen.findByRole('button', { name: 'appearance.actions.retry' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Yellowmind' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'appearance.logo.upload' })).not.toBeInTheDocument();
    expect(setAppearanceSettings).not.toHaveBeenCalled();
  });

  it('applies the selected color theme globally', async () => {
    const nextSettings: AppearanceSettings = { ...settings, defaultColorTheme: 'yellow' };
    vi.mocked(setAppearanceSettings).mockResolvedValue(nextSettings);

    const { user } = renderWithProviders(<AppearancePage />);
    const yellow = await screen.findByRole('radio', { name: 'appearance.colorTheme.yellow' });
    await user.click(yellow);

    const apply = screen.getByRole('button', { name: 'appearance.actions.applyToAll' });
    expect(apply).toBeEnabled();
    await user.click(apply);

    await waitFor(() => {
      expect(setAppearanceSettings).toHaveBeenCalledWith(
        {
          defaultColorTheme: 'yellow',
          logos: settings.logos,
          themes: settings.themes,
        },
        { applyToAllUsers: true },
      );
    });
    expect(refreshUserMock).toHaveBeenCalled();
    expect(document.documentElement.classList.contains('theme-yellowsys')).toBe(true);
  });

  it('shows the logo library and upload action', async () => {
    renderWithProviders(<AppearancePage />);
    expect(await screen.findByRole('button', { name: 'appearance.logo.upload' })).toBeInTheDocument();
    expect(screen.getByText('appearance.logo.library')).toBeInTheDocument();
    expect(screen.queryByText('appearance.logo.mapping')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'appearance.actions.saveLogo' })).not.toBeInTheDocument();
    expect(await screen.findByRole('radio', { name: 'Yellowmind' })).toBeChecked();
  });

  it('applies a selected logo to every color theme immediately without applying palettes to all users', async () => {
    const nextSettings: AppearanceSettings = {
      ...settings,
      themes: {
        default: { ...settings.themes.default, logo: 'kpmg' },
        yellow: { ...settings.themes.yellow, logo: 'kpmg' },
        orange: { ...settings.themes.orange, logo: 'kpmg' },
        blue: { ...settings.themes.blue, logo: 'kpmg' },
      },
    };
    vi.mocked(setAppearanceSettings).mockResolvedValue(nextSettings);

    const { user } = renderWithProviders(<AppearancePage />);
    await user.click(await screen.findByRole('radio', { name: 'KPMG' }));

    await waitFor(() => {
      expect(setAppearanceSettings).toHaveBeenCalledWith(
        {
          defaultColorTheme: 'default',
          logos: settings.logos,
          themes: nextSettings.themes,
        },
        { applyToAllUsers: false },
      );
    });
    expect(screen.getByRole('radio', { name: 'KPMG' })).toBeChecked();
  });

  it('does not persist when the active logo is clicked again', async () => {
    const { user } = renderWithProviders(<AppearancePage />);
    await user.click(await screen.findByRole('radio', { name: 'Yellowmind' }));
    expect(setAppearanceSettings).not.toHaveBeenCalled();
  });
});
