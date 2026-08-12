import { PlaybookFlowSettingsService } from './playbook-flow-settings.service';
import { DEFAULT_PLAYBOOK_EXECUTION_SETTINGS } from '@modules/system/interfaces/playbook-settings.interface';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

describe('PlaybookFlowSettingsService inference model resolution', () => {
  const adminSettings = {
    playbookSuggestorAgentId: null,
    inferenceModelId: null,
    advisorEvaluationModelId: null,
    replayEvaluationModelId: null,
    nodeSuggestionsMode: 'auto',
    approvalSuggestionMode: 'auto',
    intentNormalizationLimits: {},
    replayEligibilityConfidenceThreshold: 0,
    useDeterministicBlueprintBuilder: true,
    playbookExecution: DEFAULT_PLAYBOOK_EXECUTION_SETTINGS,
  };

  function createService(configuredInferenceModelId: string | null = null) {
    const systemService = {
      getPlaybookSettings: jest.fn().mockResolvedValue({
        ...adminSettings,
        inferenceModelId: configuredInferenceModelId,
      }),
      setPlaybookSettings: jest.fn((settings) => Promise.resolve(settings)),
    };
    const modelsService = {
      validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: { id: 'suggestor-model' } }),
      getDefaultModel: jest.fn(),
      getModelIdentifier: jest.fn((model) => model?.litellmModel || model?.id || ''),
    };
    const agentService = {
      findPlaybookPlannerById: jest.fn().mockResolvedValue({ agentId: '507f1f77bcf86cd799439011' }),
      listPlaybookPlannerAgentOptions: jest.fn().mockResolvedValue([]),
      findPlaybookSuggestorById: jest.fn().mockResolvedValue({
        agentId: '507f1f77bcf86cd799439012',
        model: 'suggestor-model',
      }),
      listPlaybookSuggestorAgentOptions: jest.fn().mockResolvedValue([]),
    };
    return {
      service: new PlaybookFlowSettingsService(systemService as any, modelsService as any, agentService as any),
      modelsService,
      agentService,
      systemService,
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

  it('requires and validates an explicit planner selection before saving', async () => {
    const { service, agentService, systemService } = createService();
    const plannerAgentId = '507f1f77bcf86cd799439011';

    await service.updateAdminSettings({
      playbookSuggestorAgentId: '507f1f77bcf86cd799439012',
      playbookExecution: { dynamicReasoning: { plannerAgentId } },
    });

    expect(agentService.findPlaybookPlannerById).toHaveBeenCalledWith(plannerAgentId);
    expect(systemService.setPlaybookSettings).toHaveBeenCalledWith(expect.objectContaining({
      playbookExecution: expect.objectContaining({
        dynamicReasoning: expect.objectContaining({ plannerAgentId }),
      }),
    }));
  });

  it('requires and validates an explicit suggestor selection before saving', async () => {
    const { service, agentService, systemService, modelsService } = createService();
    const suggestorAgentId = '507f1f77bcf86cd799439012';

    await service.updateAdminSettings({
      playbookSuggestorAgentId: suggestorAgentId,
      playbookExecution: { dynamicReasoning: { plannerAgentId: '507f1f77bcf86cd799439011' } },
    });

    expect(agentService.findPlaybookSuggestorById).toHaveBeenCalledWith(suggestorAgentId);
    expect(modelsService.validateModelActive).toHaveBeenCalledWith('suggestor-model', 'chat');
    expect(systemService.setPlaybookSettings).toHaveBeenCalledWith(expect.objectContaining({
      playbookSuggestorAgentId: suggestorAgentId,
    }));
  });

  it('rejects saving when no planner is selected', async () => {
    const { service, agentService, systemService } = createService();

    await expect(service.updateAdminSettings({})).rejects.toThrow(ErrorCode.PLAYBOOK_PLANNER_UNAVAILABLE);
    expect(agentService.findPlaybookPlannerById).not.toHaveBeenCalled();
    expect(systemService.setPlaybookSettings).not.toHaveBeenCalled();
  });
});
