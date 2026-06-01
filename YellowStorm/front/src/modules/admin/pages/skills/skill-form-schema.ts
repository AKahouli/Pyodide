import * as z from 'zod';

export interface SkillFormValues {
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: 'light' | 'dark';
  categoryId: string;
  license: string;
  compatibility: string;
  allowedToolsText: string;
  metadataText: string;
  instructions: string;
  isActive: boolean;
}

export const skillFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and single hyphens only'),
  description: z.string().min(1, 'Description is required').max(1024),
  icon: z.string().max(64).default(''),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .or(z.literal(''))
    .default(''),
  iconColor: z.enum(['light', 'dark']).default('light'),
  categoryId: z.string().default(''),
  license: z.string().max(255).default(''),
  compatibility: z.string().max(500).default(''),
  allowedToolsText: z.string().default(''),
  metadataText: z.string().default('{}'),
  instructions: z.string().max(50000).default(''),
  isActive: z.boolean().default(true),
});

export const defaultSkillFormValues: SkillFormValues = {
  name: '',
  description: '',
  icon: '',
  color: '',
  iconColor: 'light',
  categoryId: '',
  license: '',
  compatibility: '',
  allowedToolsText: '',
  metadataText: '{}',
  instructions: '',
  isActive: true,
};
