import type { TaskTemplate } from '../types';

export const TASK_TEMPLATES: TaskTemplate[] = [];

export const TEMPLATE_CATEGORIES = ['content', 'generation', 'analysis', 'code', 'evaluation'] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export function getTemplateById(id: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((t) => t.id === id);
}

export function getTemplatesByCategory(category: TemplateCategory): TaskTemplate[] {
  return TASK_TEMPLATES.filter((t) => t.category === category);
}
