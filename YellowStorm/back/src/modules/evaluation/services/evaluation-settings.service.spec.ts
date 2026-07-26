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
    await expect(service.updateSettings(saved as never)).resolves.toEqual({ responseReliability: saved.responseReliability });
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
});
