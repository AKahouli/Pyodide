import { PlaybookFlowSettingsService } from './playbook-flow-settings.service';
import { DEFAULT_PLAYBOOK_EXECUTION_SETTINGS } from '@modules/system/interfaces/playbook-settings.interface';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

describe('PlaybookFlowSettingsService inference model resolution', () => {
  const adminSettings = {
    inferenceModelId: null,
    advisorEvaluationModelId: null,
    replayEvaluationModelId: null,
    nodeSuggestionsMode: 'auto',
    approvalSuggestionMode: 'auto',
    intentNormalizationLimits: {},
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
      validateModelActive: jest.fn().mockResolvedValue({ valid: true, model: { id: 'model' } }),
      getDefaultModel: jest.fn(),
      getModelIdentifier: jest.fn((model) => model?.litellmModel || model?.id || ''),
    };
    const agentService = {
      findPlaybookPlannerById: jest.fn().mockResolvedValue({ agentId: '507f1f77bcf86cd799439011' }),
      listPlaybookPlannerAgentOptions: jest.fn().mockResolvedValue([]),
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

  it('uses the effective inference model for a model-less planner', async () => {
    const { service, agentService, modelsService } = createService('admin-model');
    agentService.findPlaybookPlannerById.mockResolvedValue({
      agentId: '507f1f77bcf86cd799439011',
      model: null,
      instruction: 'Plan safely',
    });
    modelsService.validateModelActive.mockResolvedValue({
      valid: true,
      model: { id: 'admin-model', litellmModel: 'azure/admin-model', omitTemperature: true },
    });

    await expect(service.resolvePlaybookPlanner('507f1f77bcf86cd799439011')).resolves.toEqual(
      expect.objectContaining({ model: 'azure/admin-model', omitTemperature: true }),
    );
    expect(modelsService.validateModelActive).toHaveBeenCalledWith('admin-model');
  });

  it('uses and validates a planner-owned model before inference fallback', async () => {
    const { service, agentService, modelsService } = createService('admin-model');
    agentService.findPlaybookPlannerById.mockResolvedValue({
      agentId: '507f1f77bcf86cd799439011',
      model: 'planner-model',
      instruction: 'Plan safely',
    });
    modelsService.validateModelActive.mockResolvedValue({
      valid: true,
      model: { id: 'planner-model', litellmModel: 'azure/planner-model', omitTemperature: false },
    });

    await expect(service.resolvePlaybookPlanner('507f1f77bcf86cd799439011')).resolves.toEqual(
      expect.objectContaining({ model: 'azure/planner-model', omitTemperature: false }),
    );
    expect(modelsService.validateModelActive).toHaveBeenCalledWith('planner-model', 'chat');
  });

  it('falls back when the planner-owned model is unavailable', async () => {
    const { service, agentService, modelsService } = createService('admin-model');
    agentService.findPlaybookPlannerById.mockResolvedValue({
      agentId: '507f1f77bcf86cd799439011',
      model: 'inactive-planner-model',
      instruction: 'Plan safely',
    });
    modelsService.validateModelActive
      .mockResolvedValueOnce({ valid: false, model: null })
      .mockResolvedValueOnce({
        valid: true,
        model: { id: 'admin-model', litellmModel: 'azure/admin-model', omitTemperature: true },
      });

    await expect(service.resolvePlaybookPlanner('507f1f77bcf86cd799439011')).resolves.toEqual(
      expect.objectContaining({ model: 'azure/admin-model', omitTemperature: true }),
    );
    expect(modelsService.validateModelActive).toHaveBeenNthCalledWith(1, 'inactive-planner-model', 'chat');
    expect(modelsService.validateModelActive).toHaveBeenNthCalledWith(2, 'admin-model');
  });

  it('tries the admin inference model after a stale flow model', async () => {
    const { service, modelsService } = createService('admin-model');
    modelsService.validateModelActive
      .mockResolvedValueOnce({ valid: false, model: null })
      .mockResolvedValueOnce({
        valid: true,
        model: { id: 'admin-model', litellmModel: 'azure/admin-model', omitTemperature: true },
      });

    await expect(service.resolveInferenceModelConfig({ inferenceModelId: 'stale-flow-model' })).resolves.toEqual({
      model: 'azure/admin-model',
      omitTemperature: true,
    });
    expect(modelsService.validateModelActive).toHaveBeenNthCalledWith(1, 'stale-flow-model');
    expect(modelsService.validateModelActive).toHaveBeenNthCalledWith(2, 'admin-model');
  });

  it('requires and validates an explicit planner selection before saving', async () => {
    const { service, agentService, systemService } = createService();
    const plannerAgentId = '507f1f77bcf86cd799439011';

    await service.updateAdminSettings({
      playbookExecution: { dynamicReasoning: { plannerAgentId } },
    });

    expect(agentService.findPlaybookPlannerById).toHaveBeenCalledWith(plannerAgentId);
    expect(systemService.setPlaybookSettings).toHaveBeenCalledWith(expect.objectContaining({
      playbookExecution: expect.objectContaining({
        dynamicReasoning: expect.objectContaining({ plannerAgentId }),
      }),
    }));
  });

  it('persists the Code Interpreter call limit with execution settings', async () => {
    const { service, systemService } = createService();

    await service.updateAdminSettings({
      playbookExecution: { maxSandboxCallsPerStep: 16 },
    });

    expect(systemService.setPlaybookSettings).toHaveBeenCalledWith(expect.objectContaining({
      playbookExecution: expect.objectContaining({ maxSandboxCallsPerStep: 16 }),
    }));
  });

  it('rejects an explicitly empty planner selection', async () => {
    const { service, agentService, systemService } = createService();

    await expect(service.updateAdminSettings({
      playbookExecution: { dynamicReasoning: { plannerAgentId: '' } },
    })).rejects.toThrow(ErrorCode.PLAYBOOK_PLANNER_UNAVAILABLE);
    expect(agentService.findPlaybookPlannerById).not.toHaveBeenCalled();
    expect(systemService.setPlaybookSettings).not.toHaveBeenCalled();
  });
});
