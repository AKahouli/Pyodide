import { PlaybookFlowPromptTemplateService } from './playbook-flow-prompt-template.service';
import { DEFAULT_FLOW_PROMPTS } from './playbook-flow-prompt-seed';
import type { PromptTemplateRecord } from '../persistence/prompt-template.repository';

const userId = '507f1f77bcf86cd799439011';

function record(overrides: Partial<PromptTemplateRecord> = {}): PromptTemplateRecord {
  return {
    id: '6a272d051f4e6f361ed9846d', key: 'custom.prompt', title: 'Custom', category: 'misc', description: null,
    systemTemplate: 'sys', userTemplate: 'usr', enabled: true, version: 1, isBuiltIn: false, createdBy: null, updatedBy: null,
    createdAt: new Date('2026-05-16T00:00:00.000Z'), updatedAt: new Date('2026-05-16T00:00:00.000Z'),
    ...overrides,
  };
}

/** Every seed key present at its seed version: nothing to seed. */
const seeded = () => DEFAULT_FLOW_PROMPTS.map((item) => ({ key: item.key, version: item.version, isBuiltIn: true }));

function makeRepository(overrides: Record<string, jest.Mock> = {}) {
  return {
    findVersions: jest.fn().mockResolvedValue(seeded()),
    isEmpty: jest.fn().mockResolvedValue(false),
    insertMissing: jest.fn().mockResolvedValue(0),
    upgradeBuiltIn: jest.fn().mockResolvedValue(true),
    list: jest.fn().mockResolvedValue([]),
    findByKey: jest.fn().mockResolvedValue(null),
    upsertByKey: jest.fn(),
    deleteByKey: jest.fn().mockResolvedValue(true),
    replaceAll: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('PlaybookFlowPromptTemplateService', () => {
  it('seeds every built-in prompt into an empty catalogue', async () => {
    const repository = makeRepository({ findVersions: jest.fn().mockResolvedValue([]), isEmpty: jest.fn().mockResolvedValue(true) });
    const service = new PlaybookFlowPromptTemplateService(repository as any);

    await service.findAll();

    expect(repository.insertMissing).toHaveBeenCalledWith(DEFAULT_FLOW_PROMPTS.map((item) => ({ ...item, createdBy: null, updatedBy: null })));
    expect(repository.upgradeBuiltIn).not.toHaveBeenCalled();
  });

  it('never re-seeds a catalogue that is not empty, and upgrades only older built-in prompts', async () => {
    const [first, second, third] = DEFAULT_FLOW_PROMPTS;
    const versions = [
      { key: first.key, version: first.version - 1, isBuiltIn: true },
      { key: second.key, version: second.version - 1, isBuiltIn: false },
      { key: third.key, version: third.version, isBuiltIn: true },
    ];
    const repository = makeRepository({ findVersions: jest.fn().mockResolvedValue(versions) });
    const service = new PlaybookFlowPromptTemplateService(repository as any);

    await service.findByKey(first.key);

    expect(repository.insertMissing).not.toHaveBeenCalled();
    expect(repository.upgradeBuiltIn).toHaveBeenCalledTimes(1);
    expect(repository.upgradeBuiltIn).toHaveBeenCalledWith(first);
  });

  it('upserts by the trimmed key and passes the edit through, texts left out staying undefined', async () => {
    const repository = makeRepository({ upsertByKey: jest.fn().mockResolvedValue(record({ version: 2 })) });
    const service = new PlaybookFlowPromptTemplateService(repository as any);

    const response = await service.upsert(' custom.prompt ', { title: ' Custom ', category: 'misc', userTemplate: 'u' }, userId);

    expect(repository.upsertByKey).toHaveBeenCalledWith('custom.prompt', {
      title: 'Custom', category: 'misc', description: '', systemTemplate: undefined, userTemplate: 'u', enabled: undefined,
    }, userId);
    expect(response).toMatchObject({ key: 'custom.prompt', version: 2, createdAt: '2026-05-16T00:00:00.000Z' });
    expect(response.description).toBeUndefined();
    await expect(service.upsert(' ', { title: 't', category: 'c' }, userId)).rejects.toThrow('Prompt key is required');
    await expect(service.upsert('k', { title: 'x'.repeat(161), category: 'c' }, userId)).rejects.toThrow('title must be at most 160 characters');
  });

  it('builds the overrides payload from the enabled prompts', async () => {
    const repository = makeRepository({ list: jest.fn().mockResolvedValue([record()]) });
    const service = new PlaybookFlowPromptTemplateService(repository as any);

    const payload = await service.getPromptOverridesPayload();

    expect(repository.list).toHaveBeenCalledWith({ enabledOnly: true });
    expect(JSON.parse(payload['custom.prompt'])).toMatchObject({ key: 'custom.prompt', systemTemplate: 'sys' });
  });

  it('deletes a custom prompt, refuses a built-in one and reports a missing one', async () => {
    const repository = makeRepository();
    const service = new PlaybookFlowPromptTemplateService(repository as any);

    expect(await service.remove('missing')).toBe(false);
    repository.findByKey.mockResolvedValueOnce(record({ isBuiltIn: true }));
    await expect(service.remove('custom.prompt')).rejects.toThrow('Cannot delete built-in prompt templates');
    repository.findByKey.mockResolvedValueOnce(record());
    expect(await service.remove('custom.prompt')).toBe(true);
    expect(repository.deleteByKey).toHaveBeenCalledTimes(1);
  });

  it('replaces the catalogue and refuses duplicate keys', async () => {
    const repository = makeRepository({ list: jest.fn().mockResolvedValue([record()]) });
    const service = new PlaybookFlowPromptTemplateService(repository as any);
    const item = { key: ' a ', title: 'A', category: 'c' };

    await expect(service.replaceAll({ version: 1, type: 'playbook-prompts', items: [item, { ...item, key: 'a' }] }, userId))
      .rejects.toThrow('Import contains duplicate prompt keys');
    const result = await service.replaceAll({ version: 1, type: 'playbook-prompts', items: [item] }, userId);

    expect(repository.replaceAll).toHaveBeenCalledWith([{
      key: 'a', title: 'A', category: 'c', description: '', systemTemplate: '', userTemplate: '', enabled: true,
      version: 1, isBuiltIn: false, createdBy: userId, updatedBy: userId,
    }]);
    expect(result.items).toHaveLength(1);
  });
});
