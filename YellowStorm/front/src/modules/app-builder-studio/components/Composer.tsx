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
import { useChefs, useDefaultModel, useAppBuilderDefaultModel, useModels } from '@/modules/models';
import { useAppBuilderStudioPointersStore, useAppBuilderStudioStore } from '../store';
import { useAppBuilderStudioTranslation } from '../translation';
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
  /**
   * Disables only the Send button (and Enter-to-send). Typing / model / tools
   * stay available — used while NodePod preview is still booting.
   */
  sendDisabled?: boolean;
}

export function Composer({ onSend, sendDisabled = false }: ComposerProps) {
  const { user } = useAuth();
  const streaming = useAppBuilderStudioStore((s) => s.streaming);
  const events = useAppBuilderStudioStore((s) => s.events);
  const sessionId = useAppBuilderStudioStore((s) => s.sessionId);
  const stop = useAppBuilderStudioStore((s) => s.stop);
  const pause = useAppBuilderStudioStore((s) => s.pause);
  const resume = useAppBuilderStudioStore((s) => s.resume);
  const selectedModelId = useAppBuilderStudioStore((s) => s.selectedModelId);
  const setSelectedModelId = useAppBuilderStudioStore((s) => s.setSelectedModelId);
  const pointerStatus = useAppBuilderStudioPointersStore((s) =>
    sessionId ? s.items.find((p) => p.sessionId === sessionId)?.status : undefined,
  );
  const { t } = useAppBuilderStudioTranslation();
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
  const appBuilderDefaultModel = useAppBuilderDefaultModel();
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [manageConnectorsOpen, setManageConnectorsOpen] = useState(false);
  const selectedConnectorIds = useAppBuilderStudioStore((s) => s.selectedConnectorIds);
  const toggleSelectedConnector = useAppBuilderStudioStore((s) => s.toggleSelectedConnector);

  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [manageSkillsOpen, setManageSkillsOpen] = useState(false);
  const selectedSkillIds = useAppBuilderStudioStore((s) => s.selectedSkillIds);
  const toggleSelectedSkill = useAppBuilderStudioStore((s) => s.toggleSelectedSkill);

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
    appBuilderDefaultModel ||
    defaultModel ||
    null;

  const status: 'ready' | 'streaming' = streaming ? 'streaming' : 'ready';
  const isPaused = !streaming && pointerStatus === 'paused';
  const turnOpen = isTurnOpen(events);
  // Full input lock (streaming / open turn / quota) vs Send-only lock (preview boot).
  const inputLocked = streaming || turnOpen || isLimitExceeded;
  const submitLocked = inputLocked || sendDisabled;

  const handleSubmit = (message: PromptInputMessage) => {
    const value = message.text?.trim() ?? '';
    if (!value || submitLocked || isLimitExceeded) return;
    onSend(value, activeModel?.litellmModel || undefined);
  };

  const handlePickModel = (modelId: string) => {
    setSelectedModelId(modelId);
    setModelSelectorOpen(false);
  };

  return (
    <div className='z-10 shrink-0 border-t border-border/60 bg-background/90 p-3 backdrop-blur-md sm:p-4'>
      {isLimitExceeded ? <UsageLimitBanner /> : null}
      <div className='mx-auto w-full max-w-3xl'>
        <PromptInputProvider
          key={`${user?.id ?? 'anonymous'}:${sessionId ?? 'new'}`}
          draftKey={`${user?.id ?? 'anonymous'}:studio:${sessionId ?? 'new'}`}
        >
          <PromptInput
            onSubmit={handleSubmit}
            className='rounded-2xl border-border/70 bg-card/80 shadow-sm ring-1 ring-border/40 transition-[box-shadow,border-color] focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-primary/15'
          >
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
                                    <CheckIcon className='ms-auto size-4 text-muted-foreground' />
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
                status={status}
                disabled={submitLocked && !streaming}
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
