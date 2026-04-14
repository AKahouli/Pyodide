import { useEffect, useMemo, useState } from "react";
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
import { MultiSelect } from '@/components/ui/multi-select';

import {
  createAgentTypeFormSchema,
  defaultFormValues,
  type AgentTypeFormValues,
} from "./agent-type-form-schema";
import type { AgentTypeResponse } from "../../types";
import { getActiveSkills } from '@/modules/agent/api';
import type { SkillOption } from '@/modules/agent/types';
import { scrollToFirstError } from "@/lib/form-utils";
import { useModuleTranslation } from "@/modules/localization";

interface CreateEditAgentTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentType: AgentTypeResponse | null;
  onSave: (data: AgentTypeFormValues) => void;
  saving: boolean;
}

export function CreateEditAgentTypeDialog({
  open,
  onOpenChange,
  agentType,
  onSave,
  saving,
}: CreateEditAgentTypeDialogProps) {
  const { t } = useModuleTranslation("admin");
  const { t: tCommon } = useModuleTranslation("common");
  const [availableSkills, setAvailableSkills] = useState<SkillOption[]>([]);
  const schema = useMemo(() => createAgentTypeFormSchema(t), [t]);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<AgentTypeFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultFormValues,
  });

  useEffect(() => {
    if (open) {
      getActiveSkills().then(setAvailableSkills).catch(() => setAvailableSkills([]));
      if (agentType) {
        reset({
          name: agentType.name,
          defaultPrompt: agentType.defaultPrompt || "",
          skills: agentType.skills || [],
          isActive: agentType.isActive,
        });
      } else {
        reset(defaultFormValues);
      }
    }
  }, [open, agentType, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {agentType ? t("agentTypes.form.dialog.editTitle") : t("agentTypes.form.dialog.createTitle")}
          </DialogTitle>
          <DialogDescription>
            {agentType
              ? t("agentTypes.form.dialog.editDescription")
              : t("agentTypes.form.dialog.createDescription")}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSave, scrollToFirstError)}
          className="flex flex-col min-h-0 flex-1"
        >
          <div className="overflow-y-auto flex-1 min-h-0 pr-2">
            <div className="grid gap-4 py-4">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="agent-type-name">{t("agentTypes.form.name.label")}</Label>
                <Input
                  id="agent-type-name"
                  placeholder={t("agentTypes.form.name.placeholder")}
                  {...register("name")}
                />
                {errors.name && (
                  <p className="text-xs text-destructive">
                    {errors.name.message}
                  </p>
                )}
              </div>

              {/* Slug (read-only preview) */}
              <div className="space-y-2">
                <Label htmlFor="agent-type-slug">{t("agentTypes.form.slug.label")}</Label>
                <Input
                  id="agent-type-slug"
                  disabled
                  value={
                    watch("name")
                      ? watch("name").toLowerCase().replace(/\s+/g, "_")
                      : ""
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {t("agentTypes.form.slug.helper")}
                </p>
              </div>

              {/* Default Prompt */}
              <div className="space-y-2">
                <Label htmlFor="agent-type-default-prompt">{t("agentTypes.form.defaultPrompt.label")}</Label>
                <Textarea
                  id="agent-type-default-prompt"
                  placeholder={t("agentTypes.form.defaultPrompt.placeholder")}
                  rows={8}
                  {...register("defaultPrompt")}
                />
                {errors.defaultPrompt && (
                  <p className="text-xs text-destructive">
                    {errors.defaultPrompt.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t("agentTypes.form.skills.label")}</Label>
                <p className="text-xs text-muted-foreground">{t("agentTypes.form.skills.helper")}</p>
                <MultiSelect
                  options={availableSkills.map((skill) => ({
                    value: skill.id,
                    label: skill.name,
                    description: skill.description,
                  }))}
                  value={watch('skills')}
                  onValueChange={(val) => setValue('skills', val)}
                  placeholder={t("agentTypes.form.skills.selectPlaceholder")}
                  searchPlaceholder={t("agentTypes.form.skills.searchPlaceholder")}
                  emptyText={t("agentTypes.form.skills.emptyText")}
                />
              </div>

              {/* Active Switch */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t("agentTypes.form.active.label")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("agentTypes.form.active.description")}
                  </p>
                </div>
                <Switch
                  checked={watch("isActive")}
                  onCheckedChange={(checked) => setValue("isActive", checked)}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="pt-4 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {tCommon("actionCancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("agentTypes.form.actions.saving")}
                </>
              ) : agentType ? (
                t("agentTypes.form.actions.update")
              ) : (
                t("agentTypes.form.actions.create")
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
