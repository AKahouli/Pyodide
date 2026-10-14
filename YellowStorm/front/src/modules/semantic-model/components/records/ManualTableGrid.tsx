import { memo, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { ManualRow } from '../../hooks/use-manual-table';
import type { ManualColumn } from '../../utils/manual-table';

// Rows have one fixed height, so only the ones in view (and a few around them) are drawn, however many there are.
const ROW_HEIGHT = 36;
const OVERSCAN = 8;
const DEFAULT_VIEWPORT = 480;
const NAME_WIDTH = 220;
const FIELD_WIDTH = 170;

export interface FocusRequest {
  row: number;
  column: number;
  /** A new number each time, so asking for the same cell twice still moves the focus. */
  tick: number;
}

interface CellHandlers {
  edit: (row: number, column: number, value: string) => void;
  move: (row: number, column: number) => void;
  select: (row: number, shift: boolean) => void;
}

const cellText = (row: ManualRow, column: ManualColumn) =>
  column.attribute === null ? row.record?.label ?? '' : String(row.record?.values?.[column.attribute] ?? '');

/** A text box that keeps its own text while typed in, and tells the table once, on leaving it or on Enter. */
const Cell = memo(function Cell({ value, row, column, name, canEdit, handlers }: Readonly<{ value: string; row: number; column: number; name: string; canEdit: boolean; handlers: CellHandlers }>) {
  const input = useRef<HTMLInputElement>(null);
  const known = useRef(value);
  useEffect(() => {
    known.current = value;
    // The model changed under this cell (a paste, an undo): show it, unless the person is typing here.
    if (input.current && document.activeElement !== input.current) input.current.value = value;
  }, [value]);
  const commit = () => {
    const box = input.current;
    if (!box) return;
    const next = box.value.trim();
    // A record cannot lose its name: an emptied Name goes back to what it was.
    if (column === 0 && next === '' && known.current !== '') { box.value = known.current; return; }
    if (next === known.current) return;
    known.current = next;
    handlers.edit(row, column, next);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === 'ArrowDown') { event.preventDefault(); commit(); handlers.move(row + 1, column); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); commit(); handlers.move(row - 1, column); }
    else if (event.key === 'Escape' && input.current) input.current.value = known.current;
  };
  return <input ref={input} defaultValue={value} readOnly={!canEdit} aria-label={name} data-row={row} data-col={column}
    className='h-9 w-full bg-transparent px-2 text-sm outline-none focus:bg-primary/5 focus:ring-2 focus:ring-inset focus:ring-primary read-only:cursor-default'
    onBlur={commit} onKeyDown={keyDown} />;
});

const GridRow = memo(function GridRow({ row, index, columns, selected, canEdit, handlers }: Readonly<{ row: ManualRow; index: number; columns: ManualColumn[]; selected: boolean; canEdit: boolean; handlers: CellHandlers }>) {
  const { t } = useModuleTranslation('semantic-model');
  return <tr style={{ height: ROW_HEIGHT }} className={cn('border-b', selected && 'bg-primary/10')}>
    <td className='w-10 border-b px-2 text-center'>
      {canEdit && row.record && <input type='checkbox' checked={selected} aria-label={t('manualTable.selectRow', { row: index + 1 })} className='h-4 w-4 cursor-pointer accent-primary'
        onChange={(event) => handlers.select(index, Boolean((event.nativeEvent as MouseEvent).shiftKey))} />}
    </td>
    <td className='w-12 border-b px-2 text-end text-xs tabular-nums text-muted-foreground'>{index + 1}</td>
    {columns.map((column, position) => <td key={column.id} className='border-b p-0'>
      <Cell value={cellText(row, column)} row={index} column={position} name={`${column.label} ${index + 1}`} canEdit={canEdit} handlers={handlers} />
    </td>)}
  </tr>;
});

/**
 * The cells of a manual table, spreadsheet style: a text box per cell, Enter and the arrows move between rows,
 * and a block copied from Excel or Sheets pastes from the focused cell on.
 */
export function ManualTableGrid({ columns, rows, selected, canEdit, focusRequest, onEdit, onPasteText, onAppend, onSelect, onSelectAll }: Readonly<{
  columns: ManualColumn[]; rows: ManualRow[]; selected: ReadonlySet<string>; canEdit: boolean; focusRequest: FocusRequest | null;
  onEdit: (row: number, column: number, value: string) => void;
  onPasteText: (row: number, column: number, text: string) => void;
  /** Add a blank row at the end (or find the one already there); returns its index. */
  onAppend: () => number | null;
  onSelect: (row: number, shift: boolean) => void;
  onSelectAll: (checked: boolean) => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [request, setRequest] = useState<FocusRequest | null>(focusRequest);
  const handled = useRef(0);
  useEffect(() => { if (focusRequest) setRequest(focusRequest); }, [focusRequest]);
  const viewport = scroller.current?.clientHeight || DEFAULT_VIEWPORT;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN);

  // Handlers are stable so a row only draws again when its own record changed.
  const latest = useRef({ rows, onEdit, onAppend, onSelect });
  latest.current = { rows, onEdit, onAppend, onSelect };
  const [handlers] = useState<CellHandlers>(() => ({
    edit: (row, column, value) => latest.current.onEdit(row, column, value),
    select: (row, shift) => latest.current.onSelect(row, shift),
    move: (row, column) => {
      const { rows: current, onAppend: append } = latest.current;
      if (row < 0) return;
      if (row < current.length) { setRequest({ row, column, tick: Math.random() }); return; }
      const added = append();
      if (added !== null) setRequest({ row: added, column: 0, tick: Math.random() });
    },
  }));

  useEffect(() => {
    if (!request || handled.current === request.tick) return;
    const box = scroller.current;
    if (!box) return;
    const top = request.row * ROW_HEIGHT;
    if (top < box.scrollTop || top + ROW_HEIGHT > box.scrollTop + viewport) {
      box.scrollTop = Math.max(0, top - viewport / 2);
      setScrollTop(box.scrollTop);
    }
    const target = box.querySelector<HTMLInputElement>(`[data-row="${request.row}"][data-col="${request.column}"]`);
    if (!target) return;
    handled.current = request.tick;
    target.focus();
    target.select();
  }, [request, rows.length, first, viewport]);

  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    const { row, col } = (event.target as HTMLElement).dataset;
    if (row === undefined || col === undefined) return;
    const text = event.clipboardData.getData('text');
    // One value pastes as text into the box; a block of cells spreads over the grid.
    if (!/[\t\r\n]/.test(text.replace(/[\r\n]+$/, ''))) return;
    event.preventDefault();
    onPasteText(Number(row), Number(col), text);
  };

  const stored = rows.filter((row) => row.record).length;
  const allSelected = stored > 0 && selected.size >= stored;
  return <div ref={scroller} className='min-h-0 flex-1 overflow-auto' onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} onPaste={paste}>
    <table className='w-full table-fixed border-separate border-spacing-0 text-sm' style={{ minWidth: 88 + NAME_WIDTH + (columns.length - 1) * FIELD_WIDTH }}>
      <colgroup>
        <col style={{ width: 40 }} /><col style={{ width: 48 }} />
        {columns.map((column, position) => <col key={column.id} style={{ width: position === 0 ? NAME_WIDTH : FIELD_WIDTH }} />)}
      </colgroup>
      <thead className='sticky top-0 z-10 bg-muted text-start text-xs font-semibold'>
        <tr>
          <th className='border-b px-2 py-2 text-center'>
            {canEdit && <input type='checkbox' checked={allSelected} aria-label={t('manualTable.selectAll')} className='h-4 w-4 cursor-pointer accent-primary' onChange={(event) => onSelectAll(event.target.checked)} />}
          </th>
          <th className='border-b px-2 py-2 text-end text-muted-foreground'>#</th>
          {columns.map((column) => <th key={column.id} className='truncate border-b px-2 py-2' title={column.label}>{column.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {first > 0 && <tr aria-hidden style={{ height: first * ROW_HEIGHT }} />}
        {rows.slice(first, last).map((row, offset) => <GridRow key={row.id} row={row} index={first + offset} columns={columns} selected={selected.has(row.id)} canEdit={canEdit} handlers={handlers} />)}
        {last < rows.length && <tr aria-hidden style={{ height: (rows.length - last) * ROW_HEIGHT }} />}
      </tbody>
    </table>
  </div>;
}
