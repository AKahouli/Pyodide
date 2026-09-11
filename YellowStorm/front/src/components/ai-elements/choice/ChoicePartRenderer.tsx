import { useEffect, useState, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { ChoiceComponentData, ChoiceInteractionMetadata } from '@/modules/conversation/types';
import { useModuleTranslation } from '@/modules/localization';

const APPROVE_WORDS = new Set(['approve', 'approuver', 'yes', 'oui']);

export interface ChoiceComponentAction {
  componentId: string;
  submitText: string;
  displayText: string;
  interaction: ChoiceInteractionMetadata;
}

type Props = ChoiceComponentData & {
  componentId: string;
  onAction?: (action: ChoiceComponentAction) => Promise<void>;
  submittedInteraction?: ChoiceInteractionMetadata;
  externallyDisabled?: boolean;
};

export function ChoicePartRenderer({ componentId, onAction, submittedInteraction, externallyDisabled = false, ...choice }: Readonly<Props>) {
  const { t } = useModuleTranslation('conversation');
  const [selected, setSelected] = useState<string[]>([]);
  const [otherSelected, setOtherSelected] = useState(false);
  const [customAnswer, setCustomAnswer] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'submitted' | 'error'>(choice.status === 'ready' ? 'idle' : 'submitted');
  // Edit-on-card: editable draft fields; approving submits the edited values.
  const isEditable = Boolean(choice.editable) && Boolean(choice.fields?.length);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((choice.fields ?? []).map((f) => [f.key, f.value ?? ''])));
  const [editing, setEditing] = useState(false);
  const editSubmitText = (option: ChoiceComponentData['options'][number]) =>
    isEditable && APPROVE_WORDS.has(option.submitText.trim().toLowerCase())
      ? JSON.stringify({ verdict: 'approve', edits: fieldValues })
      : option.submitText;
  useEffect(() => {
    if (!submittedInteraction) return;
    setSelected(submittedInteraction.selectedOptions.map((option) => option.optionId));
    setOtherSelected(Boolean(submittedInteraction.customAnswer));
    setCustomAnswer(submittedInteraction.customAnswer ?? '');
    setState('submitted');
  }, [submittedInteraction]);
  const disabled = externallyDisabled || state === 'submitting' || state === 'submitted' || choice.status !== 'ready';
  const selectedOptions = choice.options.filter((option) => selected.includes(option.id));
  const customAnswerValue = otherSelected ? customAnswer.trim() : '';
  const canSubmit = (selectedOptions.length > 0 || Boolean(customAnswerValue)) && (!otherSelected || Boolean(customAnswerValue));
  const submit = async (dismissed = false) => {
    if (disabled || !onAction || (!dismissed && !canSubmit)) return;
    setState('submitting');
    const hasCustomAnswer = Boolean(customAnswerValue);
    const displayText = dismissed ? t('choice.dismissed') : choice.selectionMode === 'multiple' && hasCustomAnswer ? [...selectedOptions.map((option) => option.label), customAnswerValue].join(', ') : customAnswerValue || selectedOptions.map((option) => option.label).join(', ');
    const submitText = dismissed ? t('choice.dismissMessage') : choice.selectionMode === 'multiple' && hasCustomAnswer ? [...selectedOptions.map((option) => option.submitText), customAnswerValue].join(' ') : customAnswerValue || selectedOptions.map((option) => option.submitText).join(' ');
    try {
      await onAction({ componentId, submitText, displayText, interaction: { type: 'choice', componentId, questionId: choice.questionId, selectionMode: choice.selectionMode, selectedOptions: selectedOptions.map((option) => ({ optionId: option.id, label: option.label, ...(option.value ? { value: option.value } : {}) })), ...(customAnswerValue ? { customAnswer: customAnswerValue } : {}), ...(dismissed ? { dismissed: true } : {}), displayText } });
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
    if (choice.selectionMode === 'single') {
      setOtherSelected(false);
      setCustomAnswer('');
    }
    if (choice.submitBehavior === 'immediate') void submitOption(option);
  };
  const toggleOther = () => {
    if (disabled || !choice.otherOption?.enabled) return;
    if (otherSelected) {
      setOtherSelected(false);
      setCustomAnswer('');
      return;
    }
    setOtherSelected(true);
    if (choice.selectionMode === 'single') setSelected([]);
  };
  const submitOption = async (option: ChoiceComponentData['options'][number]) => {
    if (disabled || !onAction) return;
    setSelected([option.id]);
    setState('submitting');
    try {
      await onAction({ componentId, submitText: editSubmitText(option), displayText: option.label, interaction: { type: 'choice', componentId, questionId: choice.questionId, selectionMode: 'single', selectedOptions: [{ optionId: option.id, label: option.label, ...(option.value ? { value: option.value } : {}) }], displayText: option.label } });
      setState('submitted');
    } catch { setState('error'); }
  };
  const approveOption = choice.options.find((option) => APPROVE_WORDS.has(option.submitText.trim().toLowerCase()));
  const cancelEdit = () => {
    setFieldValues(Object.fromEntries((choice.fields ?? []).map((f) => [f.key, f.value ?? ''])));
    setEditing(false);
  };
  const onEditKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); }
    else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && approveOption) { event.preventDefault(); void submitOption(approveOption); }
  };
  if (state === 'submitted') return <div className='rounded-lg border bg-muted/40 p-3 text-sm'>{submittedInteraction?.dismissed ? t('choice.dismissed') : t('choice.submitted')}</div>;
  return <section className='space-y-3 rounded-xl border bg-card p-4' aria-label={choice.prompt}>
    <div><h3 className='font-medium'>{choice.prompt}</h3>{choice.description && !isEditable && <p className='mt-1 text-sm text-muted-foreground'>{choice.description}</p>}{choice.progress && <p className='mt-1 text-xs text-muted-foreground'>{choice.progress.label || `${choice.progress.current} / ${choice.progress.total}`}</p>}</div>
    {isEditable && <div className='overflow-hidden rounded-lg border bg-muted/30'>
      <div className='flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5'>
        <span className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>Message</span>
        {editing
          ? <button type='button' onClick={cancelEdit} className='inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'><X className='h-3.5 w-3.5' />Annuler</button>
          : <button type='button' disabled={disabled} onClick={() => setEditing(true)} className='inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'><Pencil className='h-3.5 w-3.5' />Modifier</button>}
      </div>
      <div className='flex flex-col gap-2.5 p-3' onKeyDown={editing ? onEditKeyDown : undefined}>
        {(choice.fields ?? []).map((field) => {
          const value = fieldValues[field.key] ?? '';
          if (!editing) {
            if (field.multiline) {
              return <div key={field.key} className='break-words text-sm leading-relaxed'>
                {value
                  ? (field.markdown
                      ? <div className='space-y-2 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5'><ReactMarkdown>{value}</ReactMarkdown></div>
                      : <p className='whitespace-pre-wrap'>{value}</p>)
                  : <span className='text-muted-foreground'>—</span>}
              </div>;
            }
            return <p key={field.key} className='flex flex-wrap gap-x-2 text-sm'><span className='shrink-0 text-muted-foreground'>{field.label} :</span><span className='min-w-0 break-words font-medium'>{value || '—'}</span></p>;
          }
          return <label key={field.key} className='flex flex-col gap-1'>
            <span className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>{field.label}</span>
            {field.multiline
              ? <Textarea value={value} disabled={disabled} autoFocus className='min-h-[140px] resize-y bg-background leading-relaxed' onChange={(event) => setFieldValues((prev) => ({ ...prev, [field.key]: event.target.value }))} />
              : <Input value={value} disabled={disabled} className='bg-background' onChange={(event) => setFieldValues((prev) => ({ ...prev, [field.key]: event.target.value }))} />}
          </label>;
        })}
        {editing && <p className='text-[11px] text-muted-foreground'>Astuce : Ctrl/⌘ + Entrée pour approuver, Échap pour annuler.</p>}
      </div>
    </div>}
    <div className={choice.presentation === 'quick_replies' ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2'} role={choice.selectionMode === 'single' ? 'radiogroup' : 'group'}>
      {choice.options.map((option) => {
        const isSelected = selected.includes(option.id);
        return <div key={option.id} className='flex items-center gap-2'><button type='button' disabled={disabled || option.disabled} onClick={() => toggle(option.id)} role={choice.selectionMode === 'single' ? 'radio' : 'checkbox'} aria-checked={isSelected} data-selected={isSelected} className={cn('min-h-11 flex-1 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60', isSelected ? 'border-primary bg-primary/10 ring-1 ring-primary/30' : 'border-border hover:bg-muted/60')}>
          <span className='font-medium'>{option.label}</span>{option.description && <span className='mt-1 block text-sm text-muted-foreground'>{option.description}</span>}
        </button>{option.url ? <a href={option.url} target='_blank' rel='noopener noreferrer' className='text-sm text-primary underline underline-offset-4'>Open</a> : null}</div>;
      })}
      {choice.otherOption?.enabled && <button type='button' disabled={disabled} onClick={toggleOther} role={choice.selectionMode === 'single' ? 'radio' : 'checkbox'} aria-checked={otherSelected} data-selected={otherSelected} data-other-option='true' className={cn('min-h-11 rounded-lg border px-3 py-2 text-left font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60', otherSelected ? 'border-primary bg-primary/10 ring-1 ring-primary/30' : 'border-border hover:bg-muted/60')}>
        {choice.otherOption.label}
      </button>}
    </div>
    {choice.otherOption?.enabled && otherSelected && <Textarea value={customAnswer} maxLength={choice.otherOption.maxLength} aria-label={choice.otherOption.label} placeholder={choice.otherOption.placeholder} onChange={(event) => setCustomAnswer(event.target.value)} disabled={disabled} />}
    {choice.submitBehavior === 'explicit' && <div className='flex gap-2'><Button type='button' onClick={() => void submit()} disabled={disabled || !canSubmit}>{choice.labels?.submit || t('choice.submit')}</Button>{choice.dismissible && <Button type='button' variant='ghost' onClick={() => void submit(true)} disabled={disabled}>{choice.labels?.dismiss || t('choice.dismiss')}</Button>}</div>}
    {state === 'error' && <p className='text-sm text-destructive'>{t('choice.sendError')}</p>}
  </section>;
}
