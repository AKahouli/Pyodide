import {
  DEFAULT_ADMIN_EVALUATION_SETTINGS,
  DEFAULT_RESPONSE_CORRECTION_SETTINGS,
  EvaluationSettingsService,
} from './evaluation-settings.service';

describe('EvaluationSettingsService', () => {
  const leanExec = (value: unknown) => ({ lean: () => ({ exec: async () => value }) });

  it('returns disabled defaults when no singleton exists', async () => {
    const model = { findOne: jest.fn(() => leanExec(null)) };
    const service = new EvaluationSettingsService(model as never, {} as never);
    await expect(service.getSettings()).resolves.toEqual(DEFAULT_ADMIN_EVALUATION_SETTINGS);
    expect(model.findOne).toHaveBeenCalledWith({ key: 'global' });
  });

  it('normalizes legacy informative settings with corrective defaults', async () => {
    const model = {
      findOne: jest.fn(() => leanExec({
        key: 'global',
        responseReliability: {
          enabled: false,
          mode: 'informative',
          judgeModelId: null,
          maxConcurrentEvaluations: 3,
          timeoutMs: 30000,
          maxFindings: 5,
        },
      })),
    };
    const service = new EvaluationSettingsService(model as never, {} as never);

    await expect(service.getSettings()).resolves.toEqual({
      responseReliability: {
        enabled: false,
        mode: 'informative',
        judgeModelId: null,
        maxConcurrentEvaluations: 3,
        timeoutMs: 30000,
        maxFindings: 5,
        correction: DEFAULT_RESPONSE_CORRECTION_SETTINGS,
      },
    });
  });

  it('persists enabled corrective transparent settings without clamping values', async () => {
    const saved = {
      key: 'global',
      responseReliability: {
        enabled: true,
        mode: 'corrective_transparent',
        judgeModelId: 'judge-1',
        maxConcurrentEvaluations: 11,
        timeoutMs: 601000,
        maxFindings: 11,
        correction: {
          ...DEFAULT_RESPONSE_CORRECTION_SETTINGS,
          threshold: 101,
          maxAttempts: 4,
          failureBehavior: 'abstain',
        },
      },
    };
    const model = { findOneAndUpdate: jest.fn(() => leanExec(saved)) };
    const modelsService = {
      validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: { types: ['chat'] } }),
    };
    const service = new EvaluationSettingsService(model as never, modelsService as never);
    await expect(service.updateSettings(saved as never)).resolves.toEqual({
      responseReliability: saved.responseReliability,
    });
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'global' },
      expect.objectContaining({
        $set: expect.objectContaining({
          responseReliability: expect.objectContaining({
            mode: 'corrective_transparent',
            maxConcurrentEvaluations: 11,
            timeoutMs: 601000,
            maxFindings: 11,
            correction: expect.objectContaining({ threshold: 101, maxAttempts: 4 }),
          }),
        }),
      }),
      expect.objectContaining({ upsert: true, new: true }),
    );
  });

  it('rejects corrective guarded mode until its runtime is implemented', async () => {
    const service = new EvaluationSettingsService({} as never, {} as never);
    await expect(service.updateSettings({
      responseReliability: {
        ...DEFAULT_ADMIN_EVALUATION_SETTINGS.responseReliability,
        mode: 'corrective_guarded',
      },
    } as never)).rejects.toThrow('Corrective guarded mode is not available yet');
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
