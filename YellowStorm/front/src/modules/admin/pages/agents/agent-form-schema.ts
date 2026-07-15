import * as z from 'zod';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

type Translator = (key: ModuleTranslationKey<'admin'>, params?: TranslationParams) => string;

export interface AgentFormValues {
  name: string;
  slug: string;
  agentType: string;
  role: string;
  description: string;
  temperature: number;
  model: string;
  instruction: string;
  ignorePrePrompt: boolean;
  tools: string[];
  skills: string[];
  disabledSkills: string[];
  connectors: string[];
  connectorActionSelections: Array<{ connectorId: string; actionKeys: string[] }>;
  isActive: boolean;
  isDefaultForType: boolean;
  enable_temporary_child_agents: boolean;
  max_temporary_child_agents: number;
}

export function createAgentFormSchema(t: Translator) {
  return z.object({
    name: z
      .string()
      .min(2, t('defaultAgents.form.validation.nameMin'))
      .max(50, t('defaultAgents.form.validation.nameMax'))
      .regex(/^[a-zA-Z0-9 ]+$/, t('defaultAgents.form.validation.namePattern')),
    slug: z
      .string()
      .min(1, t('defaultAgents.form.validation.slugRequired'))
      .max(100, t('defaultAgents.form.validation.slugMax'))
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, t('defaultAgents.form.validation.slugPattern')),
    agentType: z.string().min(1, t('defaultAgents.form.validation.agentTypeRequired')),
    role: z.string().min(1, t('defaultAgents.form.validation.roleRequired')).max(50000, t('defaultAgents.form.validation.roleMax')),
    description: z.string().max(1000, t('defaultAgents.form.validation.descriptionMax')).optional().default(''),
    temperature: z.number().min(0).max(1).default(0),
    model: z.string().max(100, t('defaultAgents.form.validation.modelMax')).optional().default(''),
    instruction: z.string().max(50000, t('defaultAgents.form.validation.instructionMax')).optional().default(''),
    ignorePrePrompt: z.boolean().default(false),
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
    enable_temporary_child_agents: z.boolean().default(false),
    max_temporary_child_agents: z.number().int().min(1).max(8).default(4),
  });
}

export const defaultFormValues: AgentFormValues = {
  name: '',
  slug: '',
  agentType: '',
  role: '',
  description: '',
  temperature: 0,
  model: '',
  instruction: '',
  ignorePrePrompt: false,
  tools: [],
  skills: [],
  disabledSkills: [],
  connectors: [],
  connectorActionSelections: [],
  isActive: true,
  isDefaultForType: false,
  enable_temporary_child_agents: false,
  max_temporary_child_agents: 4,
};
