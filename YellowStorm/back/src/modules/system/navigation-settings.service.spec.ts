import { BadRequestException } from '@nestjs/common';
import { DEFAULT_NAVIGATION_SETTINGS } from './interfaces/navigation-settings.interface';
import { NavigationSettingsService } from './navigation-settings.service';
import type { SystemSettingRow } from './persistence/system-setting.store';

describe('NavigationSettingsService', () => {
  const get = jest.fn<Promise<SystemSettingRow | null>, []>();
  const upsert = jest.fn<Promise<SystemSettingRow>, [string, unknown]>();
  const service = new NavigationSettingsService({ get, upsert } as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns the default tree when no setting exists', async () => {
    get.mockResolvedValue(null);
    await expect(service.getSettings()).resolves.toEqual(DEFAULT_NAVIGATION_SETTINGS);
  });

  it('falls back when a persisted tree is malformed', async () => {
    get.mockResolvedValue({
      key: 'navigation_settings',
      updatedAt: new Date(),
      value: { revision: 4, nodes: [{ ...DEFAULT_NAVIGATION_SETTINGS.nodes[0], parentId: 'missing' }] },
    });
    await expect(service.getSettings()).resolves.toEqual(DEFAULT_NAVIGATION_SETTINGS);
  });

  it('falls back when persisted node fields have invalid types', async () => {
    get.mockResolvedValue({
      key: 'navigation_settings',
      updatedAt: new Date(),
      value: { revision: 4, nodes: [{ ...DEFAULT_NAVIGATION_SETTINGS.nodes[0], visible: 'yes' }] },
    });
    await expect(service.getSettings()).resolves.toEqual(DEFAULT_NAVIGATION_SETTINGS);
  });

  it('restores a saved tree when Mongo stores omitted targets as null', async () => {
    const nodes = DEFAULT_NAVIGATION_SETTINGS.nodes.map((node) => (
      node.type === 'group' ? { ...node, targetKey: null } : { ...node }
    ));
    nodes[0].position = 9;
    get.mockResolvedValue({
      key: 'navigation_settings',
      updatedAt: new Date(),
      value: { revision: 2, nodes },
    });

    await expect(service.getSettings()).resolves.toEqual({
      revision: 2,
      nodes: DEFAULT_NAVIGATION_SETTINGS.nodes.map((node, index) => (
        index === 0 ? { ...node, position: 9, launcherVisible: true } : { ...node, launcherVisible: true }
      )),
    });
  });

  it('enables launcher items in saved trees created before launcher visibility existed', async () => {
    get.mockResolvedValue({
      key: 'navigation_settings',
      updatedAt: new Date(),
      value: { revision: 3, nodes: DEFAULT_NAVIGATION_SETTINGS.nodes },
    });

    const settings = await service.getSettings();
    expect(settings.nodes.every((node) => node.launcherVisible)).toBe(true);
  });

  it('rejects an omitted parent instead of persisting an unreachable node', async () => {
    const node = { ...DEFAULT_NAVIGATION_SETTINGS.nodes[0] } as any;
    delete node.parentId;
    await expect(service.updateSettings([node])).rejects.toThrow('Navigation parent must be explicit');
  });

  it('persists a valid rearranged tree with a new revision', async () => {
    get.mockResolvedValue(null);
    const nodes = DEFAULT_NAVIGATION_SETTINGS.nodes.map((node) => ({ ...node }));
    nodes[0].position = 9;

    const normalizedNodes = nodes.map((node) => ({ ...node, launcherVisible: true }));
    await expect(service.updateSettings(nodes)).resolves.toMatchObject({ revision: 2, nodes: normalizedNodes });
    expect(upsert).toHaveBeenCalledWith(
      'navigation_settings',
      { revision: 2, nodes: normalizedNodes },
    );
  });

  it('rejects duplicate targets and cyclic parents', async () => {
    const duplicate = DEFAULT_NAVIGATION_SETTINGS.nodes.map((node) => ({ ...node }));
    duplicate.find((node) => node.id === 'projects')!.targetKey = 'platform';
    await expect(service.updateSettings(duplicate)).rejects.toBeInstanceOf(BadRequestException);

    const cyclic = DEFAULT_NAVIGATION_SETTINGS.nodes.map((node) => ({ ...node }));
    cyclic.find((node) => node.id === 'ask')!.parentId = 'knowledge';
    cyclic.find((node) => node.id === 'knowledge')!.parentId = 'ask';
    await expect(service.updateSettings(cyclic)).rejects.toBeInstanceOf(BadRequestException);
  });
});
