import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Plus, Search, Table2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { showError } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { useManualTable } from '../../hooks/use-manual-table';
import { useSemanticModelEditorStore } from '../../store';
import type { SemanticNodeType } from '../../types';
import { manualColumns } from '../../utils/manual-table';
import { ManualTableGrid, type FocusRequest } from './ManualTableGrid';

function ManualTableBody({ concept, canEdit }: Readonly<{ concept: SemanticNodeType; canEdit: boolean }>) {
  const { t } = useModuleTranslation('semantic-model');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const lastSelected = useRef(0);
  const file = useRef<HTMLInputElement>(null);
  const nameLabel = t('manualTable.name');
  const columns = useMemo(() => manualColumns(concept.attributes ?? [], nameLabel), [concept.attributes, nameLabel]);
  const { rows, total, edit, pasteText, importText, appendRow, deleteRows } = useManualTable(concept.id, columns, canEdit, filter);

  // A selection never keeps rows that are gone (deleted here, or undone).
  const chosen = useMemo(() => rows.filter((row) => row.record && selected.has(row.id)).map((row) => row.id), [rows, selected]);
  const storedRows = rows.filter((row) => row.record);

  const select = (index: number, shift: boolean) => {
    const row = rows[index];
    if (!row?.record) return;
    const next = new Set(selected);
    if (shift) {
      const [from, to] = [Math.min(lastSelected.current, index), Math.max(lastSelected.current, index)];
      for (const between of rows.slice(from, to + 1)) if (between.record) next.add(between.id);
    } else if (next.has(row.id)) next.delete(row.id);
    else next.add(row.id);
    lastSelected.current = index;
    setSelected(next);
  };
  const addRow = () => {
    const index = appendRow();
    if (index !== null) setFocusRequest({ row: index, column: 0, tick: Math.random() });
  };
  const removeChosen = () => { deleteRows(chosen); setSelected(new Set()); };
  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    try {
      importText(await picked.text());
    } catch {
      showError(t('manualTable.import.error'));
    }
  };

  const count = total === 1 ? t('manualTable.rowCount_one', { count: total }) : t('manualTable.rowCount_other', { count: total });
  const shown = filter.trim() ? ` · ${t('manualTable.shown', { count: storedRows.length })}` : '';
  return <>
    <div className='flex flex-wrap items-center gap-2 border-b px-5 py-3'>
      {canEdit && <>
        <Button size='sm' onClick={addRow}><Plus className='me-1.5 h-4 w-4' />{t('manualTable.addRow')}</Button>
        <Button size='sm' variant='outline' onClick={() => file.current?.click()}><Upload className='me-1.5 h-4 w-4' />{t('manualTable.import.button')}</Button>
        <input ref={file} type='file' accept='.csv,.tsv,.txt,text/csv,text/plain' className='sr-only' tabIndex={-1} aria-label={t('manualTable.import.file')} onChange={(event) => void readFile(event)} />
        <Button size='sm' variant='outline' className='text-destructive' disabled={!chosen.length} onClick={removeChosen}><Trash2 className='me-1.5 h-4 w-4' />{t('manualTable.deleteSelected', { count: chosen.length })}</Button>
      </>}
      <div className='relative ms-auto w-full sm:w-56'>
        <Search className='pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground' />
        <Input className='h-9 ps-8' value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t('manualTable.filter')} aria-label={t('manualTable.filter')} />
      </div>
    </div>
    <ManualTableGrid columns={columns} rows={rows} selected={selected} canEdit={canEdit} focusRequest={focusRequest}
      onEdit={edit} onPasteText={pasteText} onAppend={appendRow} onSelect={select}
      onSelectAll={(checked) => setSelected(checked ? new Set(storedRows.map((row) => row.id)) : new Set())} />
    <div className='border-t px-5 py-2 text-xs text-muted-foreground'>
      <p role='status' className='font-medium text-foreground'>{count}{shown}</p>
      <p>{canEdit ? t('manualTable.hint') : t('manualTable.readOnly')}</p>
      {(concept.attributes?.length ?? 0) === 0 && <p className='text-amber-700 dark:text-amber-400'>{t('manualTable.noFields')}</p>}
    </div>
  </>;
}

/** The grid where the rows of a concept's manual table are typed, pasted from a spreadsheet, or imported from a CSV file. */
export function ManualTableEditor({ conceptId, canEdit, onClose }: Readonly<{ conceptId: string | null; canEdit: boolean; onClose: () => void }>) {
  const { t } = useModuleTranslation('semantic-model');
  const concept = useSemanticModelEditorStore((state) => state.graph?.nodes.find((node) => node.id === conceptId));
  return <Sheet modal={false} open={Boolean(conceptId && concept)} onOpenChange={(open) => { if (!open) onClose(); }}>
    {conceptId && concept && <SheetContent side='right' closeLabel={t('action.close')} className='flex w-full flex-col gap-0 p-0 sm:max-w-5xl' onInteractOutside={(event) => event.preventDefault()}>
      <SheetHeader className='border-b p-5 pe-12'>
        <SheetTitle className='flex items-center gap-2'><Table2 className='h-4 w-4' />{t('manualTable.title', { concept: concept.label })}</SheetTitle>
        <SheetDescription>{t('manualTable.description', { concept: concept.label })}</SheetDescription>
      </SheetHeader>
      <ManualTableBody key={conceptId} concept={concept} canEdit={canEdit} />
    </SheetContent>}
  </Sheet>;
}
