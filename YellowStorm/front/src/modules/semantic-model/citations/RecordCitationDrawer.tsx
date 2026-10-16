import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink, FileText, Loader2, Network, Quote } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useFileViewerStore } from '@/modules/file-viewer/store';
import { showError } from '@/lib/notifications';
import { semanticModelApi } from '../api';
import { SemanticModelGraphViewer } from '../components/editor/SemanticModelGraphViewer';
import type { CitedRecordDocument, CitedRecordField, CitedRecordView } from '../types';
import { useRecordCitationStore, type RecordCitationTarget } from './record-citation-store';

/** A value longer than this is folded; the drawer shows a record, not a document. */
const LONG_VALUE = 280;
/** A value searched in its document only when it is short enough to be found as written. */
const HIGHLIGHT_CHARS = 200;

const valueText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/**
 * The record behind a chat citation: what the answer quoted, the record's values as the data holds them now,
 * where each value came from (opening the document at its page or row), and a way to the model's graph.
 */
export default function RecordCitationDrawer() {
  const target = useRecordCitationStore((state) => state.target);
  const close = useRecordCitationStore((state) => state.close);
  const graph = useRecordCitationStore((state) => state.graph);
  const closeGraph = useRecordCitationStore((state) => state.closeGraph);
  const { t } = useModuleTranslation('semantic-model');
  const onGraphRecord = useCallback((found: boolean) => {
    if (!found) showError(t('citedRecord.graphRecordMissing'));
  }, [t]);
  return (
    <>
    {graph && (
      <SemanticModelGraphViewer key={`${graph.modelId}:${graph.entityId}`} open modal onClose={closeGraph}
        modelId={graph.modelId} initialRecordId={graph.entityId} onInitialRecord={onGraphRecord} />
    )}
    <Sheet open={target !== null} onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent side='right' className='flex w-full flex-col gap-0 p-0 sm:max-w-md'>
        {target && <CitedRecord key={`${target.modelId}:${target.entityId}`} target={target} onClose={close} />}
      </SheetContent>
    </Sheet>
    </>
  );
}

function CitedRecord({ target, onClose }: { target: RecordCitationTarget; onClose: () => void }) {
  const { t } = useModuleTranslation('semantic-model');
  const [view, setView] = useState<CitedRecordView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    semanticModelApi.getCitedRecord(target.modelId, target.entityId, { data: target.data, dataRevisionId: target.dataRevisionId || undefined })
      .then((result) => { if (!cancelled) setView(result); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [target]);

  const record = view?.record;
  const documents = new Map((record?.sources ?? []).map((source) => [source.documentId, source]));
  const openDocument = (document: CitedRecordDocument, origin?: CitedRecordField['origin'], highlight?: string) => {
    onClose();
    const text = highlight && highlight.length <= HIGHLIGHT_CHARS ? highlight : undefined;
    void useFileViewerStore.getState().openFile(document.workspaceId, document.documentId, document.path, document.name, document.mimeType, {
      ...(origin?.page ? { page: origin.page } : {}),
      ...(text && !origin?.row ? { highlightText: text } : {}),
      ...(origin?.row ? { spreadsheet: { sheetName: origin.sheet, focusRow: origin.row } } : {}),
    });
  };
  const openGraph = () => useRecordCitationStore.getState().openGraph({ modelId: target.modelId, entityId: target.entityId });
  const keyText = Object.entries(target.keyFields).map(([key, value]) => `${key}: ${value}`).join(' · ');

  return (
    <>
      <SheetHeader className='border-b px-5 py-4 text-left'>
        <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>{target.concept || t('citedRecord.record')}</p>
        <SheetTitle className='break-words pr-6 text-base'>{record?.name || target.name}</SheetTitle>
        <SheetDescription className='text-xs'>
          {t('citedRecord.fromModel', { model: view?.model.name || target.modelName })}{keyText ? ` · ${keyText}` : ''}
        </SheetDescription>
        <Button variant='outline' size='sm' className='mt-2 w-fit' onClick={openGraph}>
          <Network className='mr-1.5 h-4 w-4' aria-hidden='true' />{t('citedRecord.openInGraph')}
        </Button>
      </SheetHeader>

      <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4'>
        {target.quote && (
          <figure className='rounded-lg border bg-muted/40 p-3'>
            <figcaption className='mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground'>
              <Quote className='h-3 w-3' aria-hidden='true' />{target.field ? t('citedRecord.quotedFrom', { field: target.field }) : t('citedRecord.quoted')}
            </figcaption>
            <blockquote className='whitespace-pre-wrap break-words text-sm'>{target.quote}</blockquote>
          </figure>
        )}

        {!view && !failed && <p className='flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' aria-hidden='true' />{t('citedRecord.loading')}</p>}
        {failed && <Notice>{t('citedRecord.failed')}</Notice>}
        {view?.status === 'hidden' && <Notice>{t('citedRecord.hidden')}</Notice>}
        {view?.status === 'missing' && <Notice>{t('citedRecord.missing')}</Notice>}
        {view?.changed && view.status === 'ok' && <Notice>{t('citedRecord.changed')}</Notice>}

        {record && (
          <section aria-label={t('citedRecord.values')}>
            <h3 className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('citedRecord.values')}</h3>
            <dl className='divide-y'>
              {record.fields.map((field) => (
                <FieldRow key={field.key} field={field} documents={documents} onOpen={openDocument} />
              ))}
            </dl>
          </section>
        )}

        {record && (record.sources.length > 0 || record.unavailableSources > 0) && (
          <section aria-label={t('citedRecord.sources')}>
            <h3 className='mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('citedRecord.sources')}</h3>
            <ul className='space-y-1'>
              {record.sources.map((source) => (
                <li key={source.documentId}>
                  <button type='button' className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted'
                    onClick={() => openDocument(source, source.rows?.length ? { kind: 'source', row: source.rows[0] } : undefined)}>
                    <FileText className='h-4 w-4 shrink-0 text-muted-foreground' aria-hidden='true' />
                    <span className='min-w-0 flex-1 truncate'>{source.name}</span>
                    {source.rows?.length ? <span className='shrink-0 text-[11px] text-muted-foreground'>{t('citedRecord.rows', { rows: source.rows.join(', ') })}</span> : null}
                    <ExternalLink className='h-3 w-3 shrink-0 text-muted-foreground' aria-hidden='true' />
                  </button>
                </li>
              ))}
            </ul>
            {record.unavailableSources > 0 && <p className='mt-1 text-[11px] text-muted-foreground'>{t('citedRecord.unavailableSources', { count: record.unavailableSources })}</p>}
          </section>
        )}
      </div>

    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className='flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300'><AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' aria-hidden='true' />{children}</p>;
}

function FieldRow({ field, documents, onOpen }: {
  field: CitedRecordField;
  documents: Map<string, CitedRecordDocument>;
  onOpen: (document: CitedRecordDocument, origin?: CitedRecordField['origin'], highlight?: string) => void;
}) {
  const { t } = useModuleTranslation('semantic-model');
  const [expanded, setExpanded] = useState(false);
  const text = valueText(field.value);
  const long = text.length > LONG_VALUE;
  const origin = field.origin;
  const document = origin?.documentId ? documents.get(origin.documentId) : undefined;
  const where = [
    origin?.sheet,
    origin?.page ? t('citedRecord.page', { page: origin.page }) : null,
    origin?.row ? t('citedRecord.row', { row: origin.row }) : null,
    origin?.column ? t('citedRecord.column', { column: origin.column }) : null,
  ].filter(Boolean).join(' · ');
  return (
    <div className='grid grid-cols-[minmax(6rem,0.6fr)_1fr] gap-3 py-2 text-sm'>
      <dt className='break-words text-muted-foreground'>{field.label}</dt>
      <dd className='min-w-0'>
        <p className={`whitespace-pre-wrap break-words ${text ? '' : 'italic text-muted-foreground'}`}>
          {text ? (long && !expanded ? `${text.slice(0, LONG_VALUE)}…` : text) : t('citedRecord.noValue')}
        </p>
        {(long || field.truncated) && (
          <button type='button' className='text-[11px] text-primary hover:underline' onClick={() => setExpanded((value) => !value)}>
            {expanded ? t('citedRecord.showLess') : t('citedRecord.showMore')}
          </button>
        )}
        {document && (
          <button type='button' className='mt-1 flex max-w-full items-center gap-1 truncate text-left text-[11px] text-primary hover:underline'
            onClick={() => onOpen(document, origin, text)}>
            <ExternalLink className='h-3 w-3 shrink-0' aria-hidden='true' />
            <span className='truncate'>{document.name}{where ? ` · ${where}` : ''}</span>
          </button>
        )}
        {!document && where && <p className='mt-1 text-[11px] text-muted-foreground'>{where}</p>}
        {origin?.fromRecord && <p className='mt-1 text-[11px] text-muted-foreground'>{t('citedRecord.fromRecord', { name: origin.fromRecord.name })}</p>}
        {origin?.kind === 'ai' && <p className='mt-1 text-[11px] text-muted-foreground'>{t('citedRecord.readByAi')}</p>}
        {(origin?.kind === 'human' || origin?.corrected) && <p className='mt-1 text-[11px] text-muted-foreground'>{t('citedRecord.corrected')}</p>}
      </dd>
    </div>
  );
}
