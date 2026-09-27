import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Briefcase, KeyRound, Keyboard, ListPlus, PanelRight, Pencil, Plus, Settings2, Sheet, Table2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useSemanticModelEditorStore } from '../../store';
import type { AttributeDefinition } from '../../types';
import { businessKey, guessAttributeType } from '../../utils/model-utils';

/** One icon action in a canvas toolbar; the label is its tooltip and accessible name. */
export function ToolButton({ label, onClick, children, tone = 'default', active = false }: Readonly<{ label: string; onClick?: () => void; children: ReactNode; tone?: 'default' | 'data' | 'danger'; active?: boolean }>) {
  return <button type='button' title={label} aria-label={label} aria-pressed={active || undefined}
    onClick={(event) => { event.stopPropagation(); onClick?.(); }}
    className={cn('nodrag nopan flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
      tone === 'danger' ? 'text-destructive hover:bg-destructive/10' : tone === 'data' ? 'text-teal-600 hover:bg-teal-500/10 dark:text-teal-400' : 'text-foreground hover:bg-muted',
      active && 'bg-muted')}>{children}</button>;
}

/** The floating bar of actions shown above whatever is selected on the canvas. */
export function ToolbarShell({ children, label }: Readonly<{ children: ReactNode; label: string }>) {
  return <div role='toolbar' aria-label={label} className='nodrag nopan nowheel flex w-max items-center gap-0.5 whitespace-nowrap rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur' onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>{children}</div>;
}

export const ToolbarDivider = () => <span className='mx-0.5 h-5 w-px bg-border' aria-hidden />;

/** Rename in place: the name becomes a text box, Enter keeps it, Escape leaves it as it was. */
export function InlineRename({ value, onSubmit, onCancel, label }: Readonly<{ value: string; onSubmit: (value: string) => void; onCancel: () => void; label: string }>) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const timer = window.setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 30); return () => window.clearTimeout(timer); }, []);
  const submit = (event?: FormEvent) => { event?.preventDefault(); const next = draft.trim(); if (next && next !== value) onSubmit(next); else onCancel(); };
  return <form className='nodrag nopan nowheel' onSubmit={submit} onClick={(event) => event.stopPropagation()}>
    <Input ref={ref} value={draft} aria-label={label} className='h-8 w-44 text-center text-sm font-semibold'
      onChange={(event) => setDraft(event.target.value)} onBlur={() => submit()}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onCancel(); } }} />
  </form>;
}

/**
 * A concept's fields, edited where the concept is: add one, remove one, and mark which make a record unique.
 * Field changes are graph edits (undoable); the unique fields are a rule saved on the server.
 */
export function FieldsPopover({ conceptId, label, attributes, keyFields, onToggleKey, trigger }: Readonly<{
  conceptId: string; label: string; attributes: AttributeDefinition[]; keyFields: string[];
  onToggleKey?: (conceptId: string, field: string) => void; trigger: ReactNode;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const commit = useSemanticModelEditorStore((state) => state.commit);
  const [name, setName] = useState('');
  const save = (next: AttributeDefinition[]) => commit({ type: 'node_type.update', id: conceptId, changes: { attributes: next } },
    (current) => ({ ...current, nodes: current.nodes.map((node) => node.id === conceptId ? { ...node, attributes: next } : node) }));
  const add = (event: FormEvent) => {
    event.preventDefault();
    const text = name.trim();
    if (!text) return;
    const key = businessKey(text);
    if (!key || attributes.some((attribute) => attribute.key === key)) { setName(''); return; }
    save([...attributes, { key, label: text, type: guessAttributeType(text), required: false }]);
    setName('');
  };
  return <Popover>
    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent side='bottom' align='center' className='nodrag nopan nowheel w-72 p-3' onClick={(event) => event.stopPropagation()} onOpenAutoFocus={(event) => event.preventDefault()}>
      <p className='text-sm font-semibold'>{t('canvasTools.fieldsTitle', { name: label })}</p>
      <p className='mb-2 text-[11px] text-muted-foreground'>{t('canvasTools.fieldsHelp')}</p>
      <ul className='max-h-56 space-y-1 overflow-y-auto'>
        {attributes.map((attribute) => {
          const isKey = keyFields.includes(attribute.key);
          return <li key={attribute.key} className='group flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-muted/60'>
            <button type='button' disabled={!onToggleKey} onClick={() => onToggleKey?.(conceptId, attribute.key)} aria-pressed={isKey}
              title={t(isKey ? 'canvasTools.unsetKey' : 'canvasTools.setKey', { field: attribute.label })} aria-label={t(isKey ? 'canvasTools.unsetKey' : 'canvasTools.setKey', { field: attribute.label })}
              className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', isKey ? 'bg-amber-400 text-amber-950' : 'text-muted-foreground/60 hover:bg-amber-400/20 hover:text-amber-700')}>
              <KeyRound className='h-3.5 w-3.5' />
            </button>
            <span className='min-w-0 flex-1 truncate text-sm'>{attribute.label}</span>
            <span className='text-[10px] text-muted-foreground'>{t(`attribute.type.${attribute.type}`)}</span>
            <button type='button' onClick={() => save(attributes.filter((item) => item.key !== attribute.key))} aria-label={t('canvasTools.removeField', { field: attribute.label })} title={t('canvasTools.removeField', { field: attribute.label })}
              className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100'><X className='h-3.5 w-3.5' /></button>
          </li>;
        })}
        {!attributes.length && <li className='px-1.5 py-2 text-xs text-muted-foreground'>{t('canvasTools.noFields')}</li>}
      </ul>
      <form className='mt-2 flex gap-1.5 border-t pt-2' onSubmit={add}>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('attributes.placeholder')} aria-label={t('attributes.add')} className='h-8 text-sm'
          onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation(); }} autoFocus />
        <Button type='submit' size='icon' className='h-8 w-8 shrink-0' disabled={!name.trim()} aria-label={t('attributes.add')}><Plus className='h-4 w-4' /></Button>
      </form>
    </PopoverContent>
  </Popover>;
}

export interface ConceptToolbarActions {
  onRename: () => void;
  onBringData?: () => void;
  onLinkConcept?: () => void;
  onAddRecord?: () => void;
  onDetails: () => void;
  onDelete?: () => void;
}

/** Everything that can be done to a concept, one click away while it is selected. */
export function ConceptToolbar({ conceptId, label, attributes, keyFields, onToggleKey, actions }: Readonly<{
  conceptId: string; label: string; attributes: AttributeDefinition[]; keyFields: string[];
  onToggleKey?: (conceptId: string, field: string) => void; actions: ConceptToolbarActions;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  return <ToolbarShell label={t('canvasTools.conceptToolbar', { name: label })}>
    <ToolButton label={t('canvasTools.rename')} onClick={actions.onRename}><Pencil className='h-4 w-4' /></ToolButton>
    <FieldsPopover conceptId={conceptId} label={label} attributes={attributes} keyFields={keyFields} onToggleKey={onToggleKey}
      trigger={<button type='button' title={t('canvasTools.fields')} aria-label={t('canvasTools.fields')} onClick={(event) => event.stopPropagation()}
        className='nodrag nopan flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium hover:bg-muted'><ListPlus className='h-4 w-4' />{attributes.length}</button>} />
    <ToolbarDivider />
    {actions.onBringData && <ToolButton tone='data' label={t('canvasTools.bringData')} onClick={actions.onBringData}><Sheet className='h-4 w-4' /></ToolButton>}
    {actions.onAddRecord && <ToolButton tone='data' label={t('records.quickAdd')} onClick={actions.onAddRecord}><Keyboard className='h-4 w-4' /></ToolButton>}
    {actions.onLinkConcept && <ToolButton label={t('concept.quickAdd')} onClick={actions.onLinkConcept}><Briefcase className='h-4 w-4' /></ToolButton>}
    <ToolbarDivider />
    <ToolButton label={t('canvasTools.details')} onClick={actions.onDetails}><PanelRight className='h-4 w-4' /></ToolButton>
    {actions.onDelete && <ToolButton tone='danger' label={t('designer.delete.concept', { name: label })} onClick={actions.onDelete}><Trash2 className='h-4 w-4' /></ToolButton>}
  </ToolbarShell>;
}

/** Actions for a source box: its mapping, another concept to feed, removal. Typed records open their list instead. */
export function SourceToolbar({ label, typed, onOpen, onAddFeed, onAddRecord, onRemove }: Readonly<{
  label: string; typed: boolean; onOpen?: () => void; onAddFeed?: () => void; onAddRecord?: () => void; onRemove?: () => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  return <ToolbarShell label={t('canvasTools.sourceToolbar', { name: label })}>
    {typed
      ? <ToolButton tone='data' label={t('canvasTools.openRecords')} onClick={onOpen}><Table2 className='h-4 w-4' /></ToolButton>
      : <ToolButton tone='data' label={t('canvasTools.editMapping')} onClick={onOpen}><Settings2 className='h-4 w-4' /></ToolButton>}
    {typed && onAddRecord && <ToolButton tone='data' label={t('records.quickAdd')} onClick={onAddRecord}><Plus className='h-4 w-4' /></ToolButton>}
    {!typed && onAddFeed && <ToolButton label={t('designer.plus.feed', { name: label })} onClick={onAddFeed}><Plus className='h-4 w-4' /></ToolButton>}
    {onRemove && <><ToolbarDivider /><ToolButton tone='danger' label={t('designer.delete.source', { name: label })} onClick={onRemove}><Trash2 className='h-4 w-4' /></ToolButton></>}
  </ToolbarShell>;
}
