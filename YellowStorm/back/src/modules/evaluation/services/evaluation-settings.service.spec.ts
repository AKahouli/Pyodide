import { EvaluationSettingsService, DEFAULT_ADMIN_EVALUATION_SETTINGS } from './evaluation-settings.service';

describe('EvaluationSettingsService', () => {
  const leanExec = (value: unknown) => ({ lean: () => ({ exec: async () => value }) });

  it('returns disabled defaults when no singleton exists', async () => {
    const model = { findOne: jest.fn(() => leanExec(null)) };
    const service = new EvaluationSettingsService(model as never, {} as never);
    await expect(service.getSettings()).resolves.toEqual(DEFAULT_ADMIN_EVALUATION_SETTINGS);
    expect(model.findOne).toHaveBeenCalledWith({ key: 'global' });
  });

  it('validates and upserts an enabled compatible judge model by global key', async () => {
    const saved = {
      key: 'global',
      responseReliability: { enabled: true, mode: 'informative', judgeModelId: 'judge-1', maxConcurrentEvaluations: 3, timeoutMs: 30000, maxFindings: 5 },
    };
    const model = { findOneAndUpdate: jest.fn(() => leanExec(saved)) };
    const modelsService = {
      validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: { types: ['chat'] } }),
    };
    const service = new EvaluationSettingsService(model as never, modelsService as never);
    await expect(service.updateSettings(saved as never)).resolves.toEqual({
      responseReliability: {
        ...saved.responseReliability,
        correction: DEFAULT_ADMIN_EVALUATION_SETTINGS.responseReliability.correction,
      },
    });
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'global' },
      expect.any(Object),
      expect.objectContaining({ upsert: true, new: true }),
    );
  });

  it('rejects enabled settings without a judge model', async () => {
    const service = new EvaluationSettingsService({} as never, {} as never);
    await expect(service.updateSettings({
      responseReliability: { ...DEFAULT_ADMIN_EVALUATION_SETTINGS.responseReliability, enabled: true },
    } as never)).rejects.toThrow('A judge model is required');
  });

  it('normalizes legacy settings with correction defaults', async () => {
    const model = { findOne: jest.fn(() => leanExec({ responseReliability: { enabled: false, mode: 'informative' } })) };
    const service = new EvaluationSettingsService(model as never, {} as never);
    await expect(service.getSettings()).resolves.toEqual(expect.objectContaining({
      responseReliability: expect.objectContaining({ correction: DEFAULT_ADMIN_EVALUATION_SETTINGS.responseReliability.correction }),
    }));
  });

  it.each([
    ['corrective_guarded', 'Corrective guarded mode'],
    ['additional', 'Additional document retrieval'],
    ['connector', 'Connector queries'],
    ['calculation', 'Calculation reruns'],
  ])('rejects unavailable MVP capability %s', async (capability, message) => {
    const input = structuredClone(DEFAULT_ADMIN_EVALUATION_SETTINGS);
    if (capability === 'corrective_guarded') input.responseReliability.mode = 'corrective_guarded';
    if (capability === 'additional') input.responseReliability.correction.allowAdditionalDocumentRetrieval = true;
    if (capability === 'connector') input.responseReliability.correction.allowConnectorQueries = true;
    if (capability === 'calculation') input.responseReliability.correction.allowCalculationReruns = true;
    const service = new EvaluationSettingsService({} as never, {} as never);
    await expect(service.updateSettings(input as never)).rejects.toThrow(message);
  });
});
