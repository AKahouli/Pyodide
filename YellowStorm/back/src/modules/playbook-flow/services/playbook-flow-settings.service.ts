import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ModelsService } from '@modules/models/models.service';
import {
  AgentService,
  type PlaybookPlannerAgentConfig,
  type PlaybookPlannerAgentOption,
  type PlaybookSuggestorAgentConfig,
  type PlaybookSuggestorAgentOption,
} from '@modules/agent/agent.service';
import { SystemService } from '@modules/system/system.service';
import type { AdminPlaybookSettings } from '@modules/system/interfaces/playbook-settings.interface';
import {
  FlowDesignSettings,
  EffectiveFlowDesignSettings,
  UpdateFlowDesignSettingsDto,
  DEFAULT_FLOW_DESIGN_SETTINGS,
} from '../interfaces/playbook-flow-settings.interface';
import { UpdateAdminPlaybookSettingsDto } from '../dto/update-admin-playbook-settings.dto';

export interface ResolvedPlaybookPlannerAgentConfig extends Omit<PlaybookPlannerAgentConfig, 'model'> {
  model: string;
  omitTemperature: boolean;
}

@Injectable()
export class PlaybookFlowSettingsService {
  constructor(
    private readonly systemService: SystemService,
    private readonly modelsService: ModelsService,
    private readonly agentService: AgentService,
  ) {}

  async getAdminSettings(): Promise<AdminPlaybookSettings> {
    return this.systemService.getPlaybookSettings();
  }

  async listPlannerAgents(): Promise<PlaybookPlannerAgentOption[]> {
    return this.agentService.listPlaybookPlannerAgentOptions();
  }

  async listSuggestorAgents(): Promise<PlaybookSuggestorAgentOption[]> {
    return this.agentService.listPlaybookSuggestorAgentOptions();
  }

  async resolvePlaybookPlanner(
    agentId: string,
    playbookSettings?: Partial<FlowDesignSettings> | Record<string, unknown> | null,
  ): Promise<ResolvedPlaybookPlannerAgentConfig> {
    const planner = await this.agentService.findPlaybookPlannerById(agentId);
    if (!planner.model) {
      return { ...planner, ...(await this.resolveInferenceModelConfig(playbookSettings)) };
    }

    const validation = await this.modelsService.validateModelActive(planner.model, 'chat');
    const identifier = validation.valid && validation.model
      ? this.modelsService.getModelIdentifier(validation.model)
      : '';
    if (!identifier) {
      throw new BadRequestException(ErrorCode.PLAYBOOK_PLANNER_UNAVAILABLE, 'The Playbook Planner model is unavailable');
    }
    return {
      ...planner,
      model: identifier,
      omitTemperature: validation.model?.omitTemperature === true,
    };
  }

  async resolvePlaybookSuggestor(): Promise<PlaybookSuggestorAgentConfig> {
    const settings = await this.getAdminSettings();
    const agentId = settings.playbookSuggestorAgentId?.trim();
    if (!agentId) {
      throw new BadRequestException(ErrorCode.PLAYBOOK_SUGGESTOR_UNAVAILABLE, 'A Playbook Suggestor agent must be configured');
    }
    const suggestor = await this.agentService.findPlaybookSuggestorById(agentId);
    const modelValidation = await this.modelsService.validateModelActive(suggestor.model, 'chat');
    if (!modelValidation.valid) {
      throw new BadRequestException(ErrorCode.PLAYBOOK_SUGGESTOR_UNAVAILABLE, 'The Playbook Suggestor model is unavailable');
    }
    return suggestor;
  }

  async updateAdminSettings(patch: UpdateAdminPlaybookSettingsDto): Promise<AdminPlaybookSettings> {
    const current = await this.getAdminSettings();
    const playbookSuggestorAgentId = patch.playbookSuggestorAgentId === undefined
      ? current.playbookSuggestorAgentId
      : patch.playbookSuggestorAgentId?.trim() || null;
    const inferenceModelId = patch.inferenceModelId === undefined
      ? current.inferenceModelId
      : patch.inferenceModelId?.trim() || null;
    const advisorEvaluationModelId = patch.advisorEvaluationModelId === undefined
      ? current.advisorEvaluationModelId
      : patch.advisorEvaluationModelId?.trim() || null;
    const replayEvaluationModelId = patch.replayEvaluationModelId === undefined
      ? current.replayEvaluationModelId
      : patch.replayEvaluationModelId?.trim() || null;
    const plannerAgentId = patch.playbookExecution?.dynamicReasoning?.plannerAgentId === undefined
      ? current.playbookExecution.dynamicReasoning.plannerAgentId
      : patch.playbookExecution.dynamicReasoning.plannerAgentId.trim();

    if (!plannerAgentId) {
      throw new BadRequestException(ErrorCode.PLAYBOOK_PLANNER_UNAVAILABLE, 'A Playbook Planner agent must be selected');
    }
    await this.agentService.findPlaybookPlannerById(plannerAgentId);

    if (!playbookSuggestorAgentId) {
      throw new BadRequestException(ErrorCode.PLAYBOOK_SUGGESTOR_UNAVAILABLE, 'A Playbook Suggestor agent must be selected');
    }
    const suggestor = await this.agentService.findPlaybookSuggestorById(playbookSuggestorAgentId);
    const suggestorModelValidation = await this.modelsService.validateModelActive(suggestor.model, 'chat');
    if (!suggestorModelValidation.valid) {
      throw new BadRequestException(ErrorCode.PLAYBOOK_SUGGESTOR_UNAVAILABLE, 'The Playbook Suggestor model is unavailable');
    }

    if (patch.inferenceModelId !== undefined && inferenceModelId) {
      const validation = await this.modelsService.validateModelActive(inferenceModelId);
      if (!validation.valid) throw new BadRequestException(ErrorCode.BAD_REQUEST);
    }

    if (patch.advisorEvaluationModelId !== undefined && advisorEvaluationModelId) {
      const validation = await this.modelsService.validateModelActive(advisorEvaluationModelId);
      if (!validation.valid) throw new BadRequestException(ErrorCode.MODEL_INACTIVE, 'Advisor evaluation model is unavailable.');
    }

    if (patch.replayEvaluationModelId !== undefined && replayEvaluationModelId) {
      const validation = await this.modelsService.validateModelActive(replayEvaluationModelId);
      if (!validation.valid) throw new BadRequestException(ErrorCode.MODEL_INACTIVE, 'Replay evaluation model is unavailable.');
    }

    return this.systemService.setPlaybookSettings({
      playbookSuggestorAgentId,
      inferenceModelId,
      advisorEvaluationModelId,
      replayEvaluationModelId,
      nodeSuggestionsMode: patch.nodeSuggestionsMode ?? current.nodeSuggestionsMode,
      approvalSuggestionMode: patch.approvalSuggestionMode ?? current.approvalSuggestionMode,
      intentNormalizationLimits: {
        maxWorkflowPlanChanges: patch.intentNormalizationLimits?.maxWorkflowPlanChanges ?? current.intentNormalizationLimits.maxWorkflowPlanChanges,
        maxInputPorts: patch.intentNormalizationLimits?.maxInputPorts ?? current.intentNormalizationLimits.maxInputPorts,
        maxOutputPorts: patch.intentNormalizationLimits?.maxOutputPorts ?? current.intentNormalizationLimits.maxOutputPorts,
        maxIteratorBodySteps: patch.intentNormalizationLimits?.maxIteratorBodySteps ?? current.intentNormalizationLimits.maxIteratorBodySteps,
        maxIteratorBodyEdges: patch.intentNormalizationLimits?.maxIteratorBodyEdges ?? current.intentNormalizationLimits.maxIteratorBodyEdges,
      },
      replayEligibilityConfidenceThreshold: patch.replayEligibilityConfidenceThreshold ?? current.replayEligibilityConfidenceThreshold,
      useDeterministicBlueprintBuilder: patch.useDeterministicBlueprintBuilder ?? current.useDeterministicBlueprintBuilder,
      playbookExecution: {
        ...current.playbookExecution,
        ...patch.playbookExecution,
        dynamicReasoning: {
          ...current.playbookExecution.dynamicReasoning,
          ...patch.playbookExecution?.dynamicReasoning,
          plannerAgentId,
        },
      },
    });
  }

  async resolveAdvisorEvaluationModelId(): Promise<string> {
    const adminSettings = await this.getAdminSettings();
    const configuredModelId = adminSettings.advisorEvaluationModelId?.trim() || null;

    if (configuredModelId) {
      const validation = await this.modelsService.validateModelActive(configuredModelId);
      if (validation.valid && validation.model) {
        const identifier = this.modelsService.getModelIdentifier(validation.model);
        if (identifier) {
          return identifier;
        }
      }

      throw new BadRequestException(ErrorCode.MODEL_INACTIVE, 'Advisor evaluation model is unavailable.');
    }

    const defaultModel = await this.modelsService.getDefaultModel();
    const fallbackIdentifier = this.modelsService.getModelIdentifier(defaultModel);
    if (!fallbackIdentifier) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    return fallbackIdentifier;
  }

  async resolveReplayEvaluationModelId(): Promise<string> {
    const adminSettings = await this.getAdminSettings();
    const configuredModelId = adminSettings.replayEvaluationModelId?.trim() || null;

    if (configuredModelId) {
      const validation = await this.modelsService.validateModelActive(configuredModelId);
      if (validation.valid && validation.model) {
        const identifier = this.modelsService.getModelIdentifier(validation.model);
        if (identifier) {
          return identifier;
        }
      }

      throw new BadRequestException(ErrorCode.MODEL_INACTIVE, 'Replay evaluation model is unavailable.');
    }

    const defaultModel = await this.modelsService.getDefaultModel();
    const fallbackIdentifier = this.modelsService.getModelIdentifier(defaultModel);
    if (!fallbackIdentifier) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    return fallbackIdentifier;
  }

  getDefaultPlaybookSettings(): FlowDesignSettings {
    return { ...DEFAULT_FLOW_DESIGN_SETTINGS };
  }

  normalizePlaybookSettings(
    input: Partial<FlowDesignSettings> | Record<string, unknown> | null | undefined,
  ): FlowDesignSettings {
    return {
      inferenceModelId: typeof input?.inferenceModelId === 'string' ? input.inferenceModelId.trim() || null : null,
      nodeSuggestionsMode: input?.nodeSuggestionsMode === 'auto' || input?.nodeSuggestionsMode === 'manual'
        ? input.nodeSuggestionsMode as FlowDesignSettings['nodeSuggestionsMode'] : 'inherit',
      approvalSuggestionMode: input?.approvalSuggestionMode === 'auto' || input?.approvalSuggestionMode === 'manual'
        ? input.approvalSuggestionMode as FlowDesignSettings['approvalSuggestionMode'] : 'inherit',
      recursionLimit: typeof input?.recursionLimit === 'number' && input.recursionLimit > 0
        ? Math.min(Math.round(input.recursionLimit), 50) : 25,
      maxParallelism: typeof input?.maxParallelism === 'number' && input.maxParallelism > 0
        ? Math.min(Math.round(input.maxParallelism), 10) : 5,
    };
  }

  mergePlaybookSettingsPatch(
    current: Partial<FlowDesignSettings> | Record<string, unknown> | null | undefined,
    patch: UpdateFlowDesignSettingsDto | undefined,
  ): FlowDesignSettings {
    const normalizedCurrent = this.normalizePlaybookSettings(current);
    if (!patch) return normalizedCurrent;

    return {
      inferenceModelId: patch.inferenceModelId === undefined
        ? normalizedCurrent.inferenceModelId : (patch.inferenceModelId?.trim() || null),
      nodeSuggestionsMode: patch.nodeSuggestionsMode ?? normalizedCurrent.nodeSuggestionsMode,
      approvalSuggestionMode: patch.approvalSuggestionMode ?? normalizedCurrent.approvalSuggestionMode,
      recursionLimit: patch.recursionLimit ?? normalizedCurrent.recursionLimit,
      maxParallelism: patch.maxParallelism ?? normalizedCurrent.maxParallelism,
    };
  }

  async validatePlaybookSettingsPatch(patch: UpdateFlowDesignSettingsDto | undefined): Promise<void> {
    const inferenceModelId = patch?.inferenceModelId?.trim();
    if (!inferenceModelId) return;
    const validation = await this.modelsService.validateModelActive(inferenceModelId);
    if (!validation.valid) throw new BadRequestException(ErrorCode.BAD_REQUEST);
  }

  async resolveEffectiveSettings(
    playbookSettings?: Partial<FlowDesignSettings> | Record<string, unknown> | null,
  ): Promise<EffectiveFlowDesignSettings> {
    const adminSettings = await this.getAdminSettings();
    const normalized = this.normalizePlaybookSettings(playbookSettings);
    const resolvedInferenceModelId = normalized.inferenceModelId || adminSettings.inferenceModelId || null;

    return {
      playbookSuggestorAgentId: adminSettings.playbookSuggestorAgentId,
      inferenceModelId: resolvedInferenceModelId,
      advisorEvaluationModelId: adminSettings.advisorEvaluationModelId,
      replayEvaluationModelId: adminSettings.replayEvaluationModelId,
      nodeSuggestionsMode: normalized.nodeSuggestionsMode === 'inherit'
        ? adminSettings.nodeSuggestionsMode : normalized.nodeSuggestionsMode,
      approvalSuggestionMode: normalized.approvalSuggestionMode === 'inherit'
        ? adminSettings.approvalSuggestionMode : normalized.approvalSuggestionMode,
      intentNormalizationLimits: adminSettings.intentNormalizationLimits,
      replayEligibilityConfidenceThreshold: adminSettings.replayEligibilityConfidenceThreshold,
      useDeterministicBlueprintBuilder: adminSettings.useDeterministicBlueprintBuilder,
      playbookExecution: adminSettings.playbookExecution,
      resolvedInferenceModelId,
      recursionLimit: normalized.recursionLimit,
      maxParallelism: normalized.maxParallelism,
    };
  }

  async resolveInferenceModel(
    playbookSettings?: Partial<FlowDesignSettings> | Record<string, unknown> | null,
  ): Promise<string> {
    return (await this.resolveInferenceModelConfig(playbookSettings)).model;
  }

  async resolveInferenceModelConfig(
    playbookSettings?: Partial<FlowDesignSettings> | Record<string, unknown> | null,
  ): Promise<{ model: string; omitTemperature: boolean }> {
    const effectiveSettings = await this.resolveEffectiveSettings(playbookSettings);

    if (effectiveSettings.resolvedInferenceModelId) {
      const validation = await this.modelsService.validateModelActive(effectiveSettings.resolvedInferenceModelId);
      if (validation.valid && validation.model) {
        const identifier = this.modelsService.getModelIdentifier(validation.model);
        if (identifier) return { model: identifier, omitTemperature: validation.model.omitTemperature === true };
      }
    }

    const defaultModel = await this.modelsService.getDefaultModel();
    const fallbackIdentifier = this.modelsService.getModelIdentifier(defaultModel);
    if (!fallbackIdentifier) throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    return { model: fallbackIdentifier, omitTemperature: defaultModel?.omitTemperature === true };
  }
}
