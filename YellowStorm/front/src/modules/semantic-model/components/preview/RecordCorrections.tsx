import { useState } from 'react';
import { Check, EyeOff, Link2, Pencil, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/modules/semantic-model/components/common/Select';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useRecordCorrections } from '../../hooks/use-record-corrections';
import { INPUT, INPUT_COMPACT, ROW_LIST, SectionHeader } from '../form/FormParts';
import type { RecordCorrection, RecordCorrectionInput, RecordCorrectionResult, ValueCorrection } from '../../types';

type Corrections = ReturnType<typeof useRecordCorrections>;

/** Saves a fix and reports, in plain words, whether the data is being rebuilt with it. */
export function useCorrectionActions(modelId: string, onRebuildStarted?: (jobId: string) => void, enabled = true) {
  const corrections = useRecordCorrections(modelId, enabled);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const { t } = useModuleTranslation('semantic-model');
  const done = (result: RecordCorrectionResult) => {
    if (result.rebuild) onRebuildStarted?.(result.rebuild.jobId);
    setNotice({ tone: 'ok', text: result.rebuild ? t('corrections.savedRebuilding') : t('corrections.savedLater') });
  };
  const failed = () => setNotice({ tone: 'error', text: t('corrections.failed') });
  return {
    ...corrections,
    notice,
    busy: corrections.record.isPending || corrections.undo.isPending,
    save: (input: RecordCorrectionInput) => corrections.record.mutate(input, { onSuccess: done, onError: failed }),
    revert: (sequence: number) => corrections.undo.mutate(sequence, { onSuccess: done, onError: failed }),
  };
}

export type CorrectionActions = ReturnType<typeof useCorrectionActions>;

export function CorrectionNotice({ actions }: Readonly<{ actions: Pick<CorrectionActions, 'notice'> }>) {
  if (!actions.notice) return null;
  return <p role='status' className={`rounded-lg px-3 py-2 text-xs ${actions.notice.tone === 'ok' ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-destructive/10 text-destructive'}`}>{actions.notice.text}</p>;
}

/** "Corrected by you · was “Lyon”" with a way to undo it. */
export function CorrectionNote({ correction, onUndo, busy, className = '' }: Readonly<{ correction: ValueCorrection; onUndo?: () => void; busy?: boolean; className?: string }>) {
  const { t } = useModuleTranslation('semantic-model');
  const who = correction.correctedByYou ? t('corrections.byYou') : correction.correctedBy || t('corrections.bySomeone');
  const original = correction.originalValue == null || correction.originalValue === '' ? t('corrections.wasEmpty') : t('corrections.was', { value: String(correction.originalValue) });
  return <p className={`mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground ${className}`}>
    <span title={original}>{t('corrections.correctedBy', { who })} · {original}</span>
    {onUndo && <button type='button' disabled={busy} onClick={onUndo} className='inline-flex items-center gap-1 text-primary disabled:opacity-50'><Undo2 className='h-3 w-3' />{t('corrections.undo')}</button>}
  </p>;
}

/** A value with a "Fix" action that turns it into a small editor. */
export function FixValueButton({ value, onSave, busy, label }: Readonly<{ value: unknown; onSave: (value: string) => void; busy?: boolean; label: string }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  if (!editing) {
    return <button type='button' className='inline-flex items-center gap-1 text-[11px] text-primary' onClick={() => { setDraft(value == null ? '' : String(value)); setEditing(true); }} aria-label={t('corrections.fixValueOf', { field: label })}><Pencil className='h-3 w-3' />{t('corrections.fixValue')}</button>;
  }
  return <form className='mt-1 flex items-center gap-1' onSubmit={(event) => { event.preventDefault(); onSave(draft); setEditing(false); }}>
    <Input autoFocus className={INPUT_COMPACT} value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={t('corrections.newValueOf', { field: label })} />
    <Button type='submit' size='sm' className='h-8' disabled={busy}><Check className='mr-1 h-3.5 w-3.5' />{t('corrections.save')}</Button>
    <Button type='button' size='sm' variant='ghost' className='h-8' onClick={() => setEditing(false)} aria-label={t('action.cancel')}><X className='h-3.5 w-3.5' /></Button>
  </form>;
}

export function HideRecordButton({ onHide, busy }: Readonly<{ onHide: () => void; busy?: boolean }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [confirming, setConfirming] = useState(false);
  if (!confirming) return <Button type='button' variant='outline' size='sm' onClick={() => setConfirming(true)}><EyeOff className='mr-1.5 h-3.5 w-3.5' />{t('corrections.hideRecord')}</Button>;
  return <div className='flex flex-wrap items-center gap-2 text-xs'>
    <span>{t('corrections.hideRecordConfirm')}</span>
    <Button type='button' size='sm' variant='destructive' disabled={busy} onClick={() => { onHide(); setConfirming(false); }}>{t('corrections.hideRecord')}</Button>
    <Button type='button' size='sm' variant='ghost' onClick={() => setConfirming(false)}>{t('action.cancel')}</Button>
  </div>;
}

/** Link a record to another one the sources did not connect it to. */
export function AddLinkForm({ options, onAdd, busy }: Readonly<{
  options: Array<{ relationId: string; label: string; direction: 'out' | 'in'; targets: Array<{ id: string; label: string }> }>;
  onAdd: (relationId: string, otherId: string, direction: 'out' | 'in') => void;
  busy?: boolean;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');
  const [target, setTarget] = useState('');
  const usable = options.filter((option) => option.targets.length > 0);
  if (!usable.length) return null;
  if (!open) return <Button type='button' variant='outline' size='sm' onClick={() => setOpen(true)}><Link2 className='mr-1.5 h-3.5 w-3.5' />{t('corrections.addLink')}</Button>;
  const selected = usable.find((option) => `${option.relationId}|${option.direction}` === choice);
  return <form className='mt-2 grid gap-2 text-sm sm:grid-cols-[1fr_1fr_auto]' onSubmit={(event) => {
    event.preventDefault();
    if (!selected || !target) return;
    onAdd(selected.relationId, target, selected.direction);
    setOpen(false); setChoice(''); setTarget('');
  }}>
    <Select value={choice || undefined} onValueChange={(value) => { setChoice(value); setTarget(''); }}>
      <SelectTrigger className={cn(INPUT, 'px-2')} aria-label={t('corrections.chooseRelationship')}><SelectValue placeholder={t('corrections.chooseRelationship')} /></SelectTrigger>
      <SelectContent>{usable.map((option) => <SelectItem key={`${option.relationId}|${option.direction}`} value={`${option.relationId}|${option.direction}`}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
    <Select value={target || undefined} disabled={!selected} onValueChange={setTarget}>
      <SelectTrigger className={cn(INPUT, 'px-2')} aria-label={t('corrections.chooseRecord')}><SelectValue placeholder={t('corrections.chooseRecord')} /></SelectTrigger>
      <SelectContent>{selected?.targets.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.label}</SelectItem>)}</SelectContent>
    </Select>
    <div className='flex gap-1'>
      <Button type='submit' size='sm' className='h-9' disabled={busy || !selected || !target}>{t('corrections.link')}</Button>
      <Button type='button' size='sm' variant='ghost' className='h-9' onClick={() => setOpen(false)}>{t('action.cancel')}</Button>
    </div>
  </form>;
}

/** Every fix still in force, described in plain words, each undoable. */
export function CorrectionsList({ actions, recordLabel, fieldLabel, relationLabel }: Readonly<{
  actions: Pick<CorrectionActions, 'corrections' | 'busy' | 'revert'>;
  recordLabel: (entityId: unknown) => string;
  fieldLabel: (attribute: string) => string;
  relationLabel: (relationId: unknown) => string;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const items = (actions.corrections as Corrections['corrections']).data?.corrections ?? [];
  if (!items.length) return null;
  const describe = (item: RecordCorrection) => {
    const target = item.targetIdentity;
    switch (item.action) {
      case 'edit_entity': {
        const value = item.payload.value;
        return t('corrections.describeEdit', { field: fieldLabel(String(item.payload.attribute ?? '')), record: recordLabel(target.entityId), value: value == null || value === '' ? t('corrections.emptyValue') : String(value) });
      }
      case 'remove_entity': return t('corrections.describeHideRecord', { record: recordLabel(target.entityId) });
      case 'add_relationship': return t('corrections.describeAddLink', { source: recordLabel(target.sourceEntityId), relationship: relationLabel(target.relationId), target: recordLabel(target.targetEntityId) });
      case 'remove_relationship': return t('corrections.describeHideLink', { source: recordLabel(target.sourceEntityId), relationship: relationLabel(target.relationId), target: recordLabel(target.targetEntityId) });
      default: return t('corrections.describeOther');
    }
  };
  return <section className='space-y-3 rounded-2xl border bg-background p-4' aria-label={t('corrections.title')}>
    <SectionHeader title={t('corrections.title')} help={t('corrections.description')} count={items.length} />
    <ul className={ROW_LIST}>{items.map((item) => <li key={item.sequence} className='flex items-center gap-2 py-1.5 pl-3 pr-1 text-sm'>
      <span className='min-w-0 flex-1 break-words'>{describe(item)} <span className='text-xs text-muted-foreground'>· {item.correctedByYou ? t('corrections.byYou') : item.correctedBy || t('corrections.bySomeone')}</span></span>
      <Button type='button' variant='ghost' size='sm' className='h-7 shrink-0 px-2 text-xs' disabled={actions.busy} onClick={() => actions.revert(item.sequence)}><Undo2 className='mr-1 h-3.5 w-3.5' />{t('corrections.undo')}</Button>
    </li>)}</ul>
  </section>;
}
