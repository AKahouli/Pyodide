import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/renderWithProviders';
import { AppearancePage } from './AppearancePage';
import {
  deleteAppearanceLogo,
  deleteEmailLogo,
  getAppearanceSettings,
  getEmailLogo,
  setAppearanceSettings,
  uploadEmailLogo,
} from '../api';
import type { AppearanceSettings, EmailLogo } from '../types';

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
const { showErrorMock, showSuccessMock } = vi.hoisted(() => ({
  showErrorMock: vi.fn(),
  showSuccessMock: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ showError: showErrorMock, showSuccess: showSuccessMock }));
vi.mock('../api', () => ({
  getAppearanceSettings: vi.fn(),
  setAppearanceSettings: vi.fn(),
  createAppearanceLogo: vi.fn(),
  updateAppearanceLogo: vi.fn(),
  deleteAppearanceLogo: vi.fn(),
  getEmailLogo: vi.fn(),
  uploadEmailLogo: vi.fn(),
  deleteEmailLogo: vi.fn(),
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

const logo: EmailLogo = {
  filename: 'brand.png',
  contentType: 'image/png',
  size: 42,
  updatedAt: '2026-09-06T00:00:00.000Z',
  dataUri: 'data:image/png;base64,ZmFrZQ==',
};

describe('AppearancePage', () => {
  beforeEach(() => {
    vi.mocked(getAppearanceSettings).mockReset();
    vi.mocked(setAppearanceSettings).mockReset();
    vi.mocked(getEmailLogo).mockReset();
    vi.mocked(uploadEmailLogo).mockReset();
    vi.mocked(deleteEmailLogo).mockReset();
    vi.mocked(deleteAppearanceLogo).mockReset();
    showErrorMock.mockReset();
    showSuccessMock.mockReset();
    refreshUserMock.mockReset();
    refreshUserMock.mockResolvedValue(undefined);
    vi.mocked(getAppearanceSettings).mockResolvedValue(settings);
    vi.mocked(setAppearanceSettings).mockResolvedValue(settings);
    vi.mocked(getEmailLogo).mockResolvedValue(null);
    vi.mocked(uploadEmailLogo).mockResolvedValue(logo);
    vi.mocked(deleteEmailLogo).mockResolvedValue(undefined);
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

  it('shows the no-logo placeholder when no custom email logo is set', async () => {
    renderWithProviders(<AppearancePage />);
    await waitFor(() => expect(getEmailLogo).toHaveBeenCalled());
    expect((await screen.findAllByText('appearance.emailLogo.none')).length).toBeGreaterThan(0);
  });

  it('uploads a selected file and displays the new logo', async () => {
    const { user } = renderWithProviders(<AppearancePage />);
    await waitFor(() => expect(getEmailLogo).toHaveBeenCalled());

    const file = new File(['fake'], 'brand.png', { type: 'image/png' });
    const chooseButton = await screen.findByRole('button', { name: 'appearance.emailLogo.chooseFile' });
    await user.click(chooseButton);

    const input = screen.getByLabelText('appearance.emailLogo.chooseFile');
    await user.upload(input, file);

    const saveButton = await screen.findByRole('button', { name: 'appearance.emailLogo.actions.save' });
    await user.click(saveButton);

    await waitFor(() => expect(uploadEmailLogo).toHaveBeenCalledWith(file));
    await waitFor(() => expect(showSuccessMock).toHaveBeenCalled());
    expect(screen.getByRole('img', { name: 'brand.png' })).toBeInTheDocument();
  });

  it('removes the email logo', async () => {
    vi.mocked(getEmailLogo).mockResolvedValue(logo);
    const { user } = renderWithProviders(<AppearancePage />);

    const removeButton = await screen.findByRole('button', {
      name: 'appearance.emailLogo.actions.remove',
    });
    await user.click(removeButton);

    await waitFor(() => expect(deleteEmailLogo).toHaveBeenCalled());
    await waitFor(() => expect(showSuccessMock).toHaveBeenCalled());
    expect((await screen.findAllByText('appearance.emailLogo.none')).length).toBeGreaterThan(0);
  });
});
