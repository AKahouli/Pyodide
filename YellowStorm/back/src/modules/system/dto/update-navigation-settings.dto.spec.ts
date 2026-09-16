import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateNavigationSettingsDto } from './update-navigation-settings.dto';

const node = {
  id: 'workspace',
  type: 'item',
  parentId: null,
  position: 0,
  visible: true,
  launcherVisible: true,
  labels: { en: 'Workspace', fr: 'Espaces de travail' },
  targetKey: 'workspace',
};

describe('UpdateNavigationSettingsDto', () => {
  it('requires an explicit parent value', async () => {
    const { parentId: _parentId, ...withoutParent } = node;
    const errors = await validate(plainToInstance(UpdateNavigationSettingsDto, { nodes: [withoutParent] }));
    expect(errors[0]?.children?.[0]?.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'parentId' }),
    ]));
  });

  it('accepts null for a root node parent', async () => {
    await expect(validate(plainToInstance(UpdateNavigationSettingsDto, { nodes: [node] }))).resolves.toEqual([]);
  });

  it('rejects a non-boolean launcher visibility', async () => {
    const errors = await validate(plainToInstance(UpdateNavigationSettingsDto, {
      nodes: [{ ...node, launcherVisible: 'yes' }],
    }));
    expect(errors[0]?.children?.[0]?.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'launcherVisible' }),
    ]));
  });
});
