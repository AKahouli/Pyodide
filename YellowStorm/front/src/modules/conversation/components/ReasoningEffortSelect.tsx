import { ReasoningEffortSelector } from '@/components/ai-elements/reasoning-effort-selector';
import { useDefaultModel, useModels } from '@/modules/models';
import { useModuleTranslation } from '@/modules/localization';
import { useSelectedModelId, useSelectedReasoningEffort, useSetSelectedReasoningEffort } from '../store';

interface ReasoningEffortState {
  /** Efforts offered by the active model; empty when the model has none. */
  efforts: Array<{ id: string; name: string; description?: string }>;
  /** The effort a plain chat message will use: the explicit selection when valid, else the model's admin-configured default. */
  effectiveEffort: string | null | undefined;
}

/**
 * Shared source of truth for the reasoning-effort composer control: resolves
 * the active model (explicit selection, else admin default, else first) and
 * falls back to its configured default effort when the current selection does
 * not apply to it.
 */
export function useReasoningEffortState(): ReasoningEffortState {
  const selectedModelId = useSelectedModelId();
  const selectedReasoningEffort = useSelectedReasoningEffort();
  const models = useModels();
  const defaultModel = useDefaultModel();

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? defaultModel ?? models[0];
  const efforts = selectedModel?.supportsReasoning ? (selectedModel.reasoning?.efforts ?? []) : [];
  const effectiveEffort = efforts.some((effort) => effort.id === selectedReasoningEffort)
    ? selectedReasoningEffort
    : selectedModel?.reasoning?.defaultEffort;

  return { efforts, effectiveEffort };
}

/**
 * Reasoning-effort dropdown for composers (conversation home, project page).
 * Renders nothing when the active model exposes no reasoning efforts.
 */
export function ReasoningEffortSelect() {
  const { t } = useModuleTranslation('conversation');
  const setSelectedReasoningEffort = useSetSelectedReasoningEffort();
  const { efforts, effectiveEffort } = useReasoningEffortState();

  if (efforts.length === 0) return null;

  return <ReasoningEffortSelector
    efforts={efforts}
    value={effectiveEffort}
    onValueChange={setSelectedReasoningEffort}
    label={t('input.reasoning.label')}
  />;
}
