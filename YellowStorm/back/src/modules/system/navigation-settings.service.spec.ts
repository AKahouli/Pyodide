import { BadRequestException } from '@nestjs/common';
import { DEFAULT_NAVIGATION_SETTINGS } from './interfaces/navigation-settings.interface';
import { NavigationSettingsService } from './navigation-settings.service';

describe('NavigationSettingsService', () => {
  const findOne = jest.fn();
  const findOneAndUpdate = jest.fn();
  const service = new NavigationSettingsService({ findOne, findOneAndUpdate } as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns the default tree when no setting exists', async () => {
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
    await expect(service.getSettings()).resolves.toEqual(DEFAULT_NAVIGATION_SETTINGS);
  });

  it('falls back when a persisted tree is malformed', async () => {
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({
      value: { revision: 4, nodes: [{ ...DEFAULT_NAVIGATION_SETTINGS.nodes[0], parentId: 'missing' }] },
    }) }) });
    await expect(service.getSettings()).resolves.toEqual(DEFAULT_NAVIGATION_SETTINGS);
  });

  it('falls back when persisted node fields have invalid types', async () => {
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({
      value: { revision: 4, nodes: [{ ...DEFAULT_NAVIGATION_SETTINGS.nodes[0], visible: 'yes' }] },
    }) }) });
    await expect(service.getSettings()).resolves.toEqual(DEFAULT_NAVIGATION_SETTINGS);
  });

  it('restores a saved tree when Mongo stores omitted targets as null', async () => {
    const nodes = DEFAULT_NAVIGATION_SETTINGS.nodes.map((node) => (
      node.type === 'group' ? { ...node, targetKey: null } : { ...node }
    ));
    nodes[0].position = 9;
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue({
      value: { revision: 2, nodes },
    }) }) });

    await expect(service.getSettings()).resolves.toEqual({
      revision: 2,
      nodes: DEFAULT_NAVIGATION_SETTINGS.nodes.map((node, index) => (
        index === 0 ? { ...node, position: 9 } : { ...node }
      )),
    });
  });

  it('rejects an omitted parent instead of persisting an unreachable node', async () => {
    const node = { ...DEFAULT_NAVIGATION_SETTINGS.nodes[0] } as any;
    delete node.parentId;
    await expect(service.updateSettings([node])).rejects.toThrow('Navigation parent must be explicit');
  });

  it('persists a valid rearranged tree with a new revision', async () => {
    findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
    findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
    const nodes = DEFAULT_NAVIGATION_SETTINGS.nodes.map((node) => ({ ...node }));
    nodes[0].position = 9;

    await expect(service.updateSettings(nodes)).resolves.toMatchObject({ revision: 2, nodes });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'navigation_settings' },
      { key: 'navigation_settings', value: { revision: 2, nodes } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
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
