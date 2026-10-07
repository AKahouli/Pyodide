import { ListTree } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useModuleTranslation } from '@/modules/localization';
import type { DerivedExpand, DerivedExpandSplit } from '../../types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../common/Select';
import { FormField, HelpTip, INPUT_COMPACT } from '../form/FormParts';

export const EXPAND_SPLITS: DerivedExpandSplit[] = ['auto', 'list', 'emails', 'delimiters', 'lines'];
const NO_RELATION = '__none__';

/** Delimiters typed as text, one per space ("; , |"); a space itself is written "space". */
export const parseDelimiters = (text: string) => text.split(/\s+/).filter(Boolean).map((item) => item === 'space' ? ' ' : item).slice(0, 10);
export const delimitersText = (delimiters: string[] = []) => delimiters.map((item) => item === ' ' ? 'space' : item).join(' ');

/**
 * Several records per source record: one source field holding several values (text, an address list or a
 * JSON array) is split into items, and each item becomes a record of its own. Off: one record per source record.
 */
export function ExpandCard({ value, onChange, sourceFields, sourceLabel, relations, items, unit = 'record' }: Readonly<{
  value: DerivedExpand | null;
  onChange: (value: DerivedExpand | null) => void;
  sourceFields: Array<{ key: string; label: string }>;
  sourceLabel: string;
  /** What is expanded: another concept's records (fields), or a sheet's rows (columns). */
  unit?: 'record' | 'row';
  /** Relationships joining the two concepts, to link each source record to its items' records. */
  relations: Array<{ id: string; label: string }>;
  /** What the preview found: items read on the sample records, and whether some were left out. */
  items?: { count: number; records: number; truncated: boolean };
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const set = (patch: Partial<DerivedExpand>) => value && onChange({ ...value, ...patch });
  const rows = unit === 'row';
  return <div className='space-y-3 rounded-lg border px-3 py-2.5'>
    <div className='flex items-start gap-3'>
      <Switch id='derived-expand' checked={Boolean(value)} className='mt-0.5'
        // The link is always chosen: the one relationship two concepts share may mean something else (the sender, not a recipient).
        onCheckedChange={(checked) => onChange(checked ? { field: '', split: 'auto' } : null)} />
      <div className='min-w-0 flex-1 space-y-0.5'>
        <div className='flex items-center gap-1'>
          <ListTree className='h-3.5 w-3.5 text-muted-foreground' />
          <Label htmlFor='derived-expand' className='text-xs font-medium'>{rows ? t('derived.expand.row.label') : t('derived.expand.label', { source: sourceLabel })}</Label>
          <HelpTip text={rows ? t('derived.expand.row.tip') : t('derived.expand.tip')} />
        </div>
        <p className='text-[11px] text-muted-foreground'>{rows ? value ? t('derived.expand.row.on') : t('derived.expand.row.off')
          : value ? t('derived.expand.on') : t('derived.expand.off', { source: sourceLabel })}</p>
      </div>
    </div>
    {value && <div className='grid gap-3 sm:grid-cols-2'>
      <FormField label={rows ? t('derived.expand.row.field') : t('derived.expand.field')} htmlFor='derived-expand-field'>
        <Select value={value.field || undefined} onValueChange={(field) => set({ field })}>
          <SelectTrigger id='derived-expand-field' className={INPUT_COMPACT} aria-label={rows ? t('derived.expand.row.field') : t('derived.expand.field')}>
            <SelectValue placeholder={rows ? t('derived.expand.row.chooseField') : t('derived.expand.chooseField')} /></SelectTrigger>
          <SelectContent>{sourceFields.map((field) => <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>)}</SelectContent>
        </Select>
      </FormField>
      <FormField label={t('derived.expand.split')} help={t(`derived.expand.splitHelp.${value.split}`)} htmlFor='derived-expand-split'>
        <Select value={value.split} onValueChange={(split: DerivedExpandSplit) => set({ split })}>
          <SelectTrigger id='derived-expand-split' className={INPUT_COMPACT} aria-label={t('derived.expand.split')}><SelectValue /></SelectTrigger>
          <SelectContent>{EXPAND_SPLITS.map((split) => <SelectItem key={split} value={split}>{t(`derived.expand.splits.${split}`)}</SelectItem>)}</SelectContent>
        </Select>
      </FormField>
      {value.split === 'delimiters' && <FormField label={t('derived.expand.delimiters')} help={t('derived.expand.delimitersHelp')} htmlFor='derived-expand-delimiters'>
        <Input id='derived-expand-delimiters' className={INPUT_COMPACT} defaultValue={delimitersText(value.delimiters)} placeholder='; ,'
          onChange={(event) => set({ delimiters: parseDelimiters(event.target.value) })} />
      </FormField>}
      {(value.split === 'auto' || value.split === 'list') && <FormField label={t('derived.expand.path')} help={t('derived.expand.pathHelp')} htmlFor='derived-expand-path'>
        <Input id='derived-expand-path' className={INPUT_COMPACT} value={value.path ?? ''} placeholder='to, data.recipients[*]'
          onChange={(event) => set({ path: event.target.value })} />
      </FormField>}
      {relations.length > 0 && <FormField label={t('derived.expand.relation')} help={t('derived.expand.relationHelp')} htmlFor='derived-expand-relation'>
        <Select value={value.relationId ?? NO_RELATION} onValueChange={(id) => set({ relationId: id === NO_RELATION ? undefined : id })}>
          <SelectTrigger id='derived-expand-relation' className={INPUT_COMPACT} aria-label={t('derived.expand.relation')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_RELATION}>{t('derived.expand.noRelation')}</SelectItem>
            {relations.map((relation) => <SelectItem key={relation.id} value={relation.id}>{relation.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </FormField>}
    </div>}
    {value?.field && items && <p role='status' className='text-[11px] text-muted-foreground'>
      {rows ? t('derived.expand.row.found', { count: items.count, rows: items.records }) : t('derived.expand.found', { count: items.count, records: items.records })}
      {items.truncated ? ` ${t('derived.expand.truncated')}` : ''}
    </p>}
  </div>;
}
