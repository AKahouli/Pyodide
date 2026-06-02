import * as z from "zod";
import type { ModuleTranslationKey, TranslationParams } from "@/modules/localization";

type Translator = (key: ModuleTranslationKey<"admin">, params?: TranslationParams) => string;

export type ToolFormValues = {
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: "light" | "dark";
  categoryId: string;
  defaultAgentTypes: string[];
  attributes: {
    name: string;
    type: "string" | "number" | "boolean" | "enum";
    value: string | number | boolean;
    options?: string[];
  }[];
  requiredAppKey: string;
  isActive: boolean;
};

function createAttributeSchema(t: Translator) {
  return z
    .object({
      name: z.string().min(1, t("defaultTools.form.validation.attributeNameRequired")),
      type: z.enum(["string", "number", "boolean", "enum"]),
      value: z.union([z.string(), z.number(), z.boolean()]),
      options: z.array(z.string()).optional(),
    })
    .superRefine((data, ctx) => {
      switch (data.type) {
        case "string":
          if (typeof data.value !== "string") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t("defaultTools.form.validation.attributeValueString"),
              path: ["value"],
            });
          }
          break;
        case "number":
          if (typeof data.value !== "number" || Number.isNaN(data.value)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t("defaultTools.form.validation.attributeValueNumber"),
              path: ["value"],
            });
          }
          break;
        case "boolean":
          if (typeof data.value !== "boolean") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t("defaultTools.form.validation.attributeValueBoolean"),
              path: ["value"],
            });
          }
          break;
        case "enum":
          if (!data.options || data.options.length === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t("defaultTools.form.validation.attributeEnumOptions"),
              path: ["options"],
            });
          }
          if (
            typeof data.value !== "string" ||
            (data.options && !data.options.includes(data.value))
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t("defaultTools.form.validation.attributeValueEnum"),
              path: ["value"],
            });
          }
          break;
      }
    });
}

export function createToolFormSchema(t: Translator) {
  const attributeSchema = createAttributeSchema(t);
  return z.object({
    name: z
      .string()
      .min(2, t("defaultTools.form.validation.nameMin"))
      .max(100, t("defaultTools.form.validation.nameMax")),
    description: z
      .string()
      .max(1000, t("defaultTools.form.validation.descriptionMax"))
      .optional()
      .default(""),
    icon: z.string().max(64).default(""),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .or(z.literal(""))
      .default(""),
    iconColor: z.enum(["light", "dark"]).default("light"),
    categoryId: z.string().default(""),
    defaultAgentTypes: z.array(z.string()).default([]),
    requiredAppKey: z.string().default(""),
    attributes: z.array(attributeSchema).default([]),
    isActive: z.boolean().default(true),
  });
}

export const defaultFormValues: ToolFormValues = {
  name: "",
  description: "",
  icon: "",
  color: "",
  iconColor: "light",
  categoryId: "",
  defaultAgentTypes: [],
  requiredAppKey: "",
  attributes: [],
  isActive: true,
};
