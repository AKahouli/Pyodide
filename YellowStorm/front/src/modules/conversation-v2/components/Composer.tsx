import { useState, useEffect, useCallback } from 'react';
import { CheckIcon, PauseIcon, PlayIcon, SquareIcon, Cable, Loader2 } from 'lucide-react';
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
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import {
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuSub,
  PromptInputActionMenuSubContent,
  PromptInputActionMenuSubTrigger,
  PromptInputActionMenuTrigger,
} from '@/components/ai-elements/prompt-input';
import { ConnectorReposDialog } from '@/components/ai-elements/connector-repos-dialog';
import { useChefs, useDefaultModel, useModels } from '@/modules/models';
import { useConversationV2PointersStore, useConversationV2Store } from '../store';
import { useConversationV2Translation } from '../translation';
import { getActiveConnectors, getActiveSkills, type ConnectorOption } from '@/modules/agent/api';
import type { SkillOption } from '@/modules/agent/types';
import { RecentSkillsMenu } from '@/modules/skill/components/RecentSkillsMenu';
import { ManageSkillsDialog } from '@/modules/skill/components/ManageSkillsDialog';

interface ComposerProps {
  onSend: (text: string, model?: string) => void;
}

export function Composer({ onSend }: ComposerProps) {
  const streaming = useConversationV2Store((s) => s.streaming);
  const sessionId = useConversationV2Store((s) => s.sessionId);
  const stop = useConversationV2Store((s) => s.stop);
  const pause = useConversationV2Store((s) => s.pause);
  const resume = useConversationV2Store((s) => s.resume);
  const selectedModelId = useConversationV2Store((s) => s.selectedModelId);
  const setSelectedModelId = useConversationV2Store((s) => s.setSelectedModelId);
  const selectedConnectorRepo = useConversationV2Store((s) => s.selectedConnectorRepo);
  const setSelectedConnectorRepo = useConversationV2Store((s) => s.setSelectedConnectorRepo);
  const pointerStatus = useConversationV2PointersStore((s) =>
    sessionId ? s.items.find((p) => p.sessionId === sessionId)?.status : undefined,
  );
  const { t } = useConversationV2Translation();

  const models = useModels();
  const chefs = useChefs();
  const defaultModel = useDefaultModel();
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

  const [connectors, setConnectors] = useState<ConnectorOption[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [connectorDialogOpen, setConnectorDialogOpen] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState<ConnectorOption | null>(null);

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

  const handleRepositorySelect = useCallback(
    (repo: { connectorId: string; connectorName: string; repoId: string; repoName: string; repoUrl?: string }) => {
      setSelectedConnectorRepo(repo);
    },
    [setSelectedConnectorRepo],
  );

  // selectedModelId is null for fresh conversations → fall through to the
  // admin default. Both for the trigger label and for what we send on the
  // wire. (The wire payload is the LiteLLM identifier, not the modelId.)
  const activeModel =
    (selectedModelId && models.find((m) => m.id === selectedModelId)) || defaultModel || null;

  const status: 'ready' | 'streaming' = streaming ? 'streaming' : 'ready';
  const isPaused = !streaming && pointerStatus === 'paused';

  const handleSubmit = (message: PromptInputMessage) => {
    const value = message.text?.trim() ?? '';
    if (!value || streaming) return;
    onSend(value, activeModel?.litellmModel || undefined);
  };

  const handlePickModel = (modelId: string) => {
    setSelectedModelId(modelId);
    setModelSelectorOpen(false);
  };

  return (
    <div className='shrink-0 z-10 border-t border-border/50 bg-background/80 p-4 backdrop-blur-xs'>
      <div className='mx-auto w-full max-w-3xl'>
        <PromptInputProvider>
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea placeholder={t('composer.placeholder')} disabled={streaming} />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                {models.length > 0 && (
                  <ModelSelector open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
                    <ModelSelectorTrigger asChild>
                      <PromptInputButton type='button' disabled={streaming}>
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
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger />
                  <PromptInputActionMenuContent>
                    <PromptInputActionMenuSub>
                      <PromptInputActionMenuSubTrigger>
                        <Cable className='mr-2 size-4' />
                        {t('composer.connectors') || 'Connectors'}
                      </PromptInputActionMenuSubTrigger>
                      <PromptInputActionMenuSubContent>
                        {connectorsLoading ? (
                          <div className='flex items-center justify-center py-2 px-4'>
                            <Loader2 className='size-4 animate-spin' />
                          </div>
                        ) : connectors.length === 0 ? (
                          <div className='py-2 px-4 text-sm text-muted-foreground'>
                            {t('composer.noConnectors') || 'No connectors available'}
                          </div>
                        ) : (
                          connectors.map((connector) => (
                            <DropdownMenuItem
                              key={connector.id}
                              onSelect={() => {
                                setSelectedConnector(connector);
                                setConnectorDialogOpen(true);
                              }}
                            >
                              <div className='flex flex-col'>
                                <span className='font-medium'>{connector.name}</span>
                                {connector.description && (
                                  <span className='text-xs text-muted-foreground'>{connector.description}</span>
                                )}
                              </div>
                            </DropdownMenuItem>
                          ))
                        )}
                      </PromptInputActionMenuSubContent>
                    </PromptInputActionMenuSub>
                    <RecentSkillsMenu
                      skills={skills}
                      loading={skillsLoading}
                      selectedIds={selectedSkillIds}
                      onSelectSkill={(skill) => toggleSelectedSkill(skill.id)}
                      onOpenManage={() => setManageSkillsOpen(true)}
                    />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                {selectedConnectorRepo && (
                  <span className='inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground'>
                    <Cable className='size-3' />
                    {selectedConnectorRepo.repoName}
                  </span>
                )}
                {skills
                  .filter((s) => selectedSkillIds.includes(s.id))
                  .map((s) => (
                    <button
                      key={s.id}
                      type='button'
                      onClick={() => toggleSelectedSkill(s.id)}
                      className='inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground'
                    >
                      {s.name}
                    </button>
                  ))}
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
              <PromptInputSubmit status={status} onStop={() => void stop()} />
            </PromptInputFooter>
          </PromptInput>
        </PromptInputProvider>
        <ConnectorReposDialog
          open={connectorDialogOpen}
          onOpenChange={setConnectorDialogOpen}
          connector={selectedConnector}
          onRepositorySelect={handleRepositorySelect}
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
