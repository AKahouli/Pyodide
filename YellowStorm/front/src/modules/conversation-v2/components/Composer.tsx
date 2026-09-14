import { useState, useEffect, useMemo } from 'react';
import { CheckIcon, PauseIcon, PlayIcon, SquareIcon } from 'lucide-react';
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
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
import {
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
} from '@/components/ai-elements/prompt-input';
import { RecentConnectorsMenu, ManageConnectorsDialog, SelectedConnectorsPills } from '@/modules/connector';
import { VersionSwitcher } from './RightPanel/VersionHistoryPanel';
import { useChefs, useDefaultModel, useConversationV2DefaultModel, useModels } from '@/modules/models';
import { useConversationV2PointersStore, useConversationV2Store } from '../store';
import { useConversationV2Translation } from '../translation';
import { isTurnOpen } from '../utils/session-reducer';
import { getActiveConnectors, getActiveSkills, type ConnectorOption } from '@/modules/agent/api';
import type { SkillOption } from '@/modules/agent/types';
import { RecentSkillsMenu } from '@/modules/skill/components/RecentSkillsMenu';
import { ManageSkillsDialog } from '@/modules/skill/components/ManageSkillsDialog';
import { SelectedSkillsPills } from '@/modules/skill/components/SelectedSkillsPills';
import { UsageLimitBanner } from '@/modules/usage';
import { useUsage } from '@/modules/usage/UsageContext';
import { useModuleTranslation } from '@/modules/localization';
import { useAuth } from '@/modules/auth/useAuth';

interface ComposerProps {
  onSend: (text: string, model?: string) => void | Promise<void>;
}

export function Composer({ onSend }: ComposerProps) {
  const { user } = useAuth();
  const streaming = useConversationV2Store((s) => s.streaming);
  const events = useConversationV2Store((s) => s.events);
  const sessionId = useConversationV2Store((s) => s.sessionId);
  const stop = useConversationV2Store((s) => s.stop);
  const pause = useConversationV2Store((s) => s.pause);
  const resume = useConversationV2Store((s) => s.resume);
  const selectedModelId = useConversationV2Store((s) => s.selectedModelId);
  const setSelectedModelId = useConversationV2Store((s) => s.setSelectedModelId);
  const pointerStatus = useConversationV2PointersStore((s) =>
    sessionId ? s.items.find((p) => p.sessionId === sessionId)?.status : undefined,
  );
  const { t } = useConversationV2Translation();
  const { t: tConversation } = useModuleTranslation('conversation');
  const { status: usageStatus } = useUsage();
  const isLimitExceeded = usageStatus?.isLimitExceeded ?? false;

  const limitPlaceholder = useMemo(() => {
    if (!isLimitExceeded) return undefined;
    if (!usageStatus?.resetsAt) return tConversation('input.limitReached');
    const now = new Date();
    const reset = new Date(usageStatus.resetsAt);
    const diffMs = reset.getTime() - now.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.max(0, Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)));
    if (hours > 0) {
      return tConversation('input.limitCountdownHours', { hours, minutes });
    }
    return tConversation('input.limitCountdownMinutes', { minutes });
  }, [isLimitExceeded, usageStatus?.resetsAt, tConversation]);

  const models = useModels();
  const chefs = useChefs();
  const defaultModel = useDefaultModel();
  const conversationV2DefaultModel = useConversationV2DefaultModel();
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [manageConnectorsOpen, setManageConnectorsOpen] = useState(false);
  const selectedConnectorIds = useConversationV2Store((s) => s.selectedConnectorIds);
  const toggleSelectedConnector = useConversationV2Store((s) => s.toggleSelectedConnector);

  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [manageSkillsOpen, setManageSkillsOpen] = useState(false);
  const selectedSkillIds = useConversationV2Store((s) => s.selectedSkillIds);
  const toggleSelectedSkill = useConversationV2Store((s) => s.toggleSelectedSkill);

  useEffect(() => {
    setConnectorsLoading(true);
    getActiveConnectors()
      .then((data) => setConnectors(data || []))
      .catch((err) => console.error('Failed to fetch connectors:', err))
      .finally(() => setConnectorsLoading(false));
  }, []);

  useEffect(() => {
    setSkillsLoading(true);
    getActiveSkills()
      .then((data) => setSkills(data || []))
      .catch((err) => console.error('Failed to fetch skills:', err))
      .finally(() => setSkillsLoading(false));
  }, []);

  // selectedModelId is null for fresh conversations → fall through to the
  // admin default. Both for the trigger label and for what we send on the
  // wire. (The wire payload is the LiteLLM identifier, not the modelId.)
  const activeModel =
    (selectedModelId && models.find((m) => m.id === selectedModelId)) ||
    conversationV2DefaultModel ||
    defaultModel ||
    null;

  const status: 'ready' | 'streaming' = streaming ? 'streaming' : 'ready';
  const isPaused = !streaming && pointerStatus === 'paused';
  const turnOpen = isTurnOpen(events);
  const inputLocked = streaming || turnOpen || isLimitExceeded;

  const handleSubmit = (message: PromptInputMessage) => {
    const value = message.text?.trim() ?? '';
    if (!value || inputLocked || isLimitExceeded) return;
    onSend(value, activeModel?.litellmModel || undefined);
  };

  const handlePickModel = (modelId: string) => {
    setSelectedModelId(modelId);
    setModelSelectorOpen(false);
  };

  return (
    <div className='shrink-0 z-10 border-t border-border/50 bg-background/80 p-4 backdrop-blur-xs'>
      {isLimitExceeded ? <UsageLimitBanner /> : null}
      <div className='mx-auto w-full max-w-3xl'>
        <PromptInputProvider key={`${user?.id ?? 'anonymous'}:${sessionId ?? 'new'}`} draftKey={`${user?.id ?? 'anonymous'}:conversation-v2:${sessionId ?? 'new'}`}>
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                placeholder={limitPlaceholder ?? t('composer.placeholder')}
                disabled={inputLocked}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                {models.length > 0 && (
                  <ModelSelector open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
                    <ModelSelectorTrigger asChild>
                      <PromptInputButton type='button' disabled={inputLocked}>
                        {activeModel?.chefSlug && (
                          <ModelSelectorLogo provider={activeModel.chefSlug} />
                        )}
                        <ModelSelectorName>
                          {activeModel?.name ?? t('composer.modelSelector.unset')}
                        </ModelSelectorName>
                      </PromptInputButton>
                    </ModelSelectorTrigger>
                    <ModelSelectorContent>
                      <ModelSelectorInput placeholder={t('composer.modelSelector.search')} />
                      <ModelSelectorList>
                        <ModelSelectorEmpty>
                          {t('composer.modelSelector.empty')}
                        </ModelSelectorEmpty>
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
                <VersionSwitcher />
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
                {streaming && (
                  <PromptInputButton type='button' onClick={() => void pause()}>
                    <PauseIcon className='size-4' />
                    <span>{t('controls.pause')}</span>
                  </PromptInputButton>
                )}
                {streaming && (
                  <PromptInputButton type='button' onClick={() => void stop()}>
                    <SquareIcon className='size-4' />
                    <span>{t('controls.stop')}</span>
                  </PromptInputButton>
                )}
                {isPaused && (
                  <PromptInputButton type='button' onClick={() => void resume()}>
                    <PlayIcon className='size-4' />
                    <span>{t('controls.resume')}</span>
                  </PromptInputButton>
                )}
              </PromptInputTools>
              <PromptInputSubmit
                status={inputLocked ? 'streaming' : status}
                onStop={() => void stop()}
              />
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
        </PromptInputProvider>
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
      </div>
    </div>
  );
}
