import * as z from "zod";
import type { ModuleTranslationKey, TranslationParams } from "@/modules/localization";

type Translator = (key: ModuleTranslationKey<"admin">, params?: TranslationParams) => string;

export type AgentTypeFormValues = {
  name: string;
  defaultPrompt: string;
  skills: string[];
  isActive: boolean;
};

export function createAgentTypeFormSchema(t: Translator) {
  return z.object({
    name: z
      .string()
      .min(2, t("agentTypes.form.validation.nameMin"))
      .max(100, t("agentTypes.form.validation.nameMax"))
      .regex(/^[a-zA-Z0-9 ]+$/, t("agentTypes.form.validation.namePattern")),
    defaultPrompt: z
      .string()
      .max(50000, t("agentTypes.form.validation.promptMax"))
      .optional()
      .default(""),
    skills: z.array(z.string()).default([]),
    isActive: z.boolean().default(true),
  });
}

export const defaultFormValues: AgentTypeFormValues = {
  name: "",
  defaultPrompt: "",
  skills: [],
  isActive: true,
};
