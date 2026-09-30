import { effectiveAiSettings, pickAiSettings, SemanticExtractionSettingsService } from './semantic-extraction-settings.service';

describe('AI reading limits', () => {
  it('keeps only whole-number limits that exist', () => {
    expect(pickAiSettings({ maxBlocks: 50, maxCharacters: 1.5, other: 3, blocksPerField: '4' })).toEqual({ maxBlocks: 50 });
    expect(pickAiSettings(null)).toEqual({});
  });

  it('uses the mapping limits, then the admin ones, then the built-in ones', () => {
    expect(effectiveAiSettings({ maxBlocks: 100, blocksPerField: 2 }, { blocksPerField: 5 })).toEqual({
      maxBlocks: 100, maxCharacters: 60000, longDocumentCharacters: 30000, blocksPerField: 5 });
  });

  it('saves only what the admin set and returns every limit filled in', async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ aiSettings: { maxCharacters: 8000 } }] }) };
    const service = new SemanticExtractionSettingsService(database as never);
    const saved = await service.updateDefaults('admin-1', { maxCharacters: 8000 });
    expect(database.query.mock.calls[0][1]).toEqual(['{"maxCharacters":8000}', 'admin-1']);
    expect(saved).toEqual({ configured: { maxCharacters: 8000 },
      aiSettings: { maxBlocks: 400, maxCharacters: 8000, longDocumentCharacters: 30000, blocksPerField: 8 } });
  });
});
