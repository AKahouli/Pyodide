import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';
import type { TaskTemplate } from '../types';

type Translate = (key: ModuleTranslationKey<'playbook'>, params?: TranslationParams) => string;

/** Localize shipped defaults without replacing user-defined template names. */
export function taskChoiceLabel(template: TaskTemplate, t: Translate): string {
  const defaults: Record<string, { title: string; key: ModuleTranslationKey<'playbook'> }> = {
    'generic-ai-task': { title: 'Generic AI task', key: 'taskChoice.ai' },
    'ai-document-intelligence': { title: 'AI Document Intelligence', key: 'taskChoice.document' },
    iterator: { title: 'Iterator', key: 'taskChoice.iterator' },
    router: { title: 'Router', key: 'taskChoice.router' },
  };
  const entry = defaults[template.key];
  return entry && template.title === entry.title ? t(entry.key) : template.title;
}
