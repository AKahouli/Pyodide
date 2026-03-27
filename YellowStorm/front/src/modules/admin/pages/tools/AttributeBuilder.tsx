import { useFieldArray, useFormContext } from "react-hook-form";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { ToolFormValues } from "./tool-form-schema";
import { useState } from "react";
import { useModuleTranslation } from "@/modules/localization";
import type { ModuleTranslationKey, TranslationParams } from "@/modules/localization";
import { Textarea } from "@/components/ui/textarea";

type Translator = (key: ModuleTranslationKey<"admin">, params?: TranslationParams) => string;

const TYPE_LABEL_KEYS: Record<string, ModuleTranslationKey<'admin'>> = {
  string: "defaultTools.form.attributes.types.string",
  number: "defaultTools.form.attributes.types.number",
  boolean: "defaultTools.form.attributes.types.boolean",
  enum: "defaultTools.form.attributes.types.enum",
};

const DEFAULT_VALUES: Record<string, string | number | boolean> = {
  string: "",
  number: 0,
  boolean: false,
  enum: "",
};

export function AttributeBuilder() {
  const { t } = useModuleTranslation("admin");
  const { control, setValue, watch, formState: { errors } } = useFormContext<ToolFormValues>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "attributes",
  });

  const addAttribute = () => {
    append({ name: "", type: "string", value: "" });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>{t("defaultTools.form.attributes.title")}</Label>
        <Button type="button" variant="outline" size="sm" onClick={addAttribute}>
          <Plus className="mr-1 h-3 w-3" />
          {t("defaultTools.form.attributes.add")}
        </Button>
      </div>

      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          {t("defaultTools.form.attributes.empty")}
        </p>
      )}

      {fields.map((field, index) => (
        <AttributeCard
          key={field.id}
          index={index}
          onRemove={() => remove(index)}
          setValue={setValue}
          watch={watch}
          errors={errors}
          t={t}
        />
      ))}
    </div>
  );
}

function AttributeCard({
  index,
  onRemove,
  setValue,
  watch,
  errors,
  t,
}: {
  index: number;
  onRemove: () => void;
  setValue: ReturnType<typeof useFormContext<ToolFormValues>>["setValue"];
  watch: ReturnType<typeof useFormContext<ToolFormValues>>["watch"];
  errors: ReturnType<typeof useFormContext<ToolFormValues>>["formState"]["errors"];
  t: Translator;
}) {
  const type = watch(`attributes.${index}.type`);
  const options = watch(`attributes.${index}.options`) || [];
  const [optionInput, setOptionInput] = useState("");

  const handleTypeChange = (newType: string) => {
    setValue(`attributes.${index}.type`, newType as ToolFormValues["attributes"][number]["type"]);
    setValue(`attributes.${index}.value`, DEFAULT_VALUES[newType]);
    if (newType !== "enum") {
      setValue(`attributes.${index}.options`, undefined);
    } else {
      setValue(`attributes.${index}.options`, []);
      setValue(`attributes.${index}.value`, "");
    }
  };

  const addOption = () => {
    const trimmed = optionInput.trim();
    if (trimmed && !options.includes(trimmed)) {
      const newOptions = [...options, trimmed];
      setValue(`attributes.${index}.options`, newOptions);
      setOptionInput("");
    }
  };

  const removeOption = (opt: string) => {
    const newOptions = options.filter((o: string) => o !== opt);
    setValue(`attributes.${index}.options`, newOptions);
    // Reset value if removed option was selected
    const currentValue = watch(`attributes.${index}.value`);
    if (currentValue === opt) {
      setValue(`attributes.${index}.value`, newOptions[0] || "");
    }
  };

  const attrErrors = errors.attributes?.[index];

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("defaultTools.form.attributes.name.label")}</Label>
              <Input
                placeholder={t("defaultTools.form.attributes.name.placeholder")}
                value={watch(`attributes.${index}.name`)}
                onChange={(e) => setValue(`attributes.${index}.name`, e.target.value)}
              />
              {attrErrors?.name && (
                <p className="text-xs text-destructive">{String(attrErrors.name.message)}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("defaultTools.form.attributes.type.label")}</Label>
              <Select value={type} onValueChange={handleTypeChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABEL_KEYS).map(([value, key]) => (
                    <SelectItem key={value} value={value}>
                      {t(key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-5 shrink-0"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>

        {/* Value field based on type */}
        <div className="space-y-1">
          <Label className="text-xs">{t("defaultTools.form.attributes.value.label")}</Label>
          {type === "string" && (
            <Textarea
              placeholder={t("defaultTools.form.attributes.value.stringPlaceholder")}
              value={String(watch(`attributes.${index}.value`) ?? "")}
              onChange={(e) => setValue(`attributes.${index}.value`, e.target.value)}
              rows={7}
            />
          )}
          {type === "number" && (
            <Input
              type="number"
              placeholder={t("defaultTools.form.attributes.value.numberPlaceholder")}
              value={String(watch(`attributes.${index}.value`) ?? 0)}
              onChange={(e) => setValue(`attributes.${index}.value`, Number(e.target.value))}
            />
          )}
          {type === "boolean" && (
            <div className="flex items-center gap-2 pt-1">
              <Switch
                checked={Boolean(watch(`attributes.${index}.value`))}
                onCheckedChange={(checked) => setValue(`attributes.${index}.value`, checked)}
              />
              <span className="text-sm text-muted-foreground">
                {watch(`attributes.${index}.value`)
                  ? t("defaultTools.form.attributes.boolean.true")
                  : t("defaultTools.form.attributes.boolean.false")}
              </span>
            </div>
          )}
          {type === "enum" && (
            <div className="space-y-2">
              {/* Options tag input */}
              <div className="space-y-1">
                <Label className="text-xs">{t("defaultTools.form.attributes.options.label")}</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder={t("defaultTools.form.attributes.options.placeholder")}
                    value={optionInput}
                    onChange={(e) => setOptionInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addOption();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addOption}>
                    {t("defaultTools.form.attributes.options.add")}
                  </Button>
                </div>
                {options.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {options.map((opt: string) => (
                      <Badge key={opt} variant="secondary" className="gap-1">
                        {opt}
                        <button
                          type="button"
                          onClick={() => removeOption(opt)}
                          className="ml-1 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                {attrErrors?.options && (
                  <p className="text-xs text-destructive">{String(attrErrors.options.message)}</p>
                )}
              </div>
              {/* Enum value select */}
              {options.length > 0 && (
                <div className="space-y-1">
                  <Label className="text-xs">{t("defaultTools.form.attributes.selectedValue")}</Label>
                  <Select
                    value={String(watch(`attributes.${index}.value`) ?? "")}
                    onValueChange={(v) => setValue(`attributes.${index}.value`, v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("defaultTools.form.attributes.value.enumPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((opt: string) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          {attrErrors?.value && (
            <p className="text-xs text-destructive">{String(attrErrors.value.message)}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
