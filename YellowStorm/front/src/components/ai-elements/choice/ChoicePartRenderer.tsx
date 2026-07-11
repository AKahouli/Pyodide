import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ChoiceComponentData, ChoiceInteractionMetadata } from '@/modules/conversation/types';
import { useModuleTranslation } from '@/modules/localization';

export interface ChoiceComponentAction {
  componentId: string;
  submitText: string;
  displayText: string;
  interaction: ChoiceInteractionMetadata;
}

type Props = ChoiceComponentData & { componentId: string; onAction?: (action: ChoiceComponentAction) => Promise<void> };

export function ChoicePartRenderer({ componentId, onAction, ...choice }: Readonly<Props>) {
  const { t } = useModuleTranslation('conversation');
  const [selected, setSelected] = useState<string[]>([]);
  const [customAnswer, setCustomAnswer] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'submitted' | 'error'>(choice.status === 'ready' ? 'idle' : 'submitted');
  const disabled = state === 'submitting' || state === 'submitted' || choice.status !== 'ready';
  const selectedOptions = choice.options.filter((option) => selected.includes(option.id));
  const submit = async (dismissed = false) => {
    if (disabled || !onAction || (!dismissed && !selectedOptions.length && !customAnswer.trim())) return;
    setState('submitting');
    const displayText = dismissed ? t('choice.dismissed') : customAnswer.trim() || selectedOptions.map((option) => option.label).join(', ');
    const submitText = dismissed ? t('choice.dismissMessage') : customAnswer.trim() || selectedOptions.map((option) => option.submitText).join(' ');
    try {
      await onAction({ componentId, submitText, displayText, interaction: { type: 'choice', componentId, questionId: choice.questionId, selectionMode: choice.selectionMode, selectedOptions: selectedOptions.map((option) => ({ optionId: option.id, label: option.label, ...(option.value ? { value: option.value } : {}) })), ...(customAnswer.trim() ? { customAnswer: customAnswer.trim() } : {}), ...(dismissed ? { dismissed: true } : {}), displayText } });
      setState('submitted');
    } catch {
      setState('error');
    }
  };
  const toggle = (id: string) => {
    if (disabled) return;
    const option = choice.options.find((item) => item.id === id);
    if (!option || option.disabled) return;
    const next = choice.selectionMode === 'single' ? [id] : selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    setSelected(next);
    if (choice.submitBehavior === 'immediate') void submitOption(option);
  };
  const submitOption = async (option: ChoiceComponentData['options'][number]) => {
    if (disabled || !onAction) return;
    setSelected([option.id]);
    setState('submitting');
    try {
      await onAction({ componentId, submitText: option.submitText, displayText: option.label, interaction: { type: 'choice', componentId, questionId: choice.questionId, selectionMode: 'single', selectedOptions: [{ optionId: option.id, label: option.label, ...(option.value ? { value: option.value } : {}) }], displayText: option.label } });
      setState('submitted');
    } catch { setState('error'); }
  };
  if (state === 'submitted') return <div className='rounded-lg border bg-muted/40 p-3 text-sm'>{selectedOptions.map((option) => option.label).join(', ') || customAnswer || t('choice.submitted')}</div>;
  return <section className='space-y-3 rounded-xl border bg-card p-4' aria-label={choice.prompt}>
    <div><h3 className='font-medium'>{choice.prompt}</h3>{choice.description && <p className='mt-1 text-sm text-muted-foreground'>{choice.description}</p>}{choice.progress && <p className='mt-1 text-xs text-muted-foreground'>{choice.progress.label || `${choice.progress.current} / ${choice.progress.total}`}</p>}</div>
    <div className='flex flex-col gap-2' role={choice.selectionMode === 'single' ? 'radiogroup' : 'group'}>
      {choice.options.map((option) => <button key={option.id} type='button' disabled={disabled || option.disabled} onClick={() => toggle(option.id)} role={choice.selectionMode === 'single' ? 'radio' : 'checkbox'} aria-checked={selected.includes(option.id)} className='min-h-11 rounded-lg border px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60'>
        <span className='font-medium'>{option.label}</span>{option.description && <span className='mt-1 block text-sm text-muted-foreground'>{option.description}</span>}
      </button>)}
    </div>
    {choice.otherOption?.enabled && <Textarea value={customAnswer} maxLength={choice.otherOption.maxLength} placeholder={choice.otherOption.placeholder} onChange={(event) => setCustomAnswer(event.target.value)} disabled={disabled} />}
    {choice.submitBehavior === 'explicit' && <div className='flex gap-2'><Button type='button' onClick={() => void submit()} disabled={disabled || (!selectedOptions.length && !customAnswer.trim())}>{choice.labels?.submit || t('choice.submit')}</Button>{choice.dismissible && <Button type='button' variant='ghost' onClick={() => void submit(true)} disabled={disabled}>{choice.labels?.dismiss || t('choice.dismiss')}</Button>}</div>}
    {state === 'error' && <p className='text-sm text-destructive'>{t('choice.sendError')}</p>}
  </section>;
}
