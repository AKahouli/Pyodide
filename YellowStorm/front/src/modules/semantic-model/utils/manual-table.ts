import type { AttributeDefinition } from '../types';

/**
 * Text going in and out of the manual table: what Excel or Sheets put on the clipboard (tab separated) and
 * CSV files (comma or semicolon separated), turned into the cells of the grid.
 */

/** A column of the grid: the record's name first, then one column per field of the concept. */
export interface ManualColumn {
  id: string;
  label: string;
  /** The key of the value in the record; null for the record's name. */
  attribute: string | null;
}

/** New values for some cells of one row, by column index. */
export type RowPatch = Record<number, string>;

export const NAME_COLUMN_ID = '__name';

export function manualColumns(attributes: AttributeDefinition[], nameLabel: string): ManualColumn[] {
  return [
    { id: NAME_COLUMN_ID, label: nameLabel, attribute: null },
    ...attributes.map((attribute) => ({ id: attribute.key, label: attribute.label, attribute: attribute.key })),
  ];
}

/** "Date of Birth", "date_of_birth" and "Date de naissance " compare on their letters and digits only. */
export const normalizeName = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** The delimiter of a table's first line: a tab (spreadsheet paste), else whichever of ";" and "," is used more outside quotes. */
export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { '\t': 0, ';': 0, ',': 0 };
  let quoted = false;
  for (const char of text.replace(/^﻿/, '')) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && char in counts) counts[char] += 1;
  }
  if (counts['\t'] > 0) return '\t';
  return counts[';'] > counts[','] ? ';' : ',';
}

/** Rows of cells; fields may be quoted ("a;b", "say ""hi""", line breaks inside quotes). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = false;
    } else if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length) rows.push([...row, cell]);
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

/** Pasted or imported text as rows of cells, its delimiter detected. */
export const parseTable = (text: string): string[][] => parseDelimited(text, detectDelimiter(text));

/** For each cell of a header row, the column it names (by label or key), or null; a column is named once. */
export function matchHeader(header: string[], columns: ManualColumn[]): Array<number | null> {
  const used = new Set<number>();
  return header.map((cell) => {
    const wanted = normalizeName(cell);
    if (!wanted) return null;
    const index = columns.findIndex((column, position) => !used.has(position)
      && (normalizeName(column.label) === wanted || (column.attribute !== null && normalizeName(column.attribute) === wanted)));
    if (index < 0) return null;
    used.add(index);
    return index;
  });
}

export interface TablePatches {
  patches: RowPatch[];
  /** The first row named columns, so it is not data. */
  header: boolean;
}

/**
 * Cells of a table as row patches. A first row naming columns places each cell under its column and is not data.
 * Otherwise cells go to the columns from `startColumn` on (where the focus was), left to right.
 * `header: 'auto'` takes the first row for a header only when most of its cells name a column and data follows it
 * (a lone pasted word is a value, not a header); `'always'` is for files, which have one.
 */
export function tableToPatches(table: string[][], columns: ManualColumn[], options: { startColumn: number; header: 'auto' | 'always' }): TablePatches {
  const matches = table.length ? matchHeader(table[0], columns) : [];
  const matched = matches.filter((match) => match !== null).length;
  const filled = table[0]?.filter((cell) => cell.trim() !== '').length ?? 0;
  const header = matched > 0 && (options.header === 'always' || (table.length > 1 && matched * 2 >= filled));
  const toPatch = (row: string[]): RowPatch => {
    const patch: RowPatch = {};
    row.forEach((cell, index) => {
      const column = header ? matches[index] : options.startColumn + index;
      if (column !== null && column !== undefined && column < columns.length) patch[column] = cell.trim();
    });
    return patch;
  };
  return { header, patches: (header ? table.slice(1) : table).map(toPatch) };
}
