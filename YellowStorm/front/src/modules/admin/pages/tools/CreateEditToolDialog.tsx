import { useCallback, useEffect, useState, useMemo } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink, Loader2, Plus } from "lucide-react";

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

import { AttributeBuilder } from "./AttributeBuilder";
import {
  createToolFormSchema,
  defaultFormValues,
  type ToolFormValues,
} from "./tool-form-schema";
import type { ToolResponse, AgentTypeResponse, ToolCategoryResponse } from "../../types";
import { getActiveAgentTypes, getToolCategories } from "../../api";
import { ManageToolCategoriesDialog } from "./ManageToolCategoriesDialog";
import { IconPickerPreview } from "../connectors/IconDisplay";
import { ColorPicker } from "../connectors/ColorPicker";
import { getAvailableApps } from "@/modules/connected-app/api";
import type { ConnectedAppWithStatus } from "@/modules/connected-app/types";
import { scrollToFirstError } from "@/lib/form-utils";
import { useModuleTranslation } from "@/modules/localization";

const ADD_CATEGORY_VALUE = "__add_category__";

interface CreateEditToolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool: ToolResponse | null;
  onSave: (data: ToolFormValues) => void;
  saving: boolean;
}

export function CreateEditToolDialog({
  open,
  onOpenChange,
  tool,
  onSave,
  saving,
}: CreateEditToolDialogProps) {
  const [agentTypeOptions, setAgentTypeOptions] = useState<{ value: string; label: string }[]>([]);
  const [connectedApps, setConnectedApps] = useState<ConnectedAppWithStatus[]>([]);
  const [categories, setCategories] = useState<ToolCategoryResponse[]>([]);
  const [showCategoriesDialog, setShowCategoriesDialog] = useState(false);
  const [loading, setLoading] = useState(false);

  const refreshCategories = useCallback(() => {
    getToolCategories()
      .then(setCategories)
      .catch(() => {});
  }, []);
  const { t } = useModuleTranslation("admin");
  const { t: tCommon } = useModuleTranslation("common");
  const schema = useMemo(() => createToolFormSchema(t), [t]);

  const form = useForm<ToolFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultFormValues,
  });

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = form;

  useEffect(() => {
    if (open) {
      setLoading(true);

      Promise.all([
        getActiveAgentTypes().catch(() => [] as AgentTypeResponse[]),
        getAvailableApps().catch(() => [] as ConnectedAppWithStatus[]),
        getToolCategories().catch(() => [] as ToolCategoryResponse[]),
      ]).then(([types, apps, cats]) => {
        setAgentTypeOptions(types.map((at: AgentTypeResponse) => ({ value: at.name, label: at.name })));
        setConnectedApps(apps);
        setCategories(cats);

        if (tool) {
          reset({
            name: tool.name,
            description: tool.description || "",
            icon: tool.icon || "",
            color: tool.color || "",
            iconColor: tool.iconColor || "light",
            categoryId: tool.categoryId || "",
            defaultAgentTypes: tool.defaultAgentTypes as ToolFormValues["defaultAgentTypes"],
            requiredAppKey: tool.requiredAppKey || "",
            attributes: tool.attributes.map((attr) => ({
              name: attr.name,
              type: attr.type as ToolFormValues["attributes"][number]["type"],
              value: attr.value,
              options: attr.options,
            })),
            isActive: tool.isActive,
          });
        } else {
          reset(defaultFormValues);
        }
        setLoading(false);
      });
    }
  }, [open, tool, reset]);

  const selectedAgentTypes = watch("defaultAgentTypes");

  const toggleAgentType = (type: string) => {
    const current = selectedAgentTypes || [];
    if (current.includes(type)) {
      setValue(
        "defaultAgentTypes",
        current.filter((t) => t !== type)
      );
    } else {
      setValue("defaultAgentTypes", [...current, type]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {tool ? t("defaultTools.form.dialog.editTitle") : t("defaultTools.form.dialog.createTitle")}
          </DialogTitle>
          <DialogDescription>
            {tool ? t("defaultTools.form.dialog.editDescription") : t("defaultTools.form.dialog.createDescription")}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 flex-1">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
        <FormProvider {...form}>
          <form
            onSubmit={handleSubmit(onSave, scrollToFirstError)}
            className="flex flex-col min-h-0 flex-1"
          >
            <div className="overflow-y-auto flex-1 min-h-0 pr-2">
              <div className="grid gap-4 py-4">
                {/* Name */}
                <div className="space-y-2">
                  <Label htmlFor="tool-name">{t("defaultTools.form.name.label")}</Label>
                  <Input
                    id="tool-name"
                    placeholder={t("defaultTools.form.name.placeholder")}
                    {...register("name")}
                  />
                  {errors.name && (
                    <p className="text-xs text-destructive">
                      {errors.name.message}
                    </p>
                  )}
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="tool-description">{t("defaultTools.form.description.label")}</Label>
                  <Textarea
                    id="tool-description"
                    placeholder={t("defaultTools.form.description.placeholder")}
                    rows={3}
                    {...register("description")}
                  />
                  {errors.description && (
                    <p className="text-xs text-destructive">
                      {errors.description.message}
                    </p>
                  )}
                </div>

                {/* Category */}
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={watch("categoryId") || "__none__"}
                    onValueChange={(value) => {
                      if (value === ADD_CATEGORY_VALUE) {
                        setShowCategoriesDialog(true);
                        return;
                      }
                      setValue("categoryId", value === "__none__" ? "" : value);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ADD_CATEGORY_VALUE} className="text-primary">
                        <span className="flex items-center gap-2">
                          <Plus className="h-3.5 w-3.5" />
                          Add category
                        </span>
                      </SelectItem>
                      <SelectItem value="__none__">No category</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Icon + Color */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="tool-icon">Icon</Label>
                    <div className="flex gap-2">
                      <IconPickerPreview
                        icon={watch("icon")}
                        color={watch("color")}
                        iconColor={watch("iconColor")}
                        onClear={() => setValue("icon", "")}
                        onToggleColorMode={() =>
                          setValue("iconColor", watch("iconColor") === "light" ? "dark" : "light")
                        }
                      />
                      <div className="flex-1 space-y-1">
                        <Input
                          id="tool-icon"
                          placeholder="FaSearch"
                          {...register("icon")}
                        />
                        <a
                          href="https://react-icons.github.io/react-icons/search/#q="
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Browse icons
                        </a>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Color</Label>
                    <ColorPicker
                      value={watch("color")}
                      onChange={(value) => setValue("color", value)}
                      placeholder="#4285f4"
                    />
                  </div>
                </div>

                {/* Default Agent Types */}
                <div className="space-y-2">
                  <Label>{t("defaultTools.form.agentTypes.label")}</Label>
                  <div className="flex flex-wrap gap-4">
                    {agentTypeOptions.map((option) => (
                      <div
                        key={option.value}
                        className="flex items-center space-x-2"
                      >
                        <Checkbox
                          id={`agent-type-${option.value}`}
                          checked={selectedAgentTypes?.includes(option.value)}
                          onCheckedChange={() => toggleAgentType(option.value)}
                        />
                        <label
                          htmlFor={`agent-type-${option.value}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          {option.label}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Required connected app */}
                <div className="space-y-2">
                  <Label htmlFor="requiredAppKey">{t("defaultTools.form.requiredApp.label")}</Label>
                  <Select
                    value={watch("requiredAppKey") || "__none__"}
                    onValueChange={(value) =>
                      setValue("requiredAppKey", value === "__none__" ? "" : value)
                    }
                  >
                    <SelectTrigger id="requiredAppKey">
                      <SelectValue placeholder={t("defaultTools.form.requiredApp.placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t("defaultTools.form.requiredApp.none")}</SelectItem>
                      {connectedApps.map((app) => (
                        <SelectItem key={app.appKey} value={app.appKey}>
                          {app.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t("defaultTools.form.requiredApp.description")}
                  </p>
                </div>

                {/* Active Switch */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>{t("defaultTools.form.active.label")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("defaultTools.form.active.description")}
                    </p>
                  </div>
                  <Switch
                    checked={watch("isActive")}
                    onCheckedChange={(checked) => setValue("isActive", checked)}
                  />
                </div>

                {/* Attributes */}
                <AttributeBuilder />
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
                    {t("defaultTools.form.actions.saving")}
                  </>
                ) : tool ? (
                  t("defaultTools.form.actions.update")
                ) : (
                  t("defaultTools.form.actions.create")
                )}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
        )}
      </DialogContent>

      <ManageToolCategoriesDialog
        open={showCategoriesDialog}
        onOpenChange={setShowCategoriesDialog}
        onCategoriesChanged={refreshCategories}
      />
    </Dialog>
  );
}
