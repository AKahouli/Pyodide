import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { DEFAULT_NAVIGATION_SETTINGS } from '../navigation';
import { getNavigationSettings, updateNavigationSettings } from '../api';
import { moveBefore, NavigationSettingsCard, validParentGroups } from './NavigationSettingsCard';

vi.mock('../api', () => ({
  getNavigationSettings: vi.fn(),
  updateNavigationSettings: vi.fn(),
}));

vi.mock('@/modules/auth/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 'admin' } }),
}));

const translateMock = vi.hoisted(() => (key: string) => key);
vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return { ...actual, useModuleTranslation: () => ({ t: translateMock, ready: true, language: 'en' }) };
});

describe('NavigationSettingsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getNavigationSettings).mockResolvedValue(structuredClone(DEFAULT_NAVIGATION_SETTINGS));
    vi.mocked(updateNavigationSettings).mockImplementation(async (value) => ({ ...value, revision: value.revision + 1 }));
  });

  it('creates and saves a localized submenu', async () => {
    const { user } = renderWithProviders(<NavigationSettingsCard />);
    await user.click(await screen.findByRole('button', { name: 'appearance.navigation.addSubmenu' }));
    const englishName = screen.getByDisplayValue('New submenu');
    await user.clear(englishName);
    await user.type(englishName, 'Operations');
    await user.click(screen.getByRole('button', { name: 'appearance.navigation.save' }));

    await waitFor(() => expect(updateNavigationSettings).toHaveBeenCalled());
    const submitted = vi.mocked(updateNavigationSettings).mock.calls[0][0];
    expect(submitted.nodes).toContainEqual(expect.objectContaining({
      type: 'group',
      labels: { en: 'Operations', fr: 'Nouveau sous-menu' },
    }));
  });

  it('excludes descendant and depth-invalid parent groups', () => {
    const build = DEFAULT_NAVIGATION_SETTINGS.nodes.find((node) => node.id === 'build')!;
    const nodes = [
      ...DEFAULT_NAVIGATION_SETTINGS.nodes,
      { id: 'deep-parent', type: 'group' as const, parentId: 'ask', position: 2, visible: true, labels: { en: 'Deep', fr: 'Profond' } },
    ];
    const ids = validParentGroups(nodes, build).map((node) => node.id);

    expect(ids).not.toContain('knowledge');
    expect(ids).not.toContain('deep-parent');
    expect(ids).toContain('ask');
  });

  it('moves a dragged node before its drop target', () => {
    const nodes = moveBefore(DEFAULT_NAVIGATION_SETTINGS.nodes, 'build', 'work');
    expect(nodes.find((node) => node.id === 'build')?.position).toBe(0);
    expect(nodes.find((node) => node.id === 'work')?.position).toBe(1);
  });

  it('saves launcher visibility independently', async () => {
    const { user } = renderWithProviders(<NavigationSettingsCard />);
    await user.click(await screen.findByRole('switch', { name: 'appearance.navigation.launcher: Work' }));
    await user.click(screen.getByRole('button', { name: 'appearance.navigation.save' }));

    await waitFor(() => expect(updateNavigationSettings).toHaveBeenCalled());
    const submitted = vi.mocked(updateNavigationSettings).mock.calls[0][0];
    expect(submitted.nodes.find((node) => node.id === 'work')?.launcherVisible).toBe(false);
    expect(submitted.nodes.find((node) => node.id === 'work')?.visible).toBe(true);
  });
});
