import { effectiveAiSettings, pickAiSettings, pickRunLimits, SemanticExtractionSettingsService } from './semantic-extraction-settings.service';

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

describe('several records per document', () => {
  it('is kept for a mapping but never taken from the admin defaults', () => {
    expect(pickAiSettings({ manyRecords: true }).manyRecords).toBe(true);
    expect(pickAiSettings({ manyRecords: 'yes' }).manyRecords).toBeUndefined();
    expect(effectiveAiSettings({ manyRecords: true }).manyRecords).toBeUndefined();
    expect(effectiveAiSettings({}, { manyRecords: true }).manyRecords).toBe(true);
  });
});

describe('run limits', () => {
  it('keeps only whole numbers inside each range', () => {
    expect(pickRunLimits({ maxRecordsPerRun: 50000, maxValuesPerRun: 10, maxRunSources: 2.5, other: 4 }))
      .toEqual({ maxRecordsPerRun: 50000 });
  });

  it('keeps the purge time only between 30 s and one hour', () => {
    expect(pickRunLimits({ purgeTimeoutSeconds: 900 })).toEqual({ purgeTimeoutSeconds: 900 });
    expect(pickRunLimits({ purgeTimeoutSeconds: 10 })).toEqual({});
    expect(pickRunLimits({ purgeTimeoutSeconds: 4000 })).toEqual({});
  });

  it('keeps the save batch between 100 and 50000 rows and its time between 5 and 600 seconds', () => {
    expect(pickRunLimits({ saveBatchRows: 5000, saveStatementSeconds: 120 })).toEqual({ saveBatchRows: 5000, saveStatementSeconds: 120 });
    expect(pickRunLimits({ saveBatchRows: 99, saveStatementSeconds: 4 })).toEqual({});
    expect(pickRunLimits({ saveBatchRows: 50001, saveStatementSeconds: 601 })).toEqual({});
  });

  it('keeps the graph projection batch between 100 and 20000 rows', () => {
    expect(pickRunLimits({ projectionBatchRows: 20000 })).toEqual({ projectionBatchRows: 20000 });
    expect(pickRunLimits({ projectionBatchRows: 100 })).toEqual({ projectionBatchRows: 100 });
    expect(pickRunLimits({ projectionBatchRows: 99 })).toEqual({});
    expect(pickRunLimits({ projectionBatchRows: 20001 })).toEqual({});
  });

  it('keeps the index build limits only inside their ranges', () => {
    const inRange = { embeddingBatchSize: 256, embeddingParallelCalls: 16, embeddingTimeoutSeconds: 600, indexReadPageRows: 500 };
    expect(pickRunLimits(inRange)).toEqual(inRange);
    expect(pickRunLimits({ embeddingBatchSize: 0, embeddingParallelCalls: 17, embeddingTimeoutSeconds: 4, indexReadPageRows: 499 })).toEqual({});
    expect(pickRunLimits({ embeddingBatchSize: 257, indexReadPageRows: 50001 })).toEqual({});
    expect(pickRunLimits({ embeddingParallelCalls: 2.5 })).toEqual({});
  });

  it('saves what the admin set and fills the rest with the built-in limits', async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ runLimits: { maxRecordsPerRun: 50000 } }] }) };
    const service = new SemanticExtractionSettingsService(database as never);
    const saved = await service.updateRunLimits('admin-1', { maxRecordsPerRun: 50000 });
    expect(database.query.mock.calls[0][1]).toEqual(['{"maxRecordsPerRun":50000}', 'admin-1']);
    expect(saved).toEqual({ configured: { maxRecordsPerRun: 50000 }, runLimits: {
      maxRunSources: 5000, maxRecordsPerSource: 5000, maxRecordsPerRun: 50000, maxValuesPerRun: 50000,
      maxAiRowsPerSource: 500, maxAiParallelCalls: 8,
      parserMemoryMb: 512, archiveTimeoutSeconds: 900, purgeTimeoutSeconds: 300,
      saveBatchRows: 2000, saveStatementSeconds: 10, projectionBatchRows: 5000,
      embeddingBatchSize: 32, embeddingParallelCalls: 4, embeddingTimeoutSeconds: 30, indexReadPageRows: 5000 } });
  });
});
