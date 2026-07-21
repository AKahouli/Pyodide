import { useEffect, useState, useRef, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MultiSelect } from '@/components/ui/multi-select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { AgentConnectorFields } from '@/modules/agent/components/AgentConnectorFields';

import { createAgentFormSchema, defaultFormValues, type AgentFormValues } from './agent-form-schema';
import type { AgentResponse, AgentTypeResponse } from '../../types';
import { getActiveAgentTypes } from '../../api';
import { getActiveConnectors, getActiveSkills, getActiveTools, type ConnectorOption, type ToolOption } from '@/modules/agent/api';
import type { SkillOption } from '@/modules/agent/types';
import { useModels } from '@/modules/models/store';
import { useModelsStore } from '@/modules/models/store';
import { scrollToFirstError } from '@/lib/form-utils';
import { useModuleTranslation } from '@/modules/localization';

function slugifyAgentName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

interface CreateEditAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: AgentResponse | null;
  onSave: (data: AgentFormValues) => void;
  saving: boolean;
}

export function CreateEditAgentDialog({ open, onOpenChange, agent, onSave, saving }: CreateEditAgentDialogProps) {
  const { t } = useModuleTranslation('admin');
  const { t: tCommon } = useModuleTranslation('common');
  const [agentTypes, setAgentTypes] = useState<AgentTypeResponse[]>([]);
  const [availableTools, setAvailableTools] = useState<ToolOption[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillOption[]>([]);
  const [availableConnectors, setAvailableConnectors] = useState<ConnectorOption[]>([]);
  const models = useModels();
  const [loading, setLoading] = useState(false);
  const slugEditedRef = useRef(false);
  const loadedAgentTypeId = useRef<string | null>(null);
  const schema = useMemo(() => createAgentFormSchema(t), [t]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<AgentFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultFormValues,
  });

  useEffect(() => {
    if (open) {
      loadedAgentTypeId.current = agent ? agent.agentType.id : null;
      slugEditedRef.current = false;
      setLoading(true);

      Promise.all([
        getActiveAgentTypes().catch(() => [] as AgentTypeResponse[]),
        useModelsStore
          .getState()
          .fetchModels()
          .catch(() => {}),
        getActiveTools().catch(() => [] as ToolOption[]),
        getActiveSkills().catch(() => [] as SkillOption[]),
        getActiveConnectors().catch(() => [] as ConnectorOption[]),
      ])
        .then(([types, , tools, skills, connectors]) => {
          setAgentTypes(types || []);
          setAvailableTools(tools || []);
          setAvailableSkills(skills || []);
          setAvailableConnectors(connectors || []);

          if (agent) {
            reset({
              name: agent.name,
              slug: agent.slug,
              agentType: agent.agentType.id,
              role: agent.role,
              description: agent.description || '',
              temperature: agent.temperature,
              model: agent.model || '',
              instruction: agent.instruction || '',
              ignorePrePrompt: agent.ignorePrePrompt,
              tools: agent.tools || [],
              skills: agent.skills || [],
              disabledSkills: agent.disabledSkills || [],
              connectors: agent.connectors || [],
              connectorActionSelections: agent.connectorActionSelections || [],
              isActive: agent.isActive,
              isDefaultForType: agent.isDefaultForType || false,
              enable_temporary_child_agents: agent.enable_temporary_child_agents ?? false,
              max_temporary_child_agents: agent.max_temporary_child_agents ?? 4,
            });
          } else {
            reset(defaultFormValues);
          }
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, agent, reset]);

  const selectedAgentTypeId = watch('agentType');
  const watchedName = watch('name');
  useEffect(() => {
    if (!selectedAgentTypeId || !availableTools.length) return;
    if (loadedAgentTypeId.current) {
      if (selectedAgentTypeId === loadedAgentTypeId.current) return;
      loadedAgentTypeId.current = null;
    }
    const agentType = agentTypes.find((at) => at.id === selectedAgentTypeId);
    if (!agentType) return;
    const defaultToolIds = availableTools.filter((t) => t.defaultAgentTypes.includes(agentType.name)).map((t) => t.id);
    setValue('tools', defaultToolIds);
  }, [selectedAgentTypeId, availableTools, agentTypes, setValue]);

  const temperature = watch('temperature');
  const watchedTools = watch('tools');
  const watchedSkills = watch('skills');
  const watchedDisabledSkills = watch('disabledSkills');
  const watchedConnectors = watch('connectors');
  const watchedConnectorActionSelections = watch('connectorActionSelections');
  const inheritedSkillIds = agentTypes.find((at) => at.id === selectedAgentTypeId)?.skills || [];

  useEffect(() => {
    if (slugEditedRef.current) return;
    setValue('slug', slugifyAgentName(watchedName), { shouldValidate: true });
  }, [watchedName, setValue]);

  useEffect(() => {
    const validDisabledSkills = watchedDisabledSkills.filter((id) => inheritedSkillIds.includes(id));
    if (validDisabledSkills.length !== watchedDisabledSkills.length) {
      setValue('disabledSkills', validDisabledSkills);
    }
  }, [inheritedSkillIds, setValue, watchedDisabledSkills]);

  useEffect(() => {
    const validSelections = watchedConnectorActionSelections
      .filter((selection) => watchedConnectors.includes(selection.connectorId))
      .map((selection) => {
        const connector = availableConnectors.find((item) => item.id === selection.connectorId);
        const enabledActionKeys = new Set((connector?.actions || [])
          .filter((action) => action.isEnabled !== false)
          .map((action) => action.key));
        return {
          connectorId: selection.connectorId,
          actionKeys: selection.actionKeys.filter((key) => enabledActionKeys.has(key)),
        };
      })
      .filter((selection) => selection.actionKeys.length > 0);

    if (JSON.stringify(validSelections) !== JSON.stringify(watchedConnectorActionSelections)) {
      setValue('connectorActionSelections', validSelections);
    }
  }, [availableConnectors, setValue, watchedConnectorActionSelections, watchedConnectors]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-3xl h-[80vh] overflow-hidden flex flex-col'>
        <DialogHeader className='shrink-0'>
          <DialogTitle>{agent ? t('defaultAgents.form.dialog.editTitle') : t('defaultAgents.form.dialog.createTitle')}</DialogTitle>
          <DialogDescription>{agent ? t('defaultAgents.form.dialog.editDescription') : t('defaultAgents.form.dialog.createDescription')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className='flex items-center justify-center py-12 flex-1'>
            <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSave, scrollToFirstError)} className='flex flex-col min-h-0 flex-1'>
            <Tabs defaultValue='identity' className='flex-1 min-h-0 flex flex-col'>
              <TabsList className='shrink-0 w-full'>
                <TabsTrigger value='identity'>{t('defaultAgents.form.tabs.identity')}</TabsTrigger>
                <TabsTrigger value='behaviour'>{t('defaultAgents.form.tabs.behaviour')}</TabsTrigger>
                <TabsTrigger value='tools'>{t('defaultAgents.form.tabs.tools')}</TabsTrigger>
                <TabsTrigger value='skills'>{t('defaultAgents.form.tabs.skills')}</TabsTrigger>
                <TabsTrigger value='connectors'>{t('defaultAgents.form.tabs.connectors')}</TabsTrigger>
              </TabsList>

              <ScrollArea className='flex-1 min-h-0 mt-4'>
                <div className='pr-4'>
                  <TabsContent value='identity' forceMount className='mt-0 data-[state=inactive]:hidden'>
                    <div className='grid gap-4'>
                      <div className='space-y-2'>
                        <Label htmlFor='agent-name'>{t('defaultAgents.form.name.label')}</Label>
                        <Input id='agent-name' placeholder={t('defaultAgents.form.name.placeholder')} {...register('name')} />
                        {errors.name && <p className='text-xs text-destructive'>{errors.name.message}</p>}
                      </div>

                      <div className='space-y-2'>
                        <Label htmlFor='agent-slug'>{t('defaultAgents.form.slug.label')}</Label>
                        <Input
                          id='agent-slug'
                          placeholder={t('defaultAgents.form.slug.placeholder')}
                          {...register('slug', {
                            onChange: () => {
                              slugEditedRef.current = true;
                            },
                          })}
                        />
                        <p className='text-xs text-muted-foreground'>{t('defaultAgents.form.slug.helper')}</p>
                        {errors.slug && <p className='text-xs text-destructive'>{errors.slug.message}</p>}
                      </div>

                      <div className='space-y-2' data-field='agentType'>
                        <Label>{t('defaultAgents.form.agentType.label')}</Label>
                        <Select value={watch('agentType')} onValueChange={(value) => setValue('agentType', value)}>
                          <SelectTrigger>
                            <SelectValue placeholder={t('defaultAgents.form.agentType.placeholder')} />
                          </SelectTrigger>
                          <SelectContent>
                            {agentTypes.map((at) => (
                              <SelectItem key={at.id} value={at.id}>
                                {at.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {errors.agentType && <p className='text-xs text-destructive'>{errors.agentType.message}</p>}
                      </div>

                      <div className='flex items-center justify-between'>
                        <div className='space-y-0.5'>
                          <Label>{t('defaultAgents.form.defaultForType.label')}</Label>
                          <p className='text-xs text-muted-foreground'>{t('defaultAgents.form.defaultForType.description')}</p>
                        </div>
                        <Switch checked={watch('isDefaultForType')} onCheckedChange={(checked) => setValue('isDefaultForType', checked)} />
                      </div>

                      <div className='flex items-center justify-between'>
                        <div className='space-y-0.5'>
                          <Label>{t('defaultAgents.form.temporaryChildAgents.label')}</Label>
                          <p className='text-xs text-muted-foreground'>{t('defaultAgents.form.temporaryChildAgents.description')}</p>
                        </div>
                        <Switch
                          checked={watch('enable_temporary_child_agents')}
                          onCheckedChange={(checked) => setValue('enable_temporary_child_agents', checked)}
                        />
                      </div>

                      <div className='space-y-2'>
                        <Label htmlFor='agent-max-temporary-child-agents'>{t('defaultAgents.form.maxTemporaryChildAgents.label')}</Label>
                        <Input
                          id='agent-max-temporary-child-agents'
                          type='number'
                          min={1}
                          max={8}
                          {...register('max_temporary_child_agents', { valueAsNumber: true })}
                        />
                        <p className='text-xs text-muted-foreground'>{t('defaultAgents.form.maxTemporaryChildAgents.description')}</p>
                        {errors.max_temporary_child_agents && <p className='text-xs text-destructive'>{errors.max_temporary_child_agents.message}</p>}
                      </div>

                      <div className='space-y-2'>
                        <Label htmlFor='agent-role'>{t('defaultAgents.form.role.label')}</Label>
                        <Textarea id='agent-role' placeholder={t('defaultAgents.form.role.placeholder')} rows={6} {...register('role')} />
                        {errors.role && <p className='text-xs text-destructive'>{errors.role.message}</p>}
                      </div>

                      <div className='space-y-2'>
                        <Label htmlFor='agent-description'>{t('defaultAgents.form.description.label')}</Label>
                        <Textarea id='agent-description' placeholder={t('defaultAgents.form.description.placeholder')} rows={2} {...register('description')} />
                        {errors.description && <p className='text-xs text-destructive'>{errors.description.message}</p>}
                      </div>

                      <div className='flex items-center justify-between'>
                        <div className='space-y-0.5'>
                          <Label>{t('defaultAgents.form.active.label')}</Label>
                          <p className='text-xs text-muted-foreground'>{t('defaultAgents.form.active.description')}</p>
                        </div>
                        <Switch checked={watch('isActive')} onCheckedChange={(checked) => setValue('isActive', checked)} />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value='behaviour' forceMount className='mt-0 data-[state=inactive]:hidden'>
                    <div className='grid gap-4'>
                      <div className='space-y-2'>
                        <Label>
                          {t('defaultAgents.form.creativityLabel', {
                            value: temperature.toFixed(1),
                          })}
                        </Label>
                        <Slider value={[temperature]} onValueChange={([val]) => setValue('temperature', val)} min={0} max={1} step={0.1} className='w-full' />
                      </div>

                      <div className='space-y-2'>
                        <Label htmlFor='agent-instruction'>{t('defaultAgents.form.instruction.label')}</Label>
                        <Textarea id='agent-instruction' placeholder={t('defaultAgents.form.instruction.placeholder')} rows={6} {...register('instruction')} />
                        {errors.instruction && <p className='text-xs text-destructive'>{errors.instruction.message}</p>}
                      </div>

                      <div className='flex items-center space-x-2'>
                        <Checkbox id='ignore-preprompt' checked={watch('ignorePrePrompt')} onCheckedChange={(checked) => setValue('ignorePrePrompt', checked === true)} />
                        <label htmlFor='ignore-preprompt' className='text-sm font-medium leading-none'>
                          {t('defaultAgents.form.ignorePreprompt')}
                        </label>
                      </div>

                      <div className='space-y-2'>
                        <Label>{t('defaultAgents.form.model.label')}</Label>
                        <SearchableSelect
                          options={[
                            {
                              value: '__none__',
                              label: t('defaultAgents.form.model.defaultOption'),
                            },
                            ...models.map((m) => ({
                              value: m.id,
                              label: m.name,
                            })),
                          ]}
                          value={watch('model') || '__none__'}
                          onValueChange={(val) => setValue('model', val === '__none__' ? '' : val)}
                          placeholder={t('defaultAgents.form.model.placeholder')}
                          searchPlaceholder={t('defaultAgents.form.model.searchPlaceholder')}
                          emptyText={t('defaultAgents.form.model.emptyText')}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value='tools' forceMount className='mt-0 data-[state=inactive]:hidden'>
                    <div className='grid gap-4'>
                      <div className='space-y-2'>
                        <Label>{t('defaultAgents.form.tools.label')}</Label>
                        <p className='text-xs text-muted-foreground'>{t('defaultAgents.form.tools.helper')}</p>
                        <MultiSelect
                          options={availableTools.map((tool) => ({
                            value: tool.id,
                            label: tool.name,
                            description: tool.description,
                          }))}
                          value={watchedTools}
                          onValueChange={(val) => setValue('tools', val)}
                          placeholder={t('defaultAgents.form.tools.selectPlaceholder')}
                          searchPlaceholder={t('defaultAgents.form.tools.searchPlaceholder')}
                          emptyText={t('defaultAgents.form.tools.emptyText')}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value='connectors' forceMount className='mt-0 data-[state=inactive]:hidden'>
                    <div className='grid gap-4'>
                      <AgentConnectorFields
                        availableConnectors={availableConnectors}
                        connectors={watchedConnectors}
                        connectorActionSelections={watchedConnectorActionSelections}
                        onConnectorsChange={(connectorIds) => setValue('connectors', connectorIds, { shouldDirty: true, shouldValidate: true })}
                        onConnectorActionSelectionsChange={(selections) => setValue('connectorActionSelections', selections, { shouldDirty: true, shouldValidate: true })}
                        labels={{
                          title: t('defaultAgents.form.connectors.label'),
                          description: t('defaultAgents.form.connectors.helper'),
                          placeholder: t('defaultAgents.form.connectors.selectPlaceholder'),
                          searchPlaceholder: t('defaultAgents.form.connectors.searchPlaceholder'),
                          emptyText: t('defaultAgents.form.connectors.emptyText'),
                          toolAccessDescription: t('defaultAgents.form.connectors.toolAccessDescription'),
                          allTools: t('defaultAgents.form.connectors.allTools'),
                          selectedTools: t('defaultAgents.form.connectors.selectedTools'),
                          noToolsAvailable: t('defaultAgents.form.connectors.noToolsAvailable'),
                        }}
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value='skills' forceMount className='mt-0 data-[state=inactive]:hidden'>
                    <div className='grid gap-4'>
                      <div className='space-y-2'>
                        <Label>{t('defaultAgents.form.skills.additionalLabel')}</Label>
                        <p className='text-xs text-muted-foreground'>{t('defaultAgents.form.skills.additionalHelper')}</p>
                        <MultiSelect
                          options={availableSkills.map((skill) => ({
                            value: skill.id,
                            label: skill.name,
                            description: skill.description,
                          }))}
                          value={watchedSkills}
                          onValueChange={(val) => setValue('skills', val)}
                          placeholder={t('defaultAgents.form.skills.selectPlaceholder')}
                          searchPlaceholder={t('defaultAgents.form.skills.searchPlaceholder')}
                          emptyText={t('defaultAgents.form.skills.emptyText')}
                        />
                      </div>

                      <div className='space-y-2'>
                        <Label>{t('defaultAgents.form.skills.disabledLabel')}</Label>
                        <p className='text-xs text-muted-foreground'>{t('defaultAgents.form.skills.disabledHelper')}</p>
                        <MultiSelect
                          options={availableSkills
                            .filter((skill) => inheritedSkillIds.includes(skill.id))
                            .map((skill) => ({
                              value: skill.id,
                              label: skill.name,
                              description: skill.description,
                            }))}
                          value={watchedDisabledSkills}
                          onValueChange={(val) => setValue('disabledSkills', val)}
                          placeholder={t('defaultAgents.form.skills.disabledSelectPlaceholder')}
                          searchPlaceholder={t('defaultAgents.form.skills.disabledSearchPlaceholder')}
                          emptyText={t('defaultAgents.form.skills.disabledEmptyText')}
                        />
                      </div>
                    </div>
                  </TabsContent>
                </div>
              </ScrollArea>
            </Tabs>

            <DialogFooter className='pt-4 shrink-0'>
              <Button type='button' variant='outline' onClick={() => onOpenChange(false)} disabled={saving}>
                {tCommon('actionCancel')}
              </Button>
              <Button type='submit' disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                    {t('defaultAgents.form.actions.saving')}
                  </>
                ) : agent ? (
                  t('defaultAgents.form.actions.update')
                ) : (
                  t('defaultAgents.form.actions.create')
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
