import { useEffect, useState } from 'react';
import { CheckIcon } from 'lucide-react';
import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputController,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector';
import { WorkspaceSelect } from '@/modules/workspace/components/WorkspaceSelect';
import { RecentSkillsMenu, ManageSkillsDialog, SelectedSkillsPills } from '@/modules/skill';
import { RecentConnectorsMenu, ManageConnectorsDialog, SelectedConnectorsPills } from '@/modules/connector';
import { getActiveSkills, getActiveConnectors, type ConnectorOption } from '@/modules/agent/api';
import type { SkillOption } from '@/modules/agent/types';
import {
  useChefs,
  useDefaultModel,
  useConversationV2DefaultModel,
  useModels,
  useModelsStore,
  CONVERSATION_V2_DEFAULT_MODEL_CHANGED_EVENT,
} from '@/modules/models';
import { useConversationV2Store } from '../store';
import { useConversationV2Translation } from '../translation';

export interface AgentComposerProps {
  onSubmit: (message: PromptInputMessage, workspaceIds: string[], modelId: string | null) => void;
  disabled?: boolean;
  /** Override the textarea placeholder (defaults to conversation-v2 agent copy). */
  placeholder?: string;
  /**
   * When `prefillNonce` changes, replace the textarea with `prefillText`
   * (used by App Builder suggestion chips without auto-submitting).
   */
  prefillText?: string;
  prefillNonce?: number;
}

/** Applies external prefill into PromptInputProvider-controlled text. */
function AgentComposerPrefill({ text, nonce }: { text?: string; nonce?: number }) {
  const { textInput } = usePromptInputController();
  useEffect(() => {
    if (nonce == null || text == null) return;
    textInput.setInput(text);
    // setInput is stable (useState setter); omit textInput object to avoid re-runs on typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-apply on explicit prefill
  }, [nonce, text]);
  return null;
}

/**
 * Shared Agent-mode composer (workspaces, skills, connectors, model) used by
 * New Conversation Agent mode and App Builder create-with-agent.
 */
export function AgentComposer({
  onSubmit,
  disabled = false,
  placeholder,
  prefillText,
  prefillNonce,
}: AgentComposerProps) {
  const { t } = useConversationV2Translation();
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<string[]>([]);

  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [manageSkillsOpen, setManageSkillsOpen] = useState(false);
  const selectedSkillIds = useConversationV2Store((s) => s.selectedSkillIds);
  const toggleSelectedSkill = useConversationV2Store((s) => s.toggleSelectedSkill);

  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [manageConnectorsOpen, setManageConnectorsOpen] = useState(false);
  const selectedConnectorIds = useConversationV2Store((s) => s.selectedConnectorIds);
  const toggleSelectedConnector = useConversationV2Store((s) => s.toggleSelectedConnector);

  useEffect(() => {
    setSkillsLoading(true);
    getActiveSkills()
      .then((data) => setSkills(data || []))
      .catch((err) => console.error('Failed to fetch skills:', err))
      .finally(() => setSkillsLoading(false));
  }, []);

  useEffect(() => {
    setConnectorsLoading(true);
    getActiveConnectors()
      .then((data) => setConnectors(data || []))
      .catch((err) => console.error('Failed to fetch connectors:', err))
      .finally(() => setConnectorsLoading(false));
  }, []);

  const models = useModels();
  const chefs = useChefs();
  const defaultModel = useDefaultModel();
  const conversationV2DefaultModel = useConversationV2DefaultModel();
  const [pickedModelId, setPickedModelId] = useState<string | null>(null);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

  useEffect(() => {
    void useModelsStore.getState().fetchModels().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onDefaultChanged = (event: Event) => {
      const previousDefaultId = (event as CustomEvent<{ previousDefaultId?: string | null }>).detail
        ?.previousDefaultId;
      if (!previousDefaultId) return;
      setPickedModelId((current) => (current === previousDefaultId ? null : current));
    };
    window.addEventListener(CONVERSATION_V2_DEFAULT_MODEL_CHANGED_EVENT, onDefaultChanged);
    return () =>
      window.removeEventListener(CONVERSATION_V2_DEFAULT_MODEL_CHANGED_EVENT, onDefaultChanged);
  }, []);

  const activeModel =
    (pickedModelId && models.find((m) => m.id === pickedModelId)) ||
    conversationV2DefaultModel ||
    defaultModel ||
    null;

  const handleSubmit = (message: PromptInputMessage) => {
    onSubmit(message, selectedWorkspaceIds, pickedModelId);
  };

  const handlePickModel = (modelId: string) => {
    setPickedModelId(modelId);
    setModelSelectorOpen(false);
  };

  return (
    <PromptInputProvider>
      <AgentComposerPrefill text={prefillText} nonce={prefillNonce} />
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            placeholder={placeholder ?? t('agentComposer.placeholder')}
            disabled={disabled}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger />
            <PromptInputActionMenuContent>
              <RecentConnectorsMenu
                connectors={connectors}
                loading={connectorsLoading}
                onSelectConnector={(connector) => toggleSelectedConnector(connector.id)}
                onOpenManage={() => setManageConnectorsOpen(true)}
              />
              <RecentSkillsMenu
                skills={skills}
                loading={skillsLoading}
                selectedIds={selectedSkillIds}
                onSelectSkill={(skill) => toggleSelectedSkill(skill.id)}
                onOpenManage={() => setManageSkillsOpen(true)}
              />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          <WorkspaceSelect
            selectedIds={selectedWorkspaceIds}
            onChange={setSelectedWorkspaceIds}
            disabled={disabled}
          />
          {models.length > 0 && (
            <ModelSelector open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
              <ModelSelectorTrigger asChild>
                <PromptInputButton type='button' disabled={disabled}>
                  {activeModel?.chefSlug && <ModelSelectorLogo provider={activeModel.chefSlug} />}
                  <ModelSelectorName>
                    {activeModel?.name ?? t('composer.modelSelector.unset')}
                  </ModelSelectorName>
                </PromptInputButton>
              </ModelSelectorTrigger>
              <ModelSelectorContent>
                <ModelSelectorInput placeholder={t('composer.modelSelector.search')} />
                <ModelSelectorList>
                  <ModelSelectorEmpty>{t('composer.modelSelector.empty')}</ModelSelectorEmpty>
                  {chefs.map((chef) => (
                    <ModelSelectorGroup heading={chef.name} key={chef.slug}>
                      {models
                        .filter((m) => m.chefSlug === chef.slug)
                        .map((m) => (
                          <ModelSelectorItem
                            key={m.id}
                            value={`${m.name} ${m.chef}`}
                            onSelect={() => handlePickModel(m.id)}
                          >
                            <ModelSelectorLogo provider={m.chefSlug} />
                            <ModelSelectorName>{m.name}</ModelSelectorName>
                            {activeModel?.id === m.id && (
                              <CheckIcon className='ml-auto size-4 text-muted-foreground' />
                            )}
                          </ModelSelectorItem>
                        ))}
                    </ModelSelectorGroup>
                  ))}
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector>
          )}
          <div className='flex-1' />
          <PromptInputSubmit status={disabled ? 'submitted' : 'ready'} />
        </PromptInputFooter>
      </PromptInput>
      <SelectedConnectorsPills
        connectors={connectors}
        selectedIds={selectedConnectorIds}
        onRemove={toggleSelectedConnector}
      />
      <SelectedSkillsPills
        skills={skills}
        selectedIds={selectedSkillIds}
        onRemove={toggleSelectedSkill}
      />
      <ManageConnectorsDialog
        open={manageConnectorsOpen}
        onOpenChange={setManageConnectorsOpen}
        connectors={connectors}
        loading={connectorsLoading}
        onUseConnector={(connector) => toggleSelectedConnector(connector.id)}
      />
      <ManageSkillsDialog
        open={manageSkillsOpen}
        onOpenChange={setManageSkillsOpen}
        skills={skills}
        loading={skillsLoading}
        selectedIds={selectedSkillIds}
        onToggleSkill={(skill) => toggleSelectedSkill(skill.id)}
      />
    </PromptInputProvider>
  );
}
