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
import { MultiSelect } from "@/components/ui/multi-select";
import { SearchableSelect } from "@/components/ui/searchable-select";

import {
  userAgentFormSchema,
  defaultFormValues,
  type UserAgentFormValues,
} from "./AgentFormSchema";
import { useAgentTypes, useAgentStore } from "../store";
import { useModels, useModelsStore } from "@/modules/models/store";
import { getActiveTools, type ToolOption } from "../api";
import { getWorkspaces } from "@/modules/workspace";
import type { Workspace } from "@/modules/workspace/types";
import type { Agent } from "../types";
import { scrollToFirstError } from "@/lib/form-utils";
import { useModuleTranslation } from "@/modules/localization";

interface CreateEditAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: Agent | null;
  onSave: (data: UserAgentFormValues) => void;
  saving: boolean;
}

export function CreateEditAgentDialog({
  open,
  onOpenChange,
  agent,
  onSave,
  saving,
}: CreateEditAgentDialogProps) {
  const agentTypes = useAgentTypes();
  const models = useModels();
  const [availableTools, setAvailableTools] = useState<ToolOption[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
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
      setLoading(true);

      Promise.all([
        useAgentStore.getState().fetchAgentTypes().catch(() => {}),
        useModelsStore.getState().fetchModels().catch(() => {}),
        getActiveTools().catch(() => [] as ToolOption[]),
        getWorkspaces({ limit: 100 }).then((res) => res.workspaces).catch(() => [] as Workspace[]),
      ]).then(([, , tools, ws]) => {
        setAvailableTools(tools || []);
        setWorkspaces(ws || []);

        if (agent) {
          reset({
            name: agent.name,
            agentType: agent.agentType.id,
            role: agent.role,
            description: agent.description || "",
            temperature: agent.temperature,
            model: agent.model || "",
            instruction: agent.instruction || "",
            ignorePrePrompt: agent.ignorePrePrompt,
            knowledgeBases: agent.knowledgeBases || [],
            tools: agent.tools || [],
            isActive: agent.isActive,
            isDefaultForType: agent.isDefaultForType || false,
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
  const watchedTools = watch("tools");
  const watchedKBs = watch("knowledgeBases");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[80vh] overflow-hidden flex flex-col">
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
          onSubmit={handleSubmit(onSave, scrollToFirstError)}
          className="flex flex-col min-h-0 flex-1"
        >
          <Tabs defaultValue="identity" className="flex-1 min-h-0 flex flex-col">
            <TabsList className="shrink-0 w-full">
              <TabsTrigger value="identity">{t('createEdit.tabs.identity')}</TabsTrigger>
              <TabsTrigger value="behaviour">{t('createEdit.tabs.behaviour')}</TabsTrigger>
              <TabsTrigger value="knowledge">{t('createEdit.tabs.knowledge')}</TabsTrigger>
              <TabsTrigger value="tools">{t('createEdit.tabs.tools')}</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 min-h-0 mt-4">
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

                    {/* Default for Type */}
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>{t('createEdit.fields.defaultForType')}</Label>
                        <p className="text-xs text-muted-foreground">
                          {t('createEdit.fields.defaultForTypeDescription')}
                        </p>
                      </div>
                      <Switch
                        checked={watch("isDefaultForType")}
                        onCheckedChange={(checked) => setValue("isDefaultForType", checked)}
                      />
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
              </div>
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
            <Button type="submit" disabled={saving}>
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
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
