import * as z from "zod";
import { i18nInstance } from '@/modules/localization/i18nInstance';

function tAgent(key: string, fallback: string) {
  if (i18nInstance.isInitialized) {
    return i18nInstance.t(key, { ns: 'agent', defaultValue: fallback });
  }
  return fallback;
}

export const userAgentFormSchema = z.object({
  name: z
    .string()
    .min(2, tAgent("form.validation.nameMin", "Name must be at least 2 characters"))
    .max(50, tAgent("form.validation.nameMax", "Name must be at most 50 characters"))
    .regex(/^[a-zA-Z0-9 ]+$/, tAgent("form.validation.namePattern", "Name must contain only letters, numbers, and spaces")),
  slug: z
    .string()
    .min(1, tAgent("form.validation.slugRequired", "Slug is required"))
    .max(100, tAgent("form.validation.slugMax", "Slug must be at most 100 characters"))
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, tAgent("form.validation.slugPattern", "Slug must contain only lowercase letters, numbers, and hyphens")),
  agentType: z.string().min(1, tAgent("form.validation.agentTypeRequired", "Agent type is required")),
  role: z.string().min(1, tAgent("form.validation.roleRequired", "Role is required")).max(50000, tAgent("form.validation.roleMax", "Role must be at most 50000 characters")),
  description: z.string().max(1000, tAgent("form.validation.descriptionMax", "Description must be at most 1000 characters")).optional().default(""),
  temperature: z.number().min(0).max(1).default(0),
  model: z.string().max(100).optional().default(""),
  instruction: z.string().max(50000, tAgent("form.validation.instructionMax", "Instruction must be at most 50000 characters")).optional().default(""),
  ignorePrePrompt: z.boolean().default(false),
  knowledgeBases: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  disabledSkills: z.array(z.string()).default([]),
  connectors: z.array(z.string()).default([]),
  connectorActionSelections: z.array(
    z.object({
      connectorId: z.string().min(1),
      actionKeys: z.array(z.string().min(1)).min(1),
    }),
  ).default([]),
  isActive: z.boolean().default(true),
  isDefaultForType: z.boolean().default(false),
});

export type UserAgentFormValues = z.infer<typeof userAgentFormSchema>;

export const defaultFormValues: UserAgentFormValues = {
  name: "",
  slug: "",
  agentType: "",
  role: "",
  description: "",
  temperature: 0,
  model: "",
  instruction: "",
  ignorePrePrompt: false,
  knowledgeBases: [],
  tools: [],
  skills: [],
  disabledSkills: [],
  connectors: [],
  connectorActionSelections: [],
  isActive: true,
  isDefaultForType: false,
};
