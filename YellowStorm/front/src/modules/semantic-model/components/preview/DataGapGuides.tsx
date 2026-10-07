import { ExternalLink, FileWarning, KeyRound, Link2Off, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFileViewerStore } from '@/modules/file-viewer/store';
import { useModuleTranslation } from '@/modules/localization';
import type { SemanticDataGaps, SemanticDataPreview } from '../../types';

type Entity = SemanticDataPreview['concepts'][number]['entities'][number];
type Provenance = Entity['provenance'][string];
type RowSample = NonNullable<SemanticDataGaps['rowSamples']>[number];
type LinkSample = NonNullable<SemanticDataGaps['linkSamples']>[number];

/** Where to guide actions that change the model rather than one value. */
export interface GapGuideActions {
  /** Opens how a file is read into a concept. */
  onOpenMapping?: (mappingId: string) => void;
  /** Opens what makes a concept's records unique. */
  onOpenIdentity?: (conceptId: string) => void;
  /** Opens how the records of a relationship are matched. */
  onOpenMatching?: (relationId: string) => void;
}

function readable(value: string) {
  const words = value.replaceAll(/[_-]+/g, ' ').trim();
  return words ? words[0].toLocaleUpperCase() + words.slice(1) : value;
}

function openFile(source: { workspaceId?: string; documentId?: string; documentPath?: string; documentName: string; mimeType?: string }, page?: number) {
  if (!source.workspaceId || !source.documentId) return;
  void useFileViewerStore.getState().openFile(source.workspaceId, source.documentId, source.documentPath ?? '', source.documentName, source.mimeType ?? '', { page: page ?? 1 });
}

/** The file a record was read from: the source of its other values. */
export function recordSource(entity: Entity): Provenance | undefined {
  return Object.values(entity.provenance).find((provenance) => provenance.source.kind !== 'manual' && provenance.source.documentId);
}

/**
 * Under an empty value: where it was looked for, what that means, and the three ways out — look at the
 * file, type the value, or change how the field is read.
 */
export function MissingValueGuide({ entity, field, onOpenMapping }: Readonly<{ entity: Entity; field: string; onOpenMapping?: (mappingId: string) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const provenance = recordSource(entity);
  const source = provenance?.source;
  const name = readable(field);
  const sheet = source?.kind === 'excel_sheet' || source?.kind === 'csv';
  const where = !source ? t('dataGuide.missingNoSource', { field: name })
    : sheet && provenance?.rowNumber ? t('dataGuide.missingInRow', { field: name, document: source.documentName, row: provenance.rowNumber })
      : t('dataGuide.missingInDocument', { field: name, document: source.documentName });
  return <div className='mt-2 rounded-lg border border-primary/30 bg-background p-3 text-xs'>
    <p className='font-medium text-foreground'>{where}</p>
    <p className='mt-1 text-muted-foreground'>{t(source ? 'dataGuide.missingHint' : 'dataGuide.missingHintNoSource', { field: name })}</p>
    {source && <div className='mt-2 flex flex-wrap gap-2'>
      {source.documentId && <Button size='sm' variant='outline' className='h-7 px-2 text-xs' onClick={() => openFile(source, Number.parseInt(provenance?.field?.page ?? '1', 10) || 1)}><ExternalLink className='mr-1 h-3 w-3' />{t('dataGuide.openFile', { document: source.documentName })}</Button>}
      {provenance?.mappingId && onOpenMapping && <Button size='sm' variant='outline' className='h-7 px-2 text-xs' onClick={() => onOpenMapping(provenance.mappingId)}><Settings2 className='mr-1 h-3 w-3' />{t('dataGuide.changeReading', { field: name })}</Button>}
    </div>}
  </div>;
}

/** Rows that never became records: each one with its file, what it held, and the empty field that kept it out. */
export function RejectedRowsGuide({ conceptId, conceptLabel, gaps, onOpenMapping, onOpenIdentity }: Readonly<{ conceptId: string; conceptLabel: string; gaps?: SemanticDataGaps } & GapGuideActions>) {
  const { t } = useModuleTranslation('semantic-model');
  const count = gaps?.other.filter((gap) => gap.conceptId === conceptId && gap.kind === 'missing_identity').reduce((total, gap) => total + gap.count, 0) ?? 0;
  const samples = (gaps?.rowSamples ?? []).filter((sample) => sample.conceptId === conceptId && sample.kind === 'missing_identity');
  return <section className='rounded-2xl border border-primary/40 bg-background p-4' aria-label={t('dataGuide.rowsTitle', { count, concept: conceptLabel })}>
    <div className='flex flex-wrap items-start gap-3'>
      <FileWarning className='mt-0.5 h-5 w-5 shrink-0 text-amber-600' />
      <div className='min-w-0 flex-1'>
        <h3 className='font-semibold'>{t('dataGuide.rowsTitle', { count, concept: conceptLabel })}</h3>
        <p className='mt-1 text-sm text-muted-foreground'>{t('dataGuide.rowsHelp', { concept: conceptLabel })}</p>
      </div>
      {onOpenIdentity && <Button size='sm' variant='outline' onClick={() => onOpenIdentity(conceptId)}><KeyRound className='mr-1.5 h-3.5 w-3.5' />{t('dataGuide.changeUnique', { concept: conceptLabel })}</Button>}
    </div>
    {samples.length === 0
      ? <p className='mt-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground'>{t('dataGuide.rowsRunAgain')}</p>
      : <ul className='mt-3 space-y-3'>{samples.map((sample, index) => <RejectedRow key={`${sample.source?.documentId ?? 'row'}-${sample.rowNumber ?? index}-${index}`} sample={sample} onOpenMapping={onOpenMapping} />)}</ul>}
    {samples.length > 0 && samples.length < count && <p className='mt-2 text-xs text-muted-foreground'>{t('dataGuide.samplesShown', { shown: samples.length, count })}</p>}
  </section>;
}

function RejectedRow({ sample, onOpenMapping }: Readonly<{ sample: RowSample; onOpenMapping?: (mappingId: string) => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const field = sample.fieldLabel ?? readable(sample.field ?? '');
  const values = Object.entries(sample.values);
  // The empty field is shown even when the row had no column for it at all.
  const rows: Array<[string, unknown]> = sample.field && !values.some(([key]) => key === sample.field) ? [[sample.field, null], ...values] : values;
  return <li className='rounded-xl border p-3'>
    <div className='flex flex-wrap items-center gap-2 text-xs'>
      <span className='font-medium'>{sample.source?.documentName || t('dataGuide.unknownFile')}</span>
      {sample.source?.sheetName && <span className='text-muted-foreground'>/ {sample.source.sheetName}</span>}
      {sample.rowNumber != null && <span className='text-muted-foreground'>· {t('dataPreview.row', { row: sample.rowNumber })}</span>}
    </div>
    <p className='mt-1 text-sm'>{t('dataGuide.rowMissing', { field })}</p>
    <dl className='mt-2 grid grid-cols-[minmax(6rem,0.6fr)_1fr] gap-x-3 gap-y-1 text-xs'>
      {rows.map(([key, value]) => {
        const empty = key === sample.field;
        return <div key={key} className={`contents ${empty ? 'font-medium text-destructive' : ''}`}>
          <dt className={empty ? '' : 'text-muted-foreground'}>{readable(key)}</dt>
          <dd className='break-words'>{empty ? t('dataGuide.empty') : String(value ?? '')}</dd>
        </div>;
      })}
    </dl>
    {sample.source && <div className='mt-2 flex flex-wrap gap-2'>
      <Button size='sm' variant='outline' className='h-7 px-2 text-xs' onClick={() => openFile(sample.source!)}><ExternalLink className='mr-1 h-3 w-3' />{t('dataGuide.openFile', { document: sample.source.documentName })}</Button>
      {onOpenMapping && <Button size='sm' variant='outline' className='h-7 px-2 text-xs' onClick={() => onOpenMapping(sample.source!.mappingId)}><Settings2 className='mr-1 h-3 w-3' />{t('dataGuide.editMapping')}</Button>}
    </div>}
  </li>;
}

/**
 * Records whose link found nothing: which record, the value it looked for, and why nothing matched.
 * Picking one opens it below, where a link can be added by hand.
 */
export function UnmatchedLinksGuide({ relationId, relationLabel, targetLabel, gaps, entityLabel, unmatchedInSample, onPick, onOpenMatching }: Readonly<{
  relationId: string;
  relationLabel: string;
  targetLabel: string;
  gaps?: SemanticDataGaps;
  /** The name of a record when it is in the sample, so it can be opened. */
  entityLabel: (id: string) => string | undefined;
  /** Records of the sample with no link of this kind: used when the data kept no examples. */
  unmatchedInSample: string[];
  onPick: (entityId: string) => void;
} & Pick<GapGuideActions, 'onOpenMatching'>>) {
  const { t } = useModuleTranslation('semantic-model');
  const count = gaps?.unresolvedLinks.filter((gap) => gap.relationId === relationId).reduce((total, gap) => total + gap.count, 0) ?? 0;
  const samples = (gaps?.linkSamples ?? []).filter((sample) => sample.relationId === relationId);
  const rows: Array<{ id: string; sample?: LinkSample }> = samples.length ? samples.map((sample) => ({ id: sample.sourceEntityId, sample })) : unmatchedInSample.map((id) => ({ id }));
  const why = (sample?: LinkSample) => {
    if (!sample) return t('dataGuide.linkNoMatch', { target: targetLabel });
    if (sample.kind === 'missing_reference') return t('dataGuide.linkEmpty', { field: readable(sample.referenceField ?? '') });
    return t('dataGuide.linkLookedFor', { target: targetLabel, field: readable(sample.targetField ?? sample.referenceField ?? ''), value: String(sample.referenceValue ?? '') });
  };
  return <section className='rounded-2xl border border-primary/40 bg-background p-4' aria-label={t('dataGuide.linksTitle', { count, relationship: relationLabel })}>
    <div className='flex flex-wrap items-start gap-3'>
      <Link2Off className='mt-0.5 h-5 w-5 shrink-0 text-amber-600' />
      <div className='min-w-0 flex-1'>
        <h3 className='font-semibold'>{t('dataGuide.linksTitle', { count, relationship: relationLabel })}</h3>
        <p className='mt-1 text-sm text-muted-foreground'>{t('dataGuide.linksHelp', { target: targetLabel })}</p>
      </div>
      {onOpenMatching && <Button size='sm' variant='outline' onClick={() => onOpenMatching(relationId)}><Settings2 className='mr-1.5 h-3.5 w-3.5' />{t('dataGuide.changeMatching')}</Button>}
    </div>
    {!samples.length && <p className='mt-3 text-xs text-muted-foreground'>{t('dataGuide.linksFromSample')}</p>}
    {rows.length > 0 && <ul className='mt-3 max-h-72 space-y-1 overflow-y-auto'>{rows.map(({ id, sample }, index) => {
      const label = entityLabel(id);
      return <li key={`${id}-${index}`}>
        <button type='button' disabled={!label} onClick={() => onPick(id)} className='flex w-full flex-wrap items-baseline gap-x-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent'>
          <span className='font-medium'>{label ?? t('dataGuide.recordOutsideSample')}</span>
          <span className='text-xs text-muted-foreground'>{why(sample)}</span>
        </button>
      </li>;
    })}</ul>}
    {samples.length > 0 && samples.length < count && <p className='mt-2 text-xs text-muted-foreground'>{t('dataGuide.samplesShown', { shown: samples.length, count })}</p>}
  </section>;
}
