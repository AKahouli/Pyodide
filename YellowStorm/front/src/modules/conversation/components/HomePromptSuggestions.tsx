import { ArrowUpRight, FileText, Lightbulb, ListChecks } from 'lucide-react';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { useModuleTranslation } from '@/modules/localization';

const STARTERS = [
  { key: 'understand', icon: FileText },
  { key: 'explore', icon: Lightbulb },
  { key: 'plan', icon: ListChecks },
] as const;

export function HomePromptSuggestions({ scopeName, disabled }: { scopeName?: string; disabled: boolean }) {
  const { textInput } = usePromptInputController();
  const { t } = useModuleTranslation('conversation');
  if (textInput.value.trim() || disabled) return null;
  const mode = scopeName ? 'governed' : 'standard';
  return <div className='conversation-home-prompts' aria-label={t('home.prompts.label')} role='group'>
    {STARTERS.map(({ key, icon: Icon }) => <button key={key} type='button' onClick={(event) => {
      const textarea = event.currentTarget.closest('form')?.querySelector('textarea');
      textInput.setInput(t(`home.prompts.${mode}.${key}.draft`, { scope: scopeName }));
      textarea?.focus();
    }}>
      <Icon aria-hidden='true' className='size-3.5' />
      <span>{t(`home.prompts.${mode}.${key}.label`)}</span>
      <ArrowUpRight aria-hidden='true' className='size-3.5' />
    </button>)}
  </div>;
}
