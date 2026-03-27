import { describe, expect, it } from 'vitest';
import { buildSheetData, formatCellValue, getColumnLabel } from './excel';

describe('excel utils', () => {
  it('builds spreadsheet column labels', () => {
    expect(getColumnLabel(1)).toBe('A');
    expect(getColumnLabel(26)).toBe('Z');
    expect(getColumnLabel(27)).toBe('AA');
  });

  it('formats primitive and object cell values', () => {
    expect(formatCellValue({ text: 'hello' } as never)).toBe('hello');
    expect(formatCellValue({ value: 42 } as never)).toBe('42');
    expect(formatCellValue({ value: { richText: [{ text: 'A' }, { text: 'B' }] } } as never)).toBe('AB');
    expect(formatCellValue({ value: { hyperlink: 'https://a.test', text: 'link' } } as never)).toBe('link');
  });

  it('builds padded sheet data', () => {
    const worksheet = {
      name: 'Sheet1',
      actualColumnCount: 2,
      columnCount: 2,
      eachRow: (_opts: unknown, cb: (row: { eachCell: (opts: unknown, cb2: (cell: unknown, col: number) => void) => void }, rowNumber: number) => void) => {
        cb(
          {
            eachCell: (_opts2, cb2) => {
              cb2({ text: 'r1c1' }, 1);
              cb2({ text: 'r1c2' }, 2);
            },
          },
          1,
        );
      },
    };

    const data = buildSheetData(worksheet as never);
    expect(data.name).toBe('Sheet1');
    expect(data.rows[0]?.cells[0]).toBe('r1c1');
    expect(data.columnCount).toBeGreaterThanOrEqual(42);
    expect(data.rows.length).toBeGreaterThan(1);
  });
});
