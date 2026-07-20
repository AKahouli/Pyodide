import { PlaybookFlowSettingsService } from './playbook-flow-settings.service';

describe('PlaybookFlowSettingsService inference model resolution', () => {
  const adminSettings = {
    inferenceModelId: null,
    advisorEvaluationModelId: null,
    replayEvaluationModelId: null,
    nodeSuggestionsMode: 'auto',
    approvalSuggestionMode: 'auto',
    intentNormalizationLimits: {},
    replayEligibilityConfidenceThreshold: 0,
    useDeterministicBlueprintBuilder: true,
  };

  function createService(configuredInferenceModelId: string | null = null) {
    const systemService = {
      getPlaybookSettings: jest.fn().mockResolvedValue({
        ...adminSettings,
        inferenceModelId: configuredInferenceModelId,
      }),
    };
    const modelsService = {
      validateModelActive: jest.fn(),
      getDefaultModel: jest.fn(),
      getModelIdentifier: jest.fn((model) => model?.litellmModel || model?.id || ''),
    };
    return {
      service: new PlaybookFlowSettingsService(systemService as any, modelsService as any),
      modelsService,
    };
  }

  it('resolves a playbook-selected model identifier and capability', async () => {
    const { service, modelsService } = createService('admin-model');
    modelsService.validateModelActive.mockResolvedValue({
      valid: true,
      model: { id: 'selected-model', litellmModel: 'azure/selected-model', omitTemperature: true },
    });

    await expect(service.resolveInferenceModelConfig({ inferenceModelId: 'selected-model' })).resolves.toEqual({
      model: 'azure/selected-model',
      omitTemperature: true,
    });
    expect(modelsService.validateModelActive).toHaveBeenCalledWith('selected-model');
  });

  it('resolves the admin model identifier and capability when the playbook inherits', async () => {
    const { service, modelsService } = createService('admin-model');
    modelsService.validateModelActive.mockResolvedValue({
      valid: true,
      model: { id: 'admin-model', litellmModel: 'deepseek/admin-model', omitTemperature: false },
    });

    await expect(service.resolveInferenceModelConfig()).resolves.toEqual({
      model: 'deepseek/admin-model',
      omitTemperature: false,
    });
    expect(modelsService.validateModelActive).toHaveBeenCalledWith('admin-model');
  });

  it('falls back to the default model identifier and capability', async () => {
    const { service, modelsService } = createService();
    modelsService.getDefaultModel.mockResolvedValue({
      id: 'default-model',
      litellmModel: 'azure/default-model',
      omitTemperature: true,
    });

    await expect(service.resolveInferenceModelConfig()).resolves.toEqual({
      model: 'azure/default-model',
      omitTemperature: true,
    });
    expect(modelsService.validateModelActive).not.toHaveBeenCalled();
  });
});
