import * as XLSX from 'xlsx';
import { parseBenchmarkWorkbook, parseSources } from './xlsx-benchmark-parser';

function buildWorkbook(rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Questions');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseSources', () => {
  it('expands page ranges and multiple files into parallel arrays', () => {
    const { files, pages } = parseSources('A.pdf, pages 1-2; B.pdf, pages 5, 8');
    expect(files).toEqual(['A.pdf', 'A.pdf', 'B.pdf', 'B.pdf']);
    expect(pages).toEqual([1, 2, 5, 8]);
  });

  it('ignores entries without a pages clause', () => {
    expect(parseSources('A.pdf sans pages;')).toEqual({ files: [], pages: [] });
    expect(parseSources('')).toEqual({ files: [], pages: [] });
  });
});

describe('parseBenchmarkWorkbook', () => {
  const buffer = buildWorkbook([
    ['ID', 'Cat', 'Question', 'Réponse', 'Note', 'Sources'],
    [1, '', 'Comment calculer le taux ?', 'Taux révisable...', '', 'Fiche CAT.pdf, pages 10-12'],
    [2, '', 'Deux fichiers', 'Réponse B', '', 'A.pdf, pages 1-2; B.pdf, pages 5, 8'],
    [null, '', 'ligne sans ID', 'x', '', ''],
    [3, '', 'Sans réponse', '', '', 'A.pdf, page 9'],
  ]);

  it('parses rows, expands sources, keeps missing answers', () => {
    const result = parseBenchmarkWorkbook(buffer);
    expect(result.queries).toHaveLength(3);
    expect(result.skippedRows).toBe(1);
    expect(result.queries[0]).toEqual({
      query_id: 'Q001',
      query: 'Comment calculer le taux ?',
      answer: 'Taux révisable...',
      required_file: ['Fiche CAT.pdf', 'Fiche CAT.pdf', 'Fiche CAT.pdf'],
      page: [10, 11, 12],
    });
    expect(result.queries[1].required_file).toEqual(['A.pdf', 'A.pdf', 'B.pdf', 'B.pdf']);
    expect(result.queries[1].page).toEqual([1, 2, 5, 8]);
    expect(result.queries[2].answer).toBe('');
    expect(result.queries[2].page).toEqual([9]);
  });

  it('rejects workbooks without a Questions sheet', () => {
    const ws = XLSX.utils.aoa_to_sheet([['ID'], [1]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    const bad = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    expect(() => parseBenchmarkWorkbook(bad)).toThrow(/Questions/);
  });
});
