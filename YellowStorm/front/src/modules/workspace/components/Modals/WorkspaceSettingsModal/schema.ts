import * as z from 'zod';

import type { RagType } from '../../../types';

export const settingsSchema = z.object({
  instruction: z.string().max(10000, 'Instruction must be less than 10000 characters').optional(),
  chunks: z.number().min(1).max(100).default(5),
  hybridSearch: z.boolean().default(false),
  ragType: z.enum(['standard', 'advancedRag', 'smartRag']).default('standard'),
  maxToken: z.number().min(100).max(128000).default(32000),
  topK: z.number().min(1).max(100).default(10),
});

export type SettingsFormValues = z.infer<typeof settingsSchema>;

export const RAG_TYPE_OPTIONS: RagType[] = ['standard', 'advancedRag', 'smartRag'];
