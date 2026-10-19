import { useContext, useEffect } from 'react';
import { useGetFieldValue, useSetFieldValue, useTriggerAction, useIsStreaming } from '@openuidev/react-lang';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { useModuleTranslation } from '@/modules/localization';
import { OpenUiSubmissionContext } from './actions';
import type { StockComponent } from './inline-text';
import { getTableRows, tableView, type TableView } from './data-exploration';
import { CitationMarkdown, hasMarker, OpenUiCitationContext } from './citations';

export function withDataTable(Stock: StockComponent): StockComponent {
  return function DataTable(args) {
    const getValue = useGetFieldValue(); const setValue = useSetFieldValue(); const trigger = useTriggerAction();
    const streaming = useIsStreaming(); const statuses = useContext(OpenUiSubmissionContext);
    const { t } = useModuleTranslation('conversation');
    const { byReference } = useContext(OpenUiCitationContext);
    const id = args.statementId;
    const key = `table:${id}`;
    const existing = getValue('__ysExplore', key);
    const view = tableView(existing);
    useEffect(() => {
      // Read at effect time: StrictMode may replay this after the SDK hydrates saved values.
      if (id && !streaming && getValue('__ysExplore', key) === undefined) setValue('__ysExplore', 'TableView', key, tableView(undefined), false);
    }, [id, key, streaming, getValue, setValue]);
    const rows = args.props.rows as unknown[][] | undefined;
    const columns = args.props.columns as { props?: { label?: string } }[] | undefined;
    // Action cells retain the stock renderer; exploration never serializes executable nodes.
    if (!id || !Array.isArray(rows) || !Array.isArray(columns) || rows.some(row => !Array.isArray(row) || row.some(cell => typeof cell === 'object' && cell !== null))) return <Stock {...args} />;
    const visible = getTableRows(rows, view);
    const update = (next: TableView) => setValue('__ysExplore', 'TableView', key, next, false);
    const disabled = streaming || statuses.__ysExplore === 'submitting';
    const selected = visible.filter(({ index }) => view.selectedRows.includes(index));
    return <fieldset disabled={disabled} className='m-0 min-w-0 space-y-2 border-0 p-0'>
      <Input aria-label={t('openui.explore.filter', { name: id })} placeholder={t('openui.explore.filterPlaceholder')} value={view.query} maxLength={200}
        onChange={event => update({ ...view, query: event.target.value, selectedRows: [] })} />
      <Table>
        <TableHeader><TableRow><TableHead><span className='sr-only'>{t('openui.explore.selection')}</span></TableHead>
          {columns.map((column, index) => <TableHead key={index} aria-sort={view.sortColumn === index ? view.direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
            <Button size='sm' variant='ghost' aria-label={t('openui.explore.sort', { name: column.props?.label ?? String(index + 1) })}
              onClick={() => update({ ...view, sortColumn: index, direction: view.sortColumn === index && view.direction === 'asc' ? 'desc' : 'asc' })}>
              {column.props?.label}{view.sortColumn === index ? view.direction === 'asc' ? <ArrowUp className='size-3' /> : <ArrowDown className='size-3' /> : <ArrowUpDown className='size-3' />}
            </Button>
          </TableHead>)}
        </TableRow></TableHeader>
        <TableBody>{visible.map(({ row, index }) => <TableRow key={index} data-state={view.selectedRows.includes(index) ? 'selected' : undefined}>
          <TableCell><input type='checkbox' aria-label={t('openui.explore.selectRow', { index: index + 1 })} checked={view.selectedRows.includes(index)}
            onChange={event => update({ ...view, selectedRows: event.target.checked ? [...view.selectedRows, index] : view.selectedRows.filter(entry => entry !== index) })} /></TableCell>
          {row.map((cell, cellIndex) => <TableCell key={cellIndex}>{hasMarker(cell, byReference) ? <CitationMarkdown inline textMarkdown={String(cell)} /> : args.renderNode(cell)}</TableCell>)}
        </TableRow>)}</TableBody>
      </Table>
      <p aria-live='polite' className='text-xs text-muted-foreground'>{t('openui.explore.rows', { count: visible.length, selected: selected.length })}</p>
      <Button size='sm' variant='outline' onClick={() => {
        update(view);
        void trigger(t('openui.explore.apply', { name: id }), '__ysExplore', { type: 'continue_conversation', params: {
          table: id, selectedRows: selected.map(({ row, index }) => ({ index, values: row })) } });
      }}>{t('openui.explore.apply', { name: id })}</Button>
      {statuses.__ysExplore && <p role='status' className='text-xs text-muted-foreground'>{t(`openui.interaction.${statuses.__ysExplore}`)}</p>}
    </fieldset>;
  };
}
