import { SemanticMappingPresetService } from './semantic-mapping-preset.service';

const fields = [
  { sourceField: null, targetAttribute: 'date', mode: 'extract' as const, extractionStrategy: 'deterministic' as const,
    rules: { labels: ['Date de création'], location: 'after_label' as const, transform: 'no_spaces' as const } },
];
const row = { id: 'p-1', conceptId: 'c-1', name: 'Fiches BPCE', description: null, fieldMappings: fields, aiSettings: {}, identityFields: [], updatedAt: new Date('2026-10-02T00:00:00.000Z') };

describe('SemanticMappingPresetService', () => {
  const setup = (rows: unknown[] = [row], error?: unknown) => {
    const database = { query: jest.fn(async () => { if (error) throw error; return { rows, rowCount: rows.length }; }) };
    const models = {
      requireRole: jest.fn(async () => ({ id: 'model' })),
      requireActiveRole: jest.fn(async () => ({ id: 'model' })),
    };
    const documents = { findByIds: jest.fn(async () => [{ id: 'doc-1', originalName: 'FP_LIGNE.pdf' }]) };
    return { service: new SemanticMappingPresetService(database as never, models as never, documents as never), database, models, documents };
  };
  const dto = { conceptId: 'c-1', name: '  Fiches BPCE ', fieldMappings: fields, aiSettings: { maxBlocks: 80, junk: 1 } as never };

  it('saves a named copy of the rules, reading modes and AI limits, keeping only what decides the reading', async () => {
    const { service, database, models } = setup();
    const preset = await service.save('user', 'model', { ...dto, fieldMappings: [{ ...fields[0], validated: true } as never] });
    expect(models.requireActiveRole).toHaveBeenCalledWith('user', 'model', ['owner', 'editor']);
    expect(preset).toMatchObject({ id: 'p-1', updatedAt: '2026-10-02T00:00:00.000Z' });
    const [sql, params] = database.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('INSERT INTO semantic_model.mapping_presets');
    expect(params.slice(0, 5)).toEqual(['model', 'c-1', 'Fiches BPCE', null, JSON.stringify(fields)]);
    expect(params[5]).toBe(JSON.stringify({ maxBlocks: 80 }));
    expect(params[8]).toBe(50);
  });

  it('refuses a duplicate name and a full list', async () => {
    await expect(setup([], { code: '23505' }).service.save('user', 'model', dto)).rejects.toThrow('A preset with this name already exists');
    await expect(setup([]).service.save('user', 'model', dto)).rejects.toThrow('at most 50 presets');
  });

  it('updates and deletes only a preset of the model', async () => {
    await expect(setup([]).service.save('user', 'model', dto, 'p-9')).rejects.toThrow('Preset not found');
    await expect(setup([]).service.delete('user', 'model', 'p-9')).rejects.toThrow('Preset not found');
    await expect(setup().service.delete('user', 'model', 'p-1')).resolves.toEqual({ deleted: true });
  });

  it('starts from the last document mapping of the concept, naming its source only while its workspace is linked', async () => {
    const last = { id: 'm-1', scope: 'document', documentId: 'doc-1', sourceLabel: null, linked: true, fieldMappings: fields, aiSettings: null, identityFields: ['date'], updatedAt: '2026-10-01T10:00:00.000Z' };
    const linked = setup([last]);
    await expect(linked.service.lastDocumentMapping('user', 'model', 'c-1')).resolves.toEqual({
      mappingId: 'm-1', scope: 'document', sourceName: 'FP_LIGNE.pdf', workspaceLinked: true,
      fieldMappings: fields, aiSettings: {}, identityFields: ['date'], updatedAt: '2026-10-01T10:00:00.000Z',
    });
    expect((linked.database.query.mock.calls[0] as unknown as [string])[0]).toContain('LEFT JOIN semantic_model.workspace_links');
    const unlinked = setup([{ ...last, linked: false }]);
    await expect(unlinked.service.lastDocumentMapping('user', 'model', 'c-1')).resolves.toMatchObject({ sourceName: null, workspaceLinked: false });
    expect(unlinked.documents.findByIds).not.toHaveBeenCalled();
    await expect(setup([]).service.lastDocumentMapping('user', 'model', 'c-1')).resolves.toBeNull();
  });
});
