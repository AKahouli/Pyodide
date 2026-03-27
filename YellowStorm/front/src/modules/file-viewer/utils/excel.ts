import type { Cell, Worksheet, CellHyperlinkValue } from 'exceljs';

export interface SheetRow {
  rowNumber: number;
  cells: string[];
}

export interface SheetData {
  name: string;
  rows: SheetRow[];
  columnCount: number;
}

const COLUMN_LABEL_CACHE = new Map<number, string>();
const EXTRA_VISIBLE_COLUMNS = 40;
const EXTRA_VISIBLE_ROWS = 40;

export function getColumnLabel(index: number): string {
  if (COLUMN_LABEL_CACHE.has(index)) {
    return COLUMN_LABEL_CACHE.get(index)!;
  }
  let label = '';
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCodePoint(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  COLUMN_LABEL_CACHE.set(index, label);
  return label;
}

type RichTextSegment = { text?: string };

const isHyperlinkValue = (value: unknown): value is CellHyperlinkValue => {
  return Boolean(value && typeof value === 'object' && 'hyperlink' in (value as Record<string, unknown>));
};

const joinRichTextSegments = (segments: RichTextSegment[] = []) => segments.map((segment) => segment.text ?? '').join('');

const stringifyPrimitive = (value: unknown): string | null => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return value.name ? `[Function ${value.name}]` : '[Function]';
  return null;
};

const stringifyObject = (value: Record<string, unknown>): string => {
  try {
    const json = JSON.stringify(value);
    if (json && json !== '{}') {
      return json;
    }
  } catch {
    // Ignore JSON errors and fall back to default string conversion
  }
  const objectToString = (value as { toString?: () => string }).toString;
  if (objectToString && objectToString !== Object.prototype.toString) {
    return objectToString.call(value);
  }
  const constructorName = value.constructor?.name;
  return constructorName ? `[object ${constructorName}]` : '[object]';
};

const safeStringify = (value: unknown): string => {
  const primitiveResult = stringifyPrimitive(value);
  if (primitiveResult !== null) {
    return primitiveResult;
  }
  if (typeof value === 'object' && value) {
    return stringifyObject(value as Record<string, unknown>);
  }
  return '';
};

const formatObjectValue = (value: Record<string, unknown>): string => {
  const textValue = (value as { text?: unknown }).text;
  if (typeof textValue === 'string') {
    return textValue;
  }

  const richTextValue = (value as { richText?: RichTextSegment[] }).richText;
  if (Array.isArray(richTextValue)) {
    return joinRichTextSegments(richTextValue);
  }

  const resultValue = (value as { result?: unknown }).result;
  if (resultValue !== undefined && resultValue !== null) {
    return safeStringify(resultValue);
  }

  const formulaValue = (value as { formula?: unknown }).formula;
  if (typeof formulaValue === 'string') {
    return formulaValue;
  }

  if (isHyperlinkValue(value) && typeof value.hyperlink === 'string') {
    const hyperlinkValue = value as CellHyperlinkValue;
    return hyperlinkValue.text ?? hyperlinkValue.hyperlink;
  }

  return safeStringify(value);
};

export function formatCellValue(cell: Cell | null | undefined): string {
  if (!cell) {
    return '';
  }
  if (cell.text) {
    return cell.text;
  }
  const value = cell.value as unknown;
  if (value === undefined || value === null) {
    return '';
  }
  if (value instanceof Date) {
    return value.toLocaleString();
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'bigint') {
    return safeStringify(value);
  }
  if (typeof value === 'object') {
    return formatObjectValue(value as Record<string, unknown>);
  }
  return safeStringify(value);
}

export function buildSheetData(sheet: Worksheet): SheetData {
  const rows: SheetRow[] = [];
  let maxColumns = sheet.actualColumnCount || sheet.columnCount || 0;

  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = formatCellValue(cell);
      if (colNumber > maxColumns) {
        maxColumns = colNumber;
      }
    });
    rows.push({ rowNumber, cells });
  });

  if (maxColumns === 0) {
    maxColumns = sheet.columnCount;
  }

  const columnCountWithPadding = Math.max(maxColumns, 0) + EXTRA_VISIBLE_COLUMNS;

  const normalizedRows = rows.map((row) => {
    if (row.cells.length < columnCountWithPadding) {
      const next = row.cells.slice();
      for (let i = row.cells.length; i < columnCountWithPadding; i += 1) {
        next[i] = '';
      }
      return { ...row, cells: next };
    }
    return row;
  });

  const paddedRows = normalizedRows.slice();
  const lastRowNumber = paddedRows.at(-1)?.rowNumber ?? 0;
  for (let i = 1; i <= EXTRA_VISIBLE_ROWS; i += 1) {
    const rowNumber = lastRowNumber + i;
    paddedRows.push({
      rowNumber,
      cells: Array.from({ length: columnCountWithPadding }, () => ''),
    });
  }

  return {
    name: sheet.name,
    rows: paddedRows,
    columnCount: columnCountWithPadding,
  };
}
