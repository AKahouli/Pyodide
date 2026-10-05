import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MultiSelect } from "@/components/ui/multi-select";
import { SearchableSelect } from "@/components/ui/searchable-select";

import {
  userAgentFormSchema,
  defaultFormValues,
  type UserAgentFormValues,
} from "./AgentFormSchema";
import { EvaluationTab } from "./EvaluationTab";
import { AgentTelegramIntegrationSection } from "./AgentTelegramIntegrationSection";
import { AgentDeploymentSection } from "./AgentDeploymentSection";
import { AgentConnectorFields } from './AgentConnectorFields';
import { AgentGuardrailsTab } from './AgentGuardrailsTab';
import { AgentReasoningEffortField } from './AgentReasoningEffortField';
import { useAgentTypes, useAgentStore } from "../store";
import { useModels, useModelsStore } from "@/modules/models";
import { getActiveSkills, getActiveTools, getActiveConnectors, getConnectorById, type ToolOption, type ConnectorOption } from "../api";
import { getWorkspaces } from "@/modules/workspace";
import type { Workspace } from "@/modules/workspace/types";
import type { Agent } from "../types";
import type { SkillOption } from '../types';
import { getAdminGuardrailsSettings } from '@/modules/admin/api';
import type { AdminGuardrailsSettings } from '@/modules/admin/types';
import { scrollToFirstError } from "@/lib/form-utils";
import { useModuleTranslation } from "@/modules/localization";
import { mergeWidgetSettings } from '../constants/widget-default-settings';

type LegacyPromptInjectionGuardrails = Partial<UserAgentFormValues['guardrails']['promptInjection']> & {
  classifierPrompt?: string;
  inputGuardrailEnabled?: boolean;
  outputGuardrailEnabled?: boolean;
  toolCallGuardrailEnabled?: boolean;
  toolCallClassifierPrompt?: string;
};

function normalizeGuardrails(value?: {
  promptInjection?: LegacyPromptInjectionGuardrails;
  toolActionReview?: Partial<UserAgentFormValues['guardrails']['toolActionReview']>;
}): UserAgentFormValues['guardrails'] {
  const promptInjection = value?.promptInjection || {};
  const legacyPrompt = promptInjection.classifierPrompt;
  return {
    promptInjection: {
      ...defaultFormValues.guardrails.promptInjection,
      ...promptInjection,
      inputEnabled: promptInjection.inputEnabled ?? promptInjection.inputGuardrailEnabled ?? false,
      outputEnabled: promptInjection.outputEnabled ?? promptInjection.outputGuardrailEnabled ?? false,
      inputClassifierPrompt: promptInjection.inputClassifierPrompt || legacyPrompt || defaultFormValues.guardrails.promptInjection.inputClassifierPrompt,
      outputClassifierPrompt: promptInjection.outputClassifierPrompt || legacyPrompt || defaultFormValues.guardrails.promptInjection.outputClassifierPrompt,
    },
    toolActionReview: {
      ...defaultFormValues.guardrails.toolActionReview,
      ...value?.toolActionReview,
      enabled: value?.toolActionReview?.enabled ?? promptInjection.toolCallGuardrailEnabled ?? false,
      classifierPrompt: value?.toolActionReview?.classifierPrompt || promptInjection.toolCallClassifierPrompt || legacyPrompt || defaultFormValues.guardrails.toolActionReview.classifierPrompt,
    },
  };
}

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

const AGENT_FORM_TABS = [
  { value: 'identity', labelKey: 'createEdit.tabs.identity', tipKey: 'createEdit.tabs.identityTip' },
  { value: 'behaviour', labelKey: 'createEdit.tabs.behaviour', tipKey: 'createEdit.tabs.behaviourTip' },
  { value: 'knowledge', labelKey: 'createEdit.tabs.knowledge', tipKey: 'createEdit.tabs.knowledgeTip' },
  { value: 'tools', labelKey: 'createEdit.tabs.tools', tipKey: 'createEdit.tabs.toolsTip' },
  { value: 'skills', labelKey: 'createEdit.tabs.skills', tipKey: 'createEdit.tabs.skillsTip' },
  { value: 'connectors', labelKey: 'createEdit.tabs.connectors', tipKey: 'createEdit.tabs.connectorsTip' },
  { value: 'guardrails', labelKey: 'createEdit.tabs.guardrails', tipKey: 'createEdit.tabs.guardrailsTip' },
  { value: 'deployment', labelKey: 'createEdit.tabs.deployment', tipKey: 'createEdit.tabs.deploymentTip' },
  { value: 'evaluation', labelKey: 'createEdit.tabs.evaluation', tipKey: 'createEdit.tabs.evaluationTip' },
] as const;

type AgentFormTab = (typeof AGENT_FORM_TABS)[number]['value'];

interface CreateEditAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: Agent | null;
  initialTab?: AgentFormTab;
  onSave: (data: UserAgentFormValues) => void;
  saving: boolean;
  readOnly?: boolean;
}

export function CreateEditAgentDialog({
  open,
  onOpenChange,
  agent,
  initialTab = 'identity',
  onSave,
  saving,
  readOnly = false,
}: CreateEditAgentDialogProps) {
  const agentTypes = useAgentTypes();
  const models = useModels();
  const [availableTools, setAvailableTools] = useState<ToolOption[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillOption[]>([]);
  const [availableConnectors, setAvailableConnectors] = useState<ConnectorOption[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [adminGuardrails, setAdminGuardrails] = useState<AdminGuardrailsSettings | null>(null);
  const slugEditedRef = useRef(false);
  const loadedAgentTypeId = useRef<string | null>(null);
  const { t } = useModuleTranslation('agent');

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<UserAgentFormValues>({
    resolver: zodResolver(userAgentFormSchema),
    defaultValues: defaultFormValues,
  });

  useEffect(() => {
    if (open) {
      loadedAgentTypeId.current = agent ? agent.agentType.id : null;
      slugEditedRef.current = false;
      setLoading(true);

      Promise.all([
        useAgentStore.getState().fetchAgentTypes().catch(() => { }),
        useModelsStore.getState().fetchModels().catch(() => { }),
        getActiveTools().catch(() => [] as ToolOption[]),
        getActiveSkills().catch(() => [] as SkillOption[]),
        getActiveConnectors()
          .then(async (connectors) => {
            // The visible list filters out hidden connectors; re-fetch any
            // hidden connector already attached to this agent so its chip
            // renders and it can be detached.
            const missing = (agent?.connectors || [])
              .filter((id) => !connectors.some((c) => c.id === id));
            const hidden = await Promise.all(
              missing.map((id) => getConnectorById(id).catch(() => null)),
            );
            return [...connectors, ...hidden.filter((c): c is ConnectorOption => Boolean(c))];
          })
          .catch(() => [] as ConnectorOption[]),
        getWorkspaces({ limit: 100 }).then((res) => res.workspaces).catch(() => [] as Workspace[]),
        getAdminGuardrailsSettings().catch(() => null),
      ]).then(([, , tools, skills, connectors, ws, guardrailsSettings]) => {
        setAvailableTools(tools || []);
        setAvailableSkills(skills || []);
        setAvailableConnectors(connectors || []);
        setWorkspaces(ws || []);
        setAdminGuardrails(guardrailsSettings);

        if (agent) {
          reset({
            name: agent.name,
            slug: agent.slug,
            agentType: agent.agentType.id,
            role: agent.role,
            description: agent.description || "",
            temperature: agent.temperature,
            model: agent.model || "",
            reasoningEffort: agent.reasoning_effort || "",
            instruction: agent.instruction || "",
            ignorePrePrompt: agent.ignorePrePrompt,
            knowledgeBases: agent.knowledgeBases || [],
            tools: agent.tools || [],
            skills: agent.skills || [],
            disabledSkills: agent.disabledSkills || [],
            connectors: agent.connectors || [],
            connectorActionSelections: agent.connectorActionSelections || [],
            isActive: agent.isActive,
            enable_temporary_child_agents: agent.enable_temporary_child_agents ?? false,
            max_temporary_child_agents: agent.max_temporary_child_agents ?? 4,
            guardrails: normalizeGuardrails(agent.guardrails),
            deploymentSettings: {
              ...defaultFormValues.deploymentSettings,
              ...agent.deploymentSettings,
              widget: mergeWidgetSettings(agent.deploymentSettings?.widget),
            },
          });
        } else {
          reset(defaultFormValues);
        }
      }).finally(() => {
        setLoading(false);
      });
    }
  }, [open, agent, reset]);

  // Auto-select default tools when agent type changes (skip if it matches the loaded edit value)
  const selectedAgentTypeId = watch("agentType");
  useEffect(() => {
    if (!selectedAgentTypeId || !availableTools.length) return;
    if (loadedAgentTypeId.current) {
      if (selectedAgentTypeId === loadedAgentTypeId.current) return;
      loadedAgentTypeId.current = null;
    }
    const agentType = agentTypes.find((at) => at.id === selectedAgentTypeId);
    if (!agentType) return;
    const defaultToolIds = availableTools
      .filter((t) => t.defaultAgentTypes.includes(agentType.name))
      .map((t) => t.id);
    setValue("tools", defaultToolIds);
  }, [selectedAgentTypeId, availableTools, agentTypes, setValue]);

  const temperature = watch("temperature");
  const selectedModelId = watch('model');
  const reasoningEffort = watch('reasoningEffort');
  const watchedName = watch("name");
  const watchedTools = watch("tools");
  const watchedKBs = watch("knowledgeBases");
  const watchedSkills = watch('skills');
  const watchedDisabledSkills = watch('disabledSkills');
  const watchedConnectors = watch('connectors');
  const watchedConnectorActionSelections = watch('connectorActionSelections');
  const watchedGuardrails = watch('guardrails');
  const watchedDeploymentSettings = watch('deploymentSettings');
  const forceGuardrails = adminGuardrails?.forceActivation === true;
  const inheritedSkillIds = agentTypes.find((at) => at.id === selectedAgentTypeId)?.skills || [];
  const selectedModel = models.find((model) => model.id === selectedModelId);

  useEffect(() => {
    if (!selectedModelId) {
      if (reasoningEffort) setValue('reasoningEffort', '', { shouldDirty: true });
      return;
    }
    if (!selectedModel) return;
    const efforts = selectedModel.supportsReasoning ? (selectedModel.reasoning?.efforts ?? []) : [];
    const defaultEffort = selectedModel.reasoning?.defaultEffort;
    const fallbackEffort = efforts.find((effort) => effort.id === defaultEffort)?.id ?? '';
    const nextEffort = efforts.some((effort) => effort.id === reasoningEffort)
      ? reasoningEffort
      : fallbackEffort;
    if (nextEffort !== reasoningEffort) {
      setValue('reasoningEffort', nextEffort, { shouldDirty: true });
    }
  }, [reasoningEffort, selectedModel, selectedModelId, setValue]);

  useEffect(() => {
    if (agent || slugEditedRef.current) return;
    setValue('slug', slugifyAgentName(watchedName), { shouldValidate: watchedName.length > 0 });
  }, [agent, watchedName, setValue]);

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
      <DialogContent className="h-[80vh] w-[calc(100%-2rem)] max-w-5xl overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {agent ? t('createEdit.titleEdit') : t('createEdit.titleCreate')}
          </DialogTitle>
          <DialogDescription>
            {agent
              ? t('createEdit.descriptionEdit')
              : t('createEdit.descriptionCreate')}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 flex-1">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form
            onSubmit={readOnly ? (event) => event.preventDefault() : handleSubmit(onSave, scrollToFirstError)}
            className="flex flex-col min-h-0 flex-1"
          >
            <Tabs defaultValue={initialTab} className="flex-1 min-h-0 flex flex-col">
              <TooltipProvider delayDuration={300}>
                <div className="w-full shrink-0 overflow-x-auto">
                  <TabsList className="flex h-auto w-max min-w-full flex-nowrap justify-start gap-1">
                    {AGENT_FORM_TABS.map((tab) => (
                      <Tooltip key={tab.value}>
                        <TooltipTrigger asChild>
                          <TabsTrigger
                            value={tab.value}
                            className="shrink-0 flex-none px-2.5 sm:px-3"
                          >
                            {t(tab.labelKey)}
                          </TabsTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs text-center">
                          {t(tab.tipKey)}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </TabsList>
                </div>
              </TooltipProvider>
              <ScrollArea className="flex-1 min-h-0 mt-4">
                <fieldset disabled={readOnly} className="contents">
                <div className="pr-4">
                  {/* Identity Tab */}
                  <TabsContent value="identity" forceMount className="mt-0 data-[state=inactive]:hidden">
                    <div className="grid gap-4">
                      {/* Name */}
                      <div className="space-y-2">
                        <Label htmlFor="user-agent-name">{t('createEdit.fields.name')}</Label>
                        <Input
                          id="user-agent-name"
                          placeholder={t('createEdit.fields.namePlaceholder')}
                          {...register("name")}
                        />
                        {errors.name && (
                          <p className="text-xs text-destructive">{errors.name.message}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="user-agent-slug">{t('createEdit.fields.slug')}</Label>
                        <Input
                          id="user-agent-slug"
                          placeholder={t('createEdit.fields.slugPlaceholder')}
                          {...register("slug", {
                            onChange: () => {
                              slugEditedRef.current = true;
                            },
                          })}
                        />
                        <p className="text-xs text-muted-foreground">{t('createEdit.fields.slugHelper')}</p>
                        {errors.slug && (
                          <p className="text-xs text-destructive">{errors.slug.message}</p>
                        )}
                      </div>

                      {/* Agent Type */}
                      <div className="space-y-2" data-field="agentType">
                        <Label>{t('createEdit.fields.agentType')}</Label>
                        <Select
                          value={watch("agentType")}
                          onValueChange={(value) => setValue("agentType", value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t('createEdit.fields.agentTypePlaceholder')} />
                          </SelectTrigger>
                          <SelectContent>
                            {agentTypes.map((at) => (
                              <SelectItem key={at.id} value={at.id}>
                                {at.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {errors.agentType && (
                          <p className="text-xs text-destructive">{errors.agentType.message}</p>
                        )}
                      </div>

                      {/* Role */}
                      <div className="space-y-2">
                        <Label htmlFor="user-agent-role">{t('createEdit.fields.role')}</Label>
                        <Textarea
                          id="user-agent-role"
                          placeholder={t('createEdit.fields.rolePlaceholder')}
                          rows={6}
                          {...register("role")}
                        />
                        {errors.role && (
                          <p className="text-xs text-destructive">{errors.role.message}</p>
                        )}
                      </div>

                      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{t('library.manage')}</summary><div className="mt-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>{t('createEdit.fields.temporaryChildAgents')}</Label>
                          <p className="text-xs text-muted-foreground">
                            {t('createEdit.fields.temporaryChildAgentsDescription')}
                          </p>
                        </div>
                        <Switch
                          checked={watch("enable_temporary_child_agents")}
                          onCheckedChange={(checked) => setValue("enable_temporary_child_agents", checked)}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="user-agent-max-temporary-child-agents">
                          {t('createEdit.fields.maxTemporaryChildAgents')}
                        </Label>
                        <Input
                          id="user-agent-max-temporary-child-agents"
                          type="number"
                          min={1}
                          max={8}
                          {...register("max_temporary_child_agents", { valueAsNumber: true })}
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('createEdit.fields.maxTemporaryChildAgentsDescription')}
                        </p>
                        {errors.max_temporary_child_agents && (
                          <p className="text-xs text-destructive">{errors.max_temporary_child_agents.message}</p>
                        )}
                      </div>

</div></details>
                      {/* Description */}
                      <div className="space-y-2">
                        <Label htmlFor="user-agent-description">{t('createEdit.fields.description')}</Label>
                        <Textarea
                          id="user-agent-description"
                          placeholder={t('createEdit.fields.descriptionPlaceholder')}
                          rows={2}
                          {...register("description")}
                        />
                      </div>

                      {/* Active Switch */}
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>{t('createEdit.fields.active')}</Label>
                          <p className="text-xs text-muted-foreground">
                            {t('createEdit.fields.activeDescription')}
                          </p>
                        </div>
                        <Switch
                          checked={watch("isActive")}
                          onCheckedChange={(checked) => setValue("isActive", checked)}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  {/* Behaviour Tab */}
                  <TabsContent value="behaviour" forceMount className="mt-0 data-[state=inactive]:hidden">
                    <div className="grid gap-4">
                      {/* Temperature */}
                      <div className="space-y-2">
                        <Label>{t('createEdit.fields.creativity')}{temperature.toFixed(1)}</Label>
                        <Slider
                          value={[temperature]}
                          onValueChange={([val]) => setValue("temperature", val)}
                          min={0}
                          max={1}
                          step={0.1}
                          className="w-full"
                        />
                      </div>

                      {/* Instruction */}
                      <div className="space-y-2">
                        <Label htmlFor="user-agent-instruction">{t('createEdit.fields.additionalInstruction')}</Label>
                        <Textarea
                          id="user-agent-instruction"
                          placeholder={t('createEdit.fields.instructionPlaceholder')}
                          rows={6}
                          {...register("instruction")}
                        />
                      </div>

                      {/* Ignore Pre-prompt */}
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="user-ignore-preprompt"
                          checked={watch("ignorePrePrompt")}
                          onCheckedChange={(checked) =>
                            setValue("ignorePrePrompt", checked === true)
                          }
                        />
                        <label
                          htmlFor="user-ignore-preprompt"
                          className="text-sm font-medium leading-none"
                        >
                          {t('createEdit.fields.ignorePrePrompt')}
                        </label>
                      </div>

                      {/* Model */}
                      <div className="space-y-2">
                        <Label>{t('createEdit.fields.model')}</Label>
                        <SearchableSelect
                          options={[
                            { value: "__none__", label: t('createEdit.fields.modelDefault') },
                            ...models.map((m) => ({ value: m.id, label: m.name })),
                          ]}
                          value={watch("model") || "__none__"}
                          onValueChange={(val) => setValue("model", val === "__none__" ? "" : val)}
                          placeholder={t('createEdit.fields.modelDefault')}
                          searchPlaceholder={t('createEdit.fields.searchModels')}
                          emptyText={t('createEdit.fields.noModelsFound')}
                        />
                      </div>

                      <AgentReasoningEffortField
                        model={selectedModel}
                        value={reasoningEffort}
                        onValueChange={(value) => setValue('reasoningEffort', value, { shouldDirty: true })}
                      />
                    </div>
                  </TabsContent>

                  {/* Knowledge Tab */}
                  <TabsContent value="knowledge" forceMount className="mt-0 data-[state=inactive]:hidden">
                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <Label>{t('createEdit.fields.knowledgeBases')}</Label>
                        <p className="text-xs text-muted-foreground">
                          {t('createEdit.fields.knowledgeBasesDescription')}
                        </p>
                        <MultiSelect
                          options={workspaces.map((ws) => ({
                            value: ws.id,
                            label: ws.name,
                            description: ws.description,
                          }))}
                          value={watchedKBs}
                          onValueChange={(val) => setValue("knowledgeBases", val)}
                          placeholder={t('createEdit.fields.selectWorkspaces')}
                          searchPlaceholder={t('createEdit.fields.searchWorkspaces')}
                          emptyText={t('createEdit.fields.noWorkspacesFound')}
                        />
                      </div>
                    </div>
                  </TabsContent>
                  {/* Tools Tab */}
                  <TabsContent value="tools" forceMount className="mt-0 data-[state=inactive]:hidden">
                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <Label>{t('createEdit.fields.tools')}</Label>
                        <p className="text-xs text-muted-foreground">
                          {t('createEdit.fields.toolsDescription')}
                        </p>
                        <MultiSelect
                          options={availableTools.map((tool) => ({
                            value: tool.id,
                            label: tool.name,
                            description: tool.description,
                          }))}
                          value={watchedTools}
                          onValueChange={(val) => setValue("tools", val)}
                          placeholder={t('createEdit.fields.selectTools')}
                          searchPlaceholder={t('createEdit.fields.searchTools')}
                          emptyText={t('createEdit.fields.noToolsFound')}
                        />
                      </div>
                    </div>
                  </TabsContent>
<TabsContent value="skills" forceMount className="mt-0 data-[state=inactive]:hidden">
                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <Label>{t('createEdit.fields.additionalSkills')}</Label>
                      <p className="text-xs text-muted-foreground">{t('createEdit.fields.additionalSkillsDescription')}</p>
                      <MultiSelect
                        options={availableSkills.map((skill) => ({
                          value: skill.id,
                          label: skill.name,
                          description: skill.description,
                        }))}
                        value={watchedSkills}
                        onValueChange={(val) => setValue('skills', val)}
                        placeholder={t('createEdit.fields.selectSkills')}
                        searchPlaceholder={t('createEdit.fields.searchSkills')}
                        emptyText={t('createEdit.fields.noSkillsFound')}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>{t('createEdit.fields.disabledInheritedSkills')}</Label>
                      <p className="text-xs text-muted-foreground">{t('createEdit.fields.disabledInheritedSkillsDescription')}</p>
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
                        placeholder={t('createEdit.fields.selectInheritedSkillsToDisable')}
                        searchPlaceholder={t('createEdit.fields.searchInheritedSkills')}
                        emptyText={t('createEdit.fields.noInheritedSkillsAvailable')}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="connectors" forceMount className="mt-0 data-[state=inactive]:hidden">
                  <div className="grid gap-4">
                    <AgentConnectorFields
                      availableConnectors={availableConnectors}
                      connectors={watchedConnectors}
                      connectorActionSelections={watchedConnectorActionSelections}
                      onConnectorsChange={(connectorIds) => setValue('connectors', connectorIds, { shouldDirty: true, shouldValidate: true })}
                      onConnectorActionSelectionsChange={(selections) => setValue('connectorActionSelections', selections, { shouldDirty: true, shouldValidate: true })}
                    />

                  </div>
                </TabsContent>

                <TabsContent value="guardrails" forceMount className="mt-0 data-[state=inactive]:hidden">
                  <AgentGuardrailsTab
                    value={watchedGuardrails}
                    disabled={forceGuardrails}
                    forceActivation={forceGuardrails}
                    onChange={(next) => setValue('guardrails', next, { shouldDirty: true, shouldValidate: true })}
                  />
                </TabsContent>

                <TabsContent value="deployment" forceMount className="mt-0 data-[state=inactive]:hidden">
                  <div className="grid gap-4">
                    <AgentDeploymentSection
                      agentId={agent?.id ?? null}
                      agentName={watchedName}
                      value={watchedDeploymentSettings}
                      onChange={(next) => setValue('deploymentSettings', next, { shouldDirty: true, shouldValidate: true })}
                      readOnly={readOnly}
                    />
                    <AgentTelegramIntegrationSection agentId={agent?.id ?? null} readOnly={readOnly} />
                  </div>
                </TabsContent>

                  {/* Evaluation Tab */}
                  <TabsContent value="evaluation" forceMount className="mt-0 data-[state=inactive]:hidden">
                    <EvaluationTab agent={agent} readOnly={readOnly} />
                  </TabsContent>
                </div>
                </fieldset>
              </ScrollArea>
            </Tabs>

            <DialogFooter className="pt-4 shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                {t('createEdit.actions.cancel')}
              </Button>
              {!readOnly && <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('createEdit.actions.saving')}
                  </>
                ) : agent ? (
                  t('createEdit.actions.saveChanges')
                ) : (
                  t('createEdit.actions.createAgent')
                )}
              </Button>}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
